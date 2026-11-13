import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { UserRole } from '@hardweb-pos/shared';

/** PIN: faqat raqamlar, 4–10 ta (ustun varchar(10)) */
export const PIN_PATTERN = /^\d{4,10}$/;
/** Login: 3–32 belgi — lotin harflari, raqamlar, nuqta, pastki chiziq, defis */
export const LOGIN_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 64;
export const NAME_MAX = 80;

const NAME_MESSAGE = `Ism kiriting (1–${NAME_MAX} belgi)`;
const ROLE_MESSAGE = 'Rol noto‘g‘ri';
const PIN_MESSAGE = 'PIN 4–10 ta raqamdan iborat bo‘lishi kerak';
const LOGIN_MESSAGE =
  'Login 3–32 belgi bo‘lishi kerak: lotin harflari, raqamlar, nuqta (.), _ yoki -';
const PASSWORD_MESSAGE = `Parol ${PASSWORD_MIN}–${PASSWORD_MAX} ta belgidan iborat bo‘lishi kerak`;
const PERMISSIONS_MESSAGE = 'Ruxsatlar ro‘yxat ko‘rinishida bo‘lishi kerak';

/** Qiymat berilganmi: undefined, null va bo'sh satr — "berilmagan" */
export function isGiven(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/** Satrlarning boshi/oxiridagi bo'sh joylarni olib tashlash (telefon klaviaturasi qo'shib yuboradi) */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Maydonlar semantikasi:
//  pin      — berilmasa/bo'sh: (create) PIN'siz, (update) o'zgarmaydi; aks holda 4–10 raqam, unikal
//  login    — faqat Direktor/SuperAdmin beradi; (update) berilmasa o'zgarmaydi, null/'' — login
//             (va u bilan birga parol) olib tashlanadi; katta-kichik harfdan qat'i nazar unikal
//  password — faqat Direktor/SuperAdmin beradi; berilmasa/bo'sh — o'zgarmaydi; bcrypt bilan saqlanadi
//  permissions — ma'lum ruxsat kalitlari (CAPABILITIES); noma'lumlari tashlab yuboriladi

export class CreateUserDto {
  @Transform(trim)
  @IsString({ message: NAME_MESSAGE })
  @MinLength(1, { message: NAME_MESSAGE })
  @MaxLength(NAME_MAX, { message: NAME_MESSAGE })
  name: string;

  @IsEnum(UserRole, { message: ROLE_MESSAGE })
  role: UserRole;

  // Direktor/SuperAdmin uchun shart emas (ular PIN bilan kira olmaydi)
  @Transform(trim)
  @ValidateIf((o) => isGiven(o.pin))
  @IsString({ message: PIN_MESSAGE })
  @Matches(PIN_PATTERN, { message: PIN_MESSAGE })
  pin?: string | null;

  @Transform(trim)
  @ValidateIf((o) => isGiven(o.login))
  @IsString({ message: LOGIN_MESSAGE })
  @Matches(LOGIN_PATTERN, { message: LOGIN_MESSAGE })
  login?: string | null;

  @ValidateIf((o) => isGiven(o.password))
  @IsString({ message: PASSWORD_MESSAGE })
  @MinLength(PASSWORD_MIN, { message: PASSWORD_MESSAGE })
  @MaxLength(PASSWORD_MAX, { message: PASSWORD_MESSAGE })
  password?: string | null;

  @IsOptional()
  @IsArray({ message: PERMISSIONS_MESSAGE })
  @IsString({ each: true, message: PERMISSIONS_MESSAGE })
  permissions?: string[] | null;
}

export class UpdateUserDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: NAME_MESSAGE })
  @MinLength(1, { message: NAME_MESSAGE })
  @MaxLength(NAME_MAX, { message: NAME_MESSAGE })
  name?: string;

  @IsOptional()
  @IsEnum(UserRole, { message: ROLE_MESSAGE })
  role?: UserRole;

  @IsOptional()
  @IsBoolean({ message: 'Faollik qiymati noto‘g‘ri' })
  active?: boolean;

  @Transform(trim)
  @ValidateIf((o) => isGiven(o.pin))
  @IsString({ message: PIN_MESSAGE })
  @Matches(PIN_PATTERN, { message: PIN_MESSAGE })
  pin?: string | null;

  @Transform(trim)
  @ValidateIf((o) => isGiven(o.login))
  @IsString({ message: LOGIN_MESSAGE })
  @Matches(LOGIN_PATTERN, { message: LOGIN_MESSAGE })
  login?: string | null;

  @ValidateIf((o) => isGiven(o.password))
  @IsString({ message: PASSWORD_MESSAGE })
  @MinLength(PASSWORD_MIN, { message: PASSWORD_MESSAGE })
  @MaxLength(PASSWORD_MAX, { message: PASSWORD_MESSAGE })
  password?: string | null;

  @IsOptional()
  @IsArray({ message: PERMISSIONS_MESSAGE })
  @IsString({ each: true, message: PERMISSIONS_MESSAGE })
  permissions?: string[] | null;
}
