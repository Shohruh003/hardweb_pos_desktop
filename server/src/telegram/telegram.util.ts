// Telegram xabarlari va kunlik hisobot uchun sof yordamchi funksiyalar (bazasiz, test qilish oson).

/**
 * Telegram HTML rejimi (parse_mode: 'HTML') uchun matnni xavfsiz qilish.
 * Foydalanuvchi kiritgan matnda (taom nomi, vozvrat sababi, ism) "<", ">" yoki "&" bo'lsa
 * Telegram xabarni "can't parse entities" deb rad etadi — shuning uchun almashtiramiz.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Sana -> SQLite'ning o'z UTC matn formati 'YYYY-MM-DD HH:MM:SS' (datetime('now') bilan bir xil) */
export function sqliteUtcText(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export interface DayWindow {
  /** Mahalliy kun boshi (00:00) */
  start: Date;
  /** Keyingi kun boshi (oraliqqa kirmaydi) */
  end: Date;
  /** start — bazadagi UTC matn ko'rinishida */
  from: string;
  /** end — bazadagi UTC matn ko'rinishida */
  to: string;
}

/**
 * Mahalliy kalendar kun oralig'i [00:00, ertasi 00:00) — server soat mintaqasida (Toshkent).
 * Bazada vaqtlar UTC matn sifatida saqlanadi, shuning uchun Toshkentdagi 01:30 dagi to'lov
 * UTC bo'yicha oldingi sanada turadi ('…-12 20:30:00') — oraliq ham UTC'da hisoblanadi.
 */
export function localDayWindow(day: Date): DayWindow {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0, 0);
  return { start, end, from: sqliteUtcText(start), to: sqliteUtcText(end) };
}

/**
 * SQL shart: ustun qiymati kun oralig'ida ([:dayFrom, :dayTo)).
 * Ustun datetime() bilan yagona 'YYYY-MM-DD HH:MM:SS' ko'rinishga keltiriladi — bazada aralash
 * formatlar bor ('…SS' — baza standarti, '…SS.SSS' — TypeORM, eski demo qatorlarda ISO 'T…Z'),
 * ularni oddiy matn sifatida ISO qator bilan solishtirish noto'g'ri natija beradi.
 */
export function inDaySql(column: string): string {
  return `datetime(${column}) >= :dayFrom AND datetime(${column}) < :dayTo`;
}

/** "HH:MM" (shuningdek "H:MM", "HH:MM:SS") -> { h, m }; noto'g'ri qiymat -> null */
export function parseReportTime(value: unknown): { h: number; m: number } | null {
  const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h <= 23 && m <= 59 ? { h, m } : null;
}

/** Mahalliy sana kaliti YYYY-MM-DD (kunlik hisobot takrorlanmasligi uchun) */
export function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
