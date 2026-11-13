// Bo'lim (oshxona/bar...) cheklarining qog'ozdagi ko'rinishi.
// Joylashuv desktop/src/main/escpos.ts buildKitchenTicketBuffer bilan bir xil (restoran o'rgangan
// ko'rinish): katta sarlavha, STOL raqami, zal, vaqt, taomlar katta shriftda, izohlar, kesish.
// Qo'shimchalar: ofitsiant ismi, buyurtma izohi, qo'shimcha buyurtma uchun "* QO'SHIMCHA *",
// vaqt — chek chiqqan payt (buyurtma ochilgan vaqt emas).
// Buyurtma turi bo'yicha katta sarlavha: stol -> "STOL 5" (+ zal; 2-hisobdan boshlab "STOL 5 - HISOB 2"),
// olib ketish -> "OLIB KETISH #12", yetkazish -> "YETKAZISH #5". Stol raqami "№"/"No" belgisisiz (D4).
// Oshxona chekida mijoz telefoni/manzili chiqmaydi.
// Chek navbatdan (svet/printer o'chganidan keyin) kechikib chiqsa — sarlavha ostida
// "KECHIKKAN CHEK - buyurtma vaqti HH:MM" qatori bo'ladi.
import { OrderType, orderTypeOf } from '@hardweb-pos/shared';
import { EscPosBuilder, toPrintable } from './escpos';

/** Foydalanuvchi kiritgan qiymat (nom, zal, izoh): ASCII, ortiqcha bo'shliqlarsiz */
function clean(value: unknown): string {
  return toPrintable(value).replace(/ {2,}/g, ' ').trim();
}

/** Odatiy qog'oz kengligi (80 mm) */
export const DEFAULT_PAPER_WIDTH = 48;

/** Qo'shimcha (mavjud buyurtmaga qo'shilgan) taomlar chekining sarlavhasi */
export const APPEND_TITLE = "* QO'SHIMCHA *";

/** Otkaz (bekor qilingan taomlar) chekining katta sarlavhasi */
export const VOID_TITLE = '*** OTKAZ ***';

/** Stoldagi mehmon olib ketadigan (saboy) taomlar guruhi ajratgichi */
export const TAKEAWAY_SEPARATOR = '--- OLIB KETISH (SABOY) ---';

/** Chek shuncha kechiksa (buyurtmadan keyin) — "KECHIKKAN CHEK" qatori chiqadi */
export const LATE_TICKET_MS = 60_000;

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
 * Miqdor matni: dona -> "2", kg -> "1.5 kg" (ko'pi bilan 3 xona kasr, ortiqcha nollarsiz:
 * 1.106667 kg -> "1.107 kg"). Dona odatda butun son; kasr kelib qolsa (noto'g'ri kiritilgan)
 * yaxlitlamaymiz — oshxona aniq miqdorni ko'rsin.
 */
export function formatQty(quantity: number | string, unit?: string | null): string {
  const q = Number(quantity);
  if (!Number.isFinite(q)) return '?';
  const n = String(Math.round(q * 1000) / 1000);
  return unit === 'kg' ? `${n} kg` : n;
}

/**
 * Izohdagi vaqt ("⏰ 15:00 ga tayyor", "soat 9:30 da") -> "15:00". Ofitsiant ekranidagi
 * noteTime() bilan bir xil qoida (KDS'dagi "⏰" nishoni ham shu vaqtni ko'rsatadi). Yo'q — null.
 */
