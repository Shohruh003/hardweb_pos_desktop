import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Not, Repository } from 'typeorm';
import {
  ExpenseEntity,
  OrderEntity,
  PaymentEntity,
  SettingsEntity,
} from '../entities';
import { OrderStatus } from '@hardweb-pos/shared';

// Direktorga Telegram bot orqali xabar yuboradi:
//  - vozvrat (refund) bo'lganda darhol (TZ #10)
//  - har kuni belgilangan vaqtda kunlik hisobot (TZ #8)
// Sozlash (server/.env):
//  TELEGRAM_BOT_TOKEN=...      (BotFather'dan)
//  TELEGRAM_CHAT_ID=...        (direktorning chat id'si)
//  TELEGRAM_DAILY_TIME=23:59   (kunlik hisobot vaqti)
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger('Telegram');
  private lastDailySent = '';

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
    // Har daqiqada kunlik hisobot vaqtini tekshiramiz
    setInterval(() => this.tickDaily(), 60 * 1000);
  }

  async sendMessage(text: string): Promise<boolean> {
    const { token, chatId } = await this.creds();
    if (!token || !chatId) {
      this.logger.warn('Telegram sozlanmagan (token/chat id yo‘q)');
      return false;
    }
    // Bir yoki bir nechta qabul qiluvchi (ega + direktor...) — vergul/probel/nuqta-vergul bilan
    const chatIds = chatId
      .split(/[\s,;]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    let anyOk = false;
    for (const id of chatIds) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: id, text, parse_mode: 'HTML' }),
          },
        );
        if (res.ok) anyOk = true;
        else this.logger.warn(`Telegram xatosi (${id}): ${res.status}`);
      } catch (e) {
        this.logger.warn(`Telegram yuborilmadi (${id}): ${(e as Error).message}`);
      }
    }
    return anyOk;
  }

  // Chat id'ni avtomatik aniqlash — direktor botga /start yozgach getUpdates orqali.
  // token berilmasa — sozlamalardagi token ishlatiladi.
  async detectChatId(token?: string): Promise<string | null> {
    const tok = token || (await this.creds()).token;
    if (!tok) return null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${tok}/getUpdates`);
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
    const money = new Intl.NumberFormat('uz-UZ').format(info.total);
    await this.sendMessage(
      `🔴 <b>VOZVRAT</b>\n` +
        `Stol: №${info.tableNumber ?? '-'}\n` +
        (info.items ? `Mahsulotlar: ${info.items}\n` : '') +
        `Summa: <b>${money} so'm</b>\n` +
        `Sabab: ${info.reason || '—'}\n` +
        `Kim: ${info.by}`,
    );
  }

  private async tickDaily() {
    const { time } = { time: (await this.creds()).dailyTime };
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const dayKey = now.toISOString().slice(0, 10);
    if (hhmm === time && this.lastDailySent !== dayKey) {
      this.lastDailySent = dayKey;
      await this.sendDailyReport();
    }
  }

  // Kunlik hisobot — tushum, cheklar, rasxod, vozvratlar
  async sendDailyReport() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    // Tushum — vozvrat qilinmagan cheklar bo'yicha
    const revRow = await this.payments
      .createQueryBuilder('p')
      .innerJoin(OrderEntity, 'o', 'o.id = p.order_id')
      .select('COALESCE(SUM(p.amount), 0)', 'sum')
      .where('p.created_at BETWEEN :s AND :e', {
        s: start.toISOString(),
        e: end.toISOString(),
      })
      .andWhere('o.refunded = 0')
      .getRawOne<{ sum: string }>();
    const revenue = Number(revRow?.sum ?? 0);

    const exps = await this.expenses.find({
      where: { createdAt: Between(start, end) },
    });
    const expenseTotal = exps.reduce((s, e) => s + Number(e.amount), 0);

    // Vozvratlar — mahsulotlari va umumiy summasi bilan
    const refundedOrders = await this.orders.find({
      where: { refunded: true, refundedAt: Between(start, end) },
      order: { refundedAt: 'DESC' },
    });
    const refundTotal = refundedOrders.reduce(
      (s, o) =>
        s + (o.items || []).reduce((a, it) => a + Number(it.price) * it.quantity, 0),
      0,
    );
    const closedCount = await this.orders.count({
      where: { status: OrderStatus.Closed, closedAt: Between(start, end) },
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
        const sum = (o.items || []).reduce((a, it) => a + Number(it.price) * it.quantity, 0);
        const items = (o.items || []).map((it) => `${it.quantity}× ${it.menuItemName}`).join(', ');
        const reason = o.refundReason ? ` — ${o.refundReason}` : '';
        return `  • ${items} = ${fmt(sum)}${reason}`;
      });
      refundBlock =
        `\n<b>Qaytarilgan mahsulotlar:</b>\n${lines.join('\n')}` +
        (refundedOrders.length > 15 ? `\n  ...yana ${refundedOrders.length - 15} ta` : '');
    }

    await this.sendMessage(
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
          : `\n\n🟢 Barcha cheklar yopilgan — hisobot to'liq.`),
    );
  }
}
