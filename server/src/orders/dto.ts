import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ORDER_TYPES,
  OrderStatus,
  OrderType,
  SETTABLE_ORDER_STATUSES,
} from '@hardweb-pos/shared';
import {
  ADDRESS_MAX_LENGTH,
  ADDRESS_REQUIRED_MESSAGE,
  ADDRESS_TOO_LONG_MESSAGE,
  CHECK_NO_INVALID_MESSAGE,
  DELIVERY_FEE_INVALID_MESSAGE,
  DELIVERY_FEE_MAX,
  DISCOUNT_PERCENT_MESSAGE,
  ITEM_LINE_NOT_FOUND_MESSAGE,
  ITEM_QTY_INVALID_MESSAGE,
  MAX_CHECK_NO,
  MENU_ITEM_INVALID_MESSAGE,
  NO_ITEMS_MESSAGE,
  ORDER_NOT_FOUND_MESSAGE,
  ORDER_TYPE_INVALID_MESSAGE,
  PAYMENT_AMOUNT_INVALID_MESSAGE,
  PAYMENT_TYPE_INVALID_MESSAGE,
  PHONE_INVALID_MESSAGE,
  PRICE_INVALID_MESSAGE,
  PRICE_MAX,
  QTY_DECIMALS,
  SERVICE_PERCENT_MESSAGE,
  SPLIT_QTY_INVALID_MESSAGE,
  TABLE_REQUIRED_MESSAGE,
  VOID_QTY_INVALID_MESSAGE,
  VOID_REASON_MAX_LENGTH,
  VOID_REASON_TOO_LONG_MESSAGE,
} from './order-rules';

/** Qiymat berilganmi (null / undefined / '' — berilmagan hisoblanadi) */
const given = (v: unknown) => v !== undefined && v !== null && v !== '';

/** Eng kichik musbat miqdor (kg — 6 xonagacha) */
const MIN_QTY = 1 / 10 ** QTY_DECIMALS;

export class CreateOrderItemDto {
  @IsUUID('all', { message: MENU_ITEM_INVALID_MESSAGE })
  menuItemId: string;

  // Miqdor — dona uchun butun, kg uchun kasr (6 xonagacha: 0.5, 1.106667). Birlikka mosligini
  // (dona — butun) servis menyudagi taom bo'yicha tekshiradi.
  @IsNumber(
    { maxDecimalPlaces: QTY_DECIMALS, allowNaN: false, allowInfinity: false },
    { message: ITEM_QTY_INVALID_MESSAGE },
  )
  @Min(MIN_QTY, { message: ITEM_QTY_INVALID_MESSAGE })
  quantity: number;

  @IsOptional()
  @IsString()
  note?: string;

  // Stoldagi buyurtmada "olib ketish" (saboy) qatori — xizmat haqi olinmaydi.
  // Olib ketish / yetkazish buyurtmalarida e'tiborsiz (butun buyurtma saboy).
  @IsOptional()
  @IsBoolean()
  takeaway?: boolean;

  // Qo'lda o'zgartirilgan narx (bir birlik uchun) — faqat 'cashier' yoki 'void' ruxsati bilan
  // (aks holda 403); menyudagi narxga teng bo'lsa — o'zgartirish hisoblanmaydi.
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: PRICE_INVALID_MESSAGE })
  @Min(0, { message: PRICE_INVALID_MESSAGE })
  @Max(PRICE_MAX, { message: PRICE_INVALID_MESSAGE })
  price?: number;
}

export class CreateOrderDto {
  // Buyurtma turi: 'stol' (standart) | 'olib_ketish' | 'yetkazish'
  @IsOptional()
  @IsIn(ORDER_TYPES, { message: ORDER_TYPE_INVALID_MESSAGE })
  type?: OrderType;

  // Stol — faqat 'stol' turida majburiy (yo'q bo'lsa servis 400 'Stol tanlanmagan' qaytaradi).
  // Olib ketish / yetkazishda e'tiborsiz — shuning uchun u turlarda tekshirilmaydi ham.
  @ValidateIf(
    (o: CreateOrderDto) =>
      (o.type ?? OrderType.DineIn) === OrderType.DineIn && given(o.tableId),
  )
  @IsUUID('all', { message: TABLE_REQUIRED_MESSAGE })
  tableId?: string;

  // Mavjud OCHIQ buyurtmaga (istalgan turdagi) taom qo'shish — aynan shu buyurtmaga
  @ValidateIf((o: CreateOrderDto) => given(o.orderId))
  @IsUUID('all', { message: ORDER_NOT_FOUND_MESSAGE })
  orderId?: string;

