import {
  ORDER_TYPE_LABELS,
  Order,
  OrderItem,
  OrderStatus,
  OrderType,
  calcOrderTotals,
  formatUzPhone,
  normalizeUzPhone,
  orderDisplayName,
  orderTypeOf,
} from '@hardweb-pos/shared';
import { BagIcon, TableIcon, TruckIcon } from './icons';

// Buyurtma turi (stolga / olib ketish / yetkazib berish) bo'yicha umumiy UI yordamchilari:
// rang, ikonka, belgi (badge), nom. Kassa kartochkalari, to'lov oynasi, chek, tarix va
// hisobotlar shu yerdan foydalanadi — hamma joyda bir xil ko'rinadi.
// Ranglar (R1): Stolga — primary, Olib ketish — warning, Yetkazib berish — success (ko'k emas).

export interface TypeStyle {
  /** belgi (badge): fon + matn + chegara */
  chip: string;
  /** matn rangi */
  text: string;
  /** to'liq rangli fon (progress / ulush chizig'i) */
  bar: string;
  /** yengil fon (ikonka plitkasi) */
  soft: string;
  /** chegara rangi */
  border: string;
}

export const TYPE_STYLE: Record<OrderType, TypeStyle> = {
  [OrderType.DineIn]: {
    chip: 'bg-primary/15 text-primary border-primary/40',
    text: 'text-primary',
    bar: 'bg-primary',
    soft: 'bg-primary/15',
    border: 'border-primary/40',
  },
  [OrderType.Takeaway]: {
    chip: 'bg-warning/15 text-warning border-warning/40',
    text: 'text-warning',
    bar: 'bg-warning',
    soft: 'bg-warning/15',
    border: 'border-warning/40',
  },
  [OrderType.Delivery]: {
    chip: 'bg-success/15 text-success border-success/40',
    text: 'text-success',
    bar: 'bg-success',
    soft: 'bg-success/15',
    border: 'border-success/40',
  },
};

/** Tur ikonkasi: stol / paket / yuk mashina */
export function OrderTypeIcon({ type, className = 'w-5 h-5' }: { type: OrderType; className?: string }) {
  if (type === OrderType.Takeaway) return <BagIcon className={className} />;
  if (type === OrderType.Delivery) return <TruckIcon className={className} />;
  return <TableIcon className={className} />;
}

/** Tur nishoni uchun to'liq (solid) ranglar — ikkala temada ham yuqori kontrast */
const TYPE_BADGE: Record<OrderType, string> = {
  [OrderType.DineIn]: 'bg-primary-hover border-primary-hover text-white',
  [OrderType.Takeaway]: 'bg-warning border-warning text-black',
  [OrderType.Delivery]: 'bg-success border-success text-black',
};

