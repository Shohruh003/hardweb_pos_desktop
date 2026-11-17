// Buyurtma holatlari qoidalari — server va demo (mock) bir xil tekshiradi.
import { OrderStatus, OrderType } from './enums';
import { hasCapability, isFullAccessRole } from './permissions';

type StaffLike = { id?: string | null; role?: string | null; permissions?: string[] | null } | null | undefined;

/**
 * Kassa darajasidagi xodim — kassir ('cashier' ruxsati), administrator, direktor (restoran talabi, 0.3.3).
 * Faqat ular: stolni ko'chiradi, buyurtma turini o'zgartiradi, hisobni bo'ladi, schot chiqaradi,
 * istalgan stolga xizmat qiladi va boshqa ofitsiantlar hisoblarining summasini ko'radi.
 * Ofitsiant — faqat o'z stollari va o'z savdosi.
 */
export function isOrderManager(user: StaffLike): boolean {
  if (!user) return false;
  const role = String(user.role ?? '');
  if (isFullAccessRole(role) || role === 'administrator') return true;
  return hasCapability({ role, permissions: user.permissions ?? [] }, 'cashier');
}

/** Kassa amallarini ofitsiant bajarmoqchi bo'lganda (server 403 va UI xabari — bir xil matn) */
export const BILL_FORBIDDEN_MESSAGE = 'Schotni faqat kassir chiqara oladi';
export const MOVE_TABLE_FORBIDDEN_MESSAGE = 'Stolni faqat kassir ko‘chira oladi';
export const CHANGE_TYPE_FORBIDDEN_MESSAGE = 'Buyurtma turini faqat kassir o‘zgartira oladi';
export const SPLIT_FORBIDDEN_MESSAGE = 'Hisobni faqat kassir bo‘la oladi';

/** Bu buyurtma shu xodimniki (u ochgan) yoki xodim kassa darajasida — summasini ko'ra / ocha oladi */
export function canSeeOrder(user: StaffLike, order: { waiterId?: string | null } | null | undefined): boolean {
  if (!user || !order) return false;
  return isOrderManager(user) || !order.waiterId || order.waiterId === user.id;
}

/** Ofitsiant boshqa ofitsiantning stoliga taom qo'shmoqchi bo'lganda */
export const TABLE_OWNER_MESSAGE = 'Bu stol boshqa ofitsiantga tegishli — unga taom qo‘sha olmaysiz';

/**
 * Stol egasi qoidasi (restoran talabi): ofitsiant istalgan BO'SH stolni ocha oladi, lekin boshqa
 * ofitsiant ochgan (ochiq hisobi bor) stolga taom qo'sha olmaydi va u yerda yangi hisob ocha olmaydi.
 * Kassir, administrator va direktor — hamma stolga. openOrders — shu stoldagi ochiq hisoblar.
 */
export function canServeTable(
  user: StaffLike,
  openOrders: { waiterId?: string | null }[] | null | undefined,
): boolean {
  if (!user) return false;
  if (isOrderManager(user)) return true;
  return (openOrders ?? []).every((o) => !o.waiterId || o.waiterId === user.id);
}

/** Ofitsiant boshqa ofitsiantning olib ketish / yetkazish buyurtmasiga taom qo'shmoqchi bo'lganda */
export const ORDER_OWNER_MESSAGE = 'Bu buyurtma boshqa ofitsiantga tegishli — unga taom qo‘sha olmaysiz';

/** Buyurtma turlari nomi (UI tugmalari, chek, hisobot) */
export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  [OrderType.DineIn]: 'Stolga',
  [OrderType.Takeaway]: 'Olib ketish',
  [OrderType.Delivery]: 'Yetkazib berish',
};

/** Ekran tartibi: Stolga | Olib ketish | Yetkazib berish */
export const ORDER_TYPES: OrderType[] = [OrderType.DineIn, OrderType.Takeaway, OrderType.Delivery];

/** Buyurtma turi (eski buyurtmalarda type bo'lmasa — stolga) */
export function orderTypeOf(o: { type?: OrderType | string | null } | null | undefined): OrderType {
  const t = o?.type;
  return t === OrderType.Takeaway || t === OrderType.Delivery ? t : OrderType.DineIn;
}

/**
 * Buyurtmaning qisqa nomi — kartochka, chek, oshxona cheki, KDS, Telegram uchun.
 *  stol:        "Stol 5"  (zal alohida ko'rsatiladi)
 *  olib ketish: "Olib ketish #12"
 *  yetkazish:   "Yetkazish #5"
 */