  // Stolda qaysi hisob (1..20): shu raqamli ochiq hisob bo'lsa — unga qo'shiladi, bo'lmasa aynan
  // shu raqam bilan yangi hisob ochiladi. Faqat 'stol' turida (orderId'siz) ma'noli.
  @ValidateIf((o: CreateOrderDto) => given(o.checkNo))
  @IsInt({ message: CHECK_NO_INVALID_MESSAGE })
  @Min(1, { message: CHECK_NO_INVALID_MESSAGE })
  @Max(MAX_CHECK_NO, { message: CHECK_NO_INVALID_MESSAGE })
  checkNo?: number;

  // true — stolda keyingi bo'sh raqamli YANGI hisob ochiladi ("+ Yangi hisob")
  @IsOptional()
  @IsBoolean()
  newCheck?: boolean;

  // Buyurtmani qaysi ofitsiant qabul qildi (terminal ro'yxatdan tanlaydi).
  // Berilmasa, tizimga kirgan foydalanuvchi hisoblanadi.
  @IsOptional()
  @IsUUID()
  waiterId?: string;

  @IsArray({ message: NO_ITEMS_MESSAGE })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  // Mijoz telefoni: yetkazishda majburiy, olib ketishda ixtiyoriy (servis normallashtiradi).
  // Stolga buyurtmada e'tiborsiz — shuning uchun faqat olib ketish / yetkazishda tekshiriladi.
  @ValidateIf(
    (o: CreateOrderDto) =>
      o.phone != null && (o.type === OrderType.Takeaway || o.type === OrderType.Delivery),
  )
  @IsString({ message: PHONE_INVALID_MESSAGE })
  phone?: string;

  // Yetkazish manzili (yetkazishda majburiy; boshqa turlarda e'tiborsiz)
  @ValidateIf((o: CreateOrderDto) => o.address != null && o.type === OrderType.Delivery)
  @IsString({ message: ADDRESS_REQUIRED_MESSAGE })
  @MaxLength(ADDRESS_MAX_LENGTH, { message: ADDRESS_TOO_LONG_MESSAGE })
  address?: string;

  // Yetkazish narxi (butun so'm) — faqat yangi yetkazishda; berilmasa sozlamadagi standart narx
  @ValidateIf((o: CreateOrderDto) => o.deliveryFee != null && o.type === OrderType.Delivery)
  @IsInt({ message: DELIVERY_FEE_INVALID_MESSAGE })
  @Min(0, { message: DELIVERY_FEE_INVALID_MESSAGE })
  @Max(DELIVERY_FEE_MAX, { message: DELIVERY_FEE_INVALID_MESSAGE })
  deliveryFee?: number;

  // Takroriy yuborishdan himoya (oflayn navbat / tarmoq uzilishi): bir xil id bilan kelgan so'rov
  // 24 soat ichida YANGI buyurtma yaratmaydi — avvalgi natija qaytadi.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientRequestId?: string;
}

// PATCH /orders/:id/delivery — yetkazish ma'lumotlarini o'zgartirish (faqat berilgan maydonlar)
export class DeliveryInfoDto {
  @ValidateIf((o: DeliveryInfoDto) => o.phone != null)
  @IsString({ message: PHONE_INVALID_MESSAGE })
  phone?: string;

  @ValidateIf((o: DeliveryInfoDto) => o.address != null)
  @IsString({ message: ADDRESS_REQUIRED_MESSAGE })
  @MaxLength(ADDRESS_MAX_LENGTH, { message: ADDRESS_TOO_LONG_MESSAGE })
  address?: string;

  // Izoh (buyurtma izohi — oshxona chekida ham chiqadi); bo'sh/null — o'chiriladi
  @IsOptional()
  @IsString()
  note?: string | null;

  // Yetkazish narxi (butun so'm)
  @ValidateIf((o: DeliveryInfoDto) => o.deliveryFee != null)
  @IsInt({ message: DELIVERY_FEE_INVALID_MESSAGE })
  @Min(0, { message: DELIVERY_FEE_INVALID_MESSAGE })
  @Max(DELIVERY_FEE_MAX, { message: DELIVERY_FEE_INVALID_MESSAGE })
  deliveryFee?: number;
}

export class SetNoteDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class SetCustomerDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

