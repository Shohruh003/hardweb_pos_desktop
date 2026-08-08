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
}
export interface PrintResult {
  ok: boolean;
  message: string;
}

// preload (contextBridge) orqali ochilgan API
declare global {
  interface Window {
    hardweb: {
      platform: string;
      version: string;
      printer: {
        printReceipt: (receipt: Receipt) => Promise<PrintResult>;
        printKitchen: (order: Order) => Promise<PrintResult>;
        printOrderTicket: (order: Order) => Promise<PrintResult>;
        printBill: (order: Order) => Promise<PrintResult>;
        test: () => Promise<PrintResult>;
        list: () => Promise<string[]>;
        getConfig: () => Promise<PrinterConfig>;
        setConfig: (cfg: Partial<PrinterConfig>) => Promise<PrinterConfig>;
      };
    };
  }
}
