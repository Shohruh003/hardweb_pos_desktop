// Buyurtma turlari (stol / olib ketish / yetkazish) bo'yicha umumiy qoidalar va xabarlar.
// Xabarlar demo (mock) bilan aynan bir xil bo'lishi shart — renderer ularni to'g'ridan-to'g'ri ko'rsatadi.
import {
  DEFAULT_PAYMENT_METHODS,
  MenuUnit,
  ORDER_TYPES,
  OrderTotals,
  OrderType,
  PaymentMethod,
  PaymentMethodKind,
  UserRole,
  calcOrderTotals,
  hasCapability,
  isOrderManager,
  normalizeUzPhone,
  orderTypeOf,
} from '@hardweb-pos/shared';

export const NO_ITEMS_MESSAGE = 'Buyurtmada taom yo‘q';
export const TABLE_REQUIRED_MESSAGE = 'Stol tanlanmagan';
export const TABLE_NOT_FOUND_MESSAGE = 'Stol topilmadi';
export const ORDER_NOT_FOUND_MESSAGE = 'Buyurtma topilmadi';
export const ORDER_CLOSED_MESSAGE = 'Buyurtma yopilgan';
export const ORDER_OTHER_TABLE_MESSAGE = 'Buyurtma boshqa stolga tegishli';
export const PHONE_INVALID_MESSAGE = 'Telefon raqami noto‘g‘ri (masalan: 90 123 45 67)';
export const ADDRESS_REQUIRED_MESSAGE = 'Yetkazish manzili kiritilmagan';
export const ADDRESS_TOO_LONG_MESSAGE = 'Manzil juda uzun (300 belgigacha)';
export const NOT_DELIVERY_MESSAGE = 'Bu buyurtma yetkazish emas';
export const NOT_TABLE_ORDER_MESSAGE = 'Bu buyurtma stolga bog‘lanmagan';
export const ORDER_TYPE_INVALID_MESSAGE = 'Noto‘g‘ri buyurtma turi';

// ---- Hisoblar (bitta stolda bir nechta hisob) va bo'lish (B18) ----
export const CHECK_NO_INVALID_MESSAGE = 'Hisob raqami noto‘g‘ri (1 dan 20 gacha)';
export const SPLIT_ONLY_TABLE_MESSAGE = 'Faqat stol hisobini bo‘lish mumkin';
export const ITEM_LINE_NOT_FOUND_MESSAGE = 'Taom qatori topilmadi';
export const SPLIT_QTY_INVALID_MESSAGE = 'Ko‘chiriladigan miqdor noto‘g‘ri';
export const SPLIT_KEEP_ONE_MESSAGE = 'Hisobda kamida bitta taom qolishi kerak';
export const SPLIT_NOTHING_MESSAGE = 'Ko‘chiriladigan taomni tanlang';
export const SPLIT_SAME_CHECK_MESSAGE = 'Taomni shu hisobning o‘ziga ko‘chirib bo‘lmaydi';
export const CHECK_OTHER_TABLE_MESSAGE = 'Hisob boshqa stolga tegishli';
/** To'lovi bor hisob summasi to'langan summadan pastga tushmasin (bo'lish, otkaz, tur/narx o'zgarishi) */
export const BELOW_PAID_MESSAGE = 'Qolgan summa to‘langan summadan kam bo‘lib qoladi';
/** To'lovi bor hisobni bekor qilib (bo'shatib) bo'lmaydi — aks holda olingan pul hisobotdan yo'qoladi */
export const HAS_PAYMENTS_MESSAGE = 'Bu hisobda to‘lov bor — avval to‘lovlarni o‘chiring';

// ---- Otkaz (B19) ----
export const VOID_FORBIDDEN_MESSAGE =
  'Otkaz qilish uchun ruxsat yo‘q — kassir yoki direktorga murojaat qiling';
export const VOID_QTY_INVALID_MESSAGE = 'Otkaz miqdori noto‘g‘ri';
export const VOID_REASON_TOO_LONG_MESSAGE = 'Sabab juda uzun (200 belgigacha)';
export const VOID_REASON_MAX_LENGTH = 200;