// Oshxona (KDS) qo'yadigan holatlar: qabul_qilindi | tayyorlanmoqda | tayyor.
// "yopildi" bu ro'yxatda yo'q — buyurtma faqat to'liq to'lov orqali yopiladi.
export class UpdateOrderStatusDto {
  @IsIn(SETTABLE_ORDER_STATUSES, { message: 'Noto‘g‘ri buyurtma holati' })
  status: OrderStatus;
}

// Otkaz qilinadigan qator va miqdor (qisman: 3 tadan 1 tasi)
export class VoidItemDto {
  @IsUUID('all', { message: ITEM_LINE_NOT_FOUND_MESSAGE })
  orderItemId: string;

  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: VOID_QTY_INVALID_MESSAGE })
  quantity: number;
}

// POST /orders/:id/remove-items — otkaz: items (qator + miqdor) yoki eski shakl itemIds (butun qator)
export class RemoveItemsDto {
  @IsOptional()
  @IsArray({ message: 'Olib tashlanadigan taomlar ro‘yxati noto‘g‘ri' })
  @ValidateNested({ each: true })
  @Type(() => VoidItemDto)
  items?: VoidItemDto[];

  @IsOptional()
  @IsArray({ message: 'Olib tashlanadigan taomlar ro‘yxati noto‘g‘ri' })
  @IsUUID('all', { each: true, message: 'Taom qatori identifikatori noto‘g‘ri' })
  itemIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(VOID_REASON_MAX_LENGTH, { message: VOID_REASON_TOO_LONG_MESSAGE })
  reason?: string;
}

// POST /orders/:id/cancel — butun hisobni bekor qilish (sababi bilan)
export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(VOID_REASON_MAX_LENGTH, { message: VOID_REASON_TOO_LONG_MESSAGE })
  reason?: string;
}

// Hisobni bo'lishda ko'chiriladigan qator va miqdor
export class SplitItemDto {
  @IsUUID('all', { message: ITEM_LINE_NOT_FOUND_MESSAGE })
  orderItemId: string;

  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: SPLIT_QTY_INVALID_MESSAGE })
  quantity: number;
}

// POST /orders/:id/split — tanlangan taomlarni yangi (yoki shu stoldagi boshqa) hisobga ko'chirish
export class SplitOrderDto {
  @IsArray({ message: SPLIT_QTY_INVALID_MESSAGE })
  @ValidateNested({ each: true })
  @Type(() => SplitItemDto)
  items: SplitItemDto[];

  @ValidateIf((o: SplitOrderDto) => given(o.targetOrderId))
  @IsUUID('all', { message: ORDER_NOT_FOUND_MESSAGE })
  targetOrderId?: string;
}

// Buyurtmani boshqa stolga ko'chirish (smenit stol)
export class MoveTableDto {
  @IsUUID('all', { message: 'Yangi stol tanlanmagan' })
  tableId: string;
}

// Buyurtma ofitsiantini almashtirish (smenit ofitsant)
export class ChangeWaiterDto {
  @IsUUID('all', { message: 'Ofitsiant tanlanmagan' })
  waiterId: string;
}

// POST /orders/:id/change-type — buyurtma turini o'zgartirish (Stolga / Olib ketish / Yetkazib berish)
export class ChangeOrderTypeDto {
  @IsIn(ORDER_TYPES, { message: ORDER_TYPE_INVALID_MESSAGE })
  type: OrderType;

  @ValidateIf((o: ChangeOrderTypeDto) => o.type === OrderType.DineIn && given(o.tableId))
  @IsUUID('all', { message: TABLE_REQUIRED_MESSAGE })
  tableId?: string;

  @ValidateIf((o: ChangeOrderTypeDto) => given(o.checkNo))
  @IsInt({ message: CHECK_NO_INVALID_MESSAGE })
  @Min(1, { message: CHECK_NO_INVALID_MESSAGE })
  @Max(MAX_CHECK_NO, { message: CHECK_NO_INVALID_MESSAGE })
  checkNo?: number;

  @ValidateIf((o: ChangeOrderTypeDto) => o.phone != null && o.type !== OrderType.DineIn)
  @IsString({ message: PHONE_INVALID_MESSAGE })
  phone?: string;

  @ValidateIf((o: ChangeOrderTypeDto) => o.address != null && o.type === OrderType.Delivery)
  @IsString({ message: ADDRESS_REQUIRED_MESSAGE })
  @MaxLength(ADDRESS_MAX_LENGTH, { message: ADDRESS_TOO_LONG_MESSAGE })
  address?: string;
}

// Vozvrat (to'langan chekni qaytarish): sabab va (ixtiyoriy) mahsulotlarni skladga qaytarish
export class RefundDto {
  @IsOptional()
  @IsString({ message: 'Vozvrat sababi matn bo‘lishi kerak' })
  reason?: string;

