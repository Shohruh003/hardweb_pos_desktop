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

/** begin() boshlagan parol urinishi — natijaga qarab succeed() yoki release() ga beriladi */
export interface LoginAttempt {
  readonly ip: string;
  readonly kind: LoginKind;
  /** Urinish qayd etilgan vaqt (ms) — hisoblagichdagi aynan shu yozuvni topish uchun */
  readonly at: number;
}

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

  /**
   * Parol urinishini BOSHLASH — sinxron, hech qanday await'dan OLDIN chaqiriladi: blok bo'lsa 429,
   * aks holda urinish darhol "noto'g'ri" deb sanaladi (IP va umumiy hisoblagichda).
   * Sabab: bcrypt tekshiruvi event loop'ni bo'shatadi — sanash tekshiruvdan keyin bo'lsa, bir vaqtda
   * yuborilgan o'nlab so'rov hammasi assertAllowed'dan o'tib, cheklovni butunlay chetlab o'tardi.
   * Parol to'g'ri chiqsa — succeed(); parol umuman tekshirilmagan bo'lsa — release();
   * noto'g'ri bo'lsa hech narsa qilinmaydi (urinish allaqachon sanalgan).
   */
  begin(ip: string, kind: LoginKind): LoginAttempt {
    this.assertAllowed(ip, kind);
    const at = Date.now();
    this.recordFailureAt(ip, kind, at);
    return { ip, kind, at };
  }

  /** Urinish muvaffaqiyatli: IP hisoblagichi nolga tushadi, umumiy hisoblagichdan shu urinish olinadi */
  succeed(attempt: LoginAttempt): void {
    this.byIp.delete(attempt.ip);
    this.retract(this.global[attempt.kind], attempt.at, GLOBAL_MAX_FAILURES, GLOBAL_WINDOW_MS, GLOBAL_BLOCK_MS);
  }

  /** Urinish parol tekshiruvigacha yetmadi (masalan foydalanuvchida parol yo'q) — sanalmaydi */
  release(attempt: LoginAttempt): void {
    const counter = this.byIp.get(attempt.ip);
    if (counter) {
      this.retract(counter, attempt.at, IP_MAX_FAILURES, IP_WINDOW_MS, IP_BLOCK_MS);
    }
    this.retract(this.global[attempt.kind], attempt.at, GLOBAL_MAX_FAILURES, GLOBAL_WINDOW_MS, GLOBAL_BLOCK_MS);
  }

  /** Noto'g'ri urinishni qayd etish (IP va umumiy hisoblagich) — PIN kirishi uchun */
  recordFailure(ip: string, kind: LoginKind): void {
    this.recordFailureAt(ip, kind, Date.now());
  }

  private recordFailureAt(ip: string, kind: LoginKind, now: number): void {
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

  /**
   * Hisoblagichga urinish qo'shish; chegaraga yetsa blok qo'yiladi (yangi blok — true).
   * Yozuvlar blokdan keyin ham qoladi (retract() blokni kim qo'yganini bilishi uchun) — blok oynaga
   * teng (60 s), shuning uchun blok tugaganda ular baribir oynadan chiqib bo'lgan bo'ladi.
   */
  private hit(
    counter: Counter,
    now: number,
    max: number,
    windowMs: number,
    blockMs: number,
  ): boolean {
    counter.failures = counter.failures.filter((t) => now - t < windowMs);
    counter.failures.push(now);
    if (counter.failures.length >= max && counter.blockedUntil <= now) {
      counter.blockedUntil = now + blockMs;
      return true;
    }
    return false;
  }

  /**
   * begin() qayd etgan urinishni hisoblagichdan olib tashlash. Blokni aynan shu urinish qo'ygan
   * bo'lsa va usiz chegaraga yetilmagan bo'lsa — blok ham bekor qilinadi (to'g'ri parol kiritgan
   * xodim o'zi va boshqalar uchun blok sababchisi bo'lmasin).
   */
  private retract(
    counter: Counter,
    at: number,
    max: number,
    windowMs: number,
    blockMs: number,
  ): void {
    const i = counter.failures.lastIndexOf(at);
    if (i < 0) return;
    counter.failures.splice(i, 1);
    if (counter.blockedUntil === at + blockMs) {
      const counted = counter.failures.filter((t) => t <= at && at - t < windowMs).length;
      if (counted < max) counter.blockedUntil = 0;
    }
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
