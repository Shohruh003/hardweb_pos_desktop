// Ruxsatlar (capabilities) — xodim nima qila olishini belgilaydi.
// Rol emas, aynan shu ruxsatlar UI'ni va amallarni boshqaradi.
// Direktor va SuperAdmin — barcha ruxsatlarga ega (avtomatik).
import { UserRole } from './enums';

export interface Capability {
  key: string;
  label: string; // o'zbekcha nom
  group: 'ops' | 'manage'; // operatsion yoki boshqaruv
  icon: string;
}

export const CAPABILITIES: Capability[] = [
  // Operatsion
  { key: 'waiter', label: 'Ofitsiantlik (zakaz)', group: 'ops', icon: '🍽️' },
  { key: 'kitchen', label: 'Oshxona (KDS)', group: 'ops', icon: '🍳' },
  { key: 'cashier', label: 'Kassa (to‘lov)', group: 'ops', icon: '💵' },
  { key: 'revenue', label: 'Tushum / statistikani ko‘rish', group: 'ops', icon: '📈' },
  { key: 'refund', label: 'Vozvrat qilish', group: 'ops', icon: '↩️' },
  { key: 'void', label: 'Otkaz (yuborilgan taom/hisobni bekor qilish)', group: 'ops', icon: '🚫' },
  // Boshqaruv
  { key: 'history', label: 'Cheklar tarixi', group: 'manage', icon: '🧾' },
  { key: 'reports', label: 'Hisobotlar (atchot)', group: 'manage', icon: '📊' },
  { key: 'menu', label: 'Menyu boshqarish', group: 'manage', icon: '📋' },
  { key: 'inventory', label: 'Sklad (ombor)', group: 'manage', icon: '📦' },
  { key: 'customers', label: 'Mijozlar (CRM)', group: 'manage', icon: '🙋' },
  { key: 'stations', label: 'Bo‘limlar (sexlar)', group: 'manage', icon: '🏭' },
  { key: 'tables', label: 'Stollar boshqarish', group: 'manage', icon: '🪑' },
  { key: 'staff', label: 'Xodimlar boshqarish', group: 'manage', icon: '👥' },
  { key: 'devices', label: 'Qurilmalar / printer', group: 'manage', icon: '🖨️' },
  { key: 'terminals', label: 'Terminal (blok) qo‘shish', group: 'manage', icon: '🖥️' },
  { key: 'settings', label: 'Sozlamalar', group: 'manage', icon: '⚙️' },
];

export const ALL_CAPABILITY_KEYS = CAPABILITIES.map((c) => c.key);

/**
 * Rol bo'yicha standart ruxsatlar. Yangi xodim qo'shilganda (yoki ruxsatlari belgilanmagan xodimning
 * roli o'zgarganda) oldindan belgilanadi — direktor keyin xohlagancha o'zgartiradi. Ruxsatsiz xodim
 * tizimga kirsa ham hech narsa qila olmaydi, shuning uchun server ham POST /users'da ruxsatlar
 * berilmasa (yoki bo'sh bo'lsa) shu ro'yxatni qo'llaydi.
 * Direktor/SuperAdmin bu yerda yo'q — ular barcha ruxsatlarga avtomatik ega.
 * Administrator — demo seed'dagi administrator to'plami bilan bir xil.
 */
export const DEFAULT_ROLE_CAPABILITIES: Readonly<Partial<Record<UserRole, readonly string[]>>> = {
  [UserRole.Waiter]: ['waiter'],
  [UserRole.Cook]: ['kitchen'],
  // Kassir olib ketish / yetkazish buyurtmalarini ham o'zi ochadi (ZimZim'dagidek) — 'waiter' ham bor.
  // Otkaz (yuborilgan taomni bekor qilish) — faqat kassir, administrator va direktorda; ofitsiantda YO'Q.
  [UserRole.Cashier]: ['cashier', 'waiter', 'void', 'history', 'revenue'],
  [UserRole.Admin]: [
    'history',
    'reports',
    'menu',
    'inventory',
    'stations',
    'tables',
    'staff',
    'devices',
    'terminals',
    'settings',
    'refund',
    'void',
    'cashier',
  ],
};

/** Rolning standart ruxsatlari (yangi massiv; Direktor/SuperAdmin va noma'lum rol — bo'sh) */
export function defaultCapabilitiesForRole(role: string): string[] {
  return [...(DEFAULT_ROLE_CAPABILITIES[role as UserRole] ?? [])];
}

/**
 * Lavozim bo'yicha HECH QACHON berilmaydigan ruxsatlar (restoran talabi, 0.3.3): ofitsiant kassa,
 * tushum, hisobotlar, cheklar tarixi, otkaz va vozvratga ega bo'la olmaydi — Xodimlarda belgilansa
 * ham. Ofitsiant faqat o'z savdosini ko'radi ("Mening buyurtmalarim"). Bunday ish kerak bo'lsa —
 * xodimga Kassir yoki Administrator roli beriladi.
 */
export const ROLE_FORBIDDEN_CAPABILITIES: Readonly<Partial<Record<UserRole, readonly string[]>>> = {
  [UserRole.Waiter]: ['cashier', 'revenue', 'reports', 'history', 'void', 'refund'],
};

/** Shu lavozimga bu ruxsatni berish mumkinmi (Direktor/SuperAdmin — hammasi) */
export function roleAllowsCapability(role: string, cap: string): boolean {
  return !(ROLE_FORBIDDEN_CAPABILITIES[role as UserRole] ?? []).includes(cap);
}

/** Ruxsatlar ro'yxatidan lavozimga taqiqlanganlarini olib tashlaydi (yangi massiv, tartib saqlanadi) */
export function capabilitiesForRole(role: string, caps: readonly string[] | null | undefined): string[] {
  return (caps ?? []).filter((c) => roleAllowsCapability(role, c));
}

// Direktor/SuperAdmin barcha ruxsatga ega — shu rollarni tekshiramiz
export function isFullAccessRole(role: string): boolean {
  return role === 'direktor' || role === 'superadmin';
}

// Foydalanuvchida ruxsat bormi? Lavozimga taqiqlangan ruxsat bazada qolib ketgan bo'lsa ham — yo'q.
export function hasCapability(
  user: { role: string; permissions?: string[] } | null | undefined,
  cap: string,
): boolean {
  if (!user) return false;
  if (isFullAccessRole(user.role)) return true;
  return roleAllowsCapability(user.role, cap) && (user.permissions ?? []).includes(cap);
}
