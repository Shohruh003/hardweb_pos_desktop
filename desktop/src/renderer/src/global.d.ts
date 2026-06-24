import type { Receipt } from '@hardweb-pos/shared';

export interface PrinterConfig {
  type: 'network' | 'none';
  host: string;
  port: number;
  width: number;
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
        test: () => Promise<PrintResult>;
        getConfig: () => Promise<PrinterConfig>;
        setConfig: (cfg: Partial<PrinterConfig>) => Promise<PrinterConfig>;
      };
    };
  }
}
