// Pul hisoblash — YAGONA manba. Server (to'lov, chek, hisobot), kassa UI va demo (mock)
// aynan shu funksiyalardan foydalanadi, shuning uchun summalar hamma joyda bir xil chiqadi.
//
// Qoida: barcha summalar BUTUN so'mda. Har bir qator (narx × miqdor) alohida yaxlitlanadi —
// shunda chekdagi qatorlar yig'indisi jami summaga aynan teng bo'ladi va kg taomlarda
// 121000.00000000001 kabi "suzuvchi" qoldiqlar paydo bo'lmaydi.

export interface MoneyLine {
  price: number | string;
  quantity: number | string;
  /** stoldagi buyurtmada "olib ketish" (saboy) uchun belgilangan qator — xizmat haqi OLINMAYDI */
  takeaway?: boolean | null;
}

export interface OrderTotals {
  subtotal: number; // qatorlar yig'indisi (chegirma/xizmatsiz)
  discountPercent: number;
  discountAmount: number;
  servicePercent: number;
  serviceBase: number; // xizmat haqi hisoblanadigan summa (olib ketiladigan qatorlarsiz)
  serviceAmount: number;
  deliveryFee: number; // yetkazish narxi (faqat yetkazish buyurtmasida; chegirma/xizmat unga tegmaydi)
  total: number; // to'lanadigan yakuniy summa = subtotal - chegirma + xizmat + yetkazish narxi
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
 * Buyurtma summalari. Chegirma subtotal'dan, xizmat haqi esa xizmat bazasidan hisoblanadi
 * (xizmat haqi chegirmadan keyingi summaga emas — mavjud biznes qoida saqlangan).
 * Xizmat bazasi = "olib ketish" (saboy) deb belgilangan qatorlarsiz subtotal: zalda o'tirgan mehmon
 * o'zi bilan olib ketadigan taomlarga xizmat haqi olinmaydi (eski POS'dagidek).
 */
export function calcOrderTotals(
  lines: MoneyLine[],
  discountPercent?: number | string | null,
  servicePercent?: number | string | null,
  deliveryFee?: number | string | null,
): OrderTotals {
  const subtotal = (lines || []).reduce((sum, l) => sum + lineSum(l.price, l.quantity), 0);
  const serviceBase = (lines || []).reduce(
    (sum, l) => (l.takeaway ? sum : sum + lineSum(l.price, l.quantity)),
    0,
  );
  const d = clampPercent(discountPercent);
  const s = clampPercent(servicePercent);
  const discountAmount = roundSum((subtotal * d) / 100);
  const serviceAmount = roundSum((serviceBase * s) / 100);
  const fee = Math.max(0, roundSum(deliveryFee));
  return {
    subtotal,
    discountPercent: d,
    discountAmount,
    servicePercent: s,
    serviceBase,
    serviceAmount,
    deliveryFee: fee,
    total: subtotal - discountAmount + serviceAmount + fee,
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
