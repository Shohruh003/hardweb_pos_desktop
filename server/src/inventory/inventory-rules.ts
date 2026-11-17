// Sklad (0.3.3) — umumiy yordamchilar: nomlar, kiritma tekshiruvi, so'rov parametrlari, sana chegaralari,
// hujjat yorliqlari va javob shakllari. Servislar, controller va v6 ma'lumot migratsiyasi shu yerdan oladi.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager, WhereExpressionBuilder } from 'typeorm';
import {
  OrderType,
  PRODUCT_NOT_FOUND_MESSAGE,
  ProductUnit,
  Purchase,
  STOCK_PRICE_INVALID_MESSAGE,
  StockMovement,
  SupplierPayment,
  orderDisplayName,
  orderTypeOf,
  roundStockCost,
  roundStockQty,
} from '@hardweb-pos/shared';
import { ProductEntity, PurchaseEntity, StockMovementEntity, SupplierPaymentEntity } from '../entities';
import { localBoundToUtc } from '../orders/order-rules';
import { DATE_INVALID_MESSAGE, looseDayBound } from '../reports/report-dates';

/** O'lchov birligi noto'g'ri (shared'da yo'q — faqat server tekshiruvi) */
export const PRODUCT_UNIT_INVALID_MESSAGE = 'O‘lchov birligi noto‘g‘ri (kg, g, l, ml yoki dona)';

// ---- Nomlar va matnlar ----

/** Nom: chetidagi bo'shliqlarsiz, ichidagi ketma-ket bo'shliqlar bitta ("  Baraka   savdo " -> "Baraka savdo") */
export function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

/** Nom kaliti — katta-kichik harf va bo'shliqlar farqi hisobga olinmaydi: "Baraka" = " baraka " */
export function nameKey(value: unknown): string {
  return cleanName(value).toLowerCase();
}

/** Ixtiyoriy matn (izoh, telefon): chetidagi bo'shliqlarsiz; bo'sh yoki matn emas -> null */
export function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s ? s : null;
}

export function isProductUnit(value: unknown): value is ProductUnit {
  return (Object.values(ProductUnit) as string[]).includes(String(value));
}

// ---- Sonlar (JSON'dagi number; satr yoki NaN — noto'g'ri) ----

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
}

/** Musbat miqdor (3 xonagacha yaxlitlangan) — aks holda 400 `message` */
export function positiveQty(value: unknown, message: string): number {
  const q = roundStockQty(finite(value)); // NaN -> 0
  if (!(q > 0)) throw new BadRequestException(message);
  return q;
}

/** 0 dan farqli ishorali miqdor (3 xona) — aks holda 400 `message` */
export function nonZeroQty(value: unknown, message: string): number {
  const q = roundStockQty(finite(value));
  if (q === 0) throw new BadRequestException(message);
  return q;
}

/** 0 yoki musbat miqdor (qoldiq, minimal qoldiq, sanalgan qoldiq) — aks holda 400 `message` */
export function nonNegativeQty(value: unknown, message: string): number {
  const n = finite(value);
  if (!(n >= 0)) throw new BadRequestException(message);
  return roundStockQty(n);
}

/** Narx / tannarx: 0 yoki musbat (4 xona) — aks holda 400 */
export function nonNegativeCost(value: unknown): number {
  const n = finite(value);
  if (!(n >= 0)) throw new BadRequestException(STOCK_PRICE_INVALID_MESSAGE);
  return roundStockCost(n);
}

// ---- Hujjat yorliqlari (jurnaldagi reference_label) ----

/**
 * Buyurtmaning sklad jurnalidagi nomi: orderDisplayName ("Stol 5", "Stol 5 · Hisob 2", "Olib ketish #12"),
 * stolga buyurtmada esa kunlik raqam ham: "Stol 5 · №12" — bitta stolda kun davomida ko'p chek bo'ladi.
 */
export function orderStockLabel(o: {
  type?: OrderType | string | null;
  queueNumber?: number | null;
  tableNumber?: number | null;
  checkNo?: number | null;
}): string {
  const name = orderDisplayName(o);
  const n = Number(o.queueNumber);
  return orderTypeOf(o) === OrderType.DineIn && Number.isInteger(n) && n > 0 ? `${name} · №${n}` : name;
}

/** Kirim hujjati: "Kirim: Baraka" (ta'minotchisiz — "Kirim") */
export function purchaseLabel(supplierName: string): string {
  return supplierName ? `Kirim: ${supplierName}` : 'Kirim';
}

