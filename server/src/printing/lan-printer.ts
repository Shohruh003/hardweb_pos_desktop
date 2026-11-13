// LAN (TCP, odatda 9100-port) termal printerga bayt buferini yuborish va bir printerga
// yuboriladigan ishlarni navbatga qo'yish. Tashqi kutubxonasiz (Node `net`).
import { connect, Socket } from 'net';

export interface PrinterAddress {
  host: string;
  port: number;
}

export interface LanTimeouts {
  /** Ulanish kutish vaqti */
  connectMs: number;
  /** Ulangandan keyin ma'lumot to'liq yuborilishini kutish */
  writeMs: number;
  /** Ma'lumot yuborilgach printer ulanishni yopishini kutish (yopmasa ham muvaffaqiyat) */
  closeGraceMs: number;
}

export const DEFAULT_PRINTER_PORT = 9100;

export const LAN_TIMEOUTS: LanTimeouts = { connectMs: 5000, writeMs: 5000, closeGraceMs: 2000 };

/** Printerga yuborish xatosi — `message` foydalanuvchiga ko'rsatiladigan o'zbekcha matn */
export class PrinterSendError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'PrinterSendError';
  }
}

export function formatAddress(a: PrinterAddress): string {
  return `${a.host}:${a.port}`;
}

export interface ParsedPrinterAddress {
  /** Bo'sh — printer sozlanmagan (chek chiqmaydi) */
  host: string;
  port: number;
  /** To'ldirilgan bo'lsa — manzil noto'g'ri (foydalanuvchiga ko'rsatiladi) */
  error?: string;
}

/**
 * Bo'lim sozlamasidagi printer manzilini tozalash: bo'shliqlar, "tcp://" kabi prefiks olib tashlanadi;
 * IP maydoniga "192.168.1.50:9100" yozilgan bo'lsa port shu yerdan olinadi.
 * Port bo'sh/0 bo'lsa — 9100.
 */
export function parsePrinterAddress(rawHost: unknown, rawPort: unknown): ParsedPrinterAddress {
  let host = String(rawHost ?? '').trim();
  let port = Number(rawPort) || DEFAULT_PRINTER_PORT;
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0].trim();
  // "host:port" (faqat bitta ':' — IPv6 manzillarni buzmaslik uchun)
  const m = /^([^:]+):(\d{1,5})$/.exec(host);
  if (m) {
    host = m[1].trim();
    port = Number(m[2]);
  }
  if (!host) return { host: '', port };
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { host, port, error: `Printer porti noto‘g‘ri: ${String(rawPort ?? '')}` };
  }
  return { host, port };
}

// Tizim xatolarini tushunarli o'zbekcha xabarga aylantirish
function describeSocketError(err: unknown, addr: PrinterAddress): PrinterSendError {
  const e = err as NodeJS.ErrnoException;
  const code = e?.code || '';
  const where = formatAddress(addr);
  switch (code) {
    case 'ECONNREFUSED':
      return new PrinterSendError(`Printer ulanishni rad etdi (${where})`, code);
    case 'ETIMEDOUT':
      return new PrinterSendError(`Printer javob bermadi (${where})`, code);
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EHOSTDOWN':
    case 'ENETDOWN':
      return new PrinterSendError(`Printerga tarmoq orqali yetib bo‘lmadi (${where})`, code);
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
    case 'EAI_FAIL':
      return new PrinterSendError(`Printer manzili topilmadi (${addr.host})`, code);
    case 'ECONNRESET':
    case 'ECONNABORTED':
    case 'EPIPE':
      return new PrinterSendError(`Printer aloqani uzdi (${where})`, code);
    case 'ERR_SOCKET_BAD_PORT':
      return new PrinterSendError(`Printer porti noto‘g‘ri: ${addr.port}`, code);
    default:
      return new PrinterSendError(
        `Printer xatosi (${where}): ${code || e?.message || String(err)}`,
        code || undefined,
      );
  }
}

/**
 * Ma'lumotni printerga bitta TCP ulanish orqali yuborish.
 *  1) ulanish — `connectMs` ichida;
 *  2) ma'lumot + FIN (socket.end) — `writeMs` ichida to'liq yuborilishi kerak;
 *  3) printer ulanishni yopishi kutiladi (`closeGraceMs`) — keyingi chek shu printerga faqat
 *     oldingi ulanish yopilgach ochilsin. Yopmasa ham, yoki ma'lumot yuborilgandan keyin
 *     ulanishni keskin uzsa ham (ko'p printerlar shunday qiladi) — muvaffaqiyat deb hisoblanadi.
 * Xato bo'lsa PrinterSendError (o'zbekcha xabar) bilan reject qilinadi.
 */
export function sendToLanPrinter(
  addr: PrinterAddress,
  data: Buffer,
  timeouts: LanTimeouts = LAN_TIMEOUTS,
): Promise<void> {
  const where = formatAddress(addr);
  return new Promise<void>((resolve, reject) => {
    let socket: Socket | null = null;
    let timer: NodeJS.Timeout | null = null;
    let delivered = false; // ma'lumot va FIN to'liq yuborildi
    let settled = false;

    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (socket && !socket.destroyed) socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    const arm = (ms: number, onExpire: () => void) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onExpire, ms);
    };

    try {
      socket = connect({ host: addr.host, port: addr.port });
    } catch (e) {
      // noto'g'ri port va h.k. — sinxron xato
      settle(describeSocketError(e, addr));
      return;
    }
    const s = socket;

    arm(timeouts.connectMs, () =>
      settle(new PrinterSendError(`Printer javob bermadi (${where})`, 'ETIMEDOUT')),
    );
    s.once('connect', () => {
      arm(timeouts.writeMs, () =>
        settle(new PrinterSendError(`Printer ma’lumotni qabul qilmadi (${where})`, 'EWRITETIMEOUT')),
      );
      s.setNoDelay(true);
      s.end(data);
    });
    s.once('finish', () => {
      delivered = true;
      arm(timeouts.closeGraceMs, () => settle());
    });
    // Printer holat baytlarini yuborishi mumkin — o'qib tashlaymiz (oqim to'xtab qolmasin)
    s.on('data', () => undefined);
    s.on('error', (err) => settle(delivered ? undefined : describeSocketError(err, addr)));
    s.once('close', () =>
      settle(delivered ? undefined : new PrinterSendError(`Printer aloqani uzdi (${where})`, 'ECLOSED')),
    );
  });
}

/**
 * Bir printerga (host:port) yuboriladigan ishlarni ketma-ket bajarish navbati.
 * Ko'p termal printerlar bir vaqtda faqat bitta ulanishni qabul qiladi — shuning uchun
 * bir printerga ikki chek parallel yuborilmaydi; turli printerlar esa parallel ishlaydi.
 */
export class PrinterQueue {
  private readonly tails = new Map<string, Promise<void>>();

  static keyOf(addr: PrinterAddress): string {
    return `${addr.host.toLowerCase()}:${addr.port}`;
  }

  /** Oldingi ishlar tugagach (muvaffaqiyatli yoki yo'q) `job`ni bajaradi */
  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(job);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** Shu printerga hozir ish bajarilyaptimi yoki navbatda turibdimi */
  isBusy(key: string): boolean {
    return this.tails.has(key);
  }
}
