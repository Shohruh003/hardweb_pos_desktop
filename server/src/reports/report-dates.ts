// Hisobot sanalari: mahalliy kalendar kunlar (server vaqti = restoran vaqti, Toshkent).
// Bazada vaqtlar UTC matn sifatida saqlanadi ('YYYY-MM-DD HH:MM:SS[.SSS]', eski demo qatorlarda
// ISO 'T…Z'), shuning uchun mahalliy kun chegaralari UTC matnga aylantiriladi va ustun datetime()
// bilan yagona ko'rinishga keltirib solishtiriladi (inRangeSql). Toshkentdagi 01:30 dagi to'lov
// UTC bo'yicha oldingi sanada turadi — shunda ham to'g'ri kunga tushadi.
import { BadRequestException } from '@nestjs/common';

export const DATE_INVALID_MESSAGE = 'Sana noto‘g‘ri (YYYY-MM-DD yoki YYYY-MM-DDTHH:MM)';
export const RANGE_INVALID_MESSAGE = 'Sana oralig‘i noto‘g‘ri';
export const RANGE_TOO_LONG_MESSAGE = 'Sana oralig‘i juda katta (1 yilgacha)';

/** Hisobot oralig'ining eng katta uzunligi (kunlarda) */
export const RANGE_MAX_DAYS = 366;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Mahalliy sana kaliti 'YYYY-MM-DD' */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Sana -> SQLite'ning UTC matni 'YYYY-MM-DD HH:MM:SS' (datetime() natijasi bilan bir xil ko'rinish) */
export function sqliteUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** 'YYYY-MM-DD' -> shu kunning mahalliy 00:00 vaqti; noto'g'ri yozuv yoki mavjud bo'lmagan sana -> null */
export function parseLocalDate(value: unknown): Date | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 0, 0, 0, 0);
  // 31-fevral kabi sanalar keyingi oyga "o'tib ketadi" — rad etamiz
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/**
 * 'YYYY-MM-DDTHH:MM' (yoki bo'sh joy bilan) -> mahalliy sana-vaqt; vaqtsiz 'YYYY-MM-DD' -> kun boshi.
 * hasTime — vaqt berilganmi (0.3.2: hisobotlarda istalgan soat oralig'i). Noto'g'ri -> null.
 */
export function parseLocalDateTime(value: unknown): { date: Date; hasTime: boolean } | null {
  const raw = String((Array.isArray(value) ? value[0] : value) ?? '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(raw);
  if (!m) return null;
  const day = parseLocalDate(m[1]);
  if (!day) return null;
  if (m[2] === undefined) return { date: day, hasTime: false };
  const h = Number(m[2]);
  const mi = Number(m[3]);
  if (h > 23 || mi > 59) return null;
  return { date: new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi, 0, 0), hasTime: true };
}

/** Mahalliy kun boshi (00:00) */
function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Keyingi kunning boshi (oraliqqa kirmaydi) */
function nextDayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
}

/** Mahalliy sanalar oralig'i (ikkala chegara kiradi) va bazadagi UTC chegaralar [fromUtc, toUtc) */
export interface LocalRange {
  from: string; // 'YYYY-MM-DD'
  to: string; // 'YYYY-MM-DD' (kiradi)
  fromUtc: string; // from kunining 00:00 — UTC matn
  toUtc: string; // to dan keyingi kunning 00:00 — UTC matn (oraliqqa kirmaydi)
}

/** Bitta mahalliy kun oralig'i */
export function dayRange(day: Date): LocalRange {
  const start = dayStart(day);
  const key = localDateKey(start);
  return { from: key, to: key, fromUtc: sqliteUtc(start), toUtc: sqliteUtc(nextDayStart(start)) };
}

/**
 * So'rovdagi ?from=&to= (mahalliy 'YYYY-MM-DD', ikkalasi ham kiradi) -> oraliq.
 * Hech biri berilmasa — bugun. Faqat from — from..bugun (from kelajakda bo'lsa — faqat from kuni).
 * Faqat to — shu bitta kun. Noto'g'ri sana, teskari yoki 1 yildan uzun oraliq -> 400 (o'zbekcha).
 */