  // true — chekdagi taomlar retsepti bo'yicha ayirilgan mahsulotlar skladga qaytadi (standart: yo'q —
  // tayyor taom odatda skladga qaytmaydi)
  @IsOptional()
  @IsBoolean({ message: 'Skladga qaytarish belgisi noto‘g‘ri' })
  returnStock?: boolean;
}

export class ExciseCodeItemDto {
  @IsUUID()
  orderItemId: string;

  @IsString()
  code: string;
}

export class AddExciseDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExciseCodeItemDto)
  codes: ExciseCodeItemDto[];
}

// Qarzga to'lovda — qarzdor (majburiy ism, ixtiyoriy telefon)
export class DebtorDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}

export class PayOrderDto {
  // To'lov usuli kaliti (sozlamadagi FAOL usul: 'naqd', 'karta', 'click', 'payme', 'qarz' yoki maxsus)
  @IsString({ message: PAYMENT_TYPE_INVALID_MESSAGE })
  @MaxLength(32, { message: PAYMENT_TYPE_INVALID_MESSAGE })
  type: string;

  // Bo'lib to'lash uchun to'lov summasi. Berilmasa — qolgan summa to'liq to'lanadi.
  // Server butun so'mga yaxlitlaydi (roundSum).
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: PAYMENT_AMOUNT_INVALID_MESSAGE })
  @Min(0, { message: PAYMENT_AMOUNT_INVALID_MESSAGE })
  amount?: number;

  // Chegirma foizi (TZ F-3.3), 0-100. Berilsa — buyurtmada saqlanadi; berilmasa — saqlangan foiz
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: DISCOUNT_PERCENT_MESSAGE })
  @Min(0, { message: DISCOUNT_PERCENT_MESSAGE })
  @Max(100, { message: DISCOUNT_PERCENT_MESSAGE })
  discountPercent?: number;

  // Xizmat haqi foizi (TZ F-3.3). Berilsa — saqlanadi; berilmasa — buyurtmadagi foiz (stolga
  // yaratilganda zal foizi) ishlatiladi, hech qachon jimgina 0 ga tushmaydi
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: SERVICE_PERCENT_MESSAGE })
  @Min(0, { message: SERVICE_PERCENT_MESSAGE })
  @Max(100, { message: SERVICE_PERCENT_MESSAGE })
  serviceFeePercent?: number;

  // 'Qarzga' (debt) usulida — qarzdor
  @IsOptional()
  @ValidateNested()
  @Type(() => DebtorDto)
  debtor?: DebtorDto;
}

// Bir nechta usul bilan birdaniga to'lashdagi bitta to'lov
export class PayMultiItemDto {
  @IsString({ message: PAYMENT_TYPE_INVALID_MESSAGE })
  @MaxLength(32, { message: PAYMENT_TYPE_INVALID_MESSAGE })
  type: string;

  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: PAYMENT_AMOUNT_INVALID_MESSAGE })
  amount: number;
}

// POST /orders/:id/pay-multi — masalan 20 000 naqd + 8 620 Click (bitta tranzaksiya)
export class PayMultiDto {
  @IsArray({ message: PAYMENT_AMOUNT_INVALID_MESSAGE })
  @ValidateNested({ each: true })
  @Type(() => PayMultiItemDto)
  payments: PayMultiItemDto[];

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: DISCOUNT_PERCENT_MESSAGE })
  @Min(0, { message: DISCOUNT_PERCENT_MESSAGE })
  @Max(100, { message: DISCOUNT_PERCENT_MESSAGE })
  discountPercent?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: SERVICE_PERCENT_MESSAGE })
  @Min(0, { message: SERVICE_PERCENT_MESSAGE })
  @Max(100, { message: SERVICE_PERCENT_MESSAGE })
  serviceFeePercent?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => DebtorDto)
  debtor?: DebtorDto;
}

// PATCH /orders/:id/items/:itemId/price — yuborilgan qator narxini o'zgartirish (faqat 'void' ruxsati)
export class ItemPriceDto {
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: PRICE_INVALID_MESSAGE })
  @Min(0, { message: PRICE_INVALID_MESSAGE })
  @Max(PRICE_MAX, { message: PRICE_INVALID_MESSAGE })
  price: number;

  @IsOptional()
  @IsString()
  @MaxLength(VOID_REASON_MAX_LENGTH, { message: VOID_REASON_TOO_LONG_MESSAGE })
  reason?: string;
}
