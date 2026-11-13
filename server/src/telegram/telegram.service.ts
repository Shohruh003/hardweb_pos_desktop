import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Raw, Repository } from 'typeorm';
import {
  ExpenseEntity,
  OrderEntity,
  PaymentEntity,
  SettingsEntity,
} from '../entities';
import { OrderStatus, lineSum, roundSum } from '@hardweb-pos/shared';
import {
  escapeHtml,
  inDaySql,
  localDateKey,
  localDayWindow,
  parseReportTime,
} from './telegram.util';

// Direktorga Telegram bot orqali xabar yuboradi:
//  - vozvrat (refund) bo'lganda darhol (TZ #10)
//  - har kuni belgilangan vaqtda kunlik hisobot (TZ #8)
// Sozlamalar (token, bir yoki bir nechta chat id, hisobot vaqti) — "Sozlamalar" oynasidan
// (settings jadvali). Bo'sh bo'lsa server/.env dagi zaxira qiymatlar ishlatiladi:
//  TELEGRAM_BOT_TOKEN=...      (BotFather'dan)
//  TELEGRAM_CHAT_ID=...        (chat id'lar: vergul/probel bilan)
//  TELEGRAM_DAILY_TIME=23:59   (kunlik hisobot vaqti)
// Xabarlar HTML rejimida — foydalanuvchi matni (taom nomi, sabab, ism) escapeHtml() orqali qo'yiladi.

/** Telegram API so'rovi uchun kutish vaqti (tarmoq osilib qolsa so'rov cheksiz kutmasin) */
const TELEGRAM_TIMEOUT_MS = 10_000;
/** Kunlik hisobot vaqtini tekshirish oralig'i */
const TICK_MS = 60_000;
/**
 * Hisobot vaqti o'tib ketgan bo'lsa ham shu muddat ichida yuboriladi: taymer biroz kechiksa
 * (daqiqa "sakrab" ketsa), server shu payt qayta ishga tushsa yoki yuborish muvaffaqiyatsiz
 * bo'lsa — keyingi daqiqalarda qayta urinadi.
 */
