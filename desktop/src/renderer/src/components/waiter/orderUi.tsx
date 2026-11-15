// Buyurtma turi / holati uchun umumiy UI bo'laklari va yordamchilar (ofitsiant, KDS, navbat, kassa).
// Ranglar (R1): Stolga = primary, Olib ketish = warning, Yetkazib berish = success. Ko'k ishlatilmaydi.
import {
  MenuUnit,
  ORDER_TYPE_LABELS,
  Order,
  OrderStatus,
  OrderType,
  calcOrderTotals,
  formatUzPhone,
  normalizeUzPhone,
  orderDisplayName,
  orderTypeOf,
} from '@hardweb-pos/shared';
import { IconBag, IconProps, IconScooter, IconTable } from './icons';

/** Tor joylar uchun qisqa nomlar (telefon tugmalari, nishonlar) */
export const ORDER_TYPE_SHORT: Record<OrderType, string> = {
  [OrderType.DineIn]: 'Stol',
  [OrderType.Takeaway]: 'Olib',
  [OrderType.Delivery]: 'Yetkaz',
};

/** Buyurtma turining belgisi */
export const ORDER_TYPE_ICON: Record<OrderType, (p: IconProps) => JSX.Element> = {
  [OrderType.DineIn]: IconTable,
  [OrderType.Takeaway]: IconBag,
  [OrderType.Delivery]: IconScooter,
};

// Tailwind JIT sinflarni manbadan o'qiydi — shuning uchun to'liq sinf nomlari shu yerda yozilgan
export const ORDER_TYPE_TONE: Record<OrderType, { chip: string; text: string; soft: string; border: string; solid: string }> = {
  [OrderType.DineIn]: {
    chip: 'bg-primary/15 text-primary',
    text: 'text-primary',
    soft: 'bg-primary/10',
    border: 'border-primary/50',
    // Oq matn o'qilishi uchun to'qroq yashil (primary-hover) — ikkala temada ham kontrast yetarli
    solid: 'bg-primary-hover text-white',
  },
  [OrderType.Takeaway]: {
    chip: 'bg-warning/15 text-warning',
    text: 'text-warning',
    soft: 'bg-warning/10',
    border: 'border-warning/50',
    solid: 'bg-warning text-black',
  },
  [OrderType.Delivery]: {
    chip: 'bg-success/15 text-success',
    text: 'text-success',
    soft: 'bg-success/10',
    border: 'border-success/50',
    solid: 'bg-success text-black',
  },
};

/**
 * Buyurtma turi nishoni: [belgi] Olib ketish. Egasi talabi: holatlar uzoqdan ko'rinsin — nishon doim
 * to'liq (solid) rangda va yuqori kontrastli matnda (och fonli sariq/yashil matn yorug' temada ~3:1 edi).
 * `solid` prop moslik uchun qoldirildi.
 */
export function OrderTypeBadge({
  type,
  short,
  solid,
  className = '',
}: {
  type: OrderType | string | null | undefined;
  short?: boolean;
  solid?: boolean;
  className?: string;
}) {
  const t = orderTypeOf({ type });
  const Icon = ORDER_TYPE_ICON[t];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold leading-tight whitespace-nowrap ${
        solid !== false ? ORDER_TYPE_TONE[t].solid : ORDER_TYPE_TONE[t].chip
      } ${className}`}
    >
      <Icon className="w-3.5 h-3.5" strokeWidth={2.4} />
      {short ? ORDER_TYPE_SHORT[t] : ORDER_TYPE_LABELS[t]}
    </span>
  );
}

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  [OrderStatus.Accepted]: { label: 'Qabul qilindi', cls: 'bg-info/15 text-info' },
  [OrderStatus.Cooking]: { label: 'Tayyorlanmoqda', cls: 'bg-warning/15 text-warning' },
  // "Tayyor" — ajralib tursin (to'q yashil fon, qora matn — ikkala temada ham yaxshi o'qiladi)
  [OrderStatus.Ready]: { label: 'Tayyor', cls: 'bg-success text-black shadow-sm' },
  [OrderStatus.Closed]: { label: 'Yopilgan', cls: 'bg-muted/20 text-muted' },
};

/** Buyurtma holati: Qabul qilindi / Tayyorlanmoqda / Tayyor */
export function OrderStatusChip({ status, className = '' }: { status: OrderStatus | string; className?: string }) {
  const s = STATUS_CHIP[status] ?? STATUS_CHIP[OrderStatus.Accepted];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold leading-tight whitespace-nowrap ${s.cls} ${className}`}
    >
      {status === OrderStatus.Ready && <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />}
      {s.label}
    </span>
  );
}

/** Faqat raqamlar */
export function onlyDigits(s: string | null | undefined): string {
  return String(s ?? '').replace(/\D/g, '');
}

