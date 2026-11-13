import { getServerUrl } from './config';

// Prezentatsiya rejimi: VITE_MOCK=1 bo'lsa serverga emas, soxta ma'lumotlarga yo'naltiriladi.
// Qiymat build vaqtida qo'yiladi: real buildda `false` bo'lib, mock kodi (lib/mock.ts) bundlega
// kirmaydi ham, bajarilmaydi ham (u faqat MOCK bo'lganda dinamik import qilinadi).
export const MOCK = import.meta.env.VITE_MOCK === '1';

/** Token muddati tugadi / foydalanuvchi o'chirildi — AuthProvider shu hodisani tinglaydi */
export const SESSION_EXPIRED_EVENT = 'auth:expired';
export const SESSION_EXPIRED_MESSAGE = 'Sessiya tugadi — qayta kiring';
/** B35: server direktor tokenini tashqi kompyuterdan qabul qilmaydi — login ekranida aynan shu matn */
export const DIRECTOR_LOCAL_ONLY_MESSAGE = 'Direktor faqat kassa (server) kompyuteridan kira oladi';
export const TIMEOUT_MESSAGE = 'Server javob bermadi';
export const NETWORK_MESSAGE = 'Serverga ulanib bo‘lmadi — tarmoqni tekshiring';

/** Odatiy so'rov kutish vaqti */
const DEFAULT_TIMEOUT_MS = 10_000;
/** Server tashqi xizmatga (Telegram) yoki LAN printerga murojaat qiladigan so'rovlar uzoqroq kutiladi */
const SLOW_TIMEOUT_MS = 30_000;
const SLOW_PATHS = [/^\/settings\/telegram-/, /^\/stations\/[^/]+\/test-print$/];

/**
 * Server xatosi — HTTP holat kodi bilan (masalan 400/401/403/429).
 * status = 0 — javob kelmadi (timeout). Tarmoq uzilishi esa TypeError bo'lib qoladi:
 * oflayn navbat (WaiterPage) aynan TypeError'ni "aloqa yo'q" deb taniydi.
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface RequestOptions {
  /** Kutish vaqti (ms). Standart: 10 s (Telegram so'rovlari 30 s) */
  timeoutMs?: number;
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
}

let token: string | null = readStoredToken();

export function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem('token', t);
    else localStorage.removeItem('token');
  } catch {
    /* localStorage yopiq — token faqat xotirada qoladi */
  }
}

export function getToken() {
  return token;
}

/**
 * Server qaytargan nisbiy fayl manzili ('/api/menu/items/<id>/image?v=3') -> to'liq URL
 * (telefon/terminal serverga boshqa hostdan murojaat qiladi). data:/blob:/http(s): manzillar
 * o'zgarmaydi (demo rejimida rasm data URL bo'lib keladi). Bo'sh qiymat -> undefined.
 */
export function assetUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^(data:|blob:|https?:)/i.test(path)) return path;
  return `${getServerUrl()}${path.startsWith('/') ? '' : '/'}${path}`;
}

// Kirish so'rovlarining 401 javobi — "login/PIN noto'g'ri" degani, sessiya tugashi emas
function isLoginPath(path: string): boolean {
  const p = path.split('?')[0];
  return p === '/auth/login' || p === '/auth/login-pin';
}

/** Sessiyani tozalash (token + user) va ilovaga xabar berish — login ekrani ochiladi.
 * reason — login ekranida ko'rsatiladigan sabab (CustomEvent.detail; bo'sh — "Sessiya tugadi") */
function expireSession(reason?: string): void {
  setToken(null);
  try {
    localStorage.removeItem('user');
  } catch {
    /* e'tiborsiz */
  }
  try {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: reason || '' }));
  } catch {
    /* e'tiborsiz */
  }
}

function errorMessage(data: unknown, status: number): string {
  const msg = (data as { message?: unknown } | null)?.message;
  // Validatsiya xatolari massiv bo'lib keladi; bitta maydonning bir nechta sharti bir xil
  // matn qaytarishi mumkin — takrorlarni olib tashlaymiz
  if (Array.isArray(msg) && msg.length) return [...new Set(msg.map(String))].join(', ');
  if (typeof msg === 'string' && msg) return msg;
  return `Xato (${status})`;
}

async function httpRequest<T>(
  method: string,
  path: string,
  body: unknown,
  authToken: string | null,
  opts?: RequestOptions,
): Promise<T> {
  const timeoutMs =
    opts?.timeoutMs ?? (SLOW_PATHS.some((re) => re.test(path)) ? SLOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res: Response;
    let text: string;
    try {
      res = await fetch(`${getServerUrl()}/api${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      // Javob tanasi ham shu vaqt ichida o'qilishi kerak
      text = await res.text();
    } catch {
      if (ctrl.signal.aborted) throw new ApiError(TIMEOUT_MESSAGE, 0);
      // Server/tarmoq mavjud emas — TypeError (oflayn navbat shunga tayanadi)
      throw new TypeError(NETWORK_MESSAGE);
    }

    let data: unknown = undefined;
    let parsed = true;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        parsed = false;
      }
    }

    if (!res.ok) {
      throw new ApiError(parsed ? errorMessage(data, res.status) : `Xato (${res.status})`, res.status);
    }
    // 2xx, lekin JSON emas — odatda noto'g'ri port (masalan 8080 dagi HTML sahifa)
    if (!parsed) throw new ApiError('Server javobi noto‘g‘ri — server manzilini tekshiring', res.status);
    // 204 (bo'sh javob) holatlar uchun undefined qaytadi
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

// Demo (mock) server — faqat MOCK buildda yuklanadi va bajariladi
async function mockCall<T>(method: string, path: string, body: unknown, authToken: string | null): Promise<T> {
  const { mockRequest } = await import('./mock');
  try {
    return await mockRequest<T>(method, path, body, authToken);
  } catch (e) {
    const status = (e as { status?: unknown })?.status;
    throw new ApiError((e as Error)?.message || 'Xato', typeof status === 'number' ? status : 400);
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  const usedToken = token;
  // Shart ataylab try-blokdan TASHQARIDA: Rollup try ichidagi kodni tree-shake qilmaydi
  // (tryCatchDeoptimization). Shu yerda bo'lgani uchun real buildda (MOCK=false) mock
  // tarmog'i va lib/mock.ts bundledan butunlay tushib qoladi.
  const pending = MOCK
    ? mockCall<T>(method, path, body, usedToken)
    : httpRequest<T>(method, path, body, usedToken, opts);
  try {
    return await pending;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && !isLoginPath(path)) {
      // Eski tokenli so'rovning kech kelgan 401 javobi yangi kirgan sessiyani o'chirmasin
      const reason = e.message === DIRECTOR_LOCAL_ONLY_MESSAGE ? e.message : '';
      if (token === usedToken) expireSession(reason);
      throw new ApiError(reason || SESSION_EXPIRED_MESSAGE, 401);
    }
    throw e;
  }
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body, opts),
  del: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
};
