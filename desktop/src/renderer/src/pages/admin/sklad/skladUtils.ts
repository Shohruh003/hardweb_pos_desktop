// Sklad (ombor) bo'limi uchun sof yordamchilar: o'lchov birliklari, ruxsatlar, miqdor/narx matni,
// narx kiritish rejimi va Excel (CSV) eksporti. Hisob-kitob qoidalari — shared/inventory (server bilan bir xil).
import { Product, ProductUnit, hasCapability, roundStockCost, roundStockQty, stockValue } from '@hardweb-pos/shared';
import { formatSum } from '../../../components/ui';
import { buildCsv, downloadCsv, todayKey } from '../../../components/reports/reportUtils';

export const UNITS: { value: ProductUnit; short: string; long: string }[] = [
  { value: ProductUnit.Kg, short: 'kg', long: 'kilogramm' },
  { value: ProductUnit.Gram, short: 'g', long: 'gramm' },
  { value: ProductUnit.Litr, short: 'l', long: 'litr' },
  { value: ProductUnit.Ml, short: 'ml', long: 'millilitr' },
  { value: ProductUnit.Dona, short: 'dona', long: 'dona' },
];

// ---- Ruxsatlar (server bilan bir xil: UI faqat tugmalarni yashiradi, tekshiruv serverda) ----

type UserLike = { role: string; permissions?: string[] } | null | undefined;

const ADMIN_ROLES = new Set<string>(['administrator', 'direktor', 'superadmin']);

/** Administrator / direktor / superadmin */
export function isAdminRole(user: UserLike): boolean {
  return !!user && ADMIN_ROLES.has(user.role);
}

/** Skladga yozish (mahsulot, kirim, chiqim, inventarizatsiya, ta'minotchi): 'inventory' ruxsati yoki admin */
export function canWriteSklad(user: UserLike): boolean {
  return hasCapability(user, 'inventory') || isAdminRole(user);
}

/** Ta'minotchiga to'lovni o'chirish (pul yozuvini bekor qiladi) — faqat admin rollar */
export function canDeleteSupplierPayment(user: UserLike): boolean {
  return isAdminRole(user);
}

// ---- Matnlar ----

/** Server xatosi matni (ApiError o'zbekcha xabar beradi) */
export function errText(e: unknown, fallback = 'Xato'): string {
  const m = (e as Error)?.message;
  return typeof m === 'string' && m ? m : fallback;
}

const groupInt = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Miqdor: "12 500,25" (3 xonagacha, ortiqcha nolsiz, vergul bilan); manfiy — "−2" */
export function qtyText(n: number | string | null | undefined): string {
  const v = roundStockQty(n);
  const [int, frac] = String(Math.abs(v)).split('.');
  return `${v < 0 ? '−' : ''}${groupInt(int)}${frac ? ',' + frac : ''}`;
}

/** Ishorali miqdor: "+2,5" / "−1" / "0" */
export function signedQtyText(n: number | string | null | undefined): string {
  const v = roundStockQty(n);
  return v > 0 ? `+${qtyText(v)}` : qtyText(v);
}

/** Birlik tannarxi: "8 000 so‘m", gramm/ml uchun kichik narx — "0,35 so‘m" (2 xonagacha) */
export function costText(n: number | string | null | undefined): string {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 100 || Number.isInteger(v)) return formatSum(v);
  const r = Math.round(Math.abs(v) * 100) / 100;
  return `${v < 0 ? '−' : ''}${String(r).replace('.', ',')} so‘m`;
}

/** O'rtacha tannarx (birlik uchun, so'm) */
export function productCost(p: Pick<Product, 'avgCost'> | null | undefined): number {
  const v = Number(p?.avgCost);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Ombor qiymati (so'm, butun) */
export function productValue(p: Pick<Product, 'stock' | 'avgCost'>): number {
  return stockValue(Number(p.stock) || 0, productCost(p));
}

/** Kam qolgan: minimal qoldiq belgilangan va qoldiq undan oshmaydi */
export function isLowStock(p: Pick<Product, 'stock' | 'minStock'>): boolean {
  const min = Number(p.minStock) || 0;
  return min > 0 && (Number(p.stock) || 0) <= min;
}

/** Qidiruv uchun: kichik harf, o'zbekcha apostroflarsiz ("Go‘sht" = "gosht") */
export function searchKey(s: string): string {
  return s.toLowerCase().replace(/['‘’`ʻʼ]/g, '').trim();
}

/** Nom bo'yicha takror (katta-kichik harf va chetdagi bo'shliqlarsiz) */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ---- Narx kiritish: birlik narxi yoki jami summa ----
// Pul maydonlari doim butun so'm (raqamlar): "8,000" hech qachon 8 so'm bo'lib qolmaydi. Gramm/ml
// mahsulotda birlik narxi kasr bo'lishi mumkin — shuning uchun "Jami summa" rejimi bor: 25 000 g un
// 150 000 so'mga -> 6 so'm/g aniq hisoblanadi.

export type PriceMode = 'unit' | 'total';

export function resolvePrice(mode: PriceMode, value: string, qty: number): { unitPrice: number; total: number } {
  const n = Number(value) || 0;
  if (mode === 'total') {
    return { unitPrice: qty > 0 ? roundStockCost(n / qty) : 0, total: Math.round(n) };
  }
  return { unitPrice: n, total: Math.round(qty * n) };
}

// ---- Excel (CSV) ----

/** CSV soni: vergulli kasr, minglik ajratgichsiz ("12,5", "8000", "-3") — Excel son sifatida o'qiydi */
export function csvNum(n: number | string | null | undefined, decimals: number): string {
  const f = 10 ** decimals;
  const v = Math.round((Number(n) || 0) * f) / f;
  return String(Object.is(v, -0) ? 0 : v).replace('.', ',');
}

/** Sklad qoldig'i (ko'rinib turgan ro'yxat) — sklad-YYYY-MM-DD.csv (mahalliy sana) */
export function exportProductsCsv(list: Product[]): void {
  const head = ['Mahsulot', 'Birlik', 'Qoldiq', 'Minimal qoldiq', 'O‘rtacha tannarx (so‘m)', 'Ombor qiymati (so‘m)', 'Retseptlarda (taom)'];
  const rows = list.map((p) => [
    p.name,
    p.unit,
    csvNum(p.stock, 3),
    csvNum(p.minStock, 3),
    csvNum(productCost(p), 2),
    csvNum(productValue(p), 0),
    csvNum(p.recipeCount ?? 0, 0),
  ]);
  const total = list.reduce((s, p) => s + productValue(p), 0);
  downloadCsv(`sklad-${todayKey()}.csv`, buildCsv([head, ...rows, ['Jami', '', '', '', '', csvNum(total, 0), '']]));
}
