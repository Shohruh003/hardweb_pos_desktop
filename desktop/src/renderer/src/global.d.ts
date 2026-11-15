import type { Order, Receipt } from '@hardweb-pos/shared';

export interface KitchenPrinter {
  name: string;
  host: string;
  port: number;
  width: number;
}

export interface PrinterConfig {
  type: 'network' | 'usb' | 'none';
  host: string;
  port: number;
  width: number;
  printerName: string;
  autoCut: boolean;
  kitchen: KitchenPrinter[];
  restaurantName?: string; // chek sarlavhasi (oxirgi to'lov chekidan eslab qolinadi)
}
export interface PrintResult {
  ok: boolean;
  message: string;
}

// preload (contextBridge) orqali ochilgan API. Faqat Electron oynasida bor — telefon/brauzerda
// (http://<kassa-IP>:8080) yo'q, shuning uchun ixtiyoriy: har chaqiriq `window.hardweb?.` bilan.
declare global {
  interface Window {
    hardweb?: {
      platform: string;
      version: string;
      showKeyboard: () => Promise<{ ok: boolean }>;
      getLanInfo: () => Promise<{ ip: string | null; webUrl: string | null; webAvailable: boolean; serverPc?: boolean }>;
      printer: {
        printReceipt: (receipt: Receipt) => Promise<PrintResult>;
        printKitchen: (order: Order) => Promise<PrintResult>;
        printOrderTicket: (order: Order) => Promise<PrintResult>;
        // Schot: restoran nomini ham qo'shib yuborish mumkin ({...order, restaurantName}) — chek sarlavhasi
        printBill: (order: Order & { restaurantName?: string | null }) => Promise<PrintResult>;
        printStation: (
          order: Order,
          host: string,
          port: number,
          width: number,
          title: string,
        ) => Promise<PrintResult>;
        test: () => Promise<PrintResult>;
        list: () => Promise<string[]>;
        getConfig: () => Promise<PrinterConfig>;
        setConfig: (cfg: Partial<PrinterConfig>) => Promise<PrinterConfig>;
      };
    };
  }
}
