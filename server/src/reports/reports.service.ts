import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, MoreThanOrEqual, Repository } from 'typeorm';

import {
  ExpenseEntity,
  OrderEntity,
  OrderItemEntity,
  PaymentEntity,
  SettingsEntity,
  UserEntity,
  VoidLogEntity,
} from '../entities';
import {
  CashSummary,
  DEFAULT_PAYMENT_METHODS,
  DebtRow,
  MenuUnit,
  MyShare,
  ORDER_TYPES,
  OrderStatus,
  OrderType,
  SoldItemsReport,
  PaymentMethod,
  PaymentMethodKind,
  PaymentType,
  ReportPeriod,
  ReportSummary,
  TopItem,
  VoidLog,
  VoidReport,
  WaiterShareReport,
  WaiterShareRow,
  WaiterStat,
  clampPercent,
  orderDisplayName,
  orderTypeOf,
  roundSum,
} from '@hardweb-pos/shared';
import { Actor, normalizePaymentMethods, orderTotalsOf } from '../orders/order-rules';
import { LocalRange, inRangeSql, rangeParams, sqliteUtc } from './report-dates';

// ---- Xabarlar (demo/mock bilan bir xil bo'lishi kerak) ----
export const SHARE_PERCENT_MESSAGE = 'Ofitsiant ulushi foizi 0 dan 100 gacha bo‘lishi kerak';
export const WAITER_REQUIRED_MESSAGE = 'Ofitsiant tanlanmagan';
export const DEBT_STATUS_MESSAGE = 'Qarz holati noto‘g‘ri (open, repaid yoki all)';
export const DEBT_NOT_FOUND_MESSAGE = 'To‘lov topilmadi';
export const DEBT_NOT_DEBT_MESSAGE = 'Bu to‘lov qarz emas';
export const DEBT_ALREADY_REPAID_MESSAGE = 'Bu qarz allaqachon qaytarilgan';
export const DEBT_REFUNDED_MESSAGE = 'Bu chek qaytarilgan (vozvrat) — qarz bekor qilingan';
export const PAYMENT_METHOD_INVALID_MESSAGE = 'To‘lov turi noto‘g‘ri';

/** Otkazlar hisobotidagi ro'yxat chegarasi (soni va summasi baribir butun davr bo'yicha) */
const VOID_LIST_LIMIT = 500;
/** Qarzlar ro'yxati chegarasi */
const DEBT_LIST_LIMIT = 500;

/** Bitta qator summasi SQL'da — shared lineSum (narx × miqdor, butun so'mga) bilan bir xil */
const LINE_SQL = 'ROUND(i.price * i.quantity)';

/** Qarzlar ro'yxati holati: ochiq (qaytarilmagan), qaytarilgan yoki hammasi */
export type DebtStatus = 'open' | 'repaid' | 'all';

/** GET /reports/debts javobi. items — rows bilan aynan bir xil ro'yxat ({items,total} uslubidagi mijozlar uchun) */
export interface DebtsReport {
  status: DebtStatus;
  rows: DebtRow[];
  items: DebtRow[];
  count: number;
  total: number; // ro'yxatdagi qarzlar summasi
  openCount: number;
  openTotal: number; // shulardan hali qaytarilmagan
  repaidTotal: number;
}

/** Yopilgan chekning pul ko'rsatkichlari (SQL'da qator yig'indilari, JS'da xizmat haqi — calcOrderTotals bilan bir xil) */
interface ClosedOrderMoney {
  waiterId: string;
  type: OrderType;
  subtotal: number; // qatorlar yig'indisi
  serviceBase: number; // saboy (olib ketish) qatorlarisiz yig'indi
  serviceAmount: number; // undirilgan xizmat haqi
}

/** To'lov usuli haqida (sozlamadagi ro'yxatdan; o'chirilgan/eski kalit — standart ro'yxatdan) */
interface MethodInfo {
  key: string;
  label: string;
  kind: PaymentMethodKind;
}

