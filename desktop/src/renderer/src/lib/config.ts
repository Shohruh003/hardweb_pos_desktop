// Server (kassa kompyuteri) manzili.
// - Kassa (Server o'rnatilgan) kompyuterda: standart http://127.0.0.1:3100 (ichki server).
// - Terminal/monoblokda: kassa IP'si kiritiladi (masalan http://192.168.1.10:3100) — localStorage'da saqlanadi.
// - Telefon brauzerida (http://<kassa-IP>:8080): manzil sahifa hostidan olinadi (http://<kassa-IP>:3100).
// Manzil saqlangach oyna qayta yuklanadi — REST ham, socket ham yangi manzil bilan qaytadan ulanadi.

/** Ichki server porti (Server o'rnatuvchisi shu portda API + socket ochadi) */
export const SERVER_PORT = 3100;
const DEFAULT_SERVER = `http://127.0.0.1:${SERVER_PORT}`;
const STORAGE_KEY = 'server_url';
/** Telefon sahifasi porti — server manzili sifatida kiritilsa xato (API 3100 da) */
const WEB_PORT = '8080';

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Kiritilgan manzilni bir xil ko'rinishga keltirish:
 *  "192.168.1.10"              -> "http://192.168.1.10:3100"
 *  "192.168.1.10:3100/"        -> "http://192.168.1.10:3100"
 *  "http://192.168.1.10/api/"  -> "http://192.168.1.10:3100"
 * Bo'sh qiymat -> "" (saqlangan manzil o'chiriladi, avtomatik manzil ishlatiladi).
 */
export function normalizeServerUrl(input: string | null | undefined): string {
  let s = (input ?? '').trim();
  if (!s) return '';
  // ws:// / wss:// yozilgan bo'lsa — http(s) ga almashtiramiz; sxema yo'q bo'lsa — http://
  s = s.replace(/^ws(s?):\/\//i, 'http$1://');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s.replace(/^\/+/, '')}`;
  // So'rov (?...) va # qismlari server manzilida kerak emas
  s = s.replace(/[?#].*$/, '');
  // Oxiridagi "/" va "/api" (bir necha marta yozilgan bo'lsa ham) olib tashlanadi
  s = s.replace(/\/+$/, '');
  while (/\/api$/i.test(s)) s = s.replace(/\/api$/i, '').replace(/\/+$/, '');

  const m = s.match(/^([a-z][a-z0-9+.-]*:\/\/)([^/]*)(.*)$/i);
  if (!m) return s;
  const scheme = m[1].toLowerCase();
  const host = m[2];
  const rest = m[3];
  if (!host) return s;
  // Port ko'rsatilmagan bo'lsa — server porti (3100). IPv6: [::1]:3100
  const hasPort = host.startsWith('[') ? /\]:\d+$/.test(host) : /:\d+$/.test(host);
  return `${scheme}${hasPort ? host : `${host}:${SERVER_PORT}`}${rest}`;
}

function isLocalhostUrl(url: string): boolean {
  return /:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url);
}

/** Avtomatik (standart) manzil — saqlangan manzil bo'lmaganda ishlatiladi */
export function getDefaultServerUrl(): string {
  // Brauzerda LAN host (telefon/planshet) orqali ochilgan bo'lsa — serverni shu
  // hostning 3100 portiga yo'naltiramiz (qo'lda kiritish shart emas).
  try {
    const loc = window.location;
    const h = loc.hostname;
    if (loc.protocol.startsWith('http') && h && h !== 'localhost' && h !== '127.0.0.1') {
      return `http://${h}:${SERVER_PORT}`;
    }
  } catch {
    /* electron file:// — pastdagi standart manzil */
  }
  return DEFAULT_SERVER;
}

export function getServerUrl(): string {
  const saved = normalizeServerUrl(readSaved());
  // Saqlangan manzil lokal (localhost/127.0.0.1) bo'lsa — eski/noto'g'ri port saqlanib
  // qolgan bo'lishi mumkin, shuning uchun standart manzil ishlatiladi.
  // Faqat haqiqiy LAN manzil (masalan 192.168.x.x) saqlangan bo'lsa, uni hurmat qilamiz.
  if (saved && !isLocalhostUrl(saved)) return saved;
  return getDefaultServerUrl();
}

/**
 * Manzilni normallashtirib saqlash (oynani qayta yuklamaydi — buni applyServerUrl qiladi).
 * Bo'sh yoki standart manzilga teng qiymat saqlanmaydi: telefon keyin ham sahifa hostiga ergashadi.
 * Saqlangan (normallashtirilgan) qiymatni qaytaradi.
 */
export function setServerUrl(url: string): string {
  const normalized = normalizeServerUrl(url);
  try {
    if (!normalized || normalized === getDefaultServerUrl()) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    /* localStorage yopiq — saqlab bo'lmadi */
  }
  return normalized;
}

// ---- Server tekshiruvi ----

export interface LicenseStatusInfo {
  status: string;
  locked: boolean;
}

/**
 * GET <server>/api/license/status — ochiq (tokensiz) marshrut. Server tirikligini ham shu bilan
 * tekshiramiz. Javob DasturXon serveriniki bo'lmasa (masalan 8080 dagi HTML sahifa) — xato.
 */
export async function fetchLicenseStatus(baseUrl: string, timeoutMs = 4000): Promise<LicenseStatusInfo> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/license/status`, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: unknown = await res.json();
    const status = (data as { status?: unknown } | null)?.status;
    if (typeof status !== 'string') throw new Error('DasturXon serveri javobi emas');
    return { status, locked: !!(data as { locked?: unknown }).locked };
  } finally {
    clearTimeout(timer);
  }
}

export interface ServerProbeResult {
  ok: boolean;
  /** Tekshirilgan (normallashtirilgan) manzil */
  url: string;
  /** Asosiy natija: "✓ Server topildi" / "Serverga ulanib bo‘lmadi — manzilni tekshiring" */
  message: string;
  /** Xato bo'lsa — nimani tekshirish kerakligi haqida qisqa maslahat */
  hint?: string;
}

/** Kiritilgan manzilda DasturXon serveri borligini tekshirish (~4 soniya kutadi) */
export async function probeServer(input: string, timeoutMs = 4000): Promise<ServerProbeResult> {
  const url = normalizeServerUrl(input) || getDefaultServerUrl();
  try {
    await fetchLicenseStatus(url, timeoutMs);
    return { ok: true, url, message: '✓ Server topildi' };
  } catch (e) {
    const port = url.match(/:(\d+)(?:\/|$)/)?.[1];
    let hint: string;
    if (port === WEB_PORT) {
      hint = `${WEB_PORT} — telefon sahifasi porti. Server porti: ${SERVER_PORT} (masalan http://192.168.1.10:${SERVER_PORT})`;
    } else if ((e as Error)?.name === 'AbortError') {
      hint = 'Javob kelmadi: kassa kompyuteri yoqilganini va shu tarmoqda ekanini tekshiring';
    } else if (e instanceof TypeError) {
      hint = `Kassa kompyuteri yoqilganini, IP to‘g‘riligini va firewall'da ${SERVER_PORT} port ochiqligini tekshiring`;
    } else {
      hint = `Bu manzilda DasturXon serveri javob bermadi (port ${SERVER_PORT} bo‘lishi kerak)`;
    }
    return { ok: false, url, message: 'Serverga ulanib bo‘lmadi — manzilni tekshiring', hint };
  }
}

