// Sklad (ombor) — 0.3.3 shartnomasi: server, ekranlar va demo (mock) bir xil turlar, qoidalar va
// xabarlar bilan ishlaydi. Sklad ixtiyoriy modul: retsepti yo'q taomlar va mahsuloti yo'q restoran
// uchun hech narsa o'zgarmaydi (tekshiruv ham, ayirish ham yo'q).
import { ProductUnit } from './enums';

/** Ombor harakati turi — har bir qoldiq o'zgarishi jurnalga shu tur bilan yoziladi */
export type StockMovementType =
  | 'initial' // boshlang'ich qoldiq (mahsulot yaratilganda yoki Sklad jurnali boshlanganda)
  | 'purchase' // kirim — ta'minotchidan qabul qilindi (+)
  | 'return' // ta'minotchiga qaytarildi (−)
  | 'writeoff' // chiqim — hisobdan chiqarildi: buzildi, yo'qoldi, xodim ovqati (−)
  | 'adjust' // qo'lda tuzatish (+/−)
  | 'count' // inventarizatsiya — sanalgan haqiqiy qoldiqqa moslandi (+/−)
  | 'production_out' // ishlab chiqarish: ketgan mahsulot (−)
  | 'production_in' // ishlab chiqarish: tayyor (yarim tayyor) mahsulot (+)
  | 'sale' // sotuv — to'lovda taom retsepti bo'yicha ayirildi (−)
  | 'refund'; // vozvrat qilingan chek mahsulotlari skladga qaytarildi (+)

export const STOCK_MOVEMENT_TYPES: StockMovementType[] = [
  'initial',
  'purchase',
  'return',
  'writeoff',
  'adjust',
  'count',
  'production_out',
  'production_in',
  'sale',
  'refund',
];

/** Harakat turlari nomi (jurnal, filtr) */
export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  initial: 'Boshlang‘ich qoldiq',
  purchase: 'Kirim',
  return: 'Ta’minotchiga qaytarish',
  writeoff: 'Chiqim (hisobdan chiqarish)',
  adjust: 'Tuzatish',
  count: 'Inventarizatsiya',
  production_out: 'Ishlab chiqarishga ketdi',
  production_in: 'Ishlab chiqarildi',
  sale: 'Sotuv',
  refund: 'Vozvratdan qaytdi',
};

/** Ombor harakati (GET /inventory/movements) */
export interface StockMovement {
  id: string;
  productId: string;
  /** mahsulot nomi va birligi harakat paytidagi holatda (mahsulot keyin o'zgarsa/o'chsa ham) */
  productName: string;
  unit: ProductUnit;
  type: StockMovementType;
  /** ishorali miqdor: + kirdi, − chiqdi (3 xonagacha) */
  quantity: number;
  /** harakatdan keyingi qoldiq */
  balanceAfter: number;
  /** shu paytdagi birlik tannarxi (so'm; kirimda — kirim narxi) */
  unitCost: number;
  /** bog'liq hujjat: buyurtma id (sale/refund), kirim id (purchase/return), partiya id (count/production) */
  reference?: string | null;
  /** odam o'qiydigan nom: "Stol 5 · №12", "Kirim: Baraka" … */
  referenceLabel?: string | null;
  note?: string | null;
  userName?: string | null;
  createdAt: string; // ISO
}

