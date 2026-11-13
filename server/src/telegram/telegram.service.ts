import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { orderTotalsOf } from '../orders/order-rules';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { Not, Raw, Repository } from 'typeorm';
import {
  ExpenseEntity,
  OrderEntity,
  PaymentEntity,
  SettingsEntity,
} from '../entities';
import {
  ORDER_TYPES,
  ORDER_TYPE_LABELS,
  OrderStatus,
  OrderType,
  orderTypeOf,
  roundSum,
} from '@hardweb-pos/shared';
import type { CashSummary, OrderVoidedPayload, VoidReport, WaiterShareReport } from '@hardweb-pos/shared';
import {
  buildVoidMessage,
  escapeHtml,
  formatMoney,
  formatQuantity,
  inDaySql,
  latestReportDue,
  localDateKey,
  localDayWindow,
  parseReportTime,
  VoidNoticeItem,
} from './telegram.util';
import { ReportsService } from '../reports/reports.service';
import { dayRange } from '../reports/report-dates';

// Direktorga Telegram bot orqali xabar yuboradi:
//  - vozvrat (refund) bo'lganda darhol (TZ #10)
//  - otkaz (yuborilgan taom bekor qilinganda) darhol (B19)
//  - har kuni belgilangan vaqtda kunlik hisobot (TZ #8)
// Sozlamalar (token, bir yoki bir nechta chat id, hisobot vaqti) — "Sozlamalar" oynasidan
// (settings jadvali). Bo'sh bo'lsa server/.env dagi zaxira qiymatlar ishlatiladi:
//  TELEGRAM_BOT_TOKEN=...      (BotFather'dan)
//  TELEGRAM_CHAT_ID=...        (chat id'lar: vergul/probel bilan)
//  TELEGRAM_DAILY_TIME=23:59   (kunlik hisobot vaqti)
// Xabarlar HTML rejimida — foydalanuvchi matni (taom nomi, sabab, ism) escapeHtml() orqali qo'yiladi.
//
// Internet bo'lmasa ham (D3): POS lokal tarmoqda to'liq ishlaydi, faqat Telegram internetga
// muhtoj. Kunlik hisobot yuborilmasa (internet yo'q / Telegram xatosi) — har ~10 daqiqada qayta
// urinadi, toki yuborilguncha yoki keyingi kunning hisobot vaqti kelguncha. Oxirgi yuborilgan
// kun baza fayli yonidagi kichik faylda saqlanadi — server qayta ishga tushsa ham hisobot ikki
// marta ketmaydi va yo'qolmaydi (internet qaytgach yuboriladi).

/** Telegram API so'rovi uchun kutish vaqti (tarmoq osilib qolsa so'rov cheksiz kutmasin) */
const TELEGRAM_TIMEOUT_MS = 10_000;
/** Kunlik hisobot vaqtini tekshirish oralig'i */
const TICK_MS = 60_000;
/**
 * Holat fayli bo'lmasa (birinchi ishga tushish yoki fayl yozilmaydi): server ishga tushishidan
 * shuncha oldin kelgan hisobot vaqtigacha qamraladi — undan eskisini oldingi versiya yuborgan
 * bo'lishi mumkin (ikki marta yubormaslik uchun o'tkazib yuboriladi).
 */
