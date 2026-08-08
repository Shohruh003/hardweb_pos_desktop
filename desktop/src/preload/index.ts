import { contextBridge, ipcRenderer } from 'electron';
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

// Renderer (React) main jarayonidagi printerga shu API orqali murojaat qiladi
contextBridge.exposeInMainWorld('hardweb', {
  platform: process.platform,
  version: process.versions.electron,
  printer: {
    printReceipt: (receipt: Receipt): Promise<PrintResult> =>
      ipcRenderer.invoke('printer:print-receipt', receipt),
    printKitchen: (order: Order): Promise<PrintResult> =>
      ipcRenderer.invoke('printer:print-kitchen', order),
    printOrderTicket: (order: Order): Promise<PrintResult> =>
      ipcRenderer.invoke('printer:print-order-ticket', order),
    test: (): Promise<PrintResult> => ipcRenderer.invoke('printer:test'),
    list: (): Promise<string[]> => ipcRenderer.invoke('printer:list'),
    getConfig: (): Promise<PrinterConfig> =>
      ipcRenderer.invoke('printer:get-config'),
    setConfig: (cfg: Partial<PrinterConfig>): Promise<PrinterConfig> =>
      ipcRenderer.invoke('printer:set-config', cfg),
  },
});