// ---- Buyurtma amallari (B22, B23) ----
export const TYPE_UNCHANGED_MESSAGE = 'Buyurtma turi o‘zgarmadi';
export const WAITER_CHANGE_FORBIDDEN_MESSAGE = 'Ofitsiantni faqat kassir yoki direktor almashtira oladi';
export const ORDER_NOT_CLOSED_MESSAGE = 'Buyurtma hali yopilmagan';

// ---- Narx (B31) ----
export const PRICE_FORBIDDEN_MESSAGE = 'Narxni faqat kassir yoki direktor o‘zgartira oladi';
export const PRICE_INVALID_MESSAGE = 'Narx noto‘g‘ri (0 dan 100 000 000 gacha)';
export const PRICE_MAX = 100_000_000;

// ---- To'lov (B30) ----
export const PAYMENT_TYPE_INVALID_MESSAGE = 'To‘lov turi noto‘g‘ri';
export const PAYMENT_AMOUNT_INVALID_MESSAGE = 'To‘lov summasi noto‘g‘ri';
export const PAYMENT_EXCEEDS_MESSAGE = 'To‘lov summasi qoldiqdan katta';
export const DEBTOR_REQUIRED_MESSAGE = 'Qarzga yozish uchun mijoz ismini kiriting';
export const ORDER_ALREADY_CLOSED_MESSAGE = 'Hisob allaqachon yopilgan';

// ---- Yetkazish narxi (B28) ----
export const DELIVERY_FEE_INVALID_MESSAGE = 'Yetkazish narxi noto‘g‘ri (0 dan 1 000 000 gacha)';
export const DELIVERY_FEE_MAX = 1_000_000;

// ---- So'rov tekshiruvi (DTO) xabarlari ----
export const ITEM_QTY_INVALID_MESSAGE = 'Taom miqdori noto‘g‘ri (dona — butun son, kg — 6 xonagacha)';
export const MENU_ITEM_INVALID_MESSAGE = 'Taom tanlanmagan';
export const DISCOUNT_PERCENT_MESSAGE = 'Chegirma foizi 0 dan 100 gacha bo‘lishi kerak';
export const SERVICE_PERCENT_MESSAGE = 'Xizmat haqi foizi 0 dan 100 gacha bo‘lishi kerak';

/** Stop list (B29): menyuda tugagan taom buyurtmaga qo'shilmaydi */
export const stopListMessage = (name: string) => `«${name}» tugagan (stop list)`;
/** Miqdor noto'g'ri (dona — butun son; kg — 6 xonagacha) */
export const quantityInvalidMessage = (name: string) => `«${name}» miqdori noto‘g‘ri`;

/** Yetkazish manzilining eng katta uzunligi (belgilarda) */
export const ADDRESS_MAX_LENGTH = 300;

/** Stolda so'rov bilan tanlanadigan hisob raqamining yuqori chegarasi */
export const MAX_CHECK_NO = 20;

/** Miqdorning kasr xonalari chegarasi (kg) — dona har doim butun */
export const QTY_DECIMALS = 6;

/**
 * O'zbekiston telefon raqami -> "+998901234567" yoki null.
 * Avval faqat raqamlar qoldiriladi, keyin shared normalizeUzPhone qo'llanadi: shunda "+998 (90) 123-45-67"
 * kabi ajratgichli kiritish ham to'g'ri o'qiladi (shared'dagi ajratgich tozalashga bog'liq bo'lmaydi).
 */
export function normalizePhone(input: unknown): string | null {
  if (input == null) return null;
  return normalizeUzPhone(String(input).replace(/\D/g, ''));
}

/** So'rov parametri -> buyurtma turi; bo'sh yoki noma'lum qiymat -> undefined (filtr yo'q) */
export function parseOrderType(value: unknown): OrderType | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return (ORDER_TYPES as string[]).includes(String(v ?? '')) ? (v as OrderType) : undefined;
}