export interface PaginatedMovements {
  items: StockMovement[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/** Ta'minotchi (GET /inventory/suppliers) — balansi bilan */
export interface Supplier {
  id: string;
  name: string;
  phone?: string | null;
  note?: string | null;
  /** olingan: kirimlar − qaytarilganlar (so'm) */
  purchased: number;
  /** to'langan (so'm) */
  paid: number;
  /** qarz = purchased − paid (manfiy — oldindan to'langan) */
  debt: number;
  purchasesCount: number;
  lastPurchaseAt?: string | null;
}

/** Ta'minotchiga to'lov (GET /inventory/supplier-payments) */
export interface SupplierPayment {
  id: string;
  supplierId: string | null;
  supplierName: string;
  amount: number;
  note?: string | null;
  userName?: string | null;
  createdAt: string;
}

// ---- Xabarlar (server 400/404 va UI — aynan bir xil matn) ----
export const PRODUCT_NOT_FOUND_MESSAGE = 'Mahsulot topilmadi';
export const PRODUCT_NAME_REQUIRED_MESSAGE = 'Mahsulot nomini kiriting';
export const PRODUCT_NAME_TAKEN_MESSAGE = 'Bunday nomli mahsulot bor';
export const STOCK_QTY_POSITIVE_MESSAGE = 'Miqdor 0 dan katta bo‘lishi kerak';
export const STOCK_QTY_INVALID_MESSAGE = 'Miqdor noto‘g‘ri';
export const STOCK_PRICE_INVALID_MESSAGE = 'Narx noto‘g‘ri (0 yoki musbat son)';
export const STOCK_UNIT_LOCKED_MESSAGE =
  'O‘lchov birligini o‘zgartirib bo‘lmaydi — mahsulot bo‘yicha harakatlar bor (kerak bo‘lsa yangi mahsulot qo‘shing)';
export const productInRecipesMessage = (count: number) =>
  `Mahsulot ${count} ta taom retseptida ishlatilgan — avval retseptlardan olib tashlang`;
export const stockNotEnoughMessage = (name: string, available: number, unit: string) =>
  `Omborda yetarli emas: ${name} — mavjud ${formatStockQty(Math.max(0, available))} ${unit}`;
export const COUNT_ITEMS_REQUIRED_MESSAGE = 'Sanalgan mahsulotlarni kiriting';
export const COUNT_VALUE_INVALID_MESSAGE = 'Sanalgan qoldiq noto‘g‘ri (0 yoki musbat son)';
export const PRODUCTION_OUTPUT_REQUIRED_MESSAGE = 'Tayyor mahsulot va uning miqdorini kiriting';
export const PRODUCTION_INPUTS_REQUIRED_MESSAGE = 'Ishlab chiqarishga ketgan mahsulotlarni kiriting';
export const PRODUCTION_SELF_MESSAGE = 'Tayyor mahsulot ketgan mahsulotlar ichida bo‘lmasligi kerak';
export const SUPPLIER_NOT_FOUND_MESSAGE = 'Ta’minotchi topilmadi';
export const SUPPLIER_NAME_REQUIRED_MESSAGE = 'Ta’minotchi nomini kiriting';
export const SUPPLIER_NAME_TAKEN_MESSAGE = 'Bunday nomli ta’minotchi bor';
export const SUPPLIER_IN_USE_MESSAGE = 'Ta’minotchida kirim yoki to‘lovlar bor — o‘chirib bo‘lmaydi';
export const SUPPLIER_PAYMENT_AMOUNT_MESSAGE = 'To‘lov summasi 0 dan katta bo‘lishi kerak';
export const SUPPLIER_PAYMENT_NOT_FOUND_MESSAGE = 'To‘lov topilmadi';

// ---- Sof qoidalar (server va demo bir xil hisoblaydi) ----

/** Ombor miqdori aniqligi — 3 xona (ustun shkalasi) */
export const STOCK_QTY_DECIMALS = 3;
/** Birlik tannarxi aniqligi — 4 xona (gramm/ml uchun 1 so'mdan kichik bo'lishi mumkin) */
export const STOCK_COST_DECIMALS = 4;

export function roundStockQty(n: number | string | null | undefined): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1000) / 1000;
}

export function roundStockCost(n: number | string | null | undefined): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10_000) / 10_000;
}

/** Miqdorni ko'rsatish: "1,5", "0,25", "12" (ortiqcha nolsiz, vergul bilan) */
export function formatStockQty(n: number | string | null | undefined): string {
  return String(roundStockQty(n)).replace('.', ',');
}

/**
 * O'rtacha og'irlikdagi tannarx (moving average) — kirim (yoki ishlab chiqarish) qo'shilganda.
 * Narx 0 (yoki noma'lum) bo'lsa — tannarx o'zgarmaydi (bepul/noma'lum narxli kirim o'rtachani
 * buzmasin). Manfiy qoldiq o'rtachaga 0 deb olinadi (oldin hisobsiz sotilgan mahsulot).
 */
export function nextAvgCost(stockBefore: number, avgBefore: number, qty: number, unitPrice: number): number {
  const q = Number(qty);
  const price = Number(unitPrice);
  const avg = Number(avgBefore) || 0;
  if (!(q > 0) || !(price > 0)) return roundStockCost(avg);
  const base = Math.max(0, Number(stockBefore) || 0);
  const totalQty = base + q;
  if (!(totalQty > 0)) return roundStockCost(price);
  return roundStockCost((base * avg + q * price) / totalQty);
}

/** Ombor qiymati (so'm, butun): qoldiq × tannarx; manfiy qoldiq — 0 */
export function stockValue(stock: number, avgCost: number): number {
  return Math.round(Math.max(0, Number(stock) || 0) * Math.max(0, Number(avgCost) || 0));
}
