// Buyurtma holatlari qoidalari — server va demo (mock) bir xil tekshiradi.
import { OrderStatus } from './enums';

/**
 * PATCH /orders/:id/status orqali qo'yish mumkin bo'lgan holatlar.
 * "yopildi" (Closed) bu yerda YO'Q — buyurtma faqat to'liq to'lov orqali yopiladi.
 */
export const SETTABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.Accepted,
  OrderStatus.Cooking,
  OrderStatus.Ready,
];

/**
 * Holatni o'zgartirish mumkinmi?
 * - yopilgan (to'langan) buyurtmaning holati o'zgarmaydi;
 * - yangi holat faqat SETTABLE_ORDER_STATUSES ichidan bo'ladi
 *   (oshxona orqaga qaytarishi — tayyor -> tayyorlanmoqda — ruxsat etiladi).
 */
export function canChangeOrderStatus(from: OrderStatus | string, to: OrderStatus | string): boolean {
  if (from === OrderStatus.Closed) return false;
  return (SETTABLE_ORDER_STATUSES as string[]).includes(to);
}
