// Ofitsiant savati (yangi qo'shilayotgan taomlar) — turlar va yordamchilar.
// Har qator o'z kaliti (key) bilan: bir taomning izohli va izohsiz, saboy va zalda yeyiladigan,
// narxi o'zgartirilgan va oddiy porsiyalari ALOHIDA qatorlar ("3 somsa hozir" + "5 somsa — mehmon
// kelganda"); bunday qatorlar hech qachon qo'shilib ketmaydi.
import { MenuUnit, lineSum } from '@hardweb-pos/shared';
import { formatKg } from './orderUi';

export interface CartItem {
  key: string; // savat qatori kaliti (bir taom bir nechta qatorda bo'lishi mumkin)
  menuItemId: string;
  name: string;
  price: number; // sotiladigan narx (kassir/direktor o'zgartirgan bo'lishi mumkin)
  menuPrice: number; // menyudagi narx (narx o'zgartirilganini bilish uchun)
  quantity: number; // dona — butun; kg — kasr (6 xonagacha: summa bo'yicha kiritilganda aniq summa chiqishi uchun)
  unit: MenuUnit;
  note?: string; // oshxonaga izoh (chekda ">> izoh" bo'lib chiqadi)
  takeaway?: boolean; // stolda: mehmon olib ketadi (saboy) — xizmat haqi olinmaydi
}

/** Izoh uzunligi chegarasi (oshxona cheki uchun) */
export const NOTE_MAX = 200;
/** Narx chegarasi (server bilan bir xil) */
export const PRICE_MAX = 100_000_000;
/** Bir qatorda eng ko'p dona */
export const QTY_MAX = 999;

let lineSeq = 0;
/** Yangi savat qatori kaliti */
export function newLineKey(menuItemId: string): string {
  lineSeq += 1;
  return `${menuItemId}:${Date.now().toString(36)}:${lineSeq}`;
}

/** Narxi menyudagidan farq qiladimi (kassir qo'lda o'zgartirgan) */
export function isPriceChanged(c: Pick<CartItem, 'price' | 'menuPrice'>): boolean {
  return Math.round(c.price) !== Math.round(c.menuPrice);
}

/**
 * Taom plitkasi bosilganda qo'shiladigan "oddiy" qator: shu taom, izohsiz, narxi o'zgarmagan va
 * saboy belgisi joriy rejimga teng. Bunday qator bo'lsa — o'sha ko'payadi, aks holda yangi qator.
 */
export function isPlainLine(c: CartItem, menuItemId: string, takeaway: boolean): boolean {
  return c.menuItemId === menuItemId && !c.note && !!c.takeaway === takeaway && !isPriceChanged(c);
}

/** Miqdorni birlik bilan ko'rsatish (dona -> "2", kg -> "1,5 kg") */
export function qtyLabel(quantity: number, unit: MenuUnit | undefined): string {
  if (unit === MenuUnit.Weight) return `${formatKg(quantity)} kg`;
  return String(Math.round(quantity));
}

/** Miqdorni birlikka moslab yaxlitlash: dona — butun, kg — 6 xona */
export function roundQty(q: number, unit: MenuUnit): number {
  if (!Number.isFinite(q) || q <= 0) return 0;
  // kg — 6 xonagacha; dona/porsiya — 3 xonagacha kasr (yarim porsiya: 0,5) — 0.3.2
  return unit === MenuUnit.Weight ? Math.round(q * 1e6) / 1e6 : Math.round(q * 1e3) / 1e3;
}

/**
 * Kiloli taom: kiritilgan SUMMAga mos og'irlik (6 xonagacha) — lineSum(narx, og'irlik) aynan
 * shu summani beradi. Masalan baliq 75 000/kg, bo'lak 83 000 -> 1.106667 kg (= 83 000 so'm).
 */
export function kgForSum(sum: number, price: number): number {
  if (!(sum > 0) || !(price > 0)) return 0;
  let q = Math.round((sum / price) * 1e6) / 1e6;
  // Yaxlitlash summani 1 so'mga siljitsa — eng kichik qadam bilan tuzatamiz
  for (let i = 0; i < 20 && lineSum(price, q) !== sum; i++) {
    q = Math.round((q + (lineSum(price, q) < sum ? 1e-6 : -1e-6)) * 1e6) / 1e6;
  }
  return q > 0 ? q : 0;
}

/** Savatdagi taomlar -> POST /orders qatorlari (saboy — faqat stolga buyurtmada; narx — o'zgargan bo'lsa) */
export function orderLines(cart: CartItem[], dineIn: boolean) {
  return cart.map((c) => {
    const note = c.note?.trim();
    const line: { menuItemId: string; quantity: number; note?: string; takeaway?: boolean; price?: number } = {
      menuItemId: c.menuItemId,
      quantity: roundQty(c.quantity, c.unit),
    };
    if (note) line.note = note;
    if (dineIn && c.takeaway) line.takeaway = true;
    if (isPriceChanged(c)) line.price = Math.round(c.price);
    return line;
  });
}

/** Oflayn navbatga — taom nomi va birligi bilan (navbat ro'yxatida ko'rsatish uchun; yuborishda olib tashlanadi) */
export function queuedLines(cart: CartItem[], dineIn: boolean) {
  return orderLines(cart, dineIn).map((line, i) => ({ ...line, name: cart[i].name, unit: cart[i].unit }));
}

/** Savat "imzosi" — bir xil savat qayta yuborilsa bir xil clientRequestId ishlatiladi (ikki marta tushmaydi) */
export function cartSignature(target: string, cart: CartItem[], extra?: unknown): string {
  return JSON.stringify([
    target,
    cart.map((c) => [c.menuItemId, roundQty(c.quantity, c.unit), c.note ?? '', !!c.takeaway, Math.round(c.price)]),
    extra ?? null,
  ]);
}

/** Matndagi vaqt ("⏰ 15:00 ga tayyor", "soat 9:30 da") — oshxona ekranida nishon uchun */
export function noteTime(note: string | null | undefined): string | null {
  const m = String(note ?? '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}
