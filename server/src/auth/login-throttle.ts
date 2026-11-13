import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

// ---- Kirish urinishlarini cheklash (PIN/parol tanlab topishdan himoya) ----
// Hisoblagichlar xotirada (qo'shimcha kutubxonasiz). Server qayta ishga tushsa
// nolga tushadi — bu maqbul, chunki bloklar baribir 1 daqiqalik.

/** Bitta IP'dan oyna ichida shuncha noto'g'ri urinishdan keyin IP bloklanadi */
export const IP_MAX_FAILURES = 5;
/** IP bo'yicha noto'g'ri urinishlar sanaladigan oyna — 60 soniya */
export const IP_WINDOW_MS = 60_000;
/** IP bloki davomiyligi — 60 soniya (muvaffaqiyatli kirish hisoblagichni nolga tushiradi) */
export const IP_BLOCK_MS = 60_000;

/**
 * Umumiy himoya (barcha IP'lar yig'indisi): 1 daqiqada shuncha noto'g'ri urinish bo'lsa,
 * shu kirish turi (PIN yoki parol) HAMMA uchun 60 soniyaga yopiladi.
 * Bir nechta qurilma/IP almashtirib PIN (atigi 10 000 variant) terishga qarshi.
 */
export const GLOBAL_MAX_FAILURES = 40;
/** Umumiy hisoblash oynasi — 60 soniya */
export const GLOBAL_WINDOW_MS = 60_000;
/** Umumiy blok davomiyligi — 60 soniya */
export const GLOBAL_BLOCK_MS = 60_000;

/** Xotira cheksiz o'smasligi uchun kuzatiladigan IP'lar chegarasi (oshsa eskilari tozalanadi) */
const MAX_TRACKED_IPS = 2000;

/** 429 javobi matni (renderer `message`ni ko'rsatadi) */
export const TOO_MANY_ATTEMPTS_MESSAGE =
  'Juda ko‘p noto‘g‘ri urinish. 1 daqiqadan so‘ng qayta urinib ko‘ring';

/** Kirish turi: PIN yoki login/parol (parol almashtirishdagi joriy parol ham "password") */
export type LoginKind = 'pin' | 'password';

interface Counter {
  /** Oyna ichidagi noto'g'ri urinishlar vaqtlari (ms) */
  failures: number[];
  /** Shu vaqtgacha bloklangan (ms, 0 — blok yo'q) */
  blockedUntil: number;
}

/**
 * So'rov yuborgan mijozning IP manzili — faqat TCP ulanish manzili.
 * X-Forwarded-For'ga ishonmaymiz: uni har kim soxtalashtirib, blokni chetlab o'tishi mumkin.
 */
export function clientIp(req: any): string {
  const raw: string =
    req?.socket?.remoteAddress ||
    req?.connection?.remoteAddress ||
    req?.ip ||
    'unknown';
  // IPv4 manzil IPv6 ko'rinishida kelishi mumkin: ::ffff:192.168.1.5 -> 192.168.1.5
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

@Injectable()
export class LoginThrottle {
  private readonly logger = new Logger('LoginThrottle');
  private readonly byIp = new Map<string, Counter>();
  private readonly global: Record<LoginKind, Counter> = {
    pin: { failures: [], blockedUntil: 0 },
    password: { failures: [], blockedUntil: 0 },
  };

  /** IP yoki umumiy blok faol bo'lsa — HTTP 429 (parol tekshirilmaydi ham) */
  assertAllowed(ip: string, kind: LoginKind): void {
    const now = Date.now();
    const ipBlockedUntil = this.byIp.get(ip)?.blockedUntil ?? 0;
    const until = Math.max(ipBlockedUntil, this.global[kind].blockedUntil);
    if (until > now) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: TOO_MANY_ATTEMPTS_MESSAGE,
          retryAfterSec: Math.ceil((until - now) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Noto'g'ri urinishni qayd etish (IP va umumiy hisoblagich) */
  recordFailure(ip: string, kind: LoginKind): void {
    const now = Date.now();

    let counter = this.byIp.get(ip);
    if (!counter) {
      if (this.byIp.size >= MAX_TRACKED_IPS) this.sweep(now);
      counter = { failures: [], blockedUntil: 0 };
      this.byIp.set(ip, counter);
    }
    if (this.hit(counter, now, IP_MAX_FAILURES, IP_WINDOW_MS, IP_BLOCK_MS)) {
      this.logger.warn(
        `IP ${ip} 60 soniyaga bloklandi: ${IP_MAX_FAILURES} ta noto‘g‘ri urinish (${kind})`,
      );
    }

    if (
      this.hit(
        this.global[kind],
        now,
        GLOBAL_MAX_FAILURES,
        GLOBAL_WINDOW_MS,
        GLOBAL_BLOCK_MS,
      )
    ) {
      this.logger.warn(
        `Umumiy himoya: 1 daqiqada ${GLOBAL_MAX_FAILURES} ta noto‘g‘ri ${kind === 'pin' ? 'PIN' : 'parol'} — bu kirish turi hamma uchun 60 soniyaga yopildi`,
      );
    }
  }

  /** Muvaffaqiyatli kirish — shu IP hisoblagichi nolga tushadi */
  recordSuccess(ip: string): void {
    this.byIp.delete(ip);
  }

  /** Hisoblagichga urinish qo'shish; chegaraga yetsa blok qo'yiladi (true qaytadi) */
  private hit(
    counter: Counter,
    now: number,
    max: number,
    windowMs: number,
    blockMs: number,
  ): boolean {
    counter.failures = counter.failures.filter((t) => now - t < windowMs);
    counter.failures.push(now);
    if (counter.failures.length >= max) {
      counter.blockedUntil = now + blockMs;
      counter.failures = [];
      return true;
    }
    return false;
  }

  /** Muddati o'tgan yozuvlarni tozalash; baribir ko'p bo'lsa — eng eskilarini (Map tartibi) o'chiramiz */
  private sweep(now: number): void {
    for (const [ip, c] of this.byIp) {
      const fresh = c.failures.some((t) => now - t < IP_WINDOW_MS);
      if (!fresh && c.blockedUntil <= now) this.byIp.delete(ip);
    }
    const excess = this.byIp.size - Math.floor(MAX_TRACKED_IPS / 2);
    if (excess > 0) {
      let removed = 0;
      for (const ip of this.byIp.keys()) {
        if (removed >= excess) break;
        this.byIp.delete(ip);
        removed++;
      }
    }
  }
}
