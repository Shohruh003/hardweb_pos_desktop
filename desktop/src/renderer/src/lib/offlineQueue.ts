// Offline navbat (TZ F-1.10, NF-3): tarmoq uzilganda (yoki server javob bermaganda) buyurtmalar
// localStorage'da saqlanadi va ulanish tiklanganda serverga yuboriladi.
//
// Kafolatlar:
// - har bir buyurtma (localId) bir vaqtda faqat BIR marta yuboriladi (shu oynada ham,
//   boshqa oynada ham — "sendingAt" belgisi);
// - navbatdan faqat muvaffaqiyatli yuborilgandan KEYIN o'chiriladi, va faqat o'sha
//   yozuv o'chiriladi (yuborish paytida qo'shilgan yangi buyurtmalar yo'qolmaydi);
// - bitta buyurtma xatosi qolganlarini to'xtatmaydi;
// - server aniq rad etgan (4xx) buyurtma saqlanib qoladi, lekin avtomatik qayta
//   yuborilmaydi (masalan ertaga stol yangi mijozlar hisobiga tushib qolmasin);
// - har yozuvda o'zgarmas clientRequestId bor (B32): server shu id bilan kelgan so'rovni 24 soat
//   eslab qoladi va takroriy so'rovga O'SHA buyurtmani qaytaradi (yangi taom, yangi raqam, yangi
//   oshxona cheki yo'q). Shuning uchun server JAVOB BERMAGAN (timeout) yozuv ham avtomatik qayta
//   yuboriladi — ikki marta tushmaydi. Eski (id'siz, 0.2.x / 0.3 wave-1) yozuvlar esa timeout'da
//   avvalgidek "tekshiring" holatida qoladi.
//
// Buyurtma turlari (0.3.0): stol (tableId bilan; mavjud hisobga — orderId, yangi hisob — checkNo),
// olib ketish va yetkazish (stolsiz). Mavjud olib ketish/yetkazish buyurtmasiga qo'shimcha — orderId
// bilan. Eski (0.2.x) yozuvlarda tur yo'q — ular stol buyurtmasi hisoblanadi.
import { ORDER_TYPE_LABELS, OrderType, orderTypeOf } from '@hardweb-pos/shared';
import { api, ApiError, getToken } from './api';

export interface PendingOrderItem {
  menuItemId: string;
  quantity: number;
  note?: string;
  takeaway?: boolean; // stolda: saboy (olib ketiladi) — xizmat haqi olinmaydi
  price?: number; // kassir o'zgartirgan narx (server faqat ruxsati borga qabul qiladi)
  // name / unit — faqat ko'rsatish uchun (yuborilmagan buyurtmalar ro'yxatida taom nomi);
  // server ularni qabul qilmaydi — yuborishda olib tashlanadi
  name?: string;
  unit?: string;
}

export interface PendingOrder {
  localId: string; // lokal id (vaqt + tasodifiy qism)
  clientRequestId?: string; // B32: takroriy yuborishda server o'sha buyurtmani qaytaradi
  type?: OrderType; // buyurtma turi (yo'q bo'lsa — stol; 0.2.x yozuvlari)
  tableId?: string | null; // stol buyurtmasi uchun
  tableNumber?: number;
  checkNo?: number; // stol: qaysi hisob (shu raqamli ochiq hisob bo'lsa — unga, bo'lmasa shu raqam bilan yangi)
  newCheck?: boolean; // stol: keyingi bo'sh raqamli yangi hisob
  orderId?: string; // mavjud buyurtmaga (hisobga) qo'shimcha
  queueNumber?: number | null; // qo'shimcha bo'lsa — o'sha buyurtma raqami (#12), faqat ko'rsatish uchun
  phone?: string; // yetkazish: telefon
  address?: string; // yetkazish: manzil
  deliveryFee?: number; // yetkazish narxi
  note?: string; // buyurtma izohi (faqat yangi buyurtma)
  waiterId?: string;
  items: PendingOrderItem[];
  createdAt: number;
  attempts?: number; // nechta urinish bo'ldi
  lastError?: string; // oxirgi xato matni
  failed?: boolean; // server rad etdi (yoki eski yozuv javobsiz qoldi) — avtomatik qayta yuborilmaydi
  sendingAt?: number; // yuborish boshlangan vaqt (boshqa oyna bir vaqtda yubormasligi uchun)
}

