// Buyurtma amallari uchun ruxsatlar (server bilan bir xil qoidalar — B19, B22, B31).
// UI faqat tugmani ko'rsatish/yashirish uchun ishlatadi; haqiqiy tekshiruv serverda.
import { hasCapability } from '@hardweb-pos/shared';

type UserLike = { role: string; permissions?: string[] } | null | undefined;

/** Boshqaruv rollari: administrator, direktor, superadmin */
const ADMIN_ROLES = new Set(['administrator', 'direktor', 'superadmin']);

export function isAdminRole(user: UserLike): boolean {
  return !!user && ADMIN_ROLES.has(user.role);
}

/** Buyurtma bilan ishlay oladimi (ofitsiant yoki kassir) — turi, stol, bo'lish, chek */
export function canWorkOrders(user: UserLike): boolean {
  return hasCapability(user, 'waiter') || hasCapability(user, 'cashier');
}

/** Otkaz (yuborilgan taomni / hisobni bekor qilish) — faqat 'void' ruxsati (kassir, administrator, direktor) */
export function canVoid(user: UserLike): boolean {
  return hasCapability(user, 'void');
}

/** Schot (hisob cheki) chiqarish — faqat kassir yoki administrator/direktor (restoran talabi) */
export function canPrintBill(user: UserLike): boolean {
  return hasCapability(user, 'cashier') || isAdminRole(user);
}

/** Ofitsiantni almashtirish — faqat kassir yoki administrator/direktor */
export function canChangeWaiter(user: UserLike): boolean {
  return hasCapability(user, 'cashier') || isAdminRole(user);
}

/** Taom narxini qo'lda o'zgartirish — kassir yoki 'void' ruxsati bor xodim */
export function canEditPrice(user: UserLike): boolean {
  return hasCapability(user, 'cashier') || hasCapability(user, 'void');
}
