// Bo'lim (oshxona/bar...) cheklarining qog'ozdagi ko'rinishi.
// Joylashuv desktop/src/main/escpos.ts buildKitchenTicketBuffer bilan bir xil (restoran o'rgangan
// ko'rinish): katta sarlavha, STOL №, zal, vaqt, taomlar katta shriftda, izohlar, kesish.
// Qo'shimchalar: ofitsiant ismi, buyurtma izohi, qo'shimcha buyurtma uchun "* QO'SHIMCHA *",
// vaqt — chek chiqqan payt (buyurtma ochilgan vaqt emas).
import { EscPosBuilder, toPrintable } from './escpos';

/** Foydalanuvchi kiritgan qiymat (nom, zal, izoh): ASCII, ortiqcha bo'shliqlarsiz */
function clean(value: unknown): string {
  return toPrintable(value).replace(/ {2,}/g, ' ').trim();
}

/** Odatiy qog'oz kengligi (80 mm) */
export const DEFAULT_PAPER_WIDTH = 48;

/** Qo'shimcha (mavjud buyurtmaga qo'shilgan) taomlar chekining sarlavhasi */
export const APPEND_TITLE = "* QO'SHIMCHA *";

/** Qog'oz kengligi (belgilarda): 32 = 58 mm, 48 = 80 mm. Noto'g'ri qiymat — 48. */
export function normalizePaperWidth(width: unknown): number {
  const w = Number(width);
  return Number.isInteger(w) && w >= 16 && w <= 80 ? w : DEFAULT_PAPER_WIDTH;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Mahalliy vaqt HH:MM */
export function clockText(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Mahalliy sana-vaqt YYYY-MM-DD HH:MM */
export function dateTimeText(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${clockText(d)}`;
}

/**
 * Miqdor matni: dona -> "2", kg -> "1.5 kg" (ko'pi bilan 3 xona kasr, ortiqcha nollarsiz).
 * Dona odatda butun son; kasr kelib qolsa (noto'g'ri kiritilgan) yaxlitlamaymiz —
 * oshxona aniq miqdorni ko'rsin.
 */
export function formatQty(quantity: number | string, unit?: string | null): string {
  const q = Number(quantity);
  if (!Number.isFinite(q)) return '?';
  const n = String(Math.round(q * 1000) / 1000);
  return unit === 'kg' ? `${n} kg` : n;
}

export interface TicketItem {
  name: string;
  quantity: number | string;
  unit?: string | null;
  note?: string | null;
}

export interface StationTicketInput {
  width: number;
  stationName: string;
  /** true — mavjud buyurtmaga qo'shimcha: sarlavha "* QO'SHIMCHA *", ostida bo'lim nomi */
  append: boolean;
  tableNumber?: number | string | null;
  hall?: string | null;
  waiterName?: string | null;
  orderNote?: string | null;
  items: TicketItem[];
  printedAt: Date;
}

/** Bo'lim cheki (narxsiz): faqat shu bo'limga tegishli taomlar */
export function buildStationTicket(t: StationTicketInput): Buffer {
  const b = new EscPosBuilder(normalizePaperWidth(t.width));
  const station = clean(t.stationName) || "Bo'lim";
  const hall = clean(t.hall);
  const waiter = clean(t.waiterName);
  const orderNote = clean(t.orderNote);

  b.align('center').bold(true);
  if (t.append) {
    b.wrapped(APPEND_TITLE, { double: true });
    b.wrapped(station);
  } else {
    b.wrapped(station, { double: true });
  }
  b.wrapped(`STOL №${clean(t.tableNumber ?? '-') || '-'}`, { double: true });
  if (hall) b.wrapped(hall);
  b.bold(false);
  if (waiter) b.wrapped(`Ofitsiant: ${waiter}`);
  b.line(clockText(t.printedAt));
  b.divider();

  b.align('left');
  for (const it of t.items) {
    const qty = `${formatQty(it.quantity, it.unit)} x `;
    const note = clean(it.note);
    // Nom uzun bo'lsa keyingi qator nom ostidan davom etadi
    b.bold(true).wrapped(`${qty}${clean(it.name) || 'Taom'}`, { double: true, hang: qty.length });
    b.bold(false);
    if (note) b.wrapped(`   >> ${note}`, { hang: 6 });
  }
  b.divider();

  if (orderNote) {
    b.bold(true).wrapped(`IZOH: ${orderNote}`, { hang: 6 }).bold(false);
    b.divider();
  }

  b.feed(2).cut();
  return b.build();
}

export interface TestTicketInput {
  width: number;
  stationName: string;
  address: string; // "192.168.1.50:9100"
  printedAt: Date;
}

/** Sinov cheki (Bo'limlar -> "Sinov"): printer manzili, qog'oz kengligi va namunaviy qator */
export function buildTestTicket(t: TestTicketInput): Buffer {
  const width = normalizePaperWidth(t.width);
  const paper = width === 32 ? '58 mm' : width === 48 ? '80 mm' : null;
  const b = new EscPosBuilder(width);

  b.align('center').bold(true);
  b.wrapped('SINOV CHEKI', { double: true });
  b.wrapped(clean(t.stationName) || "Bo'lim");
  b.bold(false).line(dateTimeText(t.printedAt));
  b.divider();

  b.align('left');
  b.wrapped(`Printer: ${t.address}`);
  b.wrapped(`Qog'oz: ${paper ? `${paper} (${width} belgi)` : `${width} belgi`}`);
  b.divider();
  b.bold(true).wrapped('2 x Namuna taom', { double: true, hang: 4 }).bold(false);
  b.wrapped('   >> izoh namunasi', { hang: 6 });
  b.divider();

  b.align('center');
  b.wrapped("Chiziqlar bitta qatorga sig'sa - qog'oz kengligi to'g'ri tanlangan.");
  b.feed(2).cut();
  return b.build();
}
