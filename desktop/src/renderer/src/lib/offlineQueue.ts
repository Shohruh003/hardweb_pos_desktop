// Offline navbat (TZ F-1.10, NF-3): tarmoq uzilganda buyurtmalar localStorage'da
// saqlanadi va ulanish tiklanganda serverga yuboriladi.
//
// Kafolatlar:
// - har bir buyurtma (localId) bir vaqtda faqat BIR marta yuboriladi (shu oynada ham,
//   boshqa oynada ham — "sendingAt" belgisi);
// - navbatdan faqat muvaffaqiyatli yuborilgandan KEYIN o'chiriladi, va faqat o'sha
//   yozuv o'chiriladi (yuborish paytida qo'shilgan yangi buyurtmalar yo'qolmaydi);
// - bitta buyurtma xatosi qolganlarini to'xtatmaydi;
// - server aniq rad etgan (4xx) buyurtma saqlanib qoladi, lekin avtomatik qayta
//   yuborilmaydi (masalan ertaga stol yangi mijozlar hisobiga tushib qolmasin).
import { api, ApiError, getToken } from './api';

export interface PendingOrder {
  localId: string; // lokal id (vaqt + tasodifiy qism)
  tableId: string;
  tableNumber?: number;
  waiterId?: string;
  // name — faqat ko'rsatish uchun (yuborilmagan buyurtmalar ro'yxatida taom nomi);
  // server uni qabul qilmaydi (ValidationPipe whitelist olib tashlaydi)
  items: { menuItemId: string; quantity: number; note?: string; name?: string }[];
  createdAt: number;
  attempts?: number; // nechta urinish bo'ldi
  lastError?: string; // oxirgi xato matni
  failed?: boolean; // server rad etdi — avtomatik qayta yuborilmaydi
  sendingAt?: number; // yuborish boshlangan vaqt (boshqa oyna bir vaqtda yubormasligi uchun)
}

const KEY = 'pending_orders';
/** "Yuborilmoqda" belgisi shu vaqtdan keyin eskirgan hisoblanadi (so'rov timeoutidan ancha katta) */
const CLAIM_TTL_MS = 45_000;
/** Navbatdagi buyurtmani yuborishda kutish vaqti (oddiy so'rovdan uzunroq — "javob kelmadi" kam bo'lsin) */
const FLUSH_TIMEOUT_MS = 20_000;
/** Server aniq rad etgan holatlar — qayta urinish natijani o'zgartirmaydi */
const REJECTED_STATUSES = new Set([400, 404, 409, 413, 422]);

type Listener = (count: number) => void;
const listeners = new Set<Listener>();

function isPendingOrder(p: unknown): p is PendingOrder {
  const o = p as PendingOrder | null;
  return !!o && typeof o.localId === 'string' && typeof o.tableId === 'string' && Array.isArray(o.items);
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

function newLocalId(now: number): string {
  let rand = '';
  try {
    const b = new Uint8Array(4);
    crypto.getRandomValues(b);
    rand = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  } catch {
    rand = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  }
  return `local-${now}-${rand}`;
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

/** Buyurtmani navbatga qo'shish. Yangi yozuvning localId'sini qaytaradi. */
export function enqueue(order: Omit<PendingOrder, 'localId' | 'createdAt'>): string {
  const createdAt = Date.now();
  const localId = newLocalId(createdAt);
  const { tableId, tableNumber, waiterId, items } = order;
  write([...read(), { localId, tableId, tableNumber, waiterId, items, createdAt }]);
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
      await api.post(
        '/orders',
        { tableId: item.tableId, waiterId: item.waiterId, items: item.items },
        { timeoutMs: FLUSH_TIMEOUT_MS },
      );
      // Muvaffaqiyat — faqat shu yozuv navbatdan o'chiriladi
      updateItem(localId, null);
      sent++;
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      updateItem(localId, {
        sendingAt: undefined,
        attempts: (item.attempts ?? 0) + 1,
        lastError: (e as Error)?.message || 'Xato',
        failed: REJECTED_STATUSES.has(status) || undefined,
      });
      // Sessiya tugadi — qolganlari ham 401 oladi; qayta kirilgach yuboriladi
      if (status === 401) break;
    } finally {
      inFlight.delete(localId);
    }
  }
  return sent;
}