const DAILY_GRACE_MS = 5 * 60_000;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Telegram');
  /** Oxirgi yuborilgan kunlik hisobot kuni (mahalliy YYYY-MM-DD) */
  private lastDailySent = '';
  private dailyInFlight = false;
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PaymentEntity)
    private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(ExpenseEntity)
    private readonly expenses: Repository<ExpenseEntity>,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(SettingsEntity)
    private readonly settings: Repository<SettingsEntity>,
  ) {}

  // Token/chat DB sozlamalaridan (har restoran o'ziniki), bo'lmasa .env'dan
  private async creds() {
    const s = await this.settings.findOne({ where: { id: 'main' } });
    return {
      token: s?.telegramToken || this.config.get<string>('TELEGRAM_BOT_TOKEN', ''),
      chatId: s?.telegramChatId || this.config.get<string>('TELEGRAM_CHAT_ID', ''),
      dailyTime: s?.dailyReportTime || this.config.get<string>('TELEGRAM_DAILY_TIME', '23:59'),
    };
  }

  onModuleInit() {
    // Har daqiqada kunlik hisobot vaqtini tekshiramiz. Har qanday xato (masalan baza band)
    // faqat logga yoziladi — rad etilgan promise server jarayonini yiqitmasligi kerak.
    this.tickTimer = setInterval(() => {
      this.tickDaily().catch((e) =>
        this.logger.error(`Kunlik hisobot tekshiruvida xato: ${errorText(e)}`),
      );
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  /** Xabarni barcha qabul qiluvchilarga yuborish. Hech qachon throw qilmaydi. */
  async sendMessage(text: string): Promise<boolean> {
    let token = '';
    let chatId = '';
    try {
      ({ token, chatId } = await this.creds());
    } catch (e) {
      this.logger.warn(`Telegram sozlamalarini o‘qib bo‘lmadi: ${errorText(e)}`);
      return false;
    }
    if (!token || !chatId) {
      this.logger.warn('Telegram sozlanmagan (token/chat id yo‘q)');
      return false;
    }
    // Bir yoki bir nechta qabul qiluvchi (ega + direktor...) — vergul/probel/nuqta-vergul bilan.
    // Parallel yuboramiz — biri sekin javob bersa boshqalari kutib qolmasin.
    const chatIds = chatId
      .split(/[\s,;]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    const results = await Promise.all(chatIds.map((id) => this.sendTo(token, id, text)));
    return results.some(Boolean);
  }

  private async sendTo(token: string, chatId: string, text: string): Promise<boolean> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      });
      if (res.ok) return true;
      // Telegram sababini ham yozamiz (masalan "chat not found", "can't parse entities")
      const body = (await res.json().catch(() => null)) as { description?: string } | null;
      this.logger.warn(
        `Telegram xatosi (${chatId}): ${res.status}${body?.description ? ` — ${body.description}` : ''}`,
      );
      return false;
    } catch (e) {
      this.logger.warn(`Telegram yuborilmadi (${chatId}): ${errorText(e)}`);
      return false;
    }
  }

  // Chat id'ni avtomatik aniqlash — direktor botga /start yozgach getUpdates orqali.
  // token berilmasa — sozlamalardagi token ishlatiladi.
  async detectChatId(token?: string): Promise<string | null> {
    try {
      const tok = token || (await this.creds()).token;
      if (!tok) return null;
      const res = await fetch(`https://api.telegram.org/bot${tok}/getUpdates`, {
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      const updates: any[] = data.result || [];
      // Eng oxirgi xabarning chat id'si
      for (let i = updates.length - 1; i >= 0; i--) {
        const chat = updates[i]?.message?.chat || updates[i]?.my_chat_member?.chat;
        if (chat?.id) return String(chat.id);
      }
      return null;
    } catch {
      return null;
    }
  }

  // Vozvrat bo'lganda direktorga darhol xabar (mahsulotlari bilan)
  async notifyRefund(info: {
    tableNumber?: number;
    total: number;
    reason: string;
    by: string;
    items?: string;
  }) {
    const money = new Intl.NumberFormat('uz-UZ').format(roundSum(info.total));
    await this.sendMessage(
      `🔴 <b>VOZVRAT</b>\n` +
        `Stol: №${escapeHtml(info.tableNumber ?? '-')}\n` +
        (info.items ? `Mahsulotlar: ${escapeHtml(info.items)}\n` : '') +
        `Summa: <b>${money} so'm</b>\n` +
        `Sabab: ${escapeHtml(info.reason || '—')}\n` +
        `Kim: ${escapeHtml(info.by)}`,
    );
  }

  /**
   * Har daqiqada: hisobot vaqti kelganmi? Vaqt kelgan bo'lsa (yoki DAILY_GRACE_MS ichida
   * o'tib ketgan bo'lsa) va shu kun uchun hali yuborilmagan bo'lsa — yuboradi.
   * Yarim tunga yaqin vaqtlar (masalan 23:59) uchun kechagi kun ham tekshiriladi: tik 00:00 dan
   * keyin kechiksa ham kechagi hisobot yo'qolmaydi. Xatolar ushlanadi va logga yoziladi.
   */
  private async tickDaily(now = new Date()): Promise<void> {
    if (this.dailyInFlight) return;
    try {
      const { token, chatId, dailyTime } = await this.creds();
      if (!token || !chatId) return; // Telegram sozlanmagan — hisobot tayyorlashga hojat yo'q
      const at = parseReportTime(dailyTime);
      if (!at) return;
      for (const dayOffset of [0, -1]) {
        const due = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + dayOffset,
          at.h,
          at.m,
          0,
          0,
        );
        const late = now.getTime() - due.getTime();
        if (late < 0 || late >= DAILY_GRACE_MS) continue;
        const key = localDateKey(due);
        if (this.lastDailySent === key) return;
        this.dailyInFlight = true;
        try {
          if (await this.sendDailyReport(due)) this.lastDailySent = key;
          else this.logger.warn('Kunlik hisobot yuborilmadi — keyingi daqiqada qayta urinamiz');
        } finally {
          this.dailyInFlight = false;
        }
        return;
      }
    } catch (e) {
      this.logger.error(`Kunlik hisobotni yuborishda xato: ${errorText(e)}`);
    }
  }

  /** Kunlik hisobotni yuborish (`day` — hisobot kuni, standart: bugun). Yuborilsa true. */
  async sendDailyReport(day: Date = new Date()): Promise<boolean> {
    return this.sendMessage(await this.buildDailyReport(day));
  }

  // Kunlik hisobot — tushum, cheklar, rasxod, vozvratlar (mahalliy kalendar kun bo'yicha)
  async buildDailyReport(day: Date = new Date()): Promise<string> {
    // Kun oralig'i [00:00, ertasi 00:00) — bazadagi UTC matn bilan to'g'ri solishtiriladi
    // (ISO 'T…Z' qatorni matn sifatida solishtirish 00:00–04:59 to'lovlarini tushirib qoldirardi)
    const { start, from, to } = localDayWindow(day);
    const range = { dayFrom: from, dayTo: to };
    const inDay = Raw((column) => inDaySql(column), range);

    // Tushum — vozvrat qilinmagan cheklar bo'yicha
    const revRow = await this.payments
      .createQueryBuilder('p')
      .innerJoin(OrderEntity, 'o', 'o.id = p.order_id')
      .select('COALESCE(SUM(p.amount), 0)', 'sum')
      .where(inDaySql('p.created_at'), range)
      .andWhere('o.refunded = 0')
      .getRawOne<{ sum: string | number }>();
    const revenue = roundSum(revRow?.sum ?? 0);

    const exps = await this.expenses.find({ where: { createdAt: inDay } });
    const expenseTotal = roundSum(exps.reduce((s, e) => s + Number(e.amount), 0));

    // Vozvratlar — mahsulotlari va umumiy summasi bilan
    const refundedOrders = await this.orders.find({
      where: { refunded: true, refundedAt: inDay },
      order: { refundedAt: 'DESC' },
    });
    const orderSum = (o: OrderEntity) =>
      (o.items || []).reduce((a, it) => a + lineSum(it.price, it.quantity), 0);
    const refundTotal = refundedOrders.reduce((s, o) => s + orderSum(o), 0);
    const closedCount = await this.orders.count({
      where: { status: OrderStatus.Closed, closedAt: inDay },
    });

    // Hali yopilmagan (ochiq) cheklar — hisobot chala emasligini bildirish uchun
    const openCount = await this.orders.count({
      where: { status: Not(OrderStatus.Closed), refunded: false },
    });

    const fmt = (n: number) => new Intl.NumberFormat('uz-UZ').format(n);

    // Vozvrat qilingan mahsulotlar ro'yxati (eng ko'pi 15 ta chek)
    let refundBlock = '';
    if (refundedOrders.length) {
      const lines = refundedOrders.slice(0, 15).map((o) => {
        const items = (o.items || [])
          .map((it) => `${Number(it.quantity)}× ${escapeHtml(it.menuItemName)}`)
          .join(', ');
        const reason = o.refundReason ? ` — ${escapeHtml(o.refundReason)}` : '';
        return `  • ${items} = ${fmt(orderSum(o))}${reason}`;
      });
      refundBlock =
        `\n<b>Qaytarilgan mahsulotlar:</b>\n${lines.join('\n')}` +
        (refundedOrders.length > 15 ? `\n  ...yana ${refundedOrders.length - 15} ta` : '');
    }

    return (
      `📊 <b>Kunlik hisobot</b> (${start.toLocaleDateString('uz-UZ')})\n\n` +
      `💰 Tushum (sof): <b>${fmt(revenue)} so'm</b>\n` +
      `🧾 Yopilgan cheklar: ${closedCount}\n` +
      `💸 Rasxod: ${fmt(expenseTotal)} so'm\n` +
      `↩️ Vozvratlar: ${refundedOrders.length} ta — <b>${fmt(refundTotal)} so'm</b>\n` +
      refundBlock +
      `\n━━━━━━━━━━━━\n` +
      `✅ Sof (rasxodsiz): <b>${fmt(revenue - expenseTotal)} so'm</b>` +
      (openCount > 0
        ? `\n\n⚠️ <b>Diqqat:</b> hozir <b>${openCount} ta chek hali ochiq</b> (yopilmagan). ` +
          `Hisobot to'liq bo'lishi uchun barcha stollar yopilgach qayta yuboring.`
        : `\n\n🟢 Barcha cheklar yopilgan — hisobot to'liq.`)
    );
  }
}
