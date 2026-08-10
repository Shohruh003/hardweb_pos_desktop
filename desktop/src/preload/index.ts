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
  // Windows ekran klaviaturasini ochish (planshet/monoblok uchun)
  showKeyboard: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('keyboard:show'),
  printer: {
    printReceipt: (receipt: Receipt): Promise<PrintResult> =>
      ipcRenderer.invoke('printer:print-receipt', receipt),
    printKitchen: (order: Order): Promise<PrintResult> =>
      ipcRenderer.invoke('printer:print-kitchen', order),
    printOrderTicket: (order: Order): Promise<PrintResult> =>
      ipcRenderer.invoke('printer:print-order-ticket', order),
    printBill: (order: Order): Promise<PrintResult> =>
      ipcRenderer.invoke('printer:print-bill', order),
    printStation: (
      order: Order,
      host: string,
      port: number,
      width: number,
      title: string,
    ): Promise<PrintResult> =>
      ipcRenderer.invoke('printer:print-station', { order, host, port, width, title }),
    test: (): Promise<PrintResult> => ipcRenderer.invoke('printer:test'),
    list: (): Promise<string[]> => ipcRenderer.invoke('printer:list'),
    getConfig: (): Promise<PrinterConfig> =>
      ipcRenderer.invoke('printer:get-config'),
    setConfig: (cfg: Partial<PrinterConfig>): Promise<PrinterConfig> =>
      ipcRenderer.invoke('printer:set-config', cfg),
  },
});
