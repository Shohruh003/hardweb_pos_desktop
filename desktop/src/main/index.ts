import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import {
  getConfig,
  listPrinters,
  printKitchen,
  printOrderTicket,
  printReceipt,
  setConfig,
  testPrint,
  PrinterConfig,
} from './printer';
import type { Order, Receipt } from '@hardweb-pos/shared';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#15181E', // tema foni — oq miltillashning oldini oladi
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  // Dev rejimda Vite serveri, production'da build qilingan HTML
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Printer IPC (renderer -> main): chek chop etish va sozlamalar
ipcMain.handle('printer:print-receipt', (_e, receipt: Receipt) =>
  printReceipt(receipt),
);
ipcMain.handle('printer:print-kitchen', (_e, order: Order) =>
  printKitchen(order),
);
ipcMain.handle('printer:print-order-ticket', (_e, order: Order) =>
  printOrderTicket(order),
);
ipcMain.handle('printer:list', () => listPrinters());
ipcMain.handle('printer:test', () => testPrint());
ipcMain.handle('printer:get-config', () => getConfig());
ipcMain.handle('printer:set-config', (_e, cfg: Partial<PrinterConfig>) =>
  setConfig(cfg),
);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