/** Kichik tur belgisi: [ikonka] Olib ketish */
export function OrderTypeBadge({ type, className = '' }: { type: OrderType; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-bold whitespace-nowrap ${TYPE_BADGE[type]} ${className}`}
    >
      <OrderTypeIcon type={type} className="w-3.5 h-3.5" />
      {ORDER_TYPE_LABELS[type]}
    </span>
  );
}

/**
 * Buyurtma nomi (orderDisplayName) — raqam qismi kattaroq va tur rangida:
 * "Olib ketish #12" -> "Olib ketish" + katta "#12"; "Stol 5" -> "Stol" + katta "5";
 * "Stol 5 · Hisob 2" -> "Stol" + katta "5" + kichik "Hisob 2".
 */
export function OrderName({
  order,
  className = '',
}: {
  order: Pick<Order, 'type' | 'queueNumber' | 'tableNumber' | 'checkNo'>;
  className?: string;
}) {
  const name = orderDisplayName(order);
  const [main, ...rest] = name.split(' · ');
  const suffix = rest.join(' · ');
  const i = main.lastIndexOf(' ');
  const head = i > 0 ? main.slice(0, i) : main;
  const tail = i > 0 ? main.slice(i + 1) : '';
  const type = orderTypeOf(order);
  return (
    <div className={`font-extrabold leading-tight text-text ${className}`}>
      <span className="text-base sm:text-lg">{head}</span>{' '}
      {tail && <span className={`text-2xl sm:text-[28px] tracking-tight ${TYPE_STYLE[type].text}`}>{tail}</span>}
      {suffix && <span className="ml-1.5 text-sm font-bold text-muted whitespace-nowrap">· {suffix}</span>}
    </div>
  );
}

/** Nom + (stolda) zal: "Stol 5 — Zal" / "Stol 5 · Hisob 2 — Zal" / "Olib ketish #12" */
export function orderTitle(o: Pick<Order, 'type' | 'queueNumber' | 'tableNumber' | 'checkNo' | 'hall'>): string {
  const name = orderDisplayName(o);
  return orderTypeOf(o) === OrderType.DineIn && o.hall ? `${name} — ${o.hall}` : name;
}

/**
 * Buyurtma qatorlari -> pul hisobi uchun (narx × miqdor). "Olib ketish" (saboy) belgisi ham
 * uzatiladi — bunday qatorlarga xizmat haqi olinmaydi (shared calcOrderTotals, server bilan bir xil).
 */
export function moneyLines(items: OrderItem[] | null | undefined) {
  return (items ?? []).map((it) => ({ price: it.price ?? 0, quantity: it.quantity, takeaway: !!it.takeaway }));
}

/** Yetkazish narxi (B28) — faqat yetkazish buyurtmasida; boshqa turlarda doim 0 (server bilan bir xil) */
export function deliveryFeeOf(o: Pick<Order, 'type' | 'deliveryFee'>): number {
  return orderTypeOf(o) === OrderType.Delivery ? Math.max(0, Math.round(Number(o.deliveryFee) || 0)) : 0;
}

/**
 * Buyurtmaning to'lanadigan summalari (shared/money — server bilan aynan bir xil, butun so'm):
 * saboy qatorlariga xizmat haqi olinmaydi, yetkazish narxi oxirida qo'shiladi.
 * B5: server DTO'dagi total ham shu formula; lokal hisob eski server/demo bilan ham to'g'ri chiqadi.
 */
export function orderTotals(o: Pick<Order, 'type' | 'items' | 'discountPercent' | 'servicePercent' | 'deliveryFee'>) {
  return calcOrderTotals(moneyLines(o.items), o.discountPercent, o.servicePercent, deliveryFeeOf(o));
}

/**
 * Xizmat haqi qatori nomi: "Xizmat haqi 6%"; saboy (olib ketiladigan) taomlar bo'lsa — xizmat
 * qaysi summadan olingani ham: "Xizmat haqi 6% (20 000 dan)".
 */
export function serviceLabel(t: { servicePercent: number; serviceBase: number; subtotal: number }): string {
  const base = t.serviceBase < t.subtotal ? ` (${groupDigits(String(Math.max(0, Math.round(t.serviceBase))))} dan)` : '';
  return `Xizmat haqi ${formatPercent(t.servicePercent)}%${base}`;
}

/** Foiz: butun bo'lsa "6", kasr bo'lsa "6,5" */
export function formatPercent(p: number | string | null | undefined): string {
  const n = Number(p);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/** Kunlik tartib raqami (B27 — barcha turlar uchun bitta ketma-ketlik): "№15"; yo'q bo'lsa — null */
export function dailyNumber(o: Pick<Order, 'queueNumber'> | null | undefined): string | null {
  const n = o?.queueNumber;
  return typeof n === 'number' && n > 0 ? `№${n}` : null;
}

/**
 * "Teng bo'lish": qolgan summani N kishiga — dastlabki ulushlar yuqoriga yaxlitlanadi (butun so'm),
 * oxirgisi qolganini oladi, shuning uchun ulushlar yig'indisi qolgan summaga AYNAN teng:
 * 100 001 / 3 -> 33 334, 33 334, 33 333.
 */
export function equalParts(remaining: number, n: number): number[] {
  const total = Math.max(0, Math.round(remaining));
  if (n < 2 || total < n) return [];
  const share = Math.ceil(total / n);
  const parts: number[] = [];
  let left = total;
  for (let i = 0; i < n; i++) {
    const p = i < n - 1 ? Math.min(share, left) : left;
    parts.push(p);
    left -= p;
  }
  // Juda kichik summada oxirgi ulush 0 bo'lib qolishi mumkin (masalan 4 so'm / 3) — bunday variant yo'q
  return parts.every((p) => p > 0) ? parts : [];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Vaqt "18:56" (qurilma tilidan qat'i nazar bir xil); noto'g'ri sana — '' */
export function clock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Sana va vaqt "13.11.2026 18:56" */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Bugungi mahalliy sana "YYYY-MM-DD" (server hisobotlari shu kalit bilan ishlaydi) */
export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Stol hisobining raqami (Hisob 1, 2 …): eski buyurtmalarda yo'q — 1 */
export function checkNumber(o: Pick<Order, 'checkNo'> | null | undefined): number {
  const n = Number(o?.checkNo);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

const STATUS_CHIP: Record<OrderStatus, { label: string; cls: string }> = {
  [OrderStatus.Accepted]: { label: 'Qabul qilindi', cls: 'bg-info/15 text-info' },
  [OrderStatus.Cooking]: { label: 'Tayyorlanmoqda', cls: 'bg-warning/15 text-warning' },
  [OrderStatus.Ready]: { label: 'Tayyor', cls: 'bg-success/20 text-success ring-1 ring-success/50' },
  [OrderStatus.Closed]: { label: 'Yopilgan', cls: 'bg-muted/20 text-muted' },
};

/** Ixcham holat belgisi (kartochka uchun) */
export function StatusChip({ status }: { status: OrderStatus }) {
  const it = STATUS_CHIP[status] ?? STATUS_CHIP[OrderStatus.Accepted];
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs font-bold whitespace-nowrap ${it.cls}`}>{it.label}</span>
  );
}

/** Ochilganiga necha vaqt bo'ldi: "hozir", "12 daq", "1 soat 5 daq" */
export function formatAge(minutes: number): string {
  if (minutes < 1) return 'hozir';
  if (minutes < 60) return `${minutes} daq`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 24) return `${Math.floor(h / 24)} kun`;
  return m ? `${h} soat ${m} daq` : `${h} soat`;
}

const onlyDigits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');

/**
 * Telefon (O'zbekiston) -> "+998 90 123 45 67". Shared yordamchilarga avval faqat raqamlar
 * beriladi (server ham shunday qiladi) — "+998 (90) 123-45-67" kabi yozuvlar ham to'g'ri chiqadi.
 * O'zbekiston raqami bo'lmasa — yozilganicha qaytadi.
 */
export function displayPhone(phone: string | null | undefined): string {
  const raw = String(phone ?? '').trim();
  if (!raw) return '';
  const d = onlyDigits(raw);
  return normalizeUzPhone(d) ? formatUzPhone(d) : raw;
}

/** Kiritilgan telefonni yagona shaklga keltirish: "+998901234567" yoki noto'g'ri bo'lsa null */
export function normalizePhone(input: string | null | undefined): string | null {
  return normalizeUzPhone(onlyDigits(input));
}

/** Faqat raqamlarni minglik bo'shliq bilan guruhlash: "1250000" -> "1 250 000" (kiritish maydoni uchun) */
export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
