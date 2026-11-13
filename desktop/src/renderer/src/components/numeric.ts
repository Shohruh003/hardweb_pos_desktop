// Raqam kiritish maydonlari uchun yordamchilar (sensorli ekran, telefon va Windows klaviaturasi).
//
// O'zbek/rus tartibli klaviaturada kasr ajratgichi ko'pincha vergul (","). Shuning uchun
// miqdor maydonlarida "1,5" har doim 1.5 deb o'qiladi — hech qachon 15 emas.
// Pul (so'm) maydonlarida esa tiyin ishlatilmaydi: bo'shliq, vergul va nuqta minglik
// ajratgich deb hisoblanadi va olib tashlanadi ("150 000" / "150,000" -> 150000).

/** Bo'shliqlar (oddiy, bo'linmas va tor bo'linmas) */
const SPACES = /[\s  ]/g;

/**
 * Kasr son matnini tozalash: vergul -> nuqta, bo'shliqlar olib tashlanadi, faqat raqamlar va
 * BITTA nuqta qoladi, nuqtadan keyin ko'pi bilan `maxDecimals` ta raqam.
 *   "1,5" -> "1.5" · " 2 . 25 " -> "2.25" · ",5" -> "0.5" · "1.2.3" -> "1.23" · "1," -> "1."
 * Oraliq holat ("1.") saqlanadi — foydalanuvchi yozishda davom etishi uchun.
 */
export function cleanDecimalInput(value: string, maxDecimals = 3): string {
  const s = String(value ?? '')
    .replace(SPACES, '')
    .replace(/,/g, '.')
    .replace(/[^0-9.]/g, '');
  const dot = s.indexOf('.');
  if (dot < 0) return s;
  const intPart = s.slice(0, dot) || '0';
  if (maxDecimals <= 0) return intPart;
  const frac = s
    .slice(dot + 1)
    .replace(/\./g, '')
    .slice(0, maxDecimals);
  return `${intPart}.${frac}`;
}

/** Butun son (so'm, PIN) matni: faqat raqamlar qoladi — minglik ajratgichlar olib tashlanadi */
export function cleanDigitsInput(value: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

/** Tozalangan kasr matnini songa aylantirish: bo'sh yoki noto'g'ri qiymat -> 0 */
export function parseDecimal(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(cleanDecimalInput(String(value ?? ''), 6));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Miqdorni ko'rsatish (kg uchun kasr): ortiqcha nollarsiz, ko'pi bilan 3 xona,
 * suzuvchi nuqta qoldiqlarisiz (0.30000000000000004 -> "0.3").
 */
export function formatQty(value: number | string | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 1000) / 1000);
}
