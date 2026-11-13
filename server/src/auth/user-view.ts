import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import {
  ALL_CAPABILITY_KEYS,
  isFullAccessRole,
  User,
  UserRole,
} from '@hardweb-pos/shared';
import { UserEntity } from '../entities';

// ---- Auth/Users modullari uchun umumiy yordamchilar ----

/** Token yaroqsiz (xodim o'chirilgan/bloklangan yoki token buzilgan) — renderer buni "sessiya tugadi" deb ko'rsatadi */
export const SESSION_INVALID_MESSAGE = 'Sessiya yaroqsiz — qayta kiring';

/** Ruxsat yo'q — loyiha bo'ylab bir xil matn (RolesGuard bilan bir xil) */
export const FORBIDDEN_MESSAGE = 'Bu amal uchun ruxsat yo‘q';

/** bcrypt "cost" — seed bilan bir xil (10) */
export const BCRYPT_COST = 10;

/** req.user shakli — JwtStrategy.validate() qaytaradi, controller'lar shundan foydalanadi */
export interface RequestUser {
  id: string;
  role: UserRole;
  name: string;
  permissions: string[];
}

/** Amaldagi ruxsatlar: Direktor/SuperAdmin — barchasi, qolganlar — bazadagi ro'yxat */
export function effectivePermissions(
  user: Pick<UserEntity, 'role' | 'permissions'>,
): string[] {
  return isFullAccessRole(user.role)
    ? [...ALL_CAPABILITY_KEYS]
    : [...(user.permissions ?? [])];
}

/** Sessiya javobidagi foydalanuvchi (login, login-pin, me, change-password) — PIN va parol xeshisiz */
export function toSessionUser(user: UserEntity): User {
  return {
    id: user.id,
    name: user.name,
    role: user.role as UserRole,
    login: user.login ?? null,
    active: !!user.active,
    permissions: effectivePermissions(user),
    hasPassword: !!user.passwordHash,
    mustChangePassword: !!user.mustChangePassword,
  };
}

/** Xodimlar ro'yxati qatori (GET/POST/PATCH /users) — PIN ko'rinadi (admin xodimga aytadi), parol xeshi hech qachon */
export function toStaffRow(user: UserEntity): User {
  return {
    id: user.id,
    name: user.name,
    role: user.role as UserRole,
    login: user.login ?? null,
    pin: user.pin ?? null,
    active: !!user.active,
    permissions: [...(user.permissions ?? [])],
    hasPassword: !!user.passwordHash,
    mustChangePassword: !!user.mustChangePassword,
  };
}

/** bcrypt solishtirish — buzilgan/eski formatdagi xesh xato bermasin, shunchaki "mos emas" */
export async function safeCompare(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** JWT kaliti — modul (imzolash) va strategiya (tekshirish) bir xil qiymatni olishi shart */
export function jwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  return secret ? secret : 'dev-secret';
}

/**
 * Token amal qilish muddati: standart 24 soat (smena + zaxira), JWT_EXPIRES_IN bilan almashtiriladi.
 * Faqat raqam berilsa (masalan "86400") — soniya deb olinadi (jsonwebtoken satrni millisekund deb tushunadi).
 */
export function jwtExpiresIn(config: ConfigService): string | number {
  const raw = (config.get<string>('JWT_EXPIRES_IN') ?? '').toString().trim();
  if (!raw) return '24h';
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}