/** Mahalliy ish kuni kaliti 'YYYY-MM-DD' (server vaqti = restoran vaqti) — kunlik raqamlash uchun */
export function businessDateOf(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Stoldagi hisob raqami: eski (raqamsiz) ochiq buyurtma — 1-hisob */
export function checkNoOf(o: { checkNo?: number | null }): number {
  const n = Number(o.checkNo);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Stoldagi keyingi bo'sh hisob raqami: ochiq hisoblar ichidagi eng katta raqam + 1 (hisob yo'q — 1) */
export function nextFreeCheckNo(openChecks: { checkNo?: number | null }[]): number {
  return openChecks.reduce((max, o) => Math.max(max, checkNoOf(o)), 0) + 1;
}

/** Otkaz / narx o'zgartirish sababi: chetidagi bo'shliqlarsiz, 200 belgigacha; bo'sh — null */
export function cleanReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s ? s.slice(0, VOID_REASON_MAX_LENGTH) : null;
}

// ---- Ruxsatlar (rol emas — ruxsat; Direktor/SuperAdmin hammasiga ega) ----

/** So'rov egasi (req.user): { id, role, name, permissions } */
export interface Actor {
  id?: string | null;
  role?: string | null;
  name?: string | null;
  permissions?: string[] | null;
}

const ADMIN_ROLES: string[] = [UserRole.Admin, UserRole.Director, UserRole.SuperAdmin];

/** Administrator / direktor / superadmin */
export function isAdminRole(actor: Actor | null | undefined): boolean {
  return !!actor?.role && ADMIN_ROLES.includes(actor.role);
}

/** Ruxsat bormi (Direktor/SuperAdmin — doim) */
export function can(actor: Actor | null | undefined, capability: string): boolean {
  if (!actor?.role) return false;
  return hasCapability({ role: actor.role, permissions: actor.permissions ?? [] }, capability);
}

/** Buyurtma bilan ishlash (yetkazish ma'lumoti va h.k.): ofitsiant yoki kassir. Kassa amallari — canManageOrders */
export function canOperateOrders(actor: Actor | null | undefined): boolean {
  return can(actor, 'waiter') || can(actor, 'cashier');
}

/** Otkaz (yuborilgan taomni / hisobni bekor qilish) — faqat 'void' ruxsati (kassir, administrator, direktor) */
export function canVoid(actor: Actor | null | undefined): boolean {
  return can(actor, 'void');
}

/** Narxni qo'lda o'zgartirish: kassir yoki 'void' ruxsati bor xodim (administrator, direktor) */
export function canOverridePrice(actor: Actor | null | undefined): boolean {
  return can(actor, 'cashier') || can(actor, 'void');
}

/** Ofitsiantni almashtirish: kassir yoki administrator / direktor */
export function canChangeWaiter(actor: Actor | null | undefined): boolean {
  return can(actor, 'cashier') || isAdminRole(actor);
}

// ---- Kassa amallari — faqat kassir / administrator / direktor (restoran talabi, 0.3.1 / 0.3.3) ----
// Ofitsiant faqat o'z stoliga taom qo'shadi: schot chiqara olmaydi, stolni ko'chira olmaydi, buyurtma
// turini o'zgartira olmaydi va hisobni bo'la olmaydi (shared isOrderManager — UI bilan bir xil qoida).
// Xabarlar shared'da (demo va UI bilan bir xil matn).
export {
  BILL_FORBIDDEN_MESSAGE,
  CHANGE_TYPE_FORBIDDEN_MESSAGE,
  MOVE_TABLE_FORBIDDEN_MESSAGE,
  SPLIT_FORBIDDEN_MESSAGE,
} from '@hardweb-pos/shared';

/** Kassa darajasidagi amallar (stol ko'chirish, tur, bo'lish, schot): kassir / administrator / direktor */
export function canManageOrders(actor: Actor | null | undefined): boolean {
  return isOrderManager(actor);
}

export function canPrintBill(actor: Actor | null | undefined): boolean {
  return canManageOrders(actor);
}

/** Cheklar tarixini to'liq ko'rish: 'history' ruxsati yoki administrator / direktor */
export function canViewAllHistory(actor: Actor | null | undefined): boolean {
  return can(actor, 'history') || isAdminRole(actor);
}

/**
 * Mahalliy sana chegarasi ('YYYY-MM-DD' yoki 'YYYY-MM-DDTHH:MM[:SS]') -> bazadagi UTC ko'rinish
 * 'YYYY-MM-DD HH:MM:SS' (SQLite datetime() bilan solishtirish uchun). end=true — chegara KIRADI:
 * kunning oxiri 23:59:59, daqiqa berilsa — shu daqiqaning 59-soniyasi. Noto'g'ri qiymat — null.
 */
