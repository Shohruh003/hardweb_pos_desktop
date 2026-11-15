import { useEffect } from 'react';
import { SOCKET_EVENTS } from '@hardweb-pos/shared';
import type { Order, Receipt } from '@hardweb-pos/shared';
import { getSocket } from '../lib/socket';
import { loadPosSettings } from '../lib/posSettings';

/**
 * Kassa printeri "relay" xizmati — App.tsx'da modul almashinuvidan TASHQARIDA, kirgan har qanday
 * xodim uchun bir marta o'rnatiladi. Shuning uchun kassir qaysi ekranda bo'lmasin (POS/Ofitsiant,
 * Kassa, Boshqaruv, bosh sahifa) boshqa terminal/telefondan kelgan ishlar shu printerdan chiqadi:
 *  - print:bill     -> hisob (schot), restoran nomi bilan (ofitsiant "Chek" bosdi, o'zida printer yo'q);
 *  - print:receipt  -> to'lov cheki (boshqa terminalda to'landi / tarixdan qayta chop etish);
 *  - order:created  -> kassa "zakas cheki" (#11). Hisob bo'lishdan paydo bo'lgan yangi hisob
 *                      (source 'split') chiqarilmaydi — unda yangi taom yo'q.
 * Faqat printeri sozlangan terminal (kassa) chop etadi (getConfig().type !== 'none'); telefon/brauzerda
 * (window.hardweb yo'q) hech narsa qilmaydi. Bu ishlar boshqa joyda (CashierPage) takrorlanmasin —
 * aks holda har chek ikki marta chiqadi.
 */
export function PrintRelayHost(): null {
  useEffect(() => {
    if (!window.hardweb?.printer) return; // printersiz qurilma (telefon / brauzer)
    const socket = getSocket();

    // Faqat printeri sozlangan terminal chop etadi; xato ekranni buzmaydi (best-effort)
    const printIfHost = async (fn: () => Promise<unknown> | undefined) => {
      try {
        const cfg = await window.hardweb?.printer?.getConfig?.();
        if (cfg && cfg.type !== 'none') await fn();
      } catch {
        /* printer xatosi — jim (chek kassada qo'lda chiqariladi) */
      }
    };

    // Boshqa terminal "Chek" (schot) bossa — hisob shu printerdan chiqadi
    const onPrintBill = (payload?: { order?: Order }) => {
      const order = payload?.order;
      if (!order) return;
      void printIfHost(async () => {
        // Schot sarlavhasi — restoran nomi (sozlamadan; o'qib bo'lmasa Electron oxirgi ma'lum nomni oladi)
        const { restaurantName } = await loadPosSettings().catch(() => ({ restaurantName: '' }));
        return window.hardweb?.printer?.printBill?.({ ...order, restaurantName });
      });
    };

    // Boshqa terminalda to'lov / qayta chop etish — to'lov cheki shu printerdan chiqadi
    const onPrintReceipt = (payload?: { receipt?: Receipt }) => {
      const receipt = payload?.receipt;
      if (!receipt) return;
      void printIfHost(() => window.hardweb?.printer?.printReceipt?.(receipt));
    };

    // Eslatma: yangi buyurtmaning kassa printeridan "zakaz cheki" nusxasi CHIQARILMAYDI (restoran talabi, 0.3.1) —
    // taomlar faqat o'z bo'limlari printeridan chiqadi (server yuboradi).

    socket.on(SOCKET_EVENTS.PRINT_BILL, onPrintBill);
    socket.on(SOCKET_EVENTS.PRINT_RECEIPT, onPrintReceipt);
    return () => {
      socket.off(SOCKET_EVENTS.PRINT_BILL, onPrintBill);
      socket.off(SOCKET_EVENTS.PRINT_RECEIPT, onPrintReceipt);
    };
  }, []);
  return null;
}
