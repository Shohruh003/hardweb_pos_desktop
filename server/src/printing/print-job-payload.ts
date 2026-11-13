// Chek navbati (print_jobs.payload): chekni keyinroq (printer/svet tiklangach, server qayta ishga
// tushgandan keyin ham) AYNAN qayta qurish uchun barcha ma'lumot — sarlavha, buyurtma turi va raqami,
// stol/zal/hisob, ofitsiant, taomlar (izoh, saboy belgisi bilan), buyurtma izohi va vaqti.
// Bazadan o'qilgan payload eski/buzilgan bo'lishi mumkin — har maydon ehtiyotkorlik bilan o'qiladi.
import { OrderType, orderTypeOf } from '@hardweb-pos/shared';
import { buildStationTicket, buildVoidTicket, TicketItem, TicketOrderInfo } from './tickets';

/** Payload tuzilmasi versiyasi (kelajakda o'zgarsa eski yozuvlarni farqlash uchun) */
export const PAYLOAD_VERSION = 1;

/** 'order' — oddiy bo'lim cheki (yangi taomlar / QO'SHIMCHA); 'void' — OTKAZ cheki */
export type PrintJobKind = 'order' | 'void';

interface PayloadBase {
  v: number;
  kind: PrintJobKind;
  stationName: string;
  orderType: OrderType;
  queueNumber: number | null;
  tableNumber: number | null;
  hall: string | null;
  checkNo: number | null;
  /** Taomlar yuborilgan (yoki otkaz qilingan) vaqt, ISO */
  orderTime: string;
}

export interface OrderTicketPayload extends PayloadBase {
  kind: 'order';
  append: boolean;
  waiterName: string | null;
  orderNote: string | null;
  items: Array<{ name: string; quantity: number; unit: string | null; note: string | null; takeaway: boolean }>;
}

export interface VoidTicketPayload extends PayloadBase {
  kind: 'void';
  reason: string | null;
  userName: string | null;
  items: Array<{ name: string; quantity: number; unit: string | null }>;
}

export type TicketPayload = OrderTicketPayload | VoidTicketPayload;

/** Chekni qayta qurish uchun navbat yozuvidan kerakli maydonlar */
export interface RenderableJob {
  kind: string;
  stationName: string;
  append: boolean;
  payload: Record<string, unknown> | null;
  createdAt?: Date | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const int = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isInteger(n) ? n : null;
};
const qty = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const validDate = (v: unknown): Date | null => {
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d : null;
};

/** Sarlavha maydonlari (payload'dan) */
function orderInfo(p: Record<string, unknown>): TicketOrderInfo {
  return {
    orderType: orderTypeOf({ type: str(p.orderType) }),
    queueNumber: int(p.queueNumber),
    tableNumber: int(p.tableNumber) ?? str(p.tableNumber),
    checkNo: int(p.checkNo),
    hall: str(p.hall),
  };
}

/**
 * Navbatdagi chekni printer baytlariga aylantirish. `printedAt` — hozir (chekdagi vaqt);
 * chek buyurtmadan 60 s+ kechiksa sarlavha ostida "KECHIKKAN CHEK" qatori chiqadi.
 * Payload buzilgan bo'lsa — null (bunday chekni chop etib bo'lmaydi).
 */
export function renderJobTicket(job: RenderableJob, width: number, printedAt: Date): Buffer | null {
  const p = job.payload;
  if (!p || typeof p !== 'object' || !Array.isArray(p.items)) return null;
  const rawItems = (p.items as unknown[]).filter(
    (it): it is Record<string, unknown> => !!it && typeof it === 'object',
  );
  if (rawItems.length === 0) return null;
  const stationName = str(job.stationName) ?? str(p.stationName) ?? "Bo'lim";
  const orderedAt = validDate(job.createdAt) ?? validDate(p.orderTime);

  if (job.kind === 'void') {
    return buildVoidTicket({
      width,
      stationName,
      ...orderInfo(p),
      items: rawItems.map((it) => ({ name: str(it.name) ?? 'Taom', quantity: qty(it.quantity), unit: str(it.unit) })),
      reason: str(p.reason),
      userName: str(p.userName),
      printedAt,
      orderedAt,
    });
  }
  const items: TicketItem[] = rawItems.map((it) => ({
    name: str(it.name) ?? 'Taom',
    quantity: qty(it.quantity),
    unit: str(it.unit),
    note: str(it.note),
    takeaway: it.takeaway === true,
  }));
  return buildStationTicket({
    width,
    stationName,
    append: !!job.append,
    ...orderInfo(p),
    waiterName: str(p.waiterName),
    orderNote: str(p.orderNote),
    items,
    printedAt,
    orderedAt,
  });
}