/** Ta'minotchiga qaytarish hujjati: "Vozvrat: Baraka" (ta'minotchisiz — "Vozvrat") */
export function supplierReturnLabel(supplierName: string): string {
  return supplierName ? `Vozvrat: ${supplierName}` : 'Vozvrat';
}

export const COUNT_LABEL = 'Inventarizatsiya';
export const PRODUCTION_LABEL = 'Ishlab chiqarish';

// ---- So'rov parametrlari ----

/** So'rov parametri -> satr (takrorlangan bo'lsa — birinchisi); bo'sh -> undefined */
export function queryStr(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

/** So'rov parametri -> musbat butun son; noto'g'ri bo'lsa — fallback, katta bo'lsa — max */
export function positiveInt(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(queryStr(value)));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * ?from=&to= — mahalliy 'YYYY-MM-DD' yoki 'YYYY-MM-DDTHH:MM' (ikkalasi ham ixtiyoriy, chegaralar kiradi;
 * localBoundToUtc — cheklar tarixi bilan bir xil qoida). Noto'g'ri sana — 400. Ustun datetime() bilan
 * solishtiriladi (bazada soniyali va millisekundli yozuvlar bor); oldidagi qo'pol matn sharti faqat
 * indeksdan foydalanish uchun, natijani o'zgartirmaydi. `column` — QueryBuilder xossasi ('m.createdAt').
 */
export function applyDateRange(qb: WhereExpressionBuilder, column: string, fromRaw: unknown, toRaw: unknown): void {
  const from = queryStr(fromRaw);
  const to = queryStr(toRaw);
  if (from) {
    const at = localBoundToUtc(from, false);
    if (!at) throw new BadRequestException(DATE_INVALID_MESSAGE);
    qb.andWhere(`${column} >= :rangeFromLo AND datetime(${column}) >= :rangeFrom`, {
      rangeFromLo: looseDayBound(at, -1),
      rangeFrom: at,
    });
  }
  if (to) {
    const at = localBoundToUtc(to, true);
    if (!at) throw new BadRequestException(DATE_INVALID_MESSAGE);
    qb.andWhere(`${column} < :rangeToHi AND datetime(${column}) <= :rangeTo`, {
      rangeToHi: looseDayBound(at, 2),
      rangeTo: at,
    });
  }
}

// ---- Baza ----

/** Mahsulot (tranzaksiya ichida) yoki 404 */
export async function productOr404(m: EntityManager, id: unknown): Promise<ProductEntity> {
  const product = typeof id === 'string' && id ? await m.findOne(ProductEntity, { where: { id } }) : null;
  if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
  return product;
}

/** Bazadagi vaqt (Date yoki SQLite UTC matni 'YYYY-MM-DD HH:MM:SS[.SSS]' / ISO) -> ISO; bo'sh -> null */
export function isoOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  let s = String(value).trim();
  // SQLite matni vaqt mintaqasisiz — UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---- Javob shakllari ----

export function toStockMovement(m: StockMovementEntity): StockMovement {
  return {
    id: m.id,
    productId: m.productId,
    productName: m.productName,
    unit: m.unit,
    type: m.type,
    quantity: roundStockQty(m.quantity),
    balanceAfter: roundStockQty(m.balanceAfter),
    unitCost: roundStockCost(m.unitCost),
    reference: m.reference ?? null,
    referenceLabel: m.referenceLabel ?? null,
    note: m.note ?? null,
    userName: m.userName ?? null,
    createdAt: isoOf(m.createdAt) ?? '',
  };
}

export function toPurchase(p: PurchaseEntity): Purchase {
  return {
    id: p.id,
    productId: p.productId,
    productName: p.productName,
    unit: p.unit,
    supplier: p.supplier ?? '',
    supplierId: p.supplierId ?? null,
    quantity: roundStockQty(p.quantity),
    unitPrice: roundStockCost(p.unitPrice),
    total: Number(p.total) || 0,
    note: p.note ?? null,
    createdAt: isoOf(p.createdAt) ?? '',
  };
}

export function toSupplierPayment(p: SupplierPaymentEntity): SupplierPayment {
  return {
    id: p.id,
    supplierId: p.supplierId ?? null,
    supplierName: p.supplier ?? '',
    amount: Number(p.amount) || 0,
    note: p.note ?? null,
    userName: p.userName ?? null,
    createdAt: isoOf(p.createdAt) ?? '',
  };
}