export function orderDisplayName(o: {
  type?: OrderType | string | null;
  queueNumber?: number | null;
  tableNumber?: number | null;
  checkNo?: number | null;
}): string {
  const t = orderTypeOf(o);
  if (t === OrderType.Takeaway) return `Olib ketish #${o.queueNumber ?? '?'}`;
  if (t === OrderType.Delivery) return `Yetkazish #${o.queueNumber ?? '?'}`;
  // Bitta stolda bir nechta hisob bo'lsa: 1-hisob "Stol 5", keyingilari "Stol 5 · Hisob 2"
  const check = o.checkNo && o.checkNo > 1 ? ` · Hisob ${o.checkNo}` : '';
  return `Stol ${o.tableNumber ?? '?'}${check}`;
}

/** Standart to'lov usullari (sozlamada bo'lmasa). Eski kalitlar (naqd/karta/qr) saqlangan — eski to'lovlar buzilmaydi. */
export const DEFAULT_PAYMENT_METHODS: { key: string; label: string; kind: 'cash' | 'card' | 'online' | 'debt' | 'other'; active: boolean }[] = [
  { key: 'naqd', label: 'Naqd', kind: 'cash', active: true },
  { key: 'karta', label: 'Terminal (karta)', kind: 'card', active: true },
  { key: 'click', label: 'Click', kind: 'online', active: true },
  { key: 'payme', label: 'Payme', kind: 'online', active: true },
  { key: 'qr', label: 'QR', kind: 'online', active: false },
  { key: 'qarz', label: 'Qarzga', kind: 'debt', active: true },
];

/** To'lov usuli nomi (sozlamadagi ro'yxatdan; topilmasa — kalitning o'zi) */
export function paymentMethodLabel(
  methods: { key: string; label: string }[] | null | undefined,
  key: string | null | undefined,
): string {
  if (!key) return '';
  const m = (methods && methods.length ? methods : DEFAULT_PAYMENT_METHODS).find((x) => x.key === key);
  return m?.label ?? DEFAULT_PAYMENT_METHODS.find((x) => x.key === key)?.label ?? key;
}

/**
 * Stolga buyurtma uchun xizmat haqi foizi: zalning alohida foizi bo'lsa — o'sha (masalan Banket zal 10%),
 * aks holda umumiy foiz (serviceDineInPercent). Server, ofitsiant/kassa ekrani va demo bir xil ishlatadi.
 */
export function hallServicePercentFor(
  settings: { serviceDineInPercent?: number | null; hallServicePercent?: Record<string, number> | null } | null | undefined,
  hall: string | null | undefined,
): number {
  const clamp = (v: unknown): number | null => {
    const n = Number(v);
    return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : Math.min(100, Math.max(0, n));
  };
  const own = hall && settings?.hallServicePercent ? clamp(settings.hallServicePercent[hall]) : null;
  return own ?? clamp(settings?.serviceDineInPercent) ?? 0;
}

/**
 * O'zbekiston telefon raqamini normallashtirish -> "+998901234567" (13 belgi).
 * Qabul qilinadi: "90 123 45 67", "901234567", "998901234567", "+998 (90) 123-45-67".
 * Noto'g'ri bo'lsa null. Server, kassa/ofitsiant ekrani va demo bir xil ishlatadi.
 */
export function normalizeUzPhone(input: string | null | undefined): string | null {
  const digits = String(input ?? '').replace(/\D/g, '');
  let local: string;
  if (digits.length === 9) local = digits;
  else if (digits.length === 12 && digits.startsWith('998')) local = digits.slice(3);
  else return null;
  return `+998${local}`;
}

/** "+998901234567" -> "+998 90 123 45 67" (ko'rsatish uchun; noto'g'ri bo'lsa o'zi qaytadi) */
export function formatUzPhone(phone: string | null | undefined): string {
  const n = normalizeUzPhone(phone);
  if (!n) return String(phone ?? '');
  const l = n.slice(4);
  return `+998 ${l.slice(0, 2)} ${l.slice(2, 5)} ${l.slice(5, 7)} ${l.slice(7, 9)}`;
}

/**
 * PATCH /orders/:id/status orqali qo'yish mumkin bo'lgan holatlar.
 * "yopildi" (Closed) bu yerda YO'Q — buyurtma faqat to'liq to'lov orqali yopiladi.
 */
export const SETTABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.Accepted,
  OrderStatus.Cooking,
  OrderStatus.Ready,
];

/**
 * Holatni o'zgartirish mumkinmi?
 * - yopilgan (to'langan) buyurtmaning holati o'zgarmaydi;
 * - yangi holat faqat SETTABLE_ORDER_STATUSES ichidan bo'ladi
 *   (oshxona orqaga qaytarishi — tayyor -> tayyorlanmoqda — ruxsat etiladi).
 */
export function canChangeOrderStatus(from: OrderStatus | string, to: OrderStatus | string): boolean {
  if (from === OrderStatus.Closed) return false;
  return (SETTABLE_ORDER_STATUSES as string[]).includes(to);
}