export function localBoundToUtc(value: string | undefined | null, end: boolean): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(value).trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hasTime = m[4] !== undefined;
  const h = hasTime ? Number(m[4]) : end ? 23 : 0;
  const mi = hasTime ? Number(m[5]) : end ? 59 : 0;
  const s = m[6] !== undefined ? Number(m[6]) : end ? 59 : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, s, 0);
  // 31-fevral kabi sanalar keyingi oyga "o'tib ketadi" — rad etamiz
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** Miqdorni 6 xonagacha yaxlitlash (ayirishdagi 0.19999999999999998 kabi qoldiqlar saqlanmasin) */
export function roundQty(value: number | string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** QTY_DECIMALS) / 10 ** QTY_DECIMALS;
}

/** Sonning kasr xonalari soni (JSON'dagi yozuvi bo'yicha: 1.5 -> 1, 1e-7 -> 7) */
export function decimalPlaces(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const s = String(n);
  const exp = /e-(\d+)$/i.exec(s);
  if (exp) {
    const mantissa = s.slice(0, exp.index);
    const frac = mantissa.includes('.') ? mantissa.split('.')[1].length : 0;
    return frac + Number(exp[1]);
  }
  return s.includes('.') ? s.split('.')[1].length : 0;
}

/** Dona/porsiya taomlarda kasr miqdor xonalari (0,5 / 1,25 / 0,333) — restoran talabi, 0.3.2 */
export const PIECE_QTY_DECIMALS = 3;

/**
 * Miqdor shu o'lchov birligi uchun to'g'rimi: musbat; dona — 3 xonagacha kasr (yarim porsiya: 0,5);
 * kg — 6 xonagacha kasr. (Taom qo'shish, hisobni bo'lish va otkazda bir xil qoida.)
 */
export function isValidQuantity(value: unknown, unit: MenuUnit | string | null | undefined): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false;
  if (unit === MenuUnit.Weight) return decimalPlaces(value) <= QTY_DECIMALS;
  return decimalPlaces(value) <= PIECE_QTY_DECIMALS;
}

/** Pul hisobiga kerakli qator maydonlari (narx, miqdor, saboy belgisi) */
export interface MoneyItem {
  price: number | string;
  quantity: number | string;
  takeaway?: boolean | null;
}

/**
 * Buyurtma summalari — YAGONA qoida: qatorlar (saboy belgisi bilan — saboy qatorlariga xizmat haqi
 * olinmaydi), saqlangan chegirma/xizmat foizi va yetkazish narxi (FAQAT yetkazish buyurtmasida).
 * Server bo'ylab (DTO, to'lov, chek, tarix, bo'lish/otkaz/tur o'zgarishi tekshiruvlari) shu funksiya
 * ishlatiladi. items berilsa — buyurtmaning o'z qatorlari o'rniga (masalan otkazdan keyin qoladiganlar).
 */
export function orderTotalsOf(
  o: {
    type?: OrderType | string | null;
    items?: MoneyItem[] | null;
    discountPercent?: number | string | null;
    servicePercent?: number | string | null;
    deliveryFee?: number | string | null;
  },
  items: MoneyItem[] | null | undefined = o.items,
): OrderTotals {
  const fee = orderTypeOf(o) === OrderType.Delivery ? o.deliveryFee : 0;
  return calcOrderTotals(
    (items || []).map((it) => ({ price: it.price, quantity: it.quantity, takeaway: !!it.takeaway })),
    o.discountPercent,
    o.servicePercent,
    fee,
  );
}

/**
 * Xuddi shu summa SQL ifodasi (tarix filtri minTotal/maxTotal va jami summa uchun) — orderTotalsOf
 * bilan aynan bir xil: har qator ROUND(narx × miqdor), chegirma subtotal'dan, xizmat haqi saboy
 * qatorlarisiz bazadan, yetkazish narxi faqat yetkazishda. SQLite ROUND(x) musbat sonlarda
 * Math.round bilan bir xil (trunc(x + 0.5)). 'o' — orders jadvali taxallusi.
 */