/** Davr bo'yicha to'lov turlari qatori — kalit, nom va toifa bilan (B30) */
export type PaymentBreakdownRow = ReportSummary['paymentBreakdown'][number] & { label: string; kind: PaymentMethodKind };

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(PaymentEntity)
    private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItems: Repository<OrderItemEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(VoidLogEntity)
    private readonly voidLogs: Repository<VoidLogEntity>,
    @InjectRepository(ExpenseEntity)
    private readonly expenses: Repository<ExpenseEntity>,
    @InjectRepository(SettingsEntity)
    private readonly settings: Repository<SettingsEntity>,
  ) {}

  // =============================================================================================
  // Sozlamalar (SettingsModule'ga bog'lanmaslik uchun to'g'ridan-to'g'ri o'qiladi — Telegram
  // moduli ham shu servisdan foydalanadi, modul halqasi bo'lmasin)
  // =============================================================================================

  private async settingsRow(): Promise<SettingsEntity | null> {
    return this.settings.findOne({ where: { id: 'main' } });
  }

  /** Sozlamadagi ofitsiant ulushi foizi (0..100) */
  async defaultSharePercent(): Promise<number> {
    return clampPercent((await this.settingsRow())?.waiterSharePercent);
  }

  /** Barcha to'lov usullari (faol va nofaol; sozlamada bo'lmasa — standart ro'yxat) */
  async paymentMethods(): Promise<PaymentMethod[]> {
    return normalizePaymentMethods((await this.settingsRow())?.paymentMethods);
  }

  /**
   * Hisobot oynasi (0.3.2): ?from=&to= (sana yoki sana+vaqt) berilsa — aynan shu oraliq,
   * aks holda eski davr (kun / hafta / oy) — boshidan hozirgacha.
   */
  private windowOf(period: ReportPeriod, range?: LocalRange | null): { fromUtc: string; toUtc: string | null } {
    if (range) return { fromUtc: range.fromUtc, toUtc: range.toUtc };
    return { fromUtc: sqliteUtc(this.periodStart(period)), toUtc: null };
  }

  /** SQL: ustun oynada (datetime() bilan yagona ko'rinish) */
  private winSql(column: string, w: { toUtc: string | null }): string {
    return w.toUtc ? `datetime(${column}) >= :wFrom AND datetime(${column}) < :wTo` : `datetime(${column}) >= :wFrom`;
  }

  private winParams(w: { fromUtc: string; toUtc: string | null }): Record<string, string> {
    return w.toUtc ? { wFrom: w.fromUtc, wTo: w.toUtc } : { wFrom: w.fromUtc };
  }

  // Davr boshlanish vaqti: kun = bugun 00:00, hafta = 7 kun, oy = 30 kun
  private periodStart(period: ReportPeriod): Date {
    const now = new Date();
    if (period === 'day') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    const days = period === 'week' ? 7 : 30;
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  // =============================================================================================
  // Umumiy hisobot (TZ 5.5)
  // =============================================================================================

  // Umumiy ko'rsatkichlar: tushum, hisoblar soni, o'rtacha chek, to'lov turlari (TZ F-5.2).
  // To'lov turlari — sozlamadagi usul kaliti, nomi va toifasi bilan (B30), sozlamadagi tartibda.
  async summary(period: ReportPeriod, range?: LocalRange | null): Promise<ReportSummary> {
    const w = this.windowOf(period, range);

    const rows = await this.payments
      .createQueryBuilder('p')
      .innerJoin(OrderEntity, 'o', 'o.id = p.order_id')
      .select('p.type', 'type')
      .addSelect('SUM(p.amount)', 'amount')
      .where(this.winSql('p.created_at', w), this.winParams(w))
      .andWhere('o.refunded = 0') // vozvrat qilinganlar hisobga olinmaydi
      .groupBy('p.type')
      .getRawMany<{ type: string; amount: string | number }>();

    const methods = await this.paymentMethods();
    const order = new Map(methods.map((m, i) => [m.key, i] as const));
    let revenue = 0;
    // Bitta chek bir nechta usul bilan to'langan bo'lishi mumkin — chek soni alohida (DISTINCT) hisoblanadi
    const breakdown: PaymentBreakdownRow[] = rows.map((r) => {
      const amount = roundSum(r.amount);
      revenue += amount;
      const info = methodInfo(methods, r.type);
      return { type: r.type as PaymentType, amount, label: info.label, kind: info.kind };
    });
    breakdown.sort(
      (a, b) => (order.get(a.type) ?? 999) - (order.get(b.type) ?? 999) || b.amount - a.amount,
    );
    const countRow = await this.payments
      .createQueryBuilder('p')
      .innerJoin(OrderEntity, 'o', 'o.id = p.order_id')
      .select('COUNT(DISTINCT p.order_id)', 'orders')
      .where(this.winSql('p.created_at', w), this.winParams(w))
      .andWhere('o.refunded = 0')
      .getRawOne<{ orders: string | number }>();
    const ordersCount = Number(countRow?.orders) || 0;

    return {
      period,
      revenue,
      ordersCount,
      avgCheck: ordersCount ? Math.round(revenue / ordersCount) : 0,
      paymentBreakdown: breakdown,
      byOrderType: await this.byOrderType(w),
    };
  }

  /**
   * Buyurtma turlari bo'yicha (stolga / olib ketish / yetkazish): tushum — umumiy tushum bilan bir
   * xil qoida (davrdagi to'lovlar, vozvrat qilinmagan cheklar), soni — shu to'lovlari bor YOPILGAN
   * cheklar. Uchala tur doim qaytadi (savdo bo'lmasa — 0).
   */
  private async byOrderType(w: { fromUtc: string; toUtc: string | null }): Promise<NonNullable<ReportSummary['byOrderType']>> {
    const rows = await this.payments
      .createQueryBuilder('p')
      .innerJoin(OrderEntity, 'o', 'o.id = p.order_id')
      .select('o.order_type', 'type')
      .addSelect('SUM(p.amount)', 'amount')
      .addSelect('COUNT(DISTINCT CASE WHEN o.status = :closed THEN o.id END)', 'orders')
      .where(this.winSql('p.created_at', w), this.winParams(w))
      .andWhere('o.refunded = 0')
      .setParameter('closed', OrderStatus.Closed)
      .groupBy('o.order_type')
      .getRawMany<{ type: string | null; amount: string | number; orders: string | number }>();

    const acc = new Map<OrderType, { count: number; amount: number }>();
    for (const r of rows) {
      // Tur yozilmagan (eski) buyurtmalar — stolga
      const t = orderTypeOf({ type: r.type });
      const cur = acc.get(t) ?? { count: 0, amount: 0 };
      cur.count += Number(r.orders) || 0;
      cur.amount += roundSum(r.amount);
      acc.set(t, cur);
    }
    return ORDER_TYPES.map((type) => ({
      type,
      count: acc.get(type)?.count ?? 0,
      amount: acc.get(type)?.amount ?? 0,
    }));
  }

  // Eng ko'p sotilgan taomlar reytingi (TZ F-5.3)
  async topItems(period: ReportPeriod, limit = 10, range?: LocalRange | null): Promise<TopItem[]> {
    const w = this.windowOf(period, range);
    const rows = await this.orderItems
      .createQueryBuilder('i')
      .innerJoin(OrderEntity, 'o', 'o.id = i.order_id')
      .select('i.menu_item_name', 'name')
      .addSelect('SUM(i.quantity)', 'qty')
      .addSelect(`SUM(${LINE_SQL})`, 'amount')
      .where('o.status = :closed', { closed: OrderStatus.Closed })
      .andWhere(this.winSql('o.closed_at', w), this.winParams(w))
      .andWhere('o.refunded = 0')
      .groupBy('i.menu_item_name')
      .orderBy('qty', 'DESC')
      .limit(limit)
      .getRawMany<{ name: string; qty: string | number; amount: string | number }>();

    return rows.map((r) => ({
      name: r.name,
      quantity: roundQty3(r.qty),
      sum: roundSum(r.amount),
    }));
  }

  /**
   * Taomlar bo'yicha to'liq hisobot (0.3.2 — restoran talabi: faqat "eng ko'p sotilganlar" emas,
   * 1 ta sotilgan bo'lsa ham). Oraliqdagi yopilgan, vozvrat qilinmagan cheklar; ixtiyoriy buyurtma turi.
   * Har taom: miqdor (kasr ham), summa, zalda / saboy / olib ketish / yetkazish bo'yicha summa.
   */
  async allItems(range: LocalRange, type?: OrderType | null): Promise<SoldItemsReport> {
    const qb = this.orderItems
      .createQueryBuilder('i')
      .innerJoin(OrderEntity, 'o', 'o.id = i.order_id')
      .leftJoin('menu_items', 'mi', 'mi.id = i.menu_item_id')
      .leftJoin('categories', 'c', 'c.id = mi.category_id')
      .select('i.menu_item_name', 'name')
      .addSelect('MAX(i.unit)', 'unit')
      .addSelect('MAX(c.name)', 'category')
      .addSelect('SUM(i.quantity)', 'qty')
      .addSelect(`SUM(${LINE_SQL})`, 'amount')
      .addSelect(`SUM(CASE WHEN COALESCE(o.order_type, 'stol') = 'stol' AND COALESCE(i.takeaway, 0) = 0 THEN ${LINE_SQL} ELSE 0 END)`, 'hall')
      .addSelect(`SUM(CASE WHEN COALESCE(o.order_type, 'stol') = 'stol' AND COALESCE(i.takeaway, 0) = 1 THEN ${LINE_SQL} ELSE 0 END)`, 'saboy')
      .addSelect(`SUM(CASE WHEN o.order_type = 'olib_ketish' THEN ${LINE_SQL} ELSE 0 END)`, 'takeaway')
      .addSelect(`SUM(CASE WHEN o.order_type = 'yetkazish' THEN ${LINE_SQL} ELSE 0 END)`, 'delivery')
      .where('o.status = :closed', { closed: OrderStatus.Closed })
      .andWhere('o.refunded = 0')
      .andWhere(inRangeSql('o.closed_at'), rangeParams(range));
    if (type === OrderType.DineIn) qb.andWhere("COALESCE(o.order_type, 'stol') = 'stol'");
    else if (type) qb.andWhere('o.order_type = :t', { t: type });
    const rows = await qb
      .groupBy('i.menu_item_name')
      .orderBy('amount', 'DESC')
      .addOrderBy('name', 'ASC')
      .getRawMany<Record<string, string | number | null>>();
    const items = rows.map((r) => ({
      name: String(r.name ?? ''),
      category: r.category ? String(r.category) : null,
      unit: r.unit === MenuUnit.Weight ? MenuUnit.Weight : MenuUnit.Piece,
      quantity: roundQty3(r.qty as number),
      sum: roundSum(r.amount),
      hall: roundSum(r.hall),
      saboy: roundSum(r.saboy),
      takeaway: roundSum(r.takeaway),
      delivery: roundSum(r.delivery),
    }));
    return {
      from: range.from,
      to: range.to,
      fromUtc: range.fromUtc,
      toUtc: range.toUtc,
      count: items.length,
      total: items.reduce((t, x) => t + x.sum, 0),
      items,
    };
  }

  // Kunlik tushum qatori (dashboard chiziqli grafigi uchun) — oxirgi N kun, MAHALLIY sana bo'yicha
  // (closed_at UTC'da saqlanadi — 'localtime' bilan Toshkent kuniga o'tkaziladi: 00:00–04:59 dagi
  // cheklar oldingi kunga tushib qolmaydi).
  async daily(days = 7): Promise<{ date: string; revenue: number }[]> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const rows = await this.orders
      .createQueryBuilder('o')
      .innerJoin(PaymentEntity, 'p', 'p.order_id = o.id')
      .select("strftime('%Y-%m-%d', o.closed_at, 'localtime')", 'date')
      .addSelect('SUM(p.amount)', 'revenue')
      .where('o.status = :closed', { closed: OrderStatus.Closed })
      .andWhere('datetime(o.closed_at) >= :start', { start: sqliteUtc(start) })
      .andWhere('o.refunded = 0')
      .groupBy('date')
      .getRawMany<{ date: string; revenue: string | number }>();

    const map = new Map(rows.map((r) => [r.date, roundSum(r.revenue)]));
    const out: { date: string; revenue: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ date: key, revenue: map.get(key) || 0 });
    }
    return out;
  }

  // Ofitsiantlar bo'yicha statistika (TZ F-5.4)
  async waiterStats(period: ReportPeriod, range?: LocalRange | null): Promise<WaiterStat[]> {
    const w = this.windowOf(period, range);
    const rows = await this.orders
      .createQueryBuilder('o')
      .innerJoin('users', 'u', 'u.id = o.waiter_id')
      .innerJoin(PaymentEntity, 'p', 'p.order_id = o.id')
      .select('u.id', 'waiterId')
      .addSelect('u.name', 'waiterName')
      .addSelect('COUNT(DISTINCT o.id)', 'ordersCount')
      .addSelect('SUM(p.amount)', 'revenue')
      .where('o.status = :closed', { closed: OrderStatus.Closed })
      .andWhere(this.winSql('o.closed_at', w), this.winParams(w))
      .andWhere('o.refunded = 0')
      .groupBy('u.id')
      .addGroupBy('u.name')
      .orderBy('revenue', 'DESC')
      .getRawMany<{ waiterId: string; waiterName: string; ordersCount: string | number; revenue: string | number }>();

    return rows.map((r) => ({
      waiterId: r.waiterId,
      waiterName: r.waiterName,
      ordersCount: Number(r.ordersCount) || 0,
      revenue: roundSum(r.revenue),
    }));
  }

  // Vozvratlar (qaytarilgan cheklar) — soni, umumiy summasi va ro'yxati
  async refunds(period: ReportPeriod, range?: LocalRange | null) {
    const start = range ? new Date(range.fromUtc.replace(' ', 'T') + 'Z') : this.periodStart(period);
    const end = range ? new Date(new Date(range.toUtc.replace(' ', 'T') + 'Z').getTime() - 1) : null;
    const orders = await this.orders.find({
      where: { refunded: true, refundedAt: end ? Between(start, end) : MoreThanOrEqual(start) },
      relations: ['items'],
      order: { refundedAt: 'DESC' },
    });
    const items = orders.map((o) => {
      // Qaytarilgan summa — chek summasi (chegirma/xizmat/yetkazish bilan, butun so'm): mijozga aynan shu qaytadi
      const total = orderTotalsOf(o).total;
      return {
        id: o.id,
        total,
        reason: o.refundReason || '',
        refundedAt: o.refundedAt,
        products: (o.items || []).map((it) => ({
          name: it.menuItemName,
          quantity: roundQty3(it.quantity),
          unit: it.unit,
        })),
      };
    });
    const total = items.reduce((a, r) => a + r.total, 0);
    return { count: items.length, total, items };
  }

  // =============================================================================================
  // Ofitsiantlar hisoboti (B20, B21)
  // =============================================================================================

  /**
   * Oraliqda (closed_at, mahalliy kunlar) yopilgan, vozvrat qilinmagan cheklarning pul ko'rsatkichlari.
   * Qator summalari SQL'da (ROUND(narx × miqdor) — shared lineSum bilan bir xil), xizmat haqi esa
   * JS'da calcOrderTotals qoidasi bilan: round(xizmat bazasi × foiz / 100). Shunda hisobot cheklardagi
   * summalar bilan tiyinigacha mos keladi.
   */
  private async closedOrderMoney(range: LocalRange, waiterId?: string): Promise<ClosedOrderMoney[]> {
    const qb = this.orders
      .createQueryBuilder('o')
      .leftJoin(OrderItemEntity, 'i', 'i.order_id = o.id')
      .select('o.id', 'id')
      .addSelect('o.waiter_id', 'waiterId')
      .addSelect('o.order_type', 'type')
      .addSelect('o.service_percent', 'servicePercent')
      .addSelect(`COALESCE(SUM(${LINE_SQL}), 0)`, 'subtotal')
      .addSelect(`COALESCE(SUM(CASE WHEN i.takeaway = 1 THEN 0 ELSE ${LINE_SQL} END), 0)`, 'serviceBase')
      .where('o.status = :closed', { closed: OrderStatus.Closed })
      .andWhere('o.refunded = 0')
      .andWhere(inRangeSql('o.closed_at'), rangeParams(range))
      .groupBy('o.id');
    if (waiterId) qb.andWhere('o.waiter_id = :waiterId', { waiterId });
    const rows = await qb.getRawMany<{
      id: string;
      waiterId: string;
      type: string | null;
      servicePercent: string | number | null;
      subtotal: string | number;
      serviceBase: string | number;
    }>();
    return rows.map((r) => {
      const serviceBase = roundSum(r.serviceBase);
      return {
        waiterId: r.waiterId,
        type: orderTypeOf({ type: r.type }),
        subtotal: roundSum(r.subtotal),
        serviceBase,
        serviceAmount: roundSum((serviceBase * clampPercent(r.servicePercent)) / 100),
      };
    });
  }

  /**
   * Bitta xodim cheklari yig'indisi (B21 qoidasi):
   *  dineInSales   — stolga cheklarning xizmat bazasi (zalda yeyilgan taomlar, saboy qatorlarisiz);
   *  takeawaySales — olib ketish/yetkazish cheklarining taomlari + stolga cheklardagi saboy qatorlari;
   *  serviceAmount — haqiqatda undirilgan xizmat haqi.
   */
  private static accumulate(list: ClosedOrderMoney[]) {
    const acc = { ordersCount: 0, dineInSales: 0, takeawaySales: 0, serviceAmount: 0 };
    for (const o of list) {
      acc.ordersCount += 1;
      if (o.type === OrderType.DineIn) {
        acc.dineInSales += o.serviceBase;
        acc.takeawaySales += o.subtotal - o.serviceBase;
      } else {
        acc.takeawaySales += o.subtotal;
      }
      acc.serviceAmount += o.serviceAmount;
    }
    return acc;
  }

  /** Ofitsiant ulushi: round(stolga buyurtmalar summasi × foiz / 100) */
  private static share(dineInSales: number, percent: number): number {
    return roundSum((dineInSales * percent) / 100);
  }

  /**
   * GET /reports/waiter-shares — eski POS'dagi "Ofitsiantlar bo'yicha hisobot": har bir buyurtmani
   * olgan xodim (kassir ham) bo'yicha. Chek hozirgi waiterId bo'yicha hisoblanadi ("Ofitsiant"
   * almashtirilgan bo'lsa — yangi ofitsiantga). Qatorlar — savdo summasi bo'yicha kamayish tartibida.
   */
  async waiterShares(range: LocalRange, sharePercent: number): Promise<WaiterShareReport> {
    const percent = round2(clampPercent(sharePercent));
    const list = await this.closedOrderMoney(range);
    const byWaiter = new Map<string, ClosedOrderMoney[]>();
    for (const o of list) {
      const arr = byWaiter.get(o.waiterId) ?? [];
      arr.push(o);
      byWaiter.set(o.waiterId, arr);
    }
    const ids = [...byWaiter.keys()].filter(Boolean);
    const people = ids.length
      ? await this.users.find({ where: { id: In(ids) }, select: { id: true, name: true, role: true } })
      : [];
    const personById = new Map(people.map((u) => [u.id, u] as const));

    const rows: WaiterShareRow[] = [...byWaiter.entries()].map(([waiterId, orders]) => {
      const acc = ReportsService.accumulate(orders);
      const person = personById.get(waiterId);
      return {
        waiterId,
        waiterName: person?.name ?? 'Noma’lum xodim',
        role: person?.role ?? '',
        ...acc,
        shareAmount: ReportsService.share(acc.dineInSales, percent),
      };
    });
    rows.sort(
      (a, b) =>
        b.dineInSales + b.takeawaySales - (a.dineInSales + a.takeawaySales) ||
        a.waiterName.localeCompare(b.waiterName, 'uz'),
    );

    // Jami qator — ustunlar yig'indisi (ulush ham qatorlar yig'indisi: jadvaldagi raqamlar bilan aynan mos)
    const totals = rows.reduce(
      (t, r) => ({
        ordersCount: t.ordersCount + r.ordersCount,
        dineInSales: t.dineInSales + r.dineInSales,
        takeawaySales: t.takeawaySales + r.takeawaySales,
        serviceAmount: t.serviceAmount + r.serviceAmount,
        shareAmount: t.shareAmount + r.shareAmount,
      }),
      { ordersCount: 0, dineInSales: 0, takeawaySales: 0, serviceAmount: 0, shareAmount: 0 },
    );
    return { from: range.from, to: range.to, sharePercent: percent, totals, rows };
  }

  /** GET /reports/waiter-items — shu xodim oraliqda sotgan taomlar (yopilgan, vozvrat qilinmagan cheklar) */
  async waiterItems(waiterId: string, range: LocalRange): Promise<(TopItem & { unit: MenuUnit | null })[]> {
    const rows = await this.orderItems
      .createQueryBuilder('i')
      .innerJoin(OrderEntity, 'o', 'o.id = i.order_id')
      .select('i.menu_item_name', 'name')
      .addSelect('MAX(i.unit)', 'unit')
      .addSelect('SUM(i.quantity)', 'qty')
      .addSelect(`SUM(${LINE_SQL})`, 'amount')
      .where('o.status = :closed', { closed: OrderStatus.Closed })
      .andWhere('o.refunded = 0')
      .andWhere('o.waiter_id = :waiterId', { waiterId })
      .andWhere(inRangeSql('o.closed_at'), rangeParams(range))
      .groupBy('i.menu_item_name')
      .orderBy('amount', 'DESC')
      .addOrderBy('name', 'ASC')
      .getRawMany<{ name: string; unit: string | null; qty: string | number; amount: string | number }>();
    return rows.map((r) => ({
      name: r.name,
      unit: r.unit === MenuUnit.Weight ? MenuUnit.Weight : r.unit ? MenuUnit.Piece : null,
      quantity: roundQty3(r.qty),
      sum: roundSum(r.amount),
    }));
  }

  /** GET /reports/my-share — xodimning o'z ko'rsatkichlari (faqat o'zi olgan cheklar) */
  async myShare(userId: string, range: LocalRange): Promise<MyShare> {
    const percent = round2(await this.defaultSharePercent());
    const acc = ReportsService.accumulate(await this.closedOrderMoney(range, userId));
    return {
      from: range.from,
      to: range.to,
      ordersCount: acc.ordersCount,
      dineInSales: acc.dineInSales,
      takeawaySales: acc.takeawaySales,
      shareAmount: ReportsService.share(acc.dineInSales, percent),
      sharePercent: percent,
    };
  }

  // =============================================================================================
  // Otkazlar (B19)
  // =============================================================================================

  /**
   * GET /reports/voids — otkazlar jurnali: soni (qatorlar) va summasi butun davr bo'yicha, ro'yxat —
   * eng yangilari birinchi (ko'pi bilan VOID_LIST_LIMIT ta). orderId berilsa — faqat shu chek
   * otkazlari (sanadan qat'i nazar; cheklar tarixidagi tafsilot oynasi uchun).
   */
  async voids(range: LocalRange, orderId?: string): Promise<VoidReport> {
    const base = () => {
      const qb = this.voidLogs.createQueryBuilder('v');
      if (orderId) qb.where('v.order_id = :orderId', { orderId });
      else qb.where(inRangeSql('v.created_at'), rangeParams(range));
      return qb;
    };
    const agg = await base()
      .select('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(ROUND(v.sum)), 0)', 'total')
      .getRawOne<{ count: string | number; total: string | number }>();
    const list = await base()
      .orderBy('v.createdAt', 'DESC')
      .addOrderBy('v.id', 'DESC')
      .take(VOID_LIST_LIMIT)
      .getMany();
    return {
      from: range.from,
      to: range.to,
      count: Number(agg?.count) || 0,
      total: roundSum(agg?.total),
      items: list.map(toVoidLog),
    };
  }

  // =============================================================================================
  // Kassa holati (B33) va qarzlar (B30, B34)
  // =============================================================================================

  /**
   * GET /reports/cash-summary — kun bo'yicha kassa holati (naqd pul oqimi):
   *  byMethod     — shu kuni qabul qilingan to'lovlar usullar bo'yicha (ochiq cheklarning qisman
   *                 to'lovlari ham — pul kassada; keyin vozvrat qilinganlari ham: qaytarilgan pul
   *                 refundsCash'da alohida ayiriladi);
   *  kirim/chiqim — kassaga kiritilgan / chiqarilgan pul (expenses.kind);
   *  debtCreated  — shu kuni qarzga yozilgan ('debt' toifali to'lovlar);
   *  debtRepaid   — shu kuni qaytarilgan qarzlar (qaysi usul bilan);
   *  refundsCash  — shu kuni vozvrat qilingan cheklarning naqd pullari;
   *  expectedCash — kassada bo'lishi kerak: naqd tushum + kirim − chiqim + naqd qaytarilgan qarz − naqd vozvrat.
   */
  async cashSummary(day: LocalRange): Promise<CashSummary> {
    const methods = await this.paymentMethods();
    const params = rangeParams(day);

    const payRows = await this.payments
      .createQueryBuilder('p')
      .select('p.type', 'type')
      .addSelect('COALESCE(SUM(p.amount), 0)', 'amount')
      .where(inRangeSql('p.created_at'), params)
      .groupBy('p.type')
      .getRawMany<{ type: string; amount: string | number }>();

    const moveRows = await this.expenses
      .createQueryBuilder('e')
      .select("COALESCE(e.kind, 'chiqim')", 'kind')
      .addSelect('COALESCE(SUM(e.amount), 0)', 'amount')
      .where(inRangeSql('e.created_at'), params)
      .groupBy("COALESCE(e.kind, 'chiqim')")
      .getRawMany<{ kind: string; amount: string | number }>();

    const repaidRows = await this.payments
      .createQueryBuilder('p')
      .select('p.debt_repaid_type', 'type')
      .addSelect('COALESCE(SUM(p.amount), 0)', 'amount')
      .where('p.debt_repaid_at IS NOT NULL')
      .andWhere(inRangeSql('p.debt_repaid_at'), params)
      .groupBy('p.debt_repaid_type')
      .getRawMany<{ type: string | null; amount: string | number }>();

    // Shu kuni vozvrat qilingan cheklarning to'lovlari (qaysi kuni to'langanidan qat'i nazar)
    const refundRows = await this.payments
      .createQueryBuilder('p')
      .innerJoin(OrderEntity, 'o', 'o.id = p.order_id')
      .select('p.type', 'type')
      .addSelect('p.debt_repaid_type', 'repaidType')
      .addSelect('COALESCE(SUM(p.amount), 0)', 'amount')
      .where('o.refunded = 1')
      .andWhere(inRangeSql('o.refunded_at'), params)
      .groupBy('p.type')
      .addGroupBy('p.debt_repaid_type')
      .getRawMany<{ type: string; repaidType: string | null; amount: string | number }>();

    const kindOf = (key: string | null | undefined) => methodInfo(methods, key).kind;

    // To'lov usullari: sozlamadagi tartibda — faol usullar doim (0 bo'lsa ham), nofaol/eski
    // kalitlar faqat shu kuni summasi bo'lsa
    const amountByKey = new Map<string, number>();
    for (const r of payRows) amountByKey.set(r.type, (amountByKey.get(r.type) ?? 0) + roundSum(r.amount));
    const byMethod: CashSummary['byMethod'] = [];
    for (const m of methods) {
      const amount = amountByKey.get(m.key) ?? 0;
      if (m.active || amount > 0) byMethod.push({ key: m.key, label: m.label, kind: m.kind, amount });
      amountByKey.delete(m.key);
    }
    for (const [key, amount] of amountByKey) {
      if (amount === 0) continue;
      const info = methodInfo(methods, key);
      byMethod.push({ key, label: info.label, kind: info.kind, amount });
    }

    let kirim = 0;
    let chiqim = 0;
    for (const r of moveRows) {
      if (r.kind === 'kirim') kirim += roundSum(r.amount);
      else chiqim += roundSum(r.amount);
    }

    const debtCreated = byMethod.filter((m) => m.kind === 'debt').reduce((s, m) => s + m.amount, 0);
    const debtRepaid: CashSummary['debtRepaid'] = repaidRows
      .filter((r) => roundSum(r.amount) > 0)
      .map((r) => {
        const info = methodInfo(methods, r.type);
        return { key: info.key, label: info.label, amount: roundSum(r.amount) };
      });

    // Naqd vozvrat: naqd to'lovlar + naqd bilan qaytarilgan qarz to'lovlari (mijozga naqd qaytadi)
    let refundsCash = 0;
    for (const r of refundRows) {
      const kind = kindOf(r.type);
      if (kind === 'cash' || (kind === 'debt' && r.repaidType && kindOf(r.repaidType) === 'cash')) {
        refundsCash += roundSum(r.amount);
      }
    }

    const cashSales = byMethod.filter((m) => m.kind === 'cash').reduce((s, m) => s + m.amount, 0);
    const cashRepaid = repaidRows
      .filter((r) => kindOf(r.type) === 'cash')
      .reduce((s, r) => s + roundSum(r.amount), 0);

    return {
      date: day.from,
      byMethod,
      kirim,
      chiqim,
      debtCreated,
      debtRepaid,
      refundsCash,
      expectedCash: cashSales + kirim - chiqim + cashRepaid - refundsCash,
    };
  }

  /** 'debt' toifali to'lov usullari kalitlari (sozlamadagi + standart 'qarz') */
  private debtKeys(methods: PaymentMethod[]): string[] {
    const keys = new Set(methods.filter((m) => m.kind === 'debt').map((m) => m.key));
    for (const m of DEFAULT_PAYMENT_METHODS) if (m.kind === 'debt') keys.add(m.key);
    return [...keys];
  }

  /**
   * GET /reports/debts — qarzga yozilgan to'lovlar. status: open (qaytarilmagan; vozvrat qilingan
   * chekning qarzi — bekor, kirmaydi), repaid (qaytarilgan), all (ikkalasi; ochiqlari birinchi).
   * from/to — qarz yozilgan kun bo'yicha (ixtiyoriy). q — qarzdor ismi yoki telefon raqamlari.
   * Tartib: ochiq qarzlar birinchi, keyin eng yangilari.
   */
  async debts(status: DebtStatus, range: LocalRange | null, q?: string): Promise<DebtsReport> {
    const methods = await this.paymentMethods();
    const keys = this.debtKeys(methods);
    const qb = this.payments
      .createQueryBuilder('p')
      .leftJoin(OrderEntity, 'o', 'o.id = p.order_id')
      .leftJoin('tables', 't', 't.id = o.table_id')
      .leftJoin('users', 'u', 'u.id = p.debt_repaid_by')
      .select('p.id', 'paymentId')
      .addSelect('p.order_id', 'orderId')
      .addSelect('p.amount', 'amount')
      .addSelect('p.created_at', 'createdAt')
      .addSelect('p.debtor_name', 'debtorName')
      .addSelect('p.debtor_phone', 'debtorPhone')
      .addSelect('p.debt_repaid_at', 'repaidAt')
      .addSelect('p.debt_repaid_type', 'repaidType')
      .addSelect('u.name', 'repaidByName')
      .addSelect('o.id', 'orderExists')
      .addSelect('o.order_type', 'orderType')
      .addSelect('o.queue_number', 'queueNumber')
      .addSelect('o.check_no', 'checkNo')
      .addSelect('t.number', 'tableNumber')
      .where('p.type IN (:...debtKeys)', { debtKeys: keys });
    if (status === 'open') {
      qb.andWhere('p.debt_repaid_at IS NULL').andWhere('(o.refunded = 0 OR o.refunded IS NULL)');
    } else if (status === 'repaid') {
      qb.andWhere('p.debt_repaid_at IS NOT NULL');
    } else {
      // Vozvrat qilingan chekning qaytarilmagan qarzi — bekor qilingan, ro'yxatga kirmaydi
      qb.andWhere('NOT (p.debt_repaid_at IS NULL AND o.refunded = 1)');
    }
    if (range) qb.andWhere(inRangeSql('p.created_at'), rangeParams(range));
    const search = String(q ?? '').trim();
    if (search) {
      const digits = search.replace(/\D/g, '');
      const like = `%${escapeLike(search.toLowerCase())}%`;
      qb.andWhere(
        digits.length >= 3
          ? "(LOWER(COALESCE(p.debtor_name, '')) LIKE :dq ESCAPE '\\' OR COALESCE(p.debtor_phone, '') LIKE :dp)"
          : "LOWER(COALESCE(p.debtor_name, '')) LIKE :dq ESCAPE '\\'",
        { dq: like, dp: `%${digits}%` },
      );
    }
    const raw = await qb
      .orderBy('CASE WHEN p.debt_repaid_at IS NULL THEN 0 ELSE 1 END', 'ASC')
      .addOrderBy('p.created_at', 'DESC')
      .limit(DEBT_LIST_LIMIT)
      .getRawMany<RawDebtRow>();
    const rows = raw.map(toDebtRow);
    const openRows = rows.filter((r) => !r.repaidAt);
    return {
      status,
      rows,
      items: rows,
      count: rows.length,
      total: rows.reduce((s, r) => s + r.amount, 0),
      openCount: openRows.length,
      openTotal: openRows.reduce((s, r) => s + r.amount, 0),
      repaidTotal: rows.filter((r) => !!r.repaidAt).reduce((s, r) => s + r.amount, 0),
    };
  }

  /**
   * POST /debts/:paymentId/repay — qarz qaytarildi: qaysi (faol, qarz bo'lmagan) usul bilan, kim qabul
   * qildi, qachon. Shu kunning kassa holatida (debtRepaid, naqd bo'lsa expectedCash) hisoblanadi.
   * Ikki kassir bir vaqtda bossa — faqat bittasi o'tadi (shartli UPDATE).
   */
  async repayDebt(paymentId: string, type: unknown, actor: Actor): Promise<DebtRow> {
    const methods = await this.paymentMethods();
    const key = typeof type === 'string' ? type.trim() : '';
    const method = methods.find((m) => m.key === key);
    if (!method || !method.active || method.kind === 'debt') {
      throw new BadRequestException(PAYMENT_METHOD_INVALID_MESSAGE);
    }
    const payment = await this.payments.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException(DEBT_NOT_FOUND_MESSAGE);
    if (!this.debtKeys(methods).includes(payment.type)) throw new BadRequestException(DEBT_NOT_DEBT_MESSAGE);
    if (payment.debtRepaidAt) throw new BadRequestException(DEBT_ALREADY_REPAID_MESSAGE);
    const order = await this.orders.findOne({ where: { id: payment.orderId }, select: { id: true, refunded: true }, loadEagerRelations: false });
    if (order?.refunded) throw new BadRequestException(DEBT_REFUNDED_MESSAGE);

    const result = await this.payments
      .createQueryBuilder()
      .update(PaymentEntity)
      .set({ debtRepaidAt: new Date(), debtRepaidBy: actor?.id ?? null, debtRepaidType: method.key })
      .where('id = :id', { id: paymentId })
      .andWhere('debt_repaid_at IS NULL')
      .execute();
    if (!result.affected) throw new BadRequestException(DEBT_ALREADY_REPAID_MESSAGE);

    const fresh = await this.debts('all', null);
    const row = fresh.rows.find((r) => r.paymentId === paymentId);
    if (row) return row;
    // Ro'yxat chegarasidan tashqarida qolgan bo'lsa — qisqa ko'rinish
    return {
      paymentId,
      orderId: payment.orderId,
      orderName: null,
      queueNumber: null,
      createdAt: isoOf(payment.createdAt) ?? new Date().toISOString(),
      amount: roundSum(payment.amount),
      debtorName: payment.debtorName ?? null,
      debtorPhone: payment.debtorPhone ?? null,
      repaidAt: new Date().toISOString(),
      repaidType: method.key,
      repaidByName: actor?.name ?? null,
    };
  }
}

