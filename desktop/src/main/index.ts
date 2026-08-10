import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'child_process';
import { join } from 'path';
import {
  getConfig,
  listPrinters,
  printBill,
  printKitchen,
  printOrderTicket,
  printReceipt,
  printStationTicket,
  setConfig,
  testPrint,
  PrinterConfig,
} from './printer';
import type { Order, Receipt } from '@hardweb-pos/shared';

// Kutilmagan xatolar butun ilovani qulatmasin (demo turli kompyuterlarda ishlashi kerak).
// Aks holda Electron "A JavaScript error occurred in the main process" dialogini chiqaradi.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
});

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
// Windows ekran (sensorli) klaviaturasini ochish — planshet/monoblok uchun.
// Input bosilganda renderer shuni chaqiradi (faqat sensorli qurilmalarda).
ipcMain.handle('keyboard:show', () => {
  // Klassik ekran klaviaturasi (osk.exe) — TabTip ishlamaganda zaxira
  const openOsk = () => {
    try {
      const osk = spawn('osk.exe', [], { detached: true, stdio: 'ignore', windowsHide: true });
      osk.on('error', () => {
        /* osk ham ochilmadi — ilova baribir ishlayveradi */
      });
      osk.unref();
    } catch {
      /* ignore */
    }
  };
  try {
    const common = process.env['CommonProgramFiles'] || 'C:\\Program Files\\Common Files';
    const tabTip = join(common, 'microsoft shared', 'ink', 'TabTip.exe');
    const child = spawn(tabTip, [], { detached: true, stdio: 'ignore', windowsHide: true });
    // spawn xatosi ASINXRON keladi (EACCES/ENOENT) — 'error' ushlanmasa main qulaydi.
    child.on('error', () => {
      // TabTip ishlamadi (ruxsat yo'q/yo'q) — klassik klaviatura bilan urinamiz
      openOsk();
    });
    child.unref();
  } catch {
    openOsk();
  }
  return { ok: true };
});

ipcMain.handle('printer:print-bill', (_e, order: Order) => printBill(order));
ipcMain.handle(
  'printer:print-station',
  (
    _e,
    payload: { order: Order; host: string; port: number; width: number; title: string },
  ) =>
    printStationTicket(
      payload.order,
      payload.host,
      payload.port,
      payload.width,
      payload.title,
    ),
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