// ---- Saqlash + qayta yuklash ----

const SKIP_SPLASH_KEY = 'dx_skip_splash_once';
let skipSplash: boolean | null = null;

/** Oynani qayta yuklash (splash ekranisiz) — REST va socket yangi sozlama bilan qaytadan ulanadi */
export function reloadApp(): void {
  try {
    sessionStorage.setItem(SKIP_SPLASH_KEY, '1');
  } catch {
    /* sessionStorage yopiq — splash bir marta ko'rinadi, xolos */
  }
  window.location.reload();
}

/**
 * Bu yuklanish reloadApp() natijasimi? (splash ekranini o'tkazib yuborish uchun).
 * Bir yuklanish davomida bir xil javob qaytaradi (StrictMode ikki marta chaqirsa ham).
 */
export function consumeSkipSplash(): boolean {
  if (skipSplash === null) {
    try {
      skipSplash = sessionStorage.getItem(SKIP_SPLASH_KEY) === '1';
      sessionStorage.removeItem(SKIP_SPLASH_KEY);
    } catch {
      skipSplash = false;
    }
  }
  return skipSplash;
}

/**
 * Manzilni saqlash. Amaldagi manzil o'zgargan bo'lsagina oyna qayta yuklanadi
 * (o'zgarmasa qayta yuklash shart emas — qayta yuklash sikli ham bo'lmaydi).
 */
export function applyServerUrl(input: string): { url: string; reloaded: boolean } {
  const before = getServerUrl();
  setServerUrl(input);
  const after = getServerUrl();
  if (after !== before) {
    reloadApp();
    return { url: after, reloaded: true };
  }
  return { url: after, reloaded: false };
}
