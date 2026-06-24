import { contextBridge, ipcRenderer } from 'electron';
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

// Renderer (React) main jarayonidagi printerga shu API orqali murojaat qiladi
contextBridge.exposeInMainWorld('hardweb', {
  platform: process.platform,
  version: process.versions.electron,
  printer: {
    printReceipt: (receipt: Receipt): Promise<PrintResult> =>
      ipcRenderer.invoke('printer:print-receipt', receipt),
    test: (): Promise<PrintResult> => ipcRenderer.invoke('printer:test'),
    getConfig: (): Promise<PrinterConfig> =>
      ipcRenderer.invoke('printer:get-config'),
    setConfig: (cfg: Partial<PrinterConfig>): Promise<PrinterConfig> =>
      ipcRenderer.invoke('printer:set-config', cfg),
  },
});