const SQL_LINE = 'ROUND(hl.price * hl.quantity)';
export const PAYABLE_TOTAL_SQL =
  `(SELECT COALESCE(SUM(${SQL_LINE}), 0)` +
  ` - ROUND(COALESCE(SUM(${SQL_LINE}), 0) * COALESCE(o.discount_percent, 0) / 100.0)` +
  ` + ROUND(COALESCE(SUM(CASE WHEN hl.takeaway = 1 THEN 0 ELSE ${SQL_LINE} END), 0) * COALESCE(o.service_percent, 0) / 100.0)` +
  ` + (CASE WHEN o.order_type = '${OrderType.Delivery}' THEN MAX(0, COALESCE(o.delivery_fee, 0)) ELSE 0 END)` +
  ` FROM order_items hl WHERE hl.order_id = o.id)`;

// ---- To'lov usullari (B30) ----

const PAYMENT_KINDS: PaymentMethodKind[] = ['cash', 'card', 'online', 'debt', 'other'];
/** To'lov usuli kaliti: kichik lotin harflari, raqamlar, _ va - (payments.type ga yoziladi) */
export const PAYMENT_KEY_RE = /^[a-z0-9_-]{1,32}$/;
export const PAYMENT_LABEL_MAX = 40;

/** Standart to'lov usullari (yangi nusxa — o'zgartirilsa shared ro'yxat buzilmasin) */
export function defaultPaymentMethods(): PaymentMethod[] {
  return DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m }));
}

/**
 * Sozlamadagi to'lov usullari -> toza ro'yxat. Bo'sh/noto'g'ri qiymat -> standart ro'yxat.
 * (Saqlashdan oldingi qat'iy tekshiruv — validatePaymentMethods.)
 */
export function normalizePaymentMethods(list: unknown): PaymentMethod[] {
  if (!Array.isArray(list) || list.length === 0) return defaultPaymentMethods();
  const out: PaymentMethod[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<PaymentMethod>;
    const key = typeof r.key === 'string' ? r.key.trim() : '';
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    if (!PAYMENT_KEY_RE.test(key) || !label || out.some((m) => m.key === key)) continue;
    const kind = PAYMENT_KINDS.includes(r.kind as PaymentMethodKind) ? (r.kind as PaymentMethodKind) : 'other';
    out.push({ key, label: label.slice(0, PAYMENT_LABEL_MAX), kind, active: r.active !== false });
  }
  return out.length ? out : defaultPaymentMethods();
}

/**
 * Direktor yuborgan to'lov usullari ro'yxatini tekshiradi. Xato bo'lsa — o'zbekcha xabar (aks holda null).
 * Qoidalar: kalitlar takrorlanmaydi va [a-z0-9_-]; nomlar bo'sh emas; kamida bitta FAOL naqd usul.
 */
export function validatePaymentMethods(list: unknown): string | null {
  if (!Array.isArray(list) || list.length === 0) return 'To‘lov turlari ro‘yxati noto‘g‘ri';
  if (list.length > 30) return 'To‘lov turlari juda ko‘p (30 tagacha)';
  const keys = new Set<string>();
  let activeCash = false;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') return 'To‘lov turlari ro‘yxati noto‘g‘ri';
    const r = raw as Partial<PaymentMethod>;
    const key = typeof r.key === 'string' ? r.key.trim() : '';
    if (!PAYMENT_KEY_RE.test(key)) {
      return `To‘lov turi kaliti noto‘g‘ri: «${key || '—'}» (faqat a-z, 0-9, _ va -)`;
    }
    if (keys.has(key)) return `To‘lov turi kaliti takrorlangan: «${key}»`;
    keys.add(key);
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    if (!label) return 'To‘lov turi nomi kiritilmagan';
    if (label.length > PAYMENT_LABEL_MAX) return `To‘lov turi nomi juda uzun (${PAYMENT_LABEL_MAX} belgigacha)`;
    if (!PAYMENT_KINDS.includes(r.kind as PaymentMethodKind)) return 'To‘lov turi toifasi noto‘g‘ri';
    if (r.active !== undefined && typeof r.active !== 'boolean') return 'To‘lov turlari ro‘yxati noto‘g‘ri';
    if (r.kind === 'cash' && r.active !== false) activeCash = true;
  }
  if (!activeCash) return 'Kamida bitta faol naqd to‘lov turi bo‘lishi kerak';
  return null;
}
