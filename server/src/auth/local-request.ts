import * as os from 'os';
import { clientIp } from './login-throttle';

/**
 * B35 — "lokal" so'rov: server ishlayotgan kompyuterning O'ZIDAN kelgan so'rov.
 * Loopback (127.x.x.x, ::1) yoki server kompyuterining o'z tarmoq manzillaridan biri
 * (kassa ilovasi o'z serveriga LAN IP orqali ham ulanishi mumkin). Manzil faqat TCP
 * ulanishdan olinadi (X-Forwarded-For kabi sarlavhalarga ishonilmaydi).
 */

export const DIRECTOR_LOCAL_ONLY_MESSAGE = 'Direktor faqat kassa (server) kompyuteridan kira oladi';
export const LOCAL_SETTING_ONLY_MESSAGE =
  'Bu sozlamani faqat kassa (server) kompyuteridan o‘zgartirish mumkin';

/** IPv4-mapped (::ffff:1.2.3.4) va zona indeksli (fe80::1%12) ko'rinishlarni bir xil shaklga keltirish */
export function normalizeAddress(addr: unknown): string {
  let a = String(addr ?? '').trim().toLowerCase();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  if (a.startsWith('::ffff:') && a.includes('.')) a = a.slice(7);
  return a;
}

function isLoopback(a: string): boolean {
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

// Interfeys manzillari keshi: IP o'zgarishi (DHCP, kabel ulanishi) 30 s ichida hisobga olinadi
const OWN_TTL_MS = 30_000;
let ownCache: { at: number; set: Set<string> } | null = null;

/** Server kompyuterining barcha tarmoq interfeyslari manzillari (normallashtirilgan) */
export function serverAddresses(): Set<string> {
  const now = Date.now();
  if (ownCache && now - ownCache.at < OWN_TTL_MS) return ownCache.set;
  const set = new Set<string>();
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const info of list ?? []) {
        if (info?.address) set.add(normalizeAddress(info.address));
      }
    }
  } catch {
    // Interfeyslarni o'qib bo'lmadi — faqat loopback lokal hisoblanadi
  }
  ownCache = { at: now, set };
  return set;
}

/** Manzil lokalmi: loopback yoki `own` (standart — server kompyuterining o'z manzillari) ichida */
export function isLocalAddress(addr: unknown, own: Iterable<string> = serverAddresses()): boolean {
  const a = normalizeAddress(addr);
  if (!a || a === 'unknown') return false;
  if (isLoopback(a)) return true;
  for (const o of own) {
    if (normalizeAddress(o) === a) return true;
  }
  return false;
}

/** So'rov server kompyuterining o'zidanmi (TCP ulanish manzili bo'yicha) */
export function isLocalRequest(req: unknown, own?: Iterable<string>): boolean {
  return isLocalAddress(clientIp(req), own);
}