const KEY = 'pending_orders';
/** "Yuborilmoqda" belgisi shu vaqtdan keyin eskirgan hisoblanadi (so'rov timeoutidan ancha katta) */
const CLAIM_TTL_MS = 45_000;
/** Navbatdagi buyurtmani yuborishda kutish vaqti (oddiy so'rovdan uzunroq — "javob kelmadi" kam bo'lsin) */
const FLUSH_TIMEOUT_MS = 20_000;
/** Server aniq rad etgan holatlar — qayta urinish natijani o'zgartirmaydi */
const REJECTED_STATUSES = new Set([400, 403, 404, 409, 413, 422]);
/** Eski (clientRequestId'siz) yozuv javobsiz qoldi — serverga yetgan bo'lishi mumkin (avtomatik qayta yuborilmaydi) */
export const TIMEOUT_HINT =
  'Server javob bermadi — buyurtma yetib borgan bo‘lishi mumkin. Ro‘yxatda tekshiring: bo‘lmasa «Qayta yuborish», bo‘lsa «O‘chirish».';
/** Yangi yozuv javobsiz qoldi — xavfsiz: keyingi urinishda avtomatik qayta yuboriladi (ikki marta tushmaydi) */
export const RETRY_HINT = 'Server javob bermadi — avtomatik qayta yuboriladi (ikki marta tushmaydi)';

type Listener = (count: number) => void;
const listeners = new Set<Listener>();

function isPendingOrder(p: unknown): p is PendingOrder {
  const o = p as PendingOrder | null;
  if (!o || typeof o.localId !== 'string' || !Array.isArray(o.items)) return false;
  const type = orderTypeOf(o);
  // Stol buyurtmasi stolsiz bo'lmaydi; olib ketish/yetkazish — stolsiz
  return type === OrderType.DineIn ? typeof o.tableId === 'string' && !!o.tableId : true;
}

function read(): PendingOrder[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter(isPendingOrder) : [];
  } catch {
    return [];
  }
}

function write(list: PendingOrder[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* localStorage to'la/yopiq — o'zgarish saqlanmadi */
  }
  listeners.forEach((l) => l(list.length));
}

/** Bitta yozuvni joriy (yangi o'qilgan) ro'yxatda yangilash yoki o'chirish (patch = null) */
function updateItem(localId: string, patch: Partial<PendingOrder> | null) {
  const list = read();
  if (!list.some((p) => p.localId === localId)) return;
  write(
    patch === null
      ? list.filter((p) => p.localId !== localId)
      : list.map((p) => (p.localId === localId ? { ...p, ...patch } : p)),
  );
}

