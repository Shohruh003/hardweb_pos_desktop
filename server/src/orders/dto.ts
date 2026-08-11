import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus, PaymentType } from '@hardweb-pos/shared';

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

export class UpdateOrderStatusDto {
  @IsString()
  status: OrderStatus;
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