// ---- Yordamchilar ----

interface RawDebtRow {
  paymentId: string;
  orderId: string;
  amount: string | number;
  createdAt: string | Date;
  debtorName: string | null;
  debtorPhone: string | null;
  repaidAt: string | Date | null;
  repaidType: string | null;
  repaidByName: string | null;
  orderExists: string | null;
  orderType: string | null;
  queueNumber: string | number | null;
  checkNo: string | number | null;
  tableNumber: string | number | null;
}

function toDebtRow(r: RawDebtRow): DebtRow {
  const queueNumber = r.queueNumber == null ? null : Number(r.queueNumber);
  return {
    paymentId: r.paymentId,
    orderId: r.orderId,
    // Buyurtma o'chirilgan bo'lsa (amalda bo'lmaydi — to'lovli chek bekor qilinmaydi) — nomsiz
    orderName: r.orderExists
      ? orderDisplayName({
          type: r.orderType,
          queueNumber,
          tableNumber: r.tableNumber == null ? null : Number(r.tableNumber),
          checkNo: r.checkNo == null ? null : Number(r.checkNo),
        })
      : null,
    queueNumber,
    createdAt: dbDateIso(r.createdAt) ?? '',
    amount: roundSum(r.amount),
    debtorName: r.debtorName ?? null,
    debtorPhone: r.debtorPhone ?? null,
    repaidAt: dbDateIso(r.repaidAt),
    repaidType: r.repaidType ?? null,
    repaidByName: r.repaidByName ?? null,
  };
}

