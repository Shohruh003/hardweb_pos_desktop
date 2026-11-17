// Sklad so'rovlari (0.3.3). Bu yerda — faqat maydonlar ro'yxati (ValidationPipe whitelist: boshqa maydonlar,
// masalan PATCH'dagi `stock`, olib tashlanadi) va tur tekshiruvi. Majburiylik, chegaralar va qoidalar
// servislarda tekshiriladi — xabar bitta matn bo'lib qaytadi (shared'dagi xabarlar bilan aynan bir xil).
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  COUNT_ITEMS_REQUIRED_MESSAGE,
  PRODUCTION_INPUTS_REQUIRED_MESSAGE,
  PRODUCTION_OUTPUT_REQUIRED_MESSAGE,
  PRODUCT_NAME_REQUIRED_MESSAGE,
  PRODUCT_NOT_FOUND_MESSAGE,
  ProductUnit,
  STOCK_PRICE_INVALID_MESSAGE,
  STOCK_QTY_INVALID_MESSAGE,
  STOCK_QTY_POSITIVE_MESSAGE,
  SUPPLIER_NAME_REQUIRED_MESSAGE,
  SUPPLIER_NOT_FOUND_MESSAGE,
  SUPPLIER_PAYMENT_AMOUNT_MESSAGE,
} from '@hardweb-pos/shared';
import { PRODUCT_UNIT_INVALID_MESSAGE } from './inventory-rules';

const TEXT_INVALID_MESSAGE = 'Matn noto‘g‘ri';
const ADJUST_TYPE_INVALID_MESSAGE = 'Harakat turi noto‘g‘ri';

// ---- Mahsulotlar ----

export class CreateProductDto {
  @IsOptional() @IsString({ message: PRODUCT_NAME_REQUIRED_MESSAGE }) name?: string;
  @IsOptional() @IsEnum(ProductUnit, { message: PRODUCT_UNIT_INVALID_MESSAGE }) unit?: ProductUnit;
  @IsOptional() @IsNumber({}, { message: STOCK_QTY_INVALID_MESSAGE }) minStock?: number;
  /** boshlang'ich qoldiq (> 0 bo'lsa — 'initial' harakati) */
  @IsOptional() @IsNumber({}, { message: STOCK_QTY_INVALID_MESSAGE }) stock?: number;
  /** boshlang'ich o'rtacha tannarx */
  @IsOptional() @IsNumber({}, { message: STOCK_PRICE_INVALID_MESSAGE }) unitCost?: number;
}

/** `stock` YO'Q: qoldiq faqat harakatlar (kirim, chiqim, inventarizatsiya…) orqali o'zgaradi */
export class UpdateProductDto {
  @IsOptional() @IsString({ message: PRODUCT_NAME_REQUIRED_MESSAGE }) name?: string;
  @IsOptional() @IsEnum(ProductUnit, { message: PRODUCT_UNIT_INVALID_MESSAGE }) unit?: ProductUnit;
  @IsOptional() @IsNumber({}, { message: STOCK_QTY_INVALID_MESSAGE }) minStock?: number;
}

export class AdjustDto {
  @IsOptional() @IsNumber({}, { message: STOCK_QTY_INVALID_MESSAGE }) delta?: number;
  @IsOptional() @IsIn(['writeoff', 'adjust'], { message: ADJUST_TYPE_INVALID_MESSAGE }) type?: 'writeoff' | 'adjust';
  @IsOptional() @IsString({ message: TEXT_INVALID_MESSAGE }) note?: string;
}

// ---- Inventarizatsiya va ishlab chiqarish (qatorlar servisda tekshiriladi) ----

export class CountDto {
  @IsOptional() @IsArray({ message: COUNT_ITEMS_REQUIRED_MESSAGE }) items?: unknown[];
  @IsOptional() @IsString({ message: TEXT_INVALID_MESSAGE }) note?: string;
}

export class ProductionDto {
  @IsOptional() @IsString({ message: PRODUCTION_OUTPUT_REQUIRED_MESSAGE }) outputProductId?: string;
  @IsOptional() @IsNumber({}, { message: PRODUCTION_OUTPUT_REQUIRED_MESSAGE }) outputQty?: number;
  @IsOptional() @IsArray({ message: PRODUCTION_INPUTS_REQUIRED_MESSAGE }) inputs?: unknown[];
  @IsOptional() @IsString({ message: TEXT_INVALID_MESSAGE }) note?: string;
}

// ---- Kirim / vozvrat ----

export class PurchaseDto {
  @IsOptional() @IsString({ message: PRODUCT_NOT_FOUND_MESSAGE }) productId?: string;
  /** ta'minotchi ro'yxatdan (bo'lishi shart) yoki… */
  @IsOptional() @IsString({ message: SUPPLIER_NOT_FOUND_MESSAGE }) supplierId?: string;
  /** …nomi bilan: mavjudi (katta-kichik harfsiz) topiladi yoki yangisi yaratiladi */
  @IsOptional() @IsString({ message: SUPPLIER_NAME_REQUIRED_MESSAGE }) supplier?: string;
  @IsOptional() @IsNumber({}, { message: STOCK_QTY_POSITIVE_MESSAGE }) quantity?: number;
  /** vozvratda ixtiyoriy: berilmasa (yoki ≤ 0) — o'rtacha tannarx */
  @IsOptional() @IsNumber({}, { message: STOCK_PRICE_INVALID_MESSAGE }) unitPrice?: number;
  @IsOptional() @IsString({ message: TEXT_INVALID_MESSAGE }) note?: string;
}

// ---- Ta'minotchilar ----

export class SupplierDto {
  @IsOptional() @IsString({ message: SUPPLIER_NAME_REQUIRED_MESSAGE }) name?: string;
  @IsOptional() @IsString({ message: TEXT_INVALID_MESSAGE }) phone?: string | null;
  @IsOptional() @IsString({ message: TEXT_INVALID_MESSAGE }) note?: string | null;
}

export class SupplierPaymentDto {
  @IsOptional() @IsString({ message: SUPPLIER_NOT_FOUND_MESSAGE }) supplierId?: string;
  @IsOptional() @IsString({ message: SUPPLIER_NAME_REQUIRED_MESSAGE }) supplier?: string;
  @IsOptional() @IsNumber({}, { message: SUPPLIER_PAYMENT_AMOUNT_MESSAGE }) amount?: number;
  @IsOptional() @IsString({ message: TEXT_INVALID_MESSAGE }) note?: string;
}

// ---- Retsept ----

export class RecipeLineDto {
  @IsUUID('all', { message: PRODUCT_NOT_FOUND_MESSAGE }) productId: string;
  @IsNumber({}, { message: STOCK_QTY_INVALID_MESSAGE }) amount: number;
}

export class SetRecipeDto {
  @IsArray({ message: 'Retsept qatorlari noto‘g‘ri' })
  @ValidateNested({ each: true })
  @Type(() => RecipeLineDto)
  items: RecipeLineDto[];
}

// ---- So'rov parametrlari (GET) — tekshiruvsiz (ValidationPipe interfeysga tegmaydi) ----

export interface MovementsQuery {
  productId?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: string;
  limit?: string;
}

export interface PurchasesQuery {
  productId?: string;
  supplierId?: string;
  from?: string;
  to?: string;
  limit?: string;
}

export interface SupplierPaymentsQuery {
  supplierId?: string;
  limit?: string;
}
