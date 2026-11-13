// Direktor hisobotlari uchun turlar (TZ 5.5)
import { OrderType, PaymentType } from './enums';

export type ReportPeriod = 'day' | 'week' | 'month';

export interface ReportSummary {
  period: ReportPeriod;
  revenue: number; // umumiy tushum
  ordersCount: number; // yopilgan hisoblar soni
  avgCheck: number; // o'rtacha chek
  paymentBreakdown: { type: PaymentType; amount: number }[]; // to'lov turlari bo'yicha
  // buyurtma turlari bo'yicha (stolga / olib ketish / yetkazish) — yopilgan hisoblar soni va tushum
  byOrderType?: { type: OrderType; count: number; amount: number }[];
}

export interface TopItem {
  name: string;
  quantity: number;
  sum: number;
}

export interface WaiterStat {
  waiterId?: string;
  waiterName: string;
  ordersCount: number;
  revenue: number;
}

/**
 * Ofitsiantlar hisoboti (eski POS'dagi "Ofitsiantlar bo'yicha hisobot" kabi).
 * Mijoz stolga buyurtmada 6% xizmat haqi to'laydi; ofitsiantga stolga buyurtmalar summasining 5% i
 * (sharePercent) tegadi; qolgani muassasada. Faqat yopilgan, vozvrat qilinmagan buyurtmalar.
 */
export interface WaiterShareRow {
  waiterId: string;
  waiterName: string;
  role: string;
  ordersCount: number; // yopilgan hisoblar soni (barcha turlar)
  dineInSales: number; // "Buyurtmalar summasi" — stolga buyurtmalar taomlari summasi (xizmatsiz)
  takeawaySales: number; // "Olib ketish va yetkazish" summasi
  serviceAmount: number; // "Xizmat summasi" — undirilgan xizmat haqi
  shareAmount: number; // "Ofitsiant xizmatlari" = round(dineInSales × sharePercent / 100)
}

export interface WaiterShareReport {
  from: string; // YYYY-MM-DD (mahalliy sana, kiradi)
  to: string; // YYYY-MM-DD (kiradi)
  sharePercent: number;
  totals: Omit<WaiterShareRow, 'waiterId' | 'waiterName' | 'role'>;
  rows: WaiterShareRow[];
}

/** GET /api/reports/my-share?date= — ofitsiantning o'z ko'rsatkichlari (o'z ekranida) */
export interface MyShare {
  from: string;
  to: string;
  ordersCount: number;
  dineInSales: number;
  takeawaySales: number;
  shareAmount: number;
  sharePercent: number;
}

/** GET /api/reports/voids?from=&to= — otkazlar hisoboti */
export interface VoidReport {
  from: string;
  to: string;
  count: number; // otkaz qilingan qatorlar soni
  total: number; // otkaz summasi
  items: import('./models').VoidLog[];
}

/**
 * Kassa harakati (eski POS'dagi "Kirim / Chiqim"): chiqim — rasxod (mavjud expenses), kirim — kassaga
 * qo'yilgan pul (ertalabki maydalik, egasi bergan pul va h.k.). POST /api/expenses {amount, note, kind}.
 */
export type CashMovementKind = 'kirim' | 'chiqim';

/** GET /api/reports/cash-summary?date=YYYY-MM-DD — kun bo'yicha kassa holati (kassada qancha naqd bo'lishi kerak) */
export interface CashSummary {
  date: string; // YYYY-MM-DD
  byMethod: { key: string; label: string; kind: string; amount: number }[]; // to'lov usullari bo'yicha tushum
  kirim: number; // kassaga kiritilgan
  chiqim: number; // kassadan chiqarilgan (rasxod)
  debtCreated: number; // shu kuni qarzga yozilgan
  debtRepaid: { key: string; label: string; amount: number }[]; // shu kuni qaytarilgan qarzlar (qaysi usul bilan)
  refundsCash: number; // naqd vozvratlar
  expectedCash: number; // kassada bo'lishi kerak: naqd tushum + kirim - chiqim + naqd qaytarilgan qarz - naqd vozvrat
}

/** Qarzlar ro'yxati qatori — GET /api/reports/debts?status=open|repaid|all&from=&to= */
export interface DebtRow {
  paymentId: string;
  orderId: string;
  orderName: string | null; // "Stol 5" / "Olib ketish #12"
  queueNumber: number | null;
  createdAt: string; // qarzga yozilgan vaqt (ISO)
  amount: number;
  debtorName: string | null;
  debtorPhone: string | null;
  repaidAt: string | null; // qaytarilgan bo'lsa
  repaidType: string | null; // qaysi usul bilan qaytarildi (to'lov usuli kaliti)
  repaidByName: string | null;
}