/**
 * Telefonni ko'rsatish: "+998 90 123 45 67". Har qanday yozuvdan (bo'shliq, "+", qavs) avval
 * raqamlar ajratiladi — shunda formatUzPhone 9 yoki 12 raqamli matnni ishonchli formatlaydi.
 */
export function phoneLabel(phone: string | null | undefined): string {
  const d = onlyDigits(phone);
  if (!d) return '';
  return formatUzPhone(d);
}

/**
 * API'ga yuboriladigan telefon: 12 raqam ("998901234567"). Server normalizeUzPhone bilan
 * "+998901234567" ga keltiradi. "+" belgisi yuborilmaydi — so'rov qatorida (?phone=) u bo'shliqqa
 * aylanib ketadi. Noto'g'ri raqam -> null.
 */
export function apiPhone(phone: string | null | undefined): string | null {
  const n = normalizeUzPhone(onlyDigits(phone));
  return n ? onlyDigits(n) : null;
}

/** Stol hisobining raqami (Hisob 1, 2 …): eski buyurtmalarda yo'q — 1 */
export function checkNoOf(o: Pick<Order, 'checkNo'> | null | undefined): number {
  const n = Number(o?.checkNo);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Buyurtmaning katta raqami: olib ketish/yetkazish — "#12", stol — "5" (belgisiz, egasining talabi) */
export function orderBigNumber(o: Pick<Order, 'type' | 'queueNumber' | 'tableNumber'>): string {
  if (orderTypeOf(o) === OrderType.DineIn) return String(o.tableNumber ?? '?');
  return `#${o.queueNumber ?? '?'}`;
}

/** Kunlik tartib raqami (B27 — barcha turlar uchun bitta ketma-ketlik): "№15"; yo'q bo'lsa — null */
export function dailyNumberLabel(o: Pick<Order, 'queueNumber'> | null | undefined): string | null {
  const n = o?.queueNumber;
  return typeof n === 'number' && n > 0 ? `№${n}` : null;
}

/** To'liq nom (stolda zal bilan): "Stol 5 · Hisob 2 · Zal", "Olib ketish #12" */
export function orderFullName(o: Pick<Order, 'type' | 'queueNumber' | 'tableNumber' | 'hall' | 'checkNo'>): string {
  const name = orderDisplayName(o);
  return orderTypeOf(o) === OrderType.DineIn && o.hall ? `${name} · ${o.hall}` : name;
}

/** Taomlar soni: dona taomlar — dona bo'yicha, kg taom — 1 qator = 1 */
export function orderItemCount(o: Pick<Order, 'items'>): number {
  return (o.items ?? []).reduce(
    (n, it) => n + (it.unit === MenuUnit.Weight ? 1 : Math.max(1, Math.round(Number(it.quantity) || 0))),
    0,
  );
}

/** To'lanadigan summa (B5): server bergan total, bo'lmasa qatorlardan (saboy va yetkazish narxi bilan) */
export function payableTotal(o: Order): number {
  if (typeof o.total === 'number' && Number.isFinite(o.total)) return o.total;
  return calcOrderTotals(
    (o.items ?? []).map((it) => ({ price: it.price ?? 0, quantity: it.quantity, takeaway: it.takeaway })),
    o.discountPercent,
    o.servicePercent,
    o.deliveryFee,
  ).total;
}

/** O'tgan vaqt: "5 daq", "1 soat 20 daq" */
export function elapsedLabel(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} daq`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} soat ${r} daq` : `${h} soat`;
}

/** Ism-familiyadan ism (kartochkalar uchun qisqa) */
export function firstName(name: string | null | undefined): string {
  return String(name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Summa minglik bo'linmas bo'shliq bilan (formatSum kabi — raqam qatorga bo'linmaydi), "so‘m"siz */
export function formatAmount(n: number | null | undefined): string {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? '−' : ''}${String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Vaqt "18:56" (qurilma tilidan qat'i nazar bir xil); noto'g'ri sana — '' */
export function hhmm(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Taom qo'shilgan vaqt — eski POS'dagidek "13.11.2026 (18:56)" */
export function addedAtLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} (${pad2(d.getHours())}:${pad2(d.getMinutes())})`;
}

/**
 * Og'irlik (kg): 3 xonagacha, vergul bilan, ortiqcha nollarsiz — "1,107" / "0,5" / "2".
 * Ichki miqdor 6 xonali bo'lishi mumkin (summa bo'yicha kiritilganda) — ekranda doim 3 xona.
 */
export function formatKg(q: number | string | null | undefined): string {
  const n = Number(q);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 1000) / 1000).replace('.', ',');
}

/** Miqdor birligi bilan: dona — "3", kg — "1,107 kg" */
export function qtyText(quantity: number | string, unit: MenuUnit | string | null | undefined): string {
  if (unit === MenuUnit.Weight) return `${formatKg(quantity)} kg`;
  const n = Number(quantity);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000).replace('.', ',') : '0';
}