export function noteTime(note: string | null | undefined): string | null {
  const m = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(String(note ?? ''));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

export interface TicketItem {
  name: string;
  quantity: number | string;
  unit?: string | null;
  note?: string | null;
  /** Stoldagi mehmon olib ketadi (saboy) — chekda alohida guruhda chiqadi */
  takeaway?: boolean;
}

/** Chek sarlavhasidagi buyurtma ma'lumotlari */
export interface TicketOrderInfo {
  /** Buyurtma turi (berilmasa yoki noma'lum — stolga) */
  orderType?: OrderType | string | null;
  /** Kunlik buyurtma raqami (#12) — olib ketish/yetkazishda sarlavhada, stolda "Buyurtma №15" qatorida */
  queueNumber?: number | null;
  tableNumber?: number | string | null;
  /** Stoldagi alohida hisob raqami (2 va undan katta bo'lsa sarlavhada "HISOB 2") */
  checkNo?: number | null;
  hall?: string | null;
}

export interface StationTicketInput extends TicketOrderInfo {
  width: number;
  stationName: string;
  /** true — mavjud buyurtmaga qo'shimcha: sarlavha "* QO'SHIMCHA *", ostida bo'lim nomi */
  append: boolean;
  waiterName?: string | null;
  orderNote?: string | null;
  items: TicketItem[];
  /** Chek chop etilayotgan payt (chekdagi vaqt) */
  printedAt: Date;
  /** Taomlar yuborilgan (buyurtma) payt — chek LATE_TICKET_MS dan ko'p kechiksa "KECHIKKAN CHEK" */
  orderedAt?: Date | null;
}

/** Chekning katta (ikki barobar) sarlavha qatori: "STOL 5" / "STOL 5 — HISOB 2" / "OLIB KETISH #12" / "YETKAZISH #5" */
export function ticketOrderTitle(t: TicketOrderInfo): string {
  const type = orderTypeOf({ type: t.orderType });
  const queue = t.queueNumber != null ? clean(t.queueNumber) : '';
  if (type === OrderType.Takeaway) return `OLIB KETISH #${queue || '?'}`;
  if (type === OrderType.Delivery) return `YETKAZISH #${queue || '?'}`;
  const table = clean(t.tableNumber ?? '-') || '-';
  const check = Number(t.checkNo);
  return Number.isInteger(check) && check >= 2 ? `STOL ${table} — HISOB ${check}` : `STOL ${table}`;
}

/** Stolga buyurtmaning kunlik raqami qatori (B27): "Buyurtma №15" (qog'ozda "No 15"). Yo'q — '' */
function orderNumberLine(t: TicketOrderInfo): string {
  if (orderTypeOf({ type: t.orderType }) !== OrderType.DineIn) return ''; // raqam sarlavhaning o'zida
  const n = Number(t.queueNumber);
  return Number.isInteger(n) && n > 0 ? `Buyurtma №${n}` : '';
}

/** Kechikkan chek qatori (navbatdan keyinroq chiqqan chek) yoki '' */
function lateLine(printedAt: Date, orderedAt?: Date | null): string {
  if (!orderedAt || !Number.isFinite(orderedAt.getTime())) return '';
  if (printedAt.getTime() - orderedAt.getTime() < LATE_TICKET_MS) return '';
  return `KECHIKKAN CHEK — buyurtma vaqti ${clockText(orderedAt)}`;
}

/**
 * Sarlavha bloki (markazda): `top` qatorlari (bo'lim nomi / "* QO'SHIMCHA *" / "*** OTKAZ ***";
 * double — ikki barobar shrift), katta buyurtma nomi, zal, "Buyurtma №15", "KECHIKKAN CHEK" qatori.
 */
function header(
  b: EscPosBuilder,
  t: TicketOrderInfo & { printedAt: Date; orderedAt?: Date | null },
  top: Array<{ text: string; double?: boolean }>,
): void {
  const dineIn = orderTypeOf({ type: t.orderType }) === OrderType.DineIn;
  // Zal faqat stolga buyurtmada (olib ketish / yetkazishda zal yo'q)
  const hall = dineIn ? clean(t.hall) : '';
  b.align('center').bold(true);
  for (const line of top) b.wrapped(line.text, { double: !!line.double });
  b.wrapped(ticketOrderTitle(t), { double: true });
  if (hall) b.wrapped(hall);
  b.bold(false);
  const no = orderNumberLine(t);
  if (no) b.wrapped(no);
  const late = lateLine(t.printedAt, t.orderedAt);
  if (late) b.bold(true).wrapped(late).bold(false);
}

/** Bitta taom qatori: "2 x OSH" (katta, qalin) + izoh ">> ..." (qalin) + izohda vaqt bo'lsa "VAQT: 15:00" (katta) */
function itemLines(b: EscPosBuilder, it: TicketItem, prefix = ''): void {
  const qty = `${prefix}${formatQty(it.quantity, it.unit)} x `;
  // Nom uzun bo'lsa keyingi qator nom ostidan davom etadi
  b.bold(true).wrapped(`${qty}${clean(it.name) || 'Taom'}`, { double: true, hang: qty.length });
  const note = clean(it.note);
  if (note) {
    b.wrapped(`   >> ${note}`, { hang: 6 });
    // "⏰ 15:00 ga tayyor" — oshpaz vaqtni uzoqdan ko'rsin (emoji qog'ozga chiqmaydi, toPrintable olib tashlaydi)
    const time = noteTime(note);
    if (time) b.wrapped(`  VAQT: ${time}`, { double: true });
  }
  b.bold(false);
}

/** Bo'lim cheki (narxsiz): faqat shu bo'limga tegishli taomlar */
export function buildStationTicket(t: StationTicketInput): Buffer {
  const b = new EscPosBuilder(normalizePaperWidth(t.width));
  const station = clean(t.stationName) || "Bo'lim";
  const dineIn = orderTypeOf({ type: t.orderType }) === OrderType.DineIn;
  const waiter = clean(t.waiterName);
  const orderNote = clean(t.orderNote);

  header(
    b,
    t,
    t.append
      ? [{ text: APPEND_TITLE, double: true }, { text: station }]
      : [{ text: station, double: true }],
  );
  if (waiter) b.wrapped(`Ofitsiant: ${waiter}`);
  b.line(clockText(t.printedAt));
  b.divider();

  b.align('left');
  // Stolga buyurtmada: avval zalda yeyiladigan taomlar, keyin "OLIB KETISH (SABOY)" guruhi.
  // Olib ketish / yetkazish buyurtmasi butunlay olib ketiladi — guruhlash shart emas (sarlavhada ko'rinadi).
  const hallItems = dineIn ? t.items.filter((it) => !it.takeaway) : t.items;
  const takeawayItems = dineIn ? t.items.filter((it) => !!it.takeaway) : [];
  for (const it of hallItems) itemLines(b, it);
  if (takeawayItems.length) {
    b.align('center').bold(true).wrapped(TAKEAWAY_SEPARATOR).bold(false).align('left');
    for (const it of takeawayItems) itemLines(b, it);
  }
  b.divider();

  if (orderNote) {
    b.bold(true).wrapped(`IZOH: ${orderNote}`, { hang: 6 }).bold(false);
    b.divider();
  }

  b.feed(2).cut();
  return b.build();
}

export interface VoidTicketInput extends TicketOrderInfo {
  width: number;
  stationName: string;
  items: Array<{ name: string; quantity: number | string; unit?: string | null }>;
  reason?: string | null;
  /** Kim otkaz qildi (kassir / direktor) */
  userName?: string | null;
  printedAt: Date;
  /** Otkaz qilingan payt — chek kechiksa "KECHIKKAN CHEK" */
  orderedAt?: Date | null;
}

/**
 * OTKAZ cheki (B19): oshxona bekor qilingan taomni tayyorlamasin. Katta "*** OTKAZ ***",
 * bo'lim, buyurtma nomi, "-1 x BULYON" qatorlari, sabab va kim otkaz qilgani.
 */
export function buildVoidTicket(t: VoidTicketInput): Buffer {
  const b = new EscPosBuilder(normalizePaperWidth(t.width));
  const station = clean(t.stationName) || "Bo'lim";
  const reason = clean(t.reason);
  const user = clean(t.userName);

  header(b, t, [{ text: VOID_TITLE, double: true }, { text: station }]);
  b.line(clockText(t.printedAt));
  b.divider();

  b.align('left');
  for (const it of t.items) {
    const qty = `-${formatQty(it.quantity, it.unit)} x `;
    b.bold(true).wrapped(`${qty}${clean(it.name) || 'Taom'}`, { double: true, hang: qty.length }).bold(false);
  }
  b.divider();
  b.bold(true).wrapped(`Sabab: ${reason || "ko'rsatilmagan"}`, { hang: 7 }).bold(false);
  if (user) b.wrapped(`Kim: ${user}`, { hang: 5 });
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
  b.bold(true).wrapped('2 x Namuna taom', { double: true, hang: 4 });
  b.wrapped('   >> izoh namunasi', { hang: 6 }).bold(false);
  b.divider();

  b.align('center');
  b.wrapped("Chiziqlar bitta qatorga sig'sa - qog'oz kengligi to'g'ri tanlangan.");
  b.feed(2).cut();
  return b.build();
}
