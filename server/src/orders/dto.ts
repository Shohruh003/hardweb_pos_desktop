import {
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus, PaymentType, SETTABLE_ORDER_STATUSES } from '@hardweb-pos/shared';

export class CreateOrderItemDto {
  @IsUUID()
  menuItemId: string;

  // Miqdor — dona uchun butun, kg uchun kasr (0.5, 1.75) bo'lishi mumkin
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateOrderDto {
  @IsUUID()
  tableId: string;

  // Buyurtmani qaysi ofitsiant qabul qildi (terminal ro'yxatdan tanlaydi).
  // Berilmasa, tizimga kirgan foydalanuvchi hisoblanadi.
  @IsOptional()
  @IsUUID()
  waiterId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;
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

// Buyurtmadan olib tashlanadigan taom qatorlari (order_items.id)
export class RemoveItemsDto {
  @IsArray({ message: 'Olib tashlanadigan taomlar ro‘yxati noto‘g‘ri' })
  @IsUUID('all', { each: true, message: 'Taom qatori identifikatori noto‘g‘ri' })
  itemIds: string[];
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

// Vozvrat (to'langan chekni qaytarish) sababi
export class RefundDto {
  @IsOptional()
  @IsString({ message: 'Vozvrat sababi matn bo‘lishi kerak' })
  reason?: string;
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

export class PayOrderDto {
  @IsEnum(PaymentType)
  type: PaymentType;

  // Bo'lib to'lash uchun to'lov summasi. Berilmasa — qolgan summa to'liq to'lanadi.
  // Server butun so'mga yaxlitlaydi (roundSum).
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  // Chegirma foizi (TZ F-3.3), 0-100
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  // Xizmat haqi foizi (TZ F-3.3)
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  serviceFeePercent?: number;
}
