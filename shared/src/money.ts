// Pul hisoblash — YAGONA manba. Server (to'lov, chek, hisobot), kassa UI va demo (mock)
// aynan shu funksiyalardan foydalanadi, shuning uchun summalar hamma joyda bir xil chiqadi.
//
// Qoida: barcha summalar BUTUN so'mda. Har bir qator (narx × miqdor) alohida yaxlitlanadi —
// shunda chekdagi qatorlar yig'indisi jami summaga aynan teng bo'ladi va kg taomlarda
// 121000.00000000001 kabi "suzuvchi" qoldiqlar paydo bo'lmaydi.

export interface MoneyLine {
  price: number | string;
  quantity: number | string;
}

export interface OrderTotals {
  subtotal: number; // qatorlar yig'indisi (chegirma/xizmatsiz)
  discountPercent: number;
  discountAmount: number;
  servicePercent: number;
  serviceAmount: number;
  total: number; // to'lanadigan yakuniy summa = subtotal - chegirma + xizmat
}

/** Butun so'mga yaxlitlash. NaN/Infinity -> 0. */
export function roundSum(value: number | string | null | undefined): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : 0;
}

/** Foizni 0..100 oralig'iga keltirish (noto'g'ri qiymat -> 0). */
export function clampPercent(value: number | string | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** Bitta qator summasi: narx × miqdor (kg uchun kasr miqdor), butun so'mga yaxlitlangan. */
export function lineSum(price: number | string, quantity: number | string): number {
  return roundSum(Number(price) * Number(quantity));
}

/**
 * Buyurtma summalari. Chegirma va xizmat haqi subtotal'dan hisoblanadi
 * (xizmat haqi chegirmadan keyingi summaga emas — mavjud biznes qoida saqlangan).
 */
export function calcOrderTotals(
  lines: MoneyLine[],
  discountPercent?: number | string | null,
  servicePercent?: number | string | null,
): OrderTotals {
  const subtotal = (lines || []).reduce((sum, l) => sum + lineSum(l.price, l.quantity), 0);
  const d = clampPercent(discountPercent);
  const s = clampPercent(servicePercent);
  const discountAmount = roundSum((subtotal * d) / 100);
  const serviceAmount = roundSum((subtotal * s) / 100);
  return {
    subtotal,
    discountPercent: d,
    discountAmount,
    servicePercent: s,
    serviceAmount,
    total: subtotal - discountAmount + serviceAmount,
  };
}

/** To'lovlar yig'indisi (butun so'm). */
export function sumPayments(payments: { amount: number | string }[] | null | undefined): number {
  return (payments || []).reduce((sum, p) => sum + roundSum(p.amount), 0);
}

/** Qolgan summa (manfiy bo'lmaydi). */
export function remainingAmount(total: number, paid: number): number {
  return Math.max(0, roundSum(total) - roundSum(paid));
}