function toVoidLog(v: VoidLogEntity): VoidLog {
  return {
    id: v.id,
    createdAt: isoOf(v.createdAt) ?? '',
    orderId: v.orderId,
    orderName: v.orderName ?? null,
    orderType: v.orderType ?? null,
    menuItemId: v.menuItemId ?? null,
    name: v.name,
    quantity: roundQty6(v.quantity),
    unit: v.unit ?? null,
    price: roundSum(v.price),
    sum: roundSum(v.sum),
    reason: v.reason ?? null,
    userId: v.userId ?? null,
    userName: v.userName ?? null,
    wholeOrder: !!v.wholeOrder,
    sentToKitchen: !!v.sentToKitchen,
  };
}

/** To'lov usuli nomi va toifasi: sozlamadagi ro'yxat -> standart ro'yxat -> kalitning o'zi */
export function methodInfo(methods: PaymentMethod[], key: string | null | undefined): MethodInfo {
  const k = String(key ?? '');
  const found = methods.find((m) => m.key === k) ?? DEFAULT_PAYMENT_METHODS.find((m) => m.key === k);
  if (found) return { key: k, label: found.label, kind: found.kind };
  return { key: k, label: k || '—', kind: 'other' };
}

/** Bazadagi sana (TypeORM Date yoki xom 'YYYY-MM-DD HH:MM:SS[.SSS]' UTC matni / ISO) -> ISO */
function dbDateIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const s = String(value).trim();
  // Xom SQLite qiymati UTC'da, lekin zona belgisisiz — 'Z' qo'shib o'qiymiz
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isoOf(value: Date | string | null | undefined): string | null {
  return dbDateIso(value ?? null);
}

/** Miqdor 3 xonagacha (hisobotda ko'rsatish uchun: kg taomlarda 1.107) */
function roundQty3(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

/** Miqdor 6 xonagacha (otkaz jurnalidagi asl qiymat) */
function roundQty6(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
}

/** Foiz 2 xonagacha */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** LIKE uchun maxsus belgilarni ekranlash ('\' ESCAPE bilan) */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
