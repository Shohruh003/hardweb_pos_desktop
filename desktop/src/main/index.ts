import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';

// electron-vite define (real build'da false, mock/demo build'da true)
declare const __MOCK__: boolean;
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

// Ichga joylangan server (NestJS + SQLite) — real buildda ilova o'zi ko'taradi.
// Demo (mock) buildda kerak emas. Dev'da server alohida ishga tushiriladi.
let serverProc: ChildProcess | null = null;
function startEmbeddedServer(): void {
  const dbg = (m: string) => {
    try {
      writeFileSync(join(app.getPath('userData'), 'launch-debug.log'), new Date().toISOString() + ' ' + m + '\n', { flag: 'a' });
    } catch {
      /* ignore */
    }
  };
  if (__MOCK__) {
    dbg('mock build — server kerak emas');
    return;
  }
  try {
    const resources = process.resourcesPath;
    const serverMain = join(resources, 'server', 'dist', 'main.js');
    dbg(`packaged=${app.isPackaged} resources=${resources} serverExists=${existsSync(serverMain)}`);
    if (!existsSync(serverMain)) {
      dbg('server bundle topilmadi — dev rejim yoki demo, o‘tkazib yuborildi');
      return;
    }
    const dataDir = join(app.getPath('userData'), 'data');
    mkdirSync(dataDir, { recursive: true });

    // JWT siri — har o'rnatma uchun alohida (userData'da saqlanadi)
    const cfgFile = join(app.getPath('userData'), 'server-config.json');
    let jwtSecret = '';
    try {
      if (existsSync(cfgFile)) jwtSecret = JSON.parse(readFileSync(cfgFile, 'utf8')).jwtSecret || '';
    } catch {
      /* buzilgan fayl */
    }
    if (!jwtSecret) {
      jwtSecret = randomBytes(24).toString('hex');
      try {
        writeFileSync(cfgFile, JSON.stringify({ jwtSecret }));
      } catch {
        /* ignore */
      }
    }

    const env = {
      ...process.env,
      PORT: '3100',
      DB_FILE: join(dataDir, 'dasturxon.db'),
      DB_SYNCHRONIZE: 'true',
      SEED_ON_START: 'true',
      JWT_SECRET: jwtSecret,
      APP_VERSION: app.getVersion(),
      // TODO: bulut deploy qilingach — LICENSE_ENFORCE=true va CLOUD_URL=https://.../api
      LICENSE_ENFORCE: 'false',
      CLOUD_URL: 'http://localhost:4000/api',
    } as NodeJS.ProcessEnv;

    const nodeExe = join(resources, 'runtime', 'node.exe');
    const useBundledNode = existsSync(nodeExe);
    const runner = useBundledNode ? nodeExe : process.execPath;
    dbg(`spawn: ${runner} ${serverMain} (bundledNode=${useBundledNode})`);
    serverProc = spawn(runner, [serverMain], {
      cwd: join(resources, 'server'),
      env: useBundledNode ? env : { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      windowsHide: true,
    });
    serverProc.on('error', (e) => dbg('spawn xato: ' + (e as Error).message));
    serverProc.on('exit', (code) => dbg('server chiqdi, code=' + code));
    dbg('spawn chaqirildi, pid=' + (serverProc.pid ?? 'yo‘q'));
  } catch (e) {
    dbg('start xato: ' + (e as Error).message);
  }
}
function stopEmbeddedServer(): void {
  if (serverProc) {
    try {
      serverProc.kill();
    } catch {
      /* ignore */
    }
    serverProc = null;
  }
}

app.whenReady().then(() => {
  startEmbeddedServer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', stopEmbeddedServer);
app.on('window-all-closed', () => {
  stopEmbeddedServer();
  if (process.platform !== 'darwin') app.quit();
});
