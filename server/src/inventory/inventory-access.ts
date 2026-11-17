// Sklad ruxsatlari (0.3.3) — server tekshiradi, UI faqat yashiradi. Rol emas, ruxsat: alohida
// "skladchi" xodimga faqat 'inventory' ruxsati berilsa — u sklad bilan to'liq ishlay oladi.
import { ForbiddenException } from '@nestjs/common';
import { FORBIDDEN_MESSAGE } from '../auth/user-view';
import { Actor, can, isAdminRole } from '../orders/order-rules';

/** Sklad amalini bajarayotgan xodim (jurnalga yoziladi) */
export interface InventoryActor {
  id: string | null;
  name: string | null;
}

function userOf(req: unknown): Actor | null {
  return (req as { user?: Actor } | null)?.user ?? null;
}

export function actorOf(req: unknown): InventoryActor {
  const user = userOf(req);
  return { id: user?.id ?? null, name: user?.name ?? null };
}

function deny(): never {
  throw new ForbiddenException(FORBIDDEN_MESSAGE);
}

/**
 * O'qish (har qanday GET /inventory/*: tannarx, kirimlar, harakatlar, ta'minotchilar): 'inventory'
 * (Sklad) yoki 'menu' (Menyu — taom retsepti va tannarxi) ruxsati, yoki administrator / direktor.
 * Ofitsiant, oshpaz va kassir — 403.
 */
export function assertCanReadInventory(req: unknown): void {
  const user = userOf(req);
  if (!(can(user, 'inventory') || can(user, 'menu') || isAdminRole(user))) deny();
}

/**
 * Yozish (mahsulot, kirim, vozvrat, chiqim/tuzatish, inventarizatsiya, ishlab chiqarish, ta'minotchi,
 * ta'minotchiga to'lov): 'inventory' ruxsati yoki administrator / direktor.
 */
export function assertCanWriteInventory(req: unknown): void {
  const user = userOf(req);
  if (!(can(user, 'inventory') || isAdminRole(user))) deny();
}

/** Taom retseptini saqlash: 'menu' yoki 'inventory' ruxsati, yoki administrator / direktor */
export function assertCanEditRecipes(req: unknown): void {
  const user = userOf(req);
  if (!(can(user, 'menu') || can(user, 'inventory') || isAdminRole(user))) deny();
}

/** Pul yozuvini bekor qilish (ta'minotchiga to'lovni o'chirish) — faqat administrator / direktor */
export function assertAdminRole(req: unknown): void {
  if (!isAdminRole(userOf(req))) deny();
}
