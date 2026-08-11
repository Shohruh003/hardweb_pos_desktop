import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { join, extname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { createServer, Server as HttpServer } from 'http';
import { networkInterfaces } from 'os';
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

// Ofitsiantlar telefon brauzeridan kirishi uchun — kassa web ilovani ham tarqatadi (8080).
// http://<kassa-IP>:8080 → renderer, u host:3100 API'ga ulanadi (config.ts avtomatik).
const WEB_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
let webServer: HttpServer | null = null;
function startWebServer(): void {
  const rendererDir = join(__dirname, '..', 'renderer');
  if (!existsSync(join(rendererDir, 'index.html'))) return;
  try {
    webServer = createServer((req, res) => {
      try {
        let p = decodeURIComponent((req.url || '/').split('?')[0]);
        if (p === '/' || p === '') p = '/index.html';
        let file = join(rendererDir, p);
        if (!file.startsWith(rendererDir) || !existsSync(file) || statSync(file).isDirectory()) {
          file = join(rendererDir, 'index.html'); // SPA fallback
        }
        res.writeHead(200, {
          'Content-Type': WEB_MIME[extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(readFileSync(file));
      } catch {
        res.writeHead(500);
        res.end('error');
      }
    });
    webServer.on('error', () => undefined);
    webServer.listen(8080, '0.0.0.0');
  } catch {
    /* ignore */
  }
}

// Ofitsiant telefoni uchun — kassaning LAN IP'si va web manzili (QR ko'rsatish uchun)
ipcMain.handle('app:lan-info', () => {
  const all: string[] = [];
  for (const arr of Object.values(networkInterfaces())) {
    for (const n of arr || []) {
      if (n && n.family === 'IPv4' && !n.internal) all.push(n.address);
    }
  }
  const ip =
    all.find((a) => a.startsWith('192.168.')) ||
    all.find((a) => a.startsWith('10.')) ||
    all[0] ||
    null;
  return { ip, webUrl: ip ? `http://${ip}:8080` : null, webAvailable: webServer !== null };
});

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
    // Faqat kassa (server) — ofitsiantlar telefoni uchun web ilovani tarqatamiz
    startWebServer();
    dbg('web server (8080) ishga tushirildi');
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
  if (webServer) {
    try {
      webServer.close();
    } catch {
      /* ignore */
    }
    webServer = null;
  }
}

// Windows yoqilganda ilova o'zi ochilsin (kassa terminali doim ishlab tursin).
// Faqat real o'rnatmada — dev/demoda kerak emas.
function setupAutoStart(): void {
  if (__MOCK__ || !app.isPackaged || process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({ openAtLogin: true, args: [] });
  } catch {
    /* ignore */
  }
}

app.whenReady().then(() => {
  startEmbeddedServer();
  setupAutoStart();
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