function randomHex(bytes: number): string {
  try {
    const b = new Uint8Array(bytes);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  } catch {
    let s = '';
    for (let i = 0; i < bytes; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    return s;
  }
}

function newLocalId(now: number): string {
  return `local-${now}-${randomHex(4)}`;
}

/**
 * Yangi so'rov identifikatori (B32, ≤ 64 belgi): "Tasdiqlash" bosilganda yoki taom navbatga
 * olinganda bir marta yaratiladi va shu so'rov qayta yuborilganda o'zgarmaydi.
 */
export function newClientRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* eski brauzer — pastdagi zaxira */
  }
  const h = randomHex(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function pendingCount(): number {
  return read().length;
}

/** Navbatdagi barcha buyurtmalar (holati bilan) — ro'yxat/diagnostika uchun */
export function getPendingOrders(): PendingOrder[] {
  return read();
}

/** Avtomatik yuboriladigan (rad etilmagan) buyurtma bormi */
export function hasRetryablePending(): boolean {
  return read().some((p) => !p.failed);
}

/** Navbatdagi buyurtma turi (eski yozuvlarda — stol) */
export function pendingType(p: Pick<PendingOrder, 'type'>): OrderType {
  return orderTypeOf(p);
}

/**
 * Navbatdagi buyurtmaning nomi (ro'yxat va tasdiqlash oynalari uchun):
 *  "Stol 5" · "Stol 5 · Hisob 2" · "Olib ketish — yangi buyurtma" · "Olib ketish #12 — qo‘shimcha"
 */
export function pendingTitle(p: PendingOrder): string {
  const type = pendingType(p);
  if (type === OrderType.DineIn) {
    const check = p.checkNo && p.checkNo > 1 ? ` · Hisob ${p.checkNo}` : p.newCheck ? ' · yangi hisob' : '';
    return `Stol ${p.tableNumber ?? '—'}${check}`;
  }
  const label = ORDER_TYPE_LABELS[type];
  if (p.orderId) return p.queueNumber != null ? `${label} #${p.queueNumber} — qo‘shimcha` : `${label} — qo‘shimcha`;
  return `${label} — yangi buyurtma`;
}

let storageHooked = false;
export function onPendingChange(l: Listener): () => void {
  listeners.add(l);
  // Boshqa oyna (masalan telefonda ikkinchi tab) navbatni o'zgartirsa ham son yangilanadi
  if (!storageHooked) {
    storageHooked = true;
    try {
      window.addEventListener('storage', (e) => {
        if (e.key === KEY || e.key === null) {
          const n = read().length;
          listeners.forEach((fn) => fn(n));
        }
      });
    } catch {
      /* window yo'q */
    }
  }
  l(read().length);
  return () => listeners.delete(l);
}

/**
 * Buyurtmani navbatga qo'shish. Yangi yozuvning localId'sini qaytaradi.
 * clientRequestId berilmasa — yangisi yaratiladi (online yuborish uzilgan bo'lsa O'SHA id beriladi:
 * server so'rovni qabul qilib ulgurgan bo'lsa ham takror yuborish ikkinchi buyurtma yaratmaydi).
 */
export function enqueue(order: Omit<PendingOrder, 'localId' | 'createdAt'>): string {
  const createdAt = Date.now();
  const localId = newLocalId(createdAt);
  const { type, tableId, tableNumber, checkNo, newCheck, orderId, queueNumber, phone, address, deliveryFee, note, waiterId, items } =
    order;
  const entry: PendingOrder = {
    localId,
    clientRequestId: order.clientRequestId || newClientRequestId(),
    type: orderTypeOf({ type }),
    waiterId,
    items,
    createdAt,
  };
  // Faqat kerakli maydonlar saqlanadi (undefined maydonlar JSON'ga yozilmaydi)
  if (tableId) entry.tableId = tableId;
  if (tableNumber != null) entry.tableNumber = tableNumber;
  if (orderId) entry.orderId = orderId;
  // Hisob raqami: yangi hisob uchun — so'rovga ketadi; mavjud hisobga (orderId) — faqat ro'yxatda ko'rsatish uchun
  if (checkNo != null && checkNo > 0) entry.checkNo = checkNo;
  else if (newCheck && !orderId) entry.newCheck = true;
  if (queueNumber != null) entry.queueNumber = queueNumber;
  if (phone) entry.phone = phone;
  if (address) entry.address = address;
  if (deliveryFee != null && deliveryFee >= 0) entry.deliveryFee = deliveryFee;
  if (note) entry.note = note;
  write([...read(), entry]);
  return localId;
}

/** Navbatdan qo'lda o'chirish (masalan server rad etgan buyurtma) */
export function discardPendingOrder(localId: string): void {
  updateItem(localId, null);
}

/** Rad etilgan buyurtmani qayta yuborishga ruxsat berish (keyingi flushPending yuboradi) */
export function retryPendingOrder(localId: string): void {
  updateItem(localId, { failed: false, lastError: undefined, sendingAt: undefined });
}

/** Navbatdagi yozuv -> POST /orders tanasi (shartnoma B2 / B18 / B32) */
function requestBody(item: PendingOrder): Record<string, unknown> {
  const type = pendingType(item);
  const items = item.items.map(({ menuItemId, quantity, note, takeaway, price }) => {
    const line: Record<string, unknown> = { menuItemId, quantity };
    if (note) line.note = note;
    if (type === OrderType.DineIn && takeaway) line.takeaway = true;
    if (typeof price === 'number' && Number.isFinite(price)) line.price = price;
    return line;
  });
  const body: Record<string, unknown> = { type, items };
  if (item.clientRequestId) body.clientRequestId = item.clientRequestId;
  if (item.waiterId) body.waiterId = item.waiterId;
  if (type === OrderType.DineIn) {
    body.tableId = item.tableId;
    // Hisob: aniq hisobga (orderId) yoki shu raqamli hisobga / yangi hisobga; hech biri bo'lmasa —
    // server stolning eng kichik raqamli ochiq hisobiga qo'shadi (eski yozuvlar uchun ham ishlaydi)
    if (item.orderId) body.orderId = item.orderId;
    else if (item.checkNo) body.checkNo = item.checkNo;
    else if (item.newCheck) body.newCheck = true;
    if (!item.orderId && item.note) body.note = item.note;
  } else if (item.orderId) {
    // Mavjud olib ketish/yetkazish buyurtmasiga qo'shimcha
    body.orderId = item.orderId;
  } else {
    // Yangi olib ketish/yetkazish buyurtmasi
    if (item.phone) body.phone = item.phone;
    if (type === OrderType.Delivery && item.address) body.address = item.address;
    if (type === OrderType.Delivery && item.deliveryFee != null) body.deliveryFee = item.deliveryFee;
    if (item.note) body.note = item.note;
  }
  return body;
}

// Shu oynada yuborilayotgan yozuvlar (bir xil localId ikki marta yuborilmasin)
const inFlight = new Set<string>();
let flushing: Promise<number> | null = null;

/**
 * Navbatdagi buyurtmalarni serverga yuborish. Bir vaqtda faqat bitta yuborish jarayoni
 * ishlaydi (parallel chaqiruvlar o'sha jarayon natijasini oladi). Yuborilganlar sonini qaytaradi.
 */
export function flushPending(): Promise<number> {
  if (!flushing) {
    flushing = doFlush().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

async function doFlush(): Promise<number> {
  // Tizimga kirilmagan — so'rov 401 bo'lardi; keyingi kirishdan keyin yuboriladi
  if (!getToken()) return 0;
  let sent = 0;
  for (const { localId } of read()) {
    if (inFlight.has(localId)) continue;
    // Har safar joriy holatni o'qiymiz: boshqa oyna yuborgan/o'chirgan bo'lishi mumkin
    const item = read().find((p) => p.localId === localId);
    if (!item || item.failed) continue;
    if (item.sendingAt && Date.now() - item.sendingAt < CLAIM_TTL_MS) continue;

    inFlight.add(localId);
    updateItem(localId, { sendingAt: Date.now() });
    try {
      await api.post('/orders', requestBody(item), { timeoutMs: FLUSH_TIMEOUT_MS });
      // Muvaffaqiyat — faqat shu yozuv navbatdan o'chiriladi
      updateItem(localId, null);
      sent++;
    } catch (e) {
      const status = e instanceof ApiError ? e.status : -1;
      // status 0 — javob kelmadi (timeout). clientRequestId bor bo'lsa — qayta yuborish xavfsiz
      // (server takrorni taniydi); eski yozuvda — buyurtma serverda bo'lishi mumkin, qo'lda tekshiriladi
      const timedOut = e instanceof ApiError && e.status === 0;
      const safeRetry = timedOut && !!item.clientRequestId;
      updateItem(localId, {
        sendingAt: undefined,
        attempts: (item.attempts ?? 0) + 1,
        lastError: timedOut ? (safeRetry ? RETRY_HINT : TIMEOUT_HINT) : (e as Error)?.message || 'Xato',
        failed: (timedOut && !safeRetry) || REJECTED_STATUSES.has(status) || undefined,
      });
      // Sessiya tugadi — qolganlari ham 401 oladi; qayta kirilgach yuboriladi
      if (status === 401) break;
    } finally {
      inFlight.delete(localId);
    }
  }
  return sent;
}
