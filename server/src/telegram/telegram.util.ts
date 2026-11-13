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

/**
 * Hozirgacha kelgan eng so'nggi kunlik hisobot vaqti: bugungi hisobot vaqti o'tgan bo'lsa — bugun,
 * aks holda kechagi. Masalan vaqt 23:59 bo'lsa, 00:30 da — kechagi 23:59.
 */
export function latestReportDue(now: Date, at: { h: number; m: number }): Date {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), at.h, at.m, 0, 0);
  if (today.getTime() <= now.getTime()) return today;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, at.h, at.m, 0, 0);
}

/** Summa: "6 000" (butun so'm, minglar bo'shliq bilan) */
export function formatMoney(value: unknown): string {
  const n = Math.round(Number(value));
  return new Intl.NumberFormat('uz-UZ').format(Number.isFinite(n) ? n : 0);
}

/** Miqdor: dona -> "2", kg -> "1,107 kg" (ko'pi bilan 3 xona kasr, suzuvchi qoldiqsiz) */
export function formatQuantity(quantity: unknown, unit?: string | null): string {
  const q = Number(quantity);
  if (!Number.isFinite(q)) return '?';
  const n = String(Math.round(q * 1000) / 1000).replace('.', ',');
  return unit === 'kg' ? `${n} kg` : n;
}

/** Otkaz xabaridagi taom qatori. sum/price — bo'lsa summa ko'rsatiladi (so'mda) */
export interface VoidNoticeItem {
  name: string;
  quantity: number | string;
  unit?: string | null;
  sum?: number | string | null;
  price?: number | string | null;
}

export interface VoidNotice {
  orderName: string;
  items: VoidNoticeItem[];
  reason?: string | null;
  userName?: string | null;
  wholeOrder?: boolean;
}

/** Bitta xabarda ko'pi bilan shuncha taom nomi (qolgani "yana N ta") */
const VOID_MAX_ITEMS = 10;

/**
 * Otkaz haqida direktorga qisqa xabar (HTML; foydalanuvchi matni escapeHtml orqali):
 *   🚫 Otkaz: Stol 5 — 1 × BULYON (6 000 so‘m) — sabab: Mijoz voz kechdi — Kassir
 * Butun hisob bekor qilinsa — "Otkaz (butun hisob)". Taom bo'lmasa — null.
 */
export function buildVoidMessage(p: VoidNotice): string | null {
  const items = (Array.isArray(p?.items) ? p.items : []).filter(
    (it) => it && Number(it.quantity) > 0,
  );
  if (items.length === 0) return null;

  // Qator summasi: sum berilgan bo'lsa — o'sha, aks holda narx × miqdor (butun so'mga)
  const sumOf = (it: VoidNoticeItem): number | null => {
    if (it.sum != null && Number.isFinite(Number(it.sum))) return Math.round(Number(it.sum));
    if (it.price != null && Number.isFinite(Number(it.price))) {
      return Math.round(Number(it.price) * Number(it.quantity));
    }
    return null;
  };
  const shown = items.slice(0, VOID_MAX_ITEMS).map((it) => {
    const sum = sumOf(it);
    return (
      `${formatQuantity(it.quantity, it.unit)} × ${escapeHtml(String(it.name || 'Taom'))}` +
      (sum != null ? ` (${formatMoney(sum)} so‘m)` : '')
    );
  });
  const more = items.length > VOID_MAX_ITEMS ? `, … yana ${items.length - VOID_MAX_ITEMS} ta` : '';
  const sums = items.map(sumOf);
  const total =
    items.length > 1 && sums.every((s) => s != null)
      ? ` = <b>${formatMoney(sums.reduce((a: number, s) => a + (s ?? 0), 0))} so‘m</b>`
      : '';
  const reason = String(p.reason ?? '').trim();
  const user = String(p.userName ?? '').trim();

  return (
    `🚫 <b>Otkaz${p.wholeOrder ? ' (butun hisob)' : ''}</b>: ` +
    `${escapeHtml(String(p.orderName || 'Buyurtma'))} — ` +
    shown.join(', ') +
    more +
    total +
    ` — sabab: ${reason ? escapeHtml(reason) : 'ko‘rsatilmagan'}` +
    (user ? ` — ${escapeHtml(user)}` : '')
  );
}
