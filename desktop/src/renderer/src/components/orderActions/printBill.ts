// Schot (hisob cheki, pre-bill) chop etish — ofitsiant paneli ham, kassa ham shu yo'ldan foydalanadi.
// 0) Ruxsat — HAR DOIM server tekshiradi (0.3.3): schotni faqat kassir / administrator / direktor
//    chiqaradi. Terminalning o'z printeri bo'lsa ham, ruxsat bo'lmasa printerga hech narsa ketmaydi.
// 1) Shu terminalda printer sozlangan bo'lsa — o'zi chiqaradi; aks holda kassa printeriga (relay).
// 2) Keyin POST /orders/:id/bill-printed — "chek berildi" vaqti (B23). Printer yo'q bo'lsa ham schot
//    berilgani qayd etiladi. Eski server (bu yo'l yo'q) — stol "hisob kutilmoqda" holatiga o'tkaziladi.
import type { Order } from '@hardweb-pos/shared';
import { ApiError, api } from '../../lib/api';
import { loadPosSettings } from '../../lib/posSettings';

export interface BillPrintResult {
  /** yangilangan buyurtma (billPrintedAt bilan); server qaytarmasa — o'zi */
  order: Order;
  /** qayerdan chiqdi: shu terminal printeri yoki kassa printeri */
  via: 'local' | 'relay';
}

/** Eski server (0.3.3 dan oldingi): yo'l umuman yo'q — NestJS "Cannot POST ..." (buyurtma topilmadi emas) */
function isMissingRoute(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404 && /^Cannot (POST|GET)\b/.test(e.message);
}

/**
 * Shu terminal printerida chop etishdan oldin server ruxsati (holat o'zgarmaydi). Ruxsat yo'q (403),
 * buyurtma yopilgan / topilmadi yoki server bilan aloqa yo'q — xato (schot chiqmaydi).
 */
async function authorizeBill(orderId: string): Promise<void> {
  try {
    await api.post(`/orders/${orderId}/bill-check`);
  } catch (e) {
    // Eski server: ruxsat avvalgidek bill-printed'da tekshiriladi
    if (isMissingRoute(e)) return;
    throw e;
  }
}

/** Schotni chop etish va "chek berildi" deb belgilash. Chop etilmasa — Error (o'zbekcha xabar bilan) */
export async function printBillAndMark(order: Order): Promise<BillPrintResult> {
  const printer = window.hardweb?.printer;
  const cfg = printer?.getConfig ? await printer.getConfig().catch(() => null) : null;
  const local = !!printer && !!cfg && cfg.type !== 'none';
  if (local) {
    await authorizeBill(order.id);
    // Schot sarlavhasi — restoran nomi (sozlamadan; o'qib bo'lmasa Electron oxirgi ma'lum nomni oladi)
    const { restaurantName } = await loadPosSettings().catch(() => ({ restaurantName: '' }));
    const res = await printer!.printBill({ ...order, restaurantName });
    if (!res?.ok) throw new Error(res?.message || 'Printer xatosi — schot chiqmadi');
  } else {
    // Bu terminalda printer yo'q — kassa printeriga yuboramiz (ruxsatni server tekshiradi)
    await api.post(`/orders/${order.id}/print-bill`);
  }
  let updated: Order = order;
  try {
    const res = await api.post<Order>(`/orders/${order.id}/bill-printed`);
    if (res && res.id === order.id) updated = res;
  } catch (e) {
    // Schot chiqdi — belgilash xatosi chop etishni "muvaffaqiyatsiz" qilmaydi.
    // Eski server: yo'l yo'q (404) — oldingi xulq (stol "hisob kutilmoqda")
    if (e instanceof ApiError && e.status === 404) {
      await api.post(`/orders/${order.id}/request-bill`).catch(() => undefined);
    }
  }
  return { order: updated, via: local ? 'local' : 'relay' };
}