export function resolveRange(fromRaw: unknown, toRaw: unknown, now: Date = new Date()): LocalRange {
  const fromGiven = isGiven(fromRaw);
  const toGiven = isGiven(toRaw);
  const fromDt = fromGiven ? parseLocalDateTime(fromRaw) : null;
  const toDt = toGiven ? parseLocalDateTime(toRaw) : null;
  if ((fromGiven && !fromDt) || (toGiven && !toDt)) throw new BadRequestException(DATE_INVALID_MESSAGE);
  // Vaqt bilan oraliq (0.3.2): "15.11 08:00 — 16.11 03:00" — aniq daqiqalar bo'yicha
  if (fromDt?.hasTime || toDt?.hasTime) {
    const start = fromDt ? fromDt.date : dayStart(toDt!.date);
    // "gacha" vaqti kiradi (shu daqiqa oxirigacha); vaqtsiz "gacha" — o'sha kun oxirigacha
    const endExcl = toDt ? (toDt.hasTime ? new Date(toDt.date.getTime() + 60_000) : nextDayStart(toDt.date)) : new Date(now.getTime() + 60_000);
    if (endExcl.getTime() <= start.getTime()) throw new BadRequestException(RANGE_INVALID_MESSAGE);
    if (endExcl.getTime() - start.getTime() > RANGE_MAX_DAYS * 86_400_000) throw new BadRequestException(RANGE_TOO_LONG_MESSAGE);
    return {
      from: localDateKey(start),
      to: localDateKey(new Date(endExcl.getTime() - 1)),
      fromUtc: sqliteUtc(start),
      toUtc: sqliteUtc(endExcl),
    };
  }
  const from = fromDt ? fromDt.date : null;
  const to = toDt ? toDt.date : null;

  const today = dayStart(now);
  const start = from ?? to ?? today;
  const end = to ?? (from ? (from.getTime() > today.getTime() ? from : today) : today);
  if (end.getTime() < start.getTime()) throw new BadRequestException(RANGE_INVALID_MESSAGE);
  // Kunlar soni (soat mintaqasi o'zgarishlarida ham to'g'ri — kalendar bo'yicha)
  const days = Math.round((nextDayStart(end).getTime() - start.getTime()) / 86_400_000);
  if (days > RANGE_MAX_DAYS) throw new BadRequestException(RANGE_TOO_LONG_MESSAGE);

  return {
    from: localDateKey(start),
    to: localDateKey(end),
    fromUtc: sqliteUtc(start),
    toUtc: sqliteUtc(nextDayStart(end)),
  };
}

/** ?date=YYYY-MM-DD (bitta kun; berilmasa — bugun). Noto'g'ri sana -> 400 */
export function resolveDay(dateRaw: unknown, now: Date = new Date()): LocalRange {
  if (!isGiven(dateRaw)) return dayRange(now);
  const d = parseLocalDate(dateRaw);
  if (!d) throw new BadRequestException(DATE_INVALID_MESSAGE);
  return dayRange(d);
}

/**
 * Indeks uchun qo'pol chegara: UTC matn chegarasining sanasi `days` kun siljitilgan 'YYYY-MM-DD'.
 * Bazadagi har qanday ko'rinish ('YYYY-MM-DD HH:MM:SS[.SSS]', ISO 'T…Z') sana bilan boshlanadi, shuning
 * uchun ustunni datetime()siz shu chegaralar bilan matn sifatida solishtirish to'g'ri va indeksdan
 * foydalanadi (datetime(ustun) shartida SQLite indeksni ishlata olmaydi). Bir-ikki kunlik zaxira —
 * vaqt mintaqasi yozilgan ISO qiymatlar uchun ham. Aniq chegara baribir datetime() bilan tekshiriladi.
 */
export function looseDayBound(utc: string, days: number): string {
  const d = new Date(`${utc.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * SQL shart: ustun qiymati oraliqda ([:<prefix>From, :<prefix>To)). Aniq shart — datetime() bilan
 * yagona 'YYYY-MM-DD HH:MM:SS' ko'rinishda (bazada aralash formatlar bor); oldidagi qo'pol shart
 * (:<prefix>Lo / :<prefix>Hi) faqat indeksdan foydalanish uchun, natijani o'zgartirmaydi.
 * Parametrlar — rangeParams(range, prefix).
 */
export function inRangeSql(column: string, prefix = 'r'): string {
  return (
    `${column} >= :${prefix}Lo AND ${column} < :${prefix}Hi AND ` +
    `datetime(${column}) >= :${prefix}From AND datetime(${column}) < :${prefix}To`
  );
}

export function rangeParams(range: LocalRange, prefix = 'r'): Record<string, string> {
  return {
    [`${prefix}From`]: range.fromUtc,
    [`${prefix}To`]: range.toUtc,
    [`${prefix}Lo`]: looseDayBound(range.fromUtc, -1),
    [`${prefix}Hi`]: looseDayBound(range.toUtc, 2),
  };
}

function isGiven(v: unknown): boolean {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw !== undefined && raw !== null && String(raw).trim() !== '';
}