const DAILY_GRACE_MS = 5 * 60_000;
/** Kunlik hisobot yuborilmasa — shuncha vaqtdan keyin qayta urinish */
const DAILY_RETRY_MS = 10 * 60_000;
/** Oxirgi yuborilgan kunlik hisobot sanasi saqlanadigan fayl (baza fayli yonida) */
const STATE_FILE = 'telegram-state.json';
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Telegram xabari chegarasi 4096 belgi — undan oshsa tafsilot ro'yxatlarisiz (qisqa) yuboriladi */
const TELEGRAM_TEXT_LIMIT = 3900;
/** Kunlik hisobotdagi tafsilot ro'yxatlari chegarasi */
const REPORT_REFUNDS_MAX = 10;
const REPORT_VOIDS_MAX = 8;
const REPORT_WAITERS_MAX = 15;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** notifyVoid() kiritmasi: OrderVoidedPayload; taom qatorida summa (sum yoki price) bo'lsa — xabarda ko'rsatiladi */
export type VoidNotification = Omit<OrderVoidedPayload, 'items'> & {
  items: Array<OrderVoidedPayload['items'][number] & Pick<VoidNoticeItem, 'sum' | 'price'>>;
};

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Telegram');
  /** Oxirgi yuborilgan kunlik hisobot kuni (mahalliy YYYY-MM-DD) — holat faylida ham saqlanadi */
  private lastDailySent = '';
  /** Holat fayli o'qildimi (yo'q bo'lsa — server ishga tushishidan oldingi hisobotlar qamralmaydi) */
  private dailyStateKnown = false;
  /** Hozir qaysi kun hisoboti yuborilmoqda / qayta urinilmoqda, nechanchi urinish va oxirgi urinish vaqti */
  private dailyRetryKey = '';
  private dailyAttempts = 0;
  private dailyLastAttemptAt = 0;
  private dailyInFlight = false;
  private readonly startedAt = Date.now();
  private readonly stateFile: string;
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
    private readonly reports: ReportsService,
  ) {
    // Baza fayli qayerda bo'lsa (app.module bilan bir xil qoida) — holat fayli o'sha papkada
    const dbFile = this.config.get<string>('DB_FILE') || join(process.cwd(), 'data', 'dasturxon.db');
    this.stateFile = join(dirname(dbFile), STATE_FILE);
  }

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
    this.loadDailyState();
    // Har daqiqada kunlik hisobot vaqtini tekshiramiz. Har qanday xato (masalan baza band)
    // faqat logga yoziladi — rad etilgan promise server jarayonini yiqitmasligi kerak.
    this.tickTimer = setInterval(() => {
      this.tickDaily().catch((e) =>
        this.logger.error(`Kunlik hisobot tekshiruvida xato: ${errorText(e)}`),
      );
    }, TICK_MS);
    this.tickTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  /** Oxirgi yuborilgan kunlik hisobot sanasini holat faylidan o'qish (yo'q/buzilgan — noma'lum) */
  private loadDailyState(): void {
    try {
      const data = JSON.parse(readFileSync(this.stateFile, 'utf8')) as { lastDailySent?: unknown } | null;
      const last = typeof data?.lastDailySent === 'string' ? data.lastDailySent : '';
      if (last && !DATE_KEY_RE.test(last)) throw new Error('sana noto‘g‘ri');
      this.lastDailySent = last;
      this.dailyStateKnown = true;
    } catch (e) {
      // Fayl hali yo'q (birinchi ishga tushish) — oddiy holat; boshqa xato bo'lsa logga yozamiz
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.logger.warn(`Telegram holat faylini o‘qib bo‘lmadi (${this.stateFile}): ${errorText(e)}`);
      }
      this.dailyStateKnown = false;
    }
  }

  /** Kunlik hisobot yuborildi — xotirada va holat faylida belgilaymiz (qayta ishga tushganda ham takrorlanmasin) */
  private markDailySent(key: string): void {
    this.lastDailySent = key;
    this.dailyRetryKey = '';
    this.dailyAttempts = 0;
    try {
      writeFileSync(
        this.stateFile,
        JSON.stringify({ lastDailySent: key, sentAt: new Date().toISOString() }),
        'utf8',
      );
      this.dailyStateKnown = true;
    } catch (e) {
      // Yozib bo'lmasa ham xotirada belgilangan — shu jarayon davomida takrorlanmaydi
      this.logger.warn(`Telegram holat faylini yozib bo‘lmadi (${this.stateFile}): ${errorText(e)}`);
    }
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

  // Vozvrat bo'lganda direktorga darhol xabar (mahsulotlari bilan).
  // orderName — orderDisplayName(): "Stol 5" / "Olib ketish #12" / "Yetkazish #5"; hall — faqat stolga.
  async notifyRefund(info: {
    orderName: string;
    hall?: string | null;
    total: number;
    reason: string;
    by: string;
    items?: string;
  }) {
    const money = new Intl.NumberFormat('uz-UZ').format(roundSum(info.total));
    await this.sendMessage(
      `🔴 <b>VOZVRAT</b>\n` +
        `Buyurtma: ${escapeHtml(info.orderName || '-')}` +
        (info.hall ? ` (${escapeHtml(info.hall)})` : '') +
        `\n` +
        (info.items ? `Mahsulotlar: ${escapeHtml(info.items)}\n` : '') +
        `Summa: <b>${money} so'm</b>\n` +
        `Sabab: ${escapeHtml(info.reason || '—')}\n` +
        `Kim: ${escapeHtml(info.by)}`,
    );
  }

  /**
   * Otkaz (B19): direktorga bitta qisqa xabar —
   *   "🚫 Otkaz: Stol 5 — 1 × BULYON (6 000 so‘m) — sabab: Mijoz voz kechdi — Kassir".
   * Telegram sozlanmagan bo'lsa jim o'tkazib yuboriladi. Hech qachon throw qilmaydi (fonda chaqiriladi).
   */
  async notifyVoid(payload: VoidNotification): Promise<void> {
    try {
      const text = buildVoidMessage({
        orderName: payload?.orderName,
        items: payload?.items ?? [],
        reason: payload?.reason,
        userName: payload?.userName,
        wholeOrder: !!payload?.wholeOrder,
      });
      if (!text) return;
      const { token, chatId } = await this.creds();
      if (!token || !chatId) return; // Telegram sozlanmagan — jim
      if (!(await this.sendMessage(text))) {
        this.logger.warn(`Otkaz xabari Telegram'ga yuborilmadi (${payload?.orderName ?? '-'})`);
      }
    } catch (e) {
      this.logger.warn(`Otkaz xabarini yuborib bo‘lmadi: ${errorText(e)}`);
    }
  }

  /**
   * Har daqiqada: eng so'nggi hisobot vaqti (bugungi yoki kechagi) kelgan va shu kun hisoboti hali
   * yuborilmagan bo'lsa — yuboradi. Yuborilmasa (internet yo'q / Telegram xatosi) — har
   * DAILY_RETRY_MS da qayta urinadi, toki yuborilguncha yoki keyingi kunning hisobot vaqti
   * kelguncha (shunda yangi kun hisoboti yuboriladi). Har urinish logga yoziladi.
   * Yarim tunga yaqin vaqtlar (masalan 23:59) ham to'g'ri: 00:30 da kechagi hisobot qayta urinadi.
   */
  private async tickDaily(now = new Date()): Promise<void> {
    if (this.dailyInFlight) return;
    try {
      const { token, chatId, dailyTime } = await this.creds();
      if (!token || !chatId) return; // Telegram sozlanmagan — hisobot tayyorlashga hojat yo'q
      const at = parseReportTime(dailyTime);
      if (!at) return;
      const due = latestReportDue(now, at);
      const key = localDateKey(due);
      if (this.lastDailySent === key) return; // shu kun hisoboti allaqachon yuborilgan
      // Holat fayli yo'q: server ishga tushishidan oldin kelgan vaqtni (oldingi versiya yuborgan
      // bo'lishi mumkin) qamramaymiz — hisobot ikki marta ketmasin
      if (!this.dailyStateKnown && due.getTime() < this.startedAt - DAILY_GRACE_MS) return;
      if (this.dailyRetryKey === key && now.getTime() - this.dailyLastAttemptAt < DAILY_RETRY_MS) return;

      if (this.dailyRetryKey && this.dailyRetryKey !== key) {
        this.logger.warn(
          `Kunlik hisobot (${this.dailyRetryKey}) ${this.dailyAttempts} ta urinishda yuborilmadi — ` +
            `endi ${key} hisoboti yuboriladi`,
        );
      }
      if (this.dailyRetryKey !== key) {
        this.dailyRetryKey = key;
        this.dailyAttempts = 0;
      }
      this.dailyAttempts += 1;
      this.dailyLastAttemptAt = now.getTime();
      this.dailyInFlight = true;
      try {
        this.logger.log(`Kunlik hisobot (${key}) yuborilmoqda — ${this.dailyAttempts}-urinish`);
        if (await this.sendDailyReport(due)) {
          this.markDailySent(key);
          this.logger.log(`Kunlik hisobot (${key}) yuborildi`);
        } else {
          this.logger.warn(
            `Kunlik hisobot (${key}) yuborilmadi (internet yoki Telegram xatosi) — ` +
              `${DAILY_RETRY_MS / 60_000} daqiqadan so‘ng qayta urinamiz`,
          );
        }
      } finally {
        this.dailyInFlight = false;
      }
    } catch (e) {
      this.logger.error(`Kunlik hisobotni yuborishda xato: ${errorText(e)}`);
    }
  }

  /** Kunlik hisobotni yuborish (`day` — hisobot kuni, standart: bugun). Yuborilsa true. */
  async sendDailyReport(day: Date = new Date()): Promise<boolean> {
    return this.sendMessage(await this.buildDailyReport(day));
  }

  /**
   * Hisobot qismlari (ofitsiantlar ulushi, otkazlar, kassa holati) ReportsService'dan olinadi.
   * Biror qism tayyorlanmasa ham kunlik hisobot asosiy raqamlar bilan baribir yuboriladi.
   */
  private async optionalPart<T>(label: string, load: () => Promise<T>): Promise<T | null> {
    try {
      return await load();
    } catch (e) {
      this.logger.warn(`Kunlik hisobot: "${label}" qismi tayyorlanmadi — ${errorText(e)}`);
      return null;
    }
  }

  // Kunlik hisobot — tushum, to'lov turlari va kassa holati, kirim/chiqim, vozvratlar, otkazlar,
  // ofitsiantlar ulushi (mahalliy kalendar kun bo'yicha)
  async buildDailyReport(day: Date = new Date()): Promise<string> {
    // Kun oralig'i [00:00, ertasi 00:00) — bazadagi UTC matn bilan to'g'ri solishtiriladi
    // (ISO 'T…Z' qatorni matn sifatida solishtirish 00:00–04:59 to'lovlarini tushirib qoldirardi)
    const { start, from, to } = localDayWindow(day);
    const range = { dayFrom: from, dayTo: to };
    const inDay = Raw((column) => inDaySql(column), range);
    const reportDay = dayRange(day);

    // Tushum — vozvrat qilinmagan cheklar bo'yicha
    const revRow = await this.payments
      .createQueryBuilder('p')
      .innerJoin(OrderEntity, 'o', 'o.id = p.order_id')
      .select('COALESCE(SUM(p.amount), 0)', 'sum')
      .where(inDaySql('p.created_at'), range)
      .andWhere('o.refunded = 0')
      .getRawOne<{ sum: string | number }>();
    const revenue = roundSum(revRow?.sum ?? 0);

    // Kassa harakatlari: chiqim (rasxod) va kirim (kassaga qo'yilgan pul) — B33
    const exps = await this.expenses.find({ where: { createdAt: inDay } });
    const kirimTotal = roundSum(exps.filter((e) => e.kind === 'kirim').reduce((s, e) => s + Number(e.amount), 0));
    const expenseTotal = roundSum(exps.filter((e) => e.kind !== 'kirim').reduce((s, e) => s + Number(e.amount), 0));

    const cash = await this.optionalPart<CashSummary>('kassa holati', () => this.reports.cashSummary(reportDay));
    const voids = await this.optionalPart<VoidReport>('otkazlar', () => this.reports.voids(reportDay));
    const sharePercent = (await this.optionalPart('ulush foizi', () => this.reports.defaultSharePercent())) ?? 0;
    const shares =
      sharePercent > 0
        ? await this.optionalPart<WaiterShareReport>('ofitsiantlar ulushi', () =>
            this.reports.waiterShares(reportDay, sharePercent),
          )
        : null;

    // Vozvratlar — mahsulotlari va umumiy summasi bilan
    const refundedOrders = await this.orders.find({
      where: { refunded: true, refundedAt: inDay },
      order: { refundedAt: 'DESC' },
    });
    // Qaytarilgan summa — chek summasi (chegirma/xizmat/yetkazish narxi bilan), /reports/refunds
    // bilan bir xil. Qatorlarda takeaway (saboy) belgisi bor — xizmat haqi faqat zaldagilarga.
    const orderSum = (o: OrderEntity) =>
      orderTotalsOf(o).total;
    const refundTotal = refundedOrders.reduce((s, o) => s + orderSum(o), 0);
    const closedCount = await this.orders.count({
      where: { status: OrderStatus.Closed, closedAt: inDay },
    });

    // Hali yopilmagan (ochiq) cheklar — hisobot chala emasligini bildirish uchun
    const openCount = await this.orders.count({
      where: { status: Not(OrderStatus.Closed), refunded: false },
    });

    // Buyurtma turlari bo'yicha tushum (stolga / olib ketish / yetkazish) — shu kunning to'lovlari
    const typeRows = await this.payments
      .createQueryBuilder('p')
      .innerJoin(OrderEntity, 'o', 'o.id = p.order_id')
      .select('o.order_type', 'type')
      .addSelect('COALESCE(SUM(p.amount), 0)', 'sum')
      .addSelect('COUNT(DISTINCT p.order_id)', 'orders')
      .where(inDaySql('p.created_at'), range)
      .andWhere('o.refunded = 0')
      .groupBy('o.order_type')
      .getRawMany<{ type: string | null; sum: string | number; orders: string | number }>();
    const byType = new Map<OrderType, { sum: number; orders: number }>();
    for (const r of typeRows) {
      const t = orderTypeOf({ type: r.type });
      const cur = byType.get(t) ?? { sum: 0, orders: 0 };
      cur.sum += roundSum(r.sum);
      cur.orders += Number(r.orders) || 0;
      byType.set(t, cur);
    }

    const fmt = (n: number) => formatMoney(n);
    const som = (n: number) => `${fmt(n)} so‘m`;
    const typeIcon: Record<OrderType, string> = {
      [OrderType.DineIn]: '🪑',
      [OrderType.Takeaway]: '🥡',
      [OrderType.Delivery]: '🛵',
    };
    // Faqat savdo bo'lgan turlar ko'rsatiladi (bo'sh qatorlar hisobotni cho'zmasin)
    const typeLines = ORDER_TYPES.filter((t) => (byType.get(t)?.orders ?? 0) > 0).map((t) => {
      const v = byType.get(t)!;
      return `  ${typeIcon[t]} ${ORDER_TYPE_LABELS[t]}: ${v.orders} ta — ${som(v.sum)}`;
    });
    const typeBlock = typeLines.length ? `${typeLines.join('\n')}\n` : '';

    // To'lov turlari va kassa holati (B33): faqat summasi bor usullar; naqd kassada qancha bo'lishi kerak
    let cashBlock = '';
    if (cash) {
      const methodLines = cash.byMethod
        .filter((m) => m.amount > 0)
        .map((m) => `  • ${escapeHtml(m.label)}: ${som(m.amount)}`);
      const repaid = cash.debtRepaid.reduce((s, r) => s + r.amount, 0);
      cashBlock =
        (methodLines.length ? `\n💳 <b>To‘lov turlari:</b>\n${methodLines.join('\n')}\n` : '') +
        (repaid > 0 ? `🤝 Qaytarilgan qarzlar: ${som(repaid)}\n` : '') +
        (cash.refundsCash > 0 ? `💵 Naqd vozvrat (kassadan): ${som(cash.refundsCash)}\n` : '');
    }
    const cashExpected = cash ? `🏦 Kassada bo‘lishi kerak (naqd): <b>${som(cash.expectedCash)}</b>\n` : '';

    // Vozvrat qilingan mahsulotlar ro'yxati
    const refundDetail = (): string => {
      if (!refundedOrders.length) return '';
      const lines = refundedOrders.slice(0, REPORT_REFUNDS_MAX).map((o) => {
        const items = (o.items || [])
          .map((it) => `${formatQuantity(it.quantity, it.unit)}× ${escapeHtml(it.menuItemName)}`)
          .join(', ');
        const reason = o.refundReason ? ` — ${escapeHtml(o.refundReason)}` : '';
        return `  • ${items} = ${fmt(orderSum(o))}${reason}`;
      });
      return (
        `<b>Qaytarilgan mahsulotlar:</b>\n${lines.join('\n')}\n` +
        (refundedOrders.length > REPORT_REFUNDS_MAX ? `  …yana ${refundedOrders.length - REPORT_REFUNDS_MAX} ta\n` : '')
      );
    };

    // Otkazlar (B19): soni (qatorlar) va summasi; tafsilot — eng yangilari
    const voidHead = voids ? `🚫 Otkazlar: ${voids.count} ta — <b>${som(voids.total)}</b>\n` : '';
    const voidDetail = (): string => {
      if (!voids || voids.items.length === 0) return '';
      const lines = voids.items.slice(0, REPORT_VOIDS_MAX).map((v) => {
        const reason = v.reason ? ` — ${escapeHtml(v.reason)}` : '';
        const who = v.userName ? ` — ${escapeHtml(v.userName)}` : '';
        return (
          `  • ${escapeHtml(v.orderName ?? 'Buyurtma')}: ${formatQuantity(v.quantity, v.unit)} × ` +
          `${escapeHtml(v.name)} (${fmt(v.sum)})${reason}${who}`
        );
      });
      return lines.join('\n') + '\n' + (voids.count > REPORT_VOIDS_MAX ? `  …yana ${voids.count - REPORT_VOIDS_MAX} ta\n` : '');
    };

    // Ofitsiantlar ulushi (B20): ism — ulush, eng kattasi birinchi (faqat ulushi borlar)
    let shareBlock = '';
    if (shares) {
      const rows = shares.rows.filter((r) => r.shareAmount > 0).sort((a, b) => b.shareAmount - a.shareAmount);
      if (rows.length) {
        const lines = rows
          .slice(0, REPORT_WAITERS_MAX)
          .map((r) => `  • ${escapeHtml(r.waiterName)} — <b>${som(r.shareAmount)}</b> (${fmt(r.dineInSales)} dan)`);
        shareBlock =
          `\n👤 <b>Ofitsiantlar ulushi (${fmt2(shares.sharePercent)}%):</b>\n${lines.join('\n')}\n` +
          (rows.length > REPORT_WAITERS_MAX ? `  …yana ${rows.length - REPORT_WAITERS_MAX} ta\n` : '') +
          `  Jami: ${som(shares.totals.shareAmount)}\n`;
      }
    }

    const build = (details: boolean) =>
      `📊 <b>Kunlik hisobot</b> (${dmy(start)})\n\n` +
      `💰 Tushum (sof): <b>${som(revenue)}</b>\n` +
      typeBlock +
      `🧾 Yopilgan cheklar: ${closedCount}\n` +
      cashBlock +
      `💸 Rasxod (chiqim): ${som(expenseTotal)}\n` +
      (kirimTotal > 0 ? `📥 Kirim: ${som(kirimTotal)}\n` : '') +
      cashExpected +
      `\n↩️ Vozvratlar: ${refundedOrders.length} ta — <b>${som(refundTotal)}</b>\n` +
      (details ? refundDetail() : '') +
      voidHead +
      (details ? voidDetail() : '') +
      shareBlock +
      `━━━━━━━━━━━━\n` +
      `✅ Sof (rasxodsiz): <b>${som(revenue - expenseTotal)}</b>` +
      (openCount > 0
        ? `\n\n⚠️ <b>Diqqat:</b> hozir <b>${openCount} ta chek hali ochiq</b> (yopilmagan). ` +
          `Hisobot to‘liq bo‘lishi uchun barcha stollar yopilgach qayta yuboring.`
        : `\n\n🟢 Barcha cheklar yopilgan — hisobot to‘liq.`);

    // Telegram 4096 belgidan uzun xabarni rad etadi — sig'masa tafsilot ro'yxatlarisiz
    const full = build(true);
    return full.length <= TELEGRAM_TEXT_LIMIT ? full : build(false);
  }
}

/** Foiz: 5 -> "5", 5.5 -> "5,5" */
function fmt2(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/** Sana: "13.11.2026" (qurilma tilidan qat'i nazar bir xil) */
function dmy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}
