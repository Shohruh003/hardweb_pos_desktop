import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import type { MessageBoxOptions } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { dirname, extname, join } from 'path';
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'fs';
import { copyFile } from 'fs/promises';
import { createServer, Server as HttpServer } from 'http';
import { networkInterfaces, release } from 'os';
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

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostika logi: userData/launch-debug.log (ishga tushish, server holati, xatolar)
// ─────────────────────────────────────────────────────────────────────────────
const DEBUG_LOG_MAX_BYTES = 5 * 1024 * 1024; // shundan oshsa launch-debug.log.1 ga ko'chiriladi
let debugLogChecked = false;

function errText(e: unknown): string {
  return e instanceof Error ? e.stack || e.message : String(e);
}

function debugLog(message: string): void {
  try {
    const dir = app.getPath('userData');
    const file = join(dir, 'launch-debug.log');
    if (!debugLogChecked) {
      debugLogChecked = true;
      try {
        mkdirSync(dir, { recursive: true });
        if (existsSync(file) && statSync(file).size > DEBUG_LOG_MAX_BYTES) renameSync(file, file + '.1');
      } catch {
        /* log aylantirilmasa ham yozishda davom etamiz */
      }
    }
    writeFileSync(file, new Date().toISOString() + ' ' + message + '\n', { flag: 'a' });
  } catch {
    /* log yozilmasa ham ilova ishlayveradi */
  }
}

// Kutilmagan xatolar butun ilovani qulatmasin (demo turli kompyuterlarda ishlashi kerak).
// Aks holda Electron "A JavaScript error occurred in the main process" dialogini chiqaradi.
// Packaged buildda konsol ko'rinmaydi — shuning uchun launch-debug.log'ga ham yozamiz.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
  debugLog('main uncaughtException: ' + errText(err));
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
  debugLog('main unhandledRejection: ' + errText(reason));
});

// ─────────────────────────────────────────────────────────────────────────────
// Grafik (GPU) rejimi. Eski Windows 10 monobloklardagi videodrayverlar bilan Chromium
// ekranda qora/eskirgan bo'laklar qoldirishi mumkin (restoranda kuzatildi). POS interfeysiga
// GPU shart emas, shuning uchun Windows 10 da (build < 22000) dastur videokartasiz — xavfsiz
// dasturiy chizish rejimida ishlaydi. Windows 11 da GPU yoqiq qoladi.
// Qo'lda tanlash: userData/gpu-mode.txt faylida "on" yoki "off" (yoki DASTURXON_GPU=on|off).
// Bu kod app 'ready' hodisasidan OLDIN bajarilishi shart.
// ─────────────────────────────────────────────────────────────────────────────
function gpuModeOverride(): 'on' | 'off' | null {
  const env = String(process.env.DASTURXON_GPU || '').trim().toLowerCase();
  if (env === 'on' || env === 'off') return env;
  try {
    const file = join(app.getPath('userData'), 'gpu-mode.txt');
    if (existsSync(file)) {
      const v = readFileSync(file, 'utf8').trim().toLowerCase();
      if (v === 'on' || v === 'off') return v;
    }
  } catch {
    /* fayl o'qilmasa — avtomatik tanlov */
  }
  return null;
}

function isWindows10(): boolean {
  if (process.platform !== 'win32') return false;
  // os.release(): "10.0.19045" (Windows 10) yoki "10.0.22631" (Windows 11)
  const build = Number(String(release()).split('.')[2]);
  return Number.isFinite(build) && build < 22000;
}

{
  const override = gpuModeOverride();
  const useGpu = override ? override === 'on' : !isWindows10();
  if (!useGpu) app.disableHardwareAcceleration();
  debugLog(`GPU: ${useGpu ? 'yoqiq' : 'o‘chiq (dasturiy chizish)'}${override ? ' — gpu-mode.txt/DASTURXON_GPU' : ' — avtomatik'}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ilova holati
// ─────────────────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
// Ilova yopilmoqda (tasdiqlangan yopish / Windows o'chishi) — server qayta ko'tarilmaydi
let appQuitting = false;
// Kassa oynasini yopish foydalanuvchi tomonidan tasdiqlandi
let allowWindowClose = false;
let closePromptOpen = false;

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
  mainWindow = win;

  win.on('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Kassa (Server build) oynasi butun restoranning serveri: yopilsa terminallar va telefonlar
  // ishlamay qoladi. Shuning uchun X / Alt+F4 tasdiq so'raydi.
  win.on('close', (e) => {
    if (allowWindowClose || appQuitting || !isServerBuild()) return;
    e.preventDefault();
    confirmWindowClose(win);
  });

  // Windows o'chirilmoqda / qayta yuklanmoqda / foydalanuvchi chiqmoqda — so'ramaymiz,
  // serverni to'xtatamiz (qayta ko'tarmaymiz), Windows'ning o'chishini to'smaymiz.
  win.on('session-end', () => {
    debugLog('Windows sessiyasi tugamoqda — ilova yopiladi');
    allowWindowClose = true;
    stopEmbeddedServer();
  });

  // Renderer qulasa (xotira tugashi va h.k.) — qora oyna bilan qolmasin, qayta yuklanadi.
  // Qayta-qayta qulasa (1 daqiqada 3 marta) — cheksiz siklga tushmaslik uchun to'xtatamiz.
  const rendererCrashes: number[] = [];
  win.webContents.on('render-process-gone', (_e, details) => {
    debugLog(`renderer to‘xtadi: ${details.reason} (exitCode=${details.exitCode})`);
    if (details.reason === 'clean-exit' || appQuitting) return;
    const now = Date.now();
    while (rendererCrashes.length && now - rendererCrashes[0] > 60_000) rendererCrashes.shift();
    if (rendererCrashes.length >= 3) {
      debugLog('renderer 1 daqiqada 3 marta to‘xtadi — avtomatik qayta yuklash to‘xtatildi');
      return;
    }
    rendererCrashes.push(now);
    setTimeout(() => {
      if (!win.isDestroyed()) win.reload();
    }, 1000);
  });

  if (app.isPackaged) {
    // Menyu olib tashlangan — zoom tugmalari yo'q; avvalgi versiyada tasodifan saqlangan
    // kattalashtirish/kichraytirish qolib ketmasin.
    win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(1));
  }

  // Oyna ilovadan boshqa sahifaga o'tib ketmasin: masalan rasm faylini tashlash zonasidan tashqariga
  // tashlansa Chromium o'sha faylni ochib yuboradi — kassa ekrani yo'qoladi. Ilovaning o'z sahifasi
  // (dev'da Vite manzili, production'da file://…/index.html) qayta yuklanishiga ruxsat bor.
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    const own = devUrl ? url.startsWith(devUrl) : url.startsWith('file:') && url.includes('/renderer/index.html');
    if (!own) {
      e.preventDefault();
      debugLog('navigatsiya bloklandi: ' + url.slice(0, 200));
    }
  });
  // Yangi oyna ochish (target=_blank, window.open) — taqiqlangan
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Dev rejimda Vite serveri, production'da build qilingan HTML
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function confirmWindowClose(win: BrowserWindow): void {
  if (closePromptOpen) return; // dialog allaqachon ochiq — ikkinchisini chiqarmaymiz
  closePromptOpen = true;
  dialog
    .showMessageBox(win, {
      type: 'warning',
      title: 'Kassani yopish',
      message: 'Kassa dasturi yopilsa, barcha terminallar va ofitsiant telefonlari ishlamay qoladi.',
      detail: 'Haqiqatan ham yopmoqchimisiz?',
      buttons: ['Bekor qilish', 'Yopish'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    .then(({ response }) => {
      closePromptOpen = false;
      if (response !== 1 || win.isDestroyed()) return;
      debugLog('kassa oynasi foydalanuvchi tasdig‘i bilan yopildi');
      allowWindowClose = true;
      win.close();
    })
    .catch((e) => {
      closePromptOpen = false;
      debugLog('yopish dialogi xatosi: ' + errText(e));
    });
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

// ─────────────────────────────────────────────────────────────────────────────
// Ofitsiantlar telefon brauzeridan kirishi uchun — kassa web ilovani ham tarqatadi (8080).
// http://<kassa-IP>:8080 → renderer, u host:3100 API'ga ulanadi (config.ts avtomatik).
// ─────────────────────────────────────────────────────────────────────────────
const WEB_PORT = 8080;
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
// Port haqiqatan tinglanayaptimi ('listening' kelgandan keyin true) — QR tugmasi shunga qaraydi
let webListening = false;

function startWebServer(): void {
  const rendererDir = join(__dirname, '..', 'renderer');
  if (!existsSync(join(rendererDir, 'index.html'))) {
    debugLog('web server: renderer topilmadi — o‘tkazib yuborildi');
    return;
  }
  try {
    const srv = createServer((req, res) => {
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
    srv.on('listening', () => {
      webListening = true;
      debugLog(`web server (${WEB_PORT}) tinglayapti`);
    });
    srv.on('error', (e: NodeJS.ErrnoException) => {
      // EADDRINUSE (port boshqa dastur qo'lida) va h.k. — telefon QR'i ko'rsatilmaydi
      webListening = srv.listening;
      debugLog(`web server (${WEB_PORT}) xatosi: ${e.code || ''} ${e.message}`);
    });
    webServer = srv;
    srv.listen(WEB_PORT, '0.0.0.0');
  } catch (e) {
    webListening = false;
    debugLog(`web server (${WEB_PORT}) ishga tushmadi: ${errText(e)}`);
  }
}

// Virtual adapterlar (VirtualBox/Hyper-V/VMware/VPN/Wi-Fi Direct "… * 10") — telefon ularga
// ulana olmaydi; ularning IP'si QR'ga tushmasligi uchun eng oxirgi o'ringa qo'yiladi.
const VIRTUAL_IFACE_RE =
  /vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|bluetooth|zerotier|tailscale|hamachi|radmin|openvpn|wireguard|tap-|npcap|\*\s*\d+$/i;

function pickLanIp(): string | null {
  const cands: { ip: string; virtual: boolean }[] = [];
  for (const [name, arr] of Object.entries(networkInterfaces())) {
    for (const n of arr || []) {
      if (!n || n.family !== 'IPv4' || n.internal) continue;
      if (n.address.startsWith('169.254.')) continue; // APIPA — adapter tarmoqdan manzil olmagan
      cands.push({ ip: n.address, virtual: VIRTUAL_IFACE_RE.test(name) });
    }
  }
  const rank = (ip: string) =>
    ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
  cands.sort((a, b) => Number(a.virtual) - Number(b.virtual) || rank(a.ip) - rank(b.ip));
  return cands[0]?.ip ?? null;
}

// Ofitsiant telefoni uchun — kassaning LAN IP'si va web manzili (QR ko'rsatish uchun)
ipcMain.handle('app:lan-info', () => {
  const ip = pickLanIp();
  // serverPc — shu ilova serverni o'zi ishga tushiradigan (kassa) kompyuterdami.
  // Terminal (monoblok) va telefonlarda false: u yerda direktor kirish tugmasi ko'rsatilmaydi.
  // Dev rejimda (packaged emas) — true, ishlab chiqishda qulay bo'lsin.
  const serverPc =
    !__MOCK__ && (!app.isPackaged || existsSync(join(process.resourcesPath, 'server', 'dist', 'main.js')));
  return { ip, webUrl: ip ? `http://${ip}:${WEB_PORT}` : null, webAvailable: webListening, serverPc };
});

// ─────────────────────────────────────────────────────────────────────────────
// Server logi: userData/logs/server.log — server stdout/stderr + nazoratchi (supervisor) yozuvlari.
// ~5 MB dan oshsa aylantiriladi: server.log → server.log.1 → server.log.2 (jami 3 fayl).
// ─────────────────────────────────────────────────────────────────────────────
const SERVER_LOG_MAX_BYTES = 5 * 1024 * 1024;
const SERVER_LOG_FILES = 3; // server.log + server.log.1 + server.log.2
const LOG_LINE_MAX_BYTES = 64 * 1024; // yangi qatorsiz juda uzun chiqish baribir yoziladi
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Mahalliy vaqt: 2026-11-13 14:05:09 (kassir/texnik o'qiydi — UTC emas) */
function localTime(d = new Date()): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/** Fayl nomi uchun mahalliy vaqt: 20261113-140509 */
function fileStamp(d = new Date()): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

class RotatingLog {
  private fd: number | null = null;
  private size = 0;
  // Oqim bo'yicha hali yangi qator kelmagan qoldiq (satrlar bo'linib ketmasligi uchun)
  private readonly partial = new Map<string, Buffer>();

  constructor(readonly file: string) {}

  /** Server chiqishidan kelgan bo'lak: to'liq satrlarga bo'linadi, har biriga vaqt qo'yiladi */
  chunk(stream: 'out' | 'err', data: Buffer): void {
    const prev = this.partial.get(stream);
    const buf = prev && prev.length ? Buffer.concat([prev, data]) : data;
    const nl = buf.lastIndexOf(0x0a);
    if (nl === -1) {
      if (buf.length > LOG_LINE_MAX_BYTES) {
        this.lines(stream, buf);
        this.partial.delete(stream);
      } else {
        this.partial.set(stream, buf);
      }
      return;
    }
    this.lines(stream, buf.subarray(0, nl));
    if (nl + 1 < buf.length) this.partial.set(stream, Buffer.from(buf.subarray(nl + 1)));
    else this.partial.delete(stream);
  }

  /** Oqim yopilganda qolgan (yangi qatorsiz) qismni yozib qo'yadi */
  flush(stream: 'out' | 'err'): void {
    const rest = this.partial.get(stream);
    this.partial.delete(stream);
    if (rest && rest.length) this.lines(stream, rest);
  }

  /** Nazoratchi (main) yozuvi */
  mark(message: string): void {
    this.write(`${localTime()} [main] ${message}\n`);
  }

  close(): void {
    this.closeFd();
  }

  private lines(stream: 'out' | 'err', buf: Buffer): void {
    const prefix = `${localTime()} [${stream}] `;
    const text = buf.toString('utf8').replace(ANSI_RE, '');
    const out = text
      .split('\n')
      .map((l) => prefix + l.replace(/\r$/, ''))
      .join('\n');
    this.write(out + '\n');
  }

  private write(text: string): void {
    try {
      const data = Buffer.from(text, 'utf8');
      if (this.fd === null) this.open();
      if (this.size > 0 && this.size + data.length > SERVER_LOG_MAX_BYTES) this.rotate();
      if (this.fd === null) return;
      writeSync(this.fd, data);
      this.size += data.length;
    } catch {
      // Disk to'lgan va h.k. — log yozilmasa ham server ishlayveradi; keyingi safar qayta ochamiz
      this.closeFd();
    }
  }

  private open(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    this.fd = openSync(this.file, 'a');
    this.size = fstatSync(this.fd).size;
  }

  private rotate(): void {
    this.closeFd();
    try {
      // server.log.1 → server.log.2 (eskisi ustidan), server.log → server.log.1
      for (let i = SERVER_LOG_FILES - 1; i >= 1; i--) {
        const src = i === 1 ? this.file : `${this.file}.${i - 1}`;
        if (existsSync(src)) renameSync(src, `${this.file}.${i}`);
      }
    } catch {
      // Fayl band (masalan boshqa dasturda ochiq) — hozircha joriy faylga yozishda davom etamiz
    }
    this.open();
  }

  private closeFd(): void {
    if (this.fd === null) return;
    try {
      closeSync(this.fd);
    } catch {
      /* ignore */
    }
    this.fd = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ichga joylangan server (NestJS + SQLite) — real (Server) buildda ilova o'zi ko'taradi va
// nazorat qiladi: kutilmaganda to'xtasa qayta ishga tushiradi. Demo (mock) buildda kerak emas.
// Dev'da server alohida ishga tushiriladi; Terminal buildda server paketi yo'q.
// ─────────────────────────────────────────────────────────────────────────────
interface ServerLaunch {
  runner: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  dbFile: string;
  backupsDir: string;
}

// Qayta ishga tushirish oralig'i (har keyingi urinishda uzayadi)
const SERVER_RESTART_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000];
// 10 daqiqa ichida 5 marta qayta ishga tushirilib, yana to'xtasa — taslim bo'lamiz (cheksiz sikl emas)
const SERVER_RESTART_WINDOW_MS = 10 * 60_000;
const SERVER_MAX_RESTARTS = 5;

let serverLaunch: ServerLaunch | null = null; // null emas = Server build (kassa)
let serverLog: RotatingLog | null = null;
let serverProc: ChildProcess | null = null;
let serverRestartTimer: ReturnType<typeof setTimeout> | null = null;
let serverRestarts: number[] = []; // so'nggi qayta ishga tushirishlar vaqti (ms)
let serverGaveUp = false;

/** Kassa (Server build): ichki server shu kompyuterda ishlaydi */
function isServerBuild(): boolean {
  return serverLaunch !== null;
}

/** Ham launch-debug.log, ham server.log'ga yoziladi */
function supervisorLog(message: string): void {
  debugLog(message);
  serverLog?.mark(message);
}

/** JWT siri — har o'rnatma uchun alohida (userData/server-config.json'da saqlanadi) */
function loadJwtSecret(userData: string): string {
  const cfgFile = join(userData, 'server-config.json');
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
  return jwtSecret;
}

function startEmbeddedServer(): void {
  if (__MOCK__) {
    debugLog('mock build — server kerak emas');
    return;
  }
  try {
    const resources = process.resourcesPath;
    const serverMain = join(resources, 'server', 'dist', 'main.js');
    debugLog(`packaged=${app.isPackaged} resources=${resources} serverExists=${existsSync(serverMain)}`);
    if (!existsSync(serverMain)) {
      debugLog('server bundle topilmadi — dev rejim yoki terminal/demo, o‘tkazib yuborildi');
      return;
    }
    const userData = app.getPath('userData');
    const dataDir = join(userData, 'data');
    mkdirSync(dataDir, { recursive: true });
    const dbFile = join(dataDir, 'dasturxon.db');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: '3100',
      DB_FILE: dbFile,
      DB_SYNCHRONIZE: 'true',
      // Bo'sh bazada seed ishlaydi — real rejimda faqat bitta Direktor (direktor / 1234,
      // birinchi kirishda parolni almashtirish majburiy). Demo buyurtma/menyu/stollar YO'Q.
      SEED_ON_START: 'true',
      SEED_DEMO: 'false',
      // Haqiqiy OFD (soliq) integratsiyasi yo'q — soxta fiskal raqamlar yaratilmasin
      FISCAL_ENABLED: 'false',
      JWT_SECRET: loadJwtSecret(userData),
      // Sessiya 24 soat; muddati o'tsa renderer 401 oladi va login sahifasiga qaytaradi
      JWT_EXPIRES_IN: '24h',
      APP_VERSION: app.getVersion(),
      // Litsenziya nazorati hozircha o'chiq; bulut deploy qilingach LICENSE_ENFORCE=true
      // va haqiqiy CLOUD_URL beriladi.
      LICENSE_ENFORCE: 'false',
      CLOUD_URL: 'http://localhost:4000/api',
      // server.log'da ANSI rang kodlari bo'lmasin (NestJS logger)
      NO_COLOR: '1',
    };

    const nodeExe = join(resources, 'runtime', 'node.exe');
    const useBundledNode = existsSync(nodeExe);
    serverLaunch = {
      runner: useBundledNode ? nodeExe : process.execPath,
      args: [serverMain],
      cwd: join(resources, 'server'),
      env: useBundledNode ? env : { ...env, ELECTRON_RUN_AS_NODE: '1' },
      dbFile,
      backupsDir: join(dataDir, 'backups'),
    };
    serverLog = new RotatingLog(join(userData, 'logs', 'server.log'));
    debugLog(`spawn: ${serverLaunch.runner} ${serverMain} (bundledNode=${useBundledNode})`);

    // Faqat kassa (server) — ofitsiantlar telefoni uchun web ilovani tarqatamiz
    startWebServer();

    // Avval bazaning zaxira nusxasi, keyin server (zaxira xatosi serverni to'xtatmaydi)
    void backupDatabaseOnStart(dbFile, serverLaunch.backupsDir).finally(() => spawnServer());
    scheduleNightlyBackup();
  } catch (e) {
    debugLog('start xato: ' + errText(e));
  }
}

function spawnServer(): void {
  const launch = serverLaunch;
  if (!launch || appQuitting || serverProc) return;
  serverLog?.mark(`server ishga tushirilmoqda: ${launch.runner} ${launch.args.join(' ')}`);
  let child: ChildProcess;
  try {
    child = spawn(launch.runner, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (e) {
    supervisorLog('spawn xato: ' + errText(e));
    handleServerDown('ishga tushmadi');
    return;
  }
  serverProc = child;

  // 'exit', 'close' va 'error' bir nechta kelishi mumkin — to'xtashni faqat bir marta qayta ishlaymiz
  let down = false;
  const onDown = (reason: string) => {
    if (down) return;
    down = true;
    if (serverProc === child) serverProc = null;
    handleServerDown(reason);
  };

  child.stdout?.on('data', (d: Buffer) => serverLog?.chunk('out', d));
  child.stderr?.on('data', (d: Buffer) => serverLog?.chunk('err', d));
  child.stdout?.on('end', () => serverLog?.flush('out'));
  child.stderr?.on('end', () => serverLog?.flush('err'));
  child.on('error', (e) => {
    debugLog('spawn xato: ' + e.message);
    // pid yo'q = jarayon umuman yaratilmadi ('exit' kelmasligi mumkin)
    if (child.pid === undefined) onDown('ishga tushmadi: ' + e.message);
  });
  child.on('exit', (code, signal) => {
    debugLog('server chiqdi, code=' + code + (signal ? ', signal=' + signal : ''));
    // 'close' (oqimlar yopilib, oxirgi xato satrlari logga tushgach) odatda darhol keladi;
    // kelmay qolsa ham 3 s dan keyin davom etamiz.
    setTimeout(() => onDown(`code=${code}${signal ? ', signal=' + signal : ''}`), 3000);
  });
  child.on('close', (code, signal) => onDown(`code=${code}${signal ? ', signal=' + signal : ''}`));
  debugLog('spawn chaqirildi, pid=' + (child.pid ?? 'yo‘q'));
}

function handleServerDown(reason: string): void {
  if (appQuitting) {
    serverLog?.mark(`server to‘xtatildi (${reason}) — ilova yopilmoqda`);
    return;
  }
  supervisorLog(`server kutilmaganda to‘xtadi (${reason})`);
  if (serverGaveUp) return;
  const now = Date.now();
  serverRestarts = serverRestarts.filter((t) => now - t < SERVER_RESTART_WINDOW_MS);
  if (serverRestarts.length >= SERVER_MAX_RESTARTS) {
    serverGaveUp = true;
    supervisorLog(
      `server ${SERVER_RESTART_WINDOW_MS / 60_000} daqiqa ichida ${SERVER_MAX_RESTARTS} marta qayta ishga ` +
        'tushirildi, lekin yana to‘xtadi — avtomatik qayta ishga tushirish to‘xtatildi',
    );
    showServerFailedDialog();
    return;
  }
  const delay = SERVER_RESTART_DELAYS_MS[Math.min(serverRestarts.length, SERVER_RESTART_DELAYS_MS.length - 1)];
  serverRestarts.push(now);
  supervisorLog(
    `server ${delay / 1000} s dan so‘ng qayta ishga tushiriladi (${serverRestarts.length}/${SERVER_MAX_RESTARTS})`,
  );
  if (serverRestartTimer) clearTimeout(serverRestartTimer);
  serverRestartTimer = setTimeout(() => {
    serverRestartTimer = null;
    spawnServer();
  }, delay);
}

function showServerFailedDialog(): void {
  const options: MessageBoxOptions = {
    type: 'error',
    title: 'Server ishlamayapti',
    message: 'Kassa serveri qayta-qayta to‘xtab qoldi.',
    detail:
      'Terminallar va ofitsiant telefonlari hozir ishlamaydi.\n\n' +
      '«Qayta urinish» tugmasini bosing. Muammo takrorlansa — kompyuterni qayta yoqing va ' +
      'texnik yordamga quyidagi faylni yuboring:\n' +
      (serverLog?.file ?? ''),
    buttons: ['Qayta urinish', 'Keyinroq'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
    .then(({ response }) => {
      if (response !== 0 || appQuitting) return;
      supervisorLog('server foydalanuvchi buyrug‘i bilan qayta ishga tushirilmoqda');
      serverGaveUp = false;
      serverRestarts = [];
      spawnServer();
    })
    .catch((e) => debugLog('server xatosi dialogi: ' + errText(e)));
}

function stopEmbeddedServer(): void {
  appQuitting = true; // endi to'xtash "kutilmagan" emas — qayta ko'tarilmaydi
  if (serverRestartTimer) {
    clearTimeout(serverRestartTimer);
    serverRestartTimer = null;
  }
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
      webServer.closeAllConnections?.(); // telefonlarning keep-alive ulanishlari ham yopilsin
      webServer.close();
    } catch {
      /* ignore */
    }
    webServer = null;
    webListening = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bazaning zaxira nusxalari: userData/data/backups/dasturxon-YYYYMMDD-HHMMSS.db (eng yangi 14 tasi).
// 1) Har ishga tushishda server KO'TARILISHIDAN OLDIN fayl nusxalanadi (sxema sinxronlash yoki
//    yangilanishdagi xatodan sug'urta; kassa har kuni yoqilsa — kunlik zaxira).
// 2) Kassa kechayu kunduz yoqiq tursa — tunda (03:00–05:59) server ishlab turgan paytda SQLite
//    "online backup" bilan (bundled node.exe + better-sqlite3), oxirgi zaxiradan 20 soat o'tgan bo'lsa.
// ─────────────────────────────────────────────────────────────────────────────
const BACKUP_KEEP = 14;
const BACKUP_NAME_RE = /^dasturxon-\d{8}-\d{6}\.db$/;
// SQLite yordamchi fayllari (yarim qolgan tranzaksiya jurnali / WAL) — bo'lsa bazaga qo'shib saqlanadi
const DB_SIDE_FILES = ['-journal', '-wal', '-shm'];
const BACKUP_SIDE_RE = /^(dasturxon-\d{8}-\d{6}\.db)(-journal|-wal|-shm)$/;
// Nusxa avval "<nom>.part" ga yoziladi va faqat to'liq tugagach asl nomga o'tkaziladi —
// ilova nusxa olish o'rtasida o'chsa, yarim fayl haqiqiy zaxira bo'lib ko'rinmaydi.
const BACKUP_PART_RE = /^dasturxon-\d{8}-\d{6}\.db\.part/;
const BACKUP_PART_STALE_MS = 60 * 60_000;
const NIGHT_BACKUP_CHECK_MS = 30 * 60_000;
const NIGHT_BACKUP_FROM_HOUR = 3;
const NIGHT_BACKUP_TO_HOUR = 6; // [3, 6)
const BACKUP_MIN_GAP_MS = 20 * 60 * 60_000;
const NIGHT_BACKUP_TIMEOUT_MS = 2 * 60_000;
let lastBackupAt = 0;
let nightBackupRunning = false;

function removeQuietly(file: string): void {
  try {
    if (existsSync(file)) unlinkSync(file);
  } catch {
    /* ignore */
  }
}

/**
 * Eng yangi BACKUP_KEEP tasidan eskilarini (yordamchi fayllari bilan) o'chiradi; uzilib qolgan
 * nusxalarning qoldiqlarini (eski ".part" va asosiy fayli yo'q yordamchi fayllar) tozalaydi.
 */
function pruneBackups(dir: string): void {
  try {
    const all = readdirSync(dir);
    const files = all.filter((f) => BACKUP_NAME_RE.test(f)).sort(); // nomdagi vaqt bo'yicha — eskisi oldinda
    for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
      for (const suffix of ['', ...DB_SIDE_FILES]) removeQuietly(join(dir, f + suffix));
    }
    const now = Date.now();
    for (const f of all) {
      const side = BACKUP_SIDE_RE.exec(f);
      if (side && !existsSync(join(dir, side[1]))) removeQuietly(join(dir, f));
      else if (BACKUP_PART_RE.test(f) && now - statSync(join(dir, f)).mtimeMs > BACKUP_PART_STALE_MS) {
        removeQuietly(join(dir, f));
      }
    }
  } catch (e) {
    debugLog('zaxira: eskilarini o‘chirishda xato: ' + errText(e));
  }
}

async function backupDatabaseOnStart(dbFile: string, backupsDir: string): Promise<void> {
  let target = '';
  try {
    if (!existsSync(dbFile) || statSync(dbFile).size === 0) {
      debugLog('zaxira: baza hali yo‘q (birinchi ishga tushish) — o‘tkazib yuborildi');
      return;
    }
    mkdirSync(backupsDir, { recursive: true });
    const started = Date.now();
    target = join(backupsDir, `dasturxon-${fileStamp()}.db`);
    await copyFile(dbFile, target + '.part');
    for (const suffix of DB_SIDE_FILES) {
      if (existsSync(dbFile + suffix)) await copyFile(dbFile + suffix, target + suffix);
    }
    renameSync(target + '.part', target);
    lastBackupAt = Date.now();
    supervisorLog(
      `zaxira nusxa: ${target} (${Math.round(statSync(target).size / 1024)} KB, ${Date.now() - started} ms)`,
    );
    pruneBackups(backupsDir);
  } catch (e) {
    supervisorLog('zaxira nusxa olinmadi (server baribir ishga tushadi): ' + errText(e));
    if (target) for (const suffix of ['.part', ...DB_SIDE_FILES]) removeQuietly(target + suffix);
  }
}

// Bundled node.exe'da ishlaydigan skript: argv = [better-sqlite3 papkasi, baza, nusxa fayli]
const ONLINE_BACKUP_SCRIPT = [
  'const [mod, src, dst] = process.argv.slice(1);',
  'const Database = require(mod);',
  'const db = new Database(src, { readonly: true, fileMustExist: true, timeout: 10000 });',
  'db.backup(dst).then(',
  '  () => { db.close(); process.exit(0); },',
  '  (e) => { console.error(String((e && e.message) || e)); process.exit(1); },',
  ');',
].join('\n');

function scheduleNightlyBackup(): void {
  setInterval(() => void runNightlyBackup(), NIGHT_BACKUP_CHECK_MS);
}

async function runNightlyBackup(): Promise<void> {
  const launch = serverLaunch;
  if (!launch || nightBackupRunning || appQuitting || !serverProc) return;
  const hour = new Date().getHours();
  if (hour < NIGHT_BACKUP_FROM_HOUR || hour >= NIGHT_BACKUP_TO_HOUR) return;
  if (Date.now() - lastBackupAt < BACKUP_MIN_GAP_MS) return;
  nightBackupRunning = true;
  try {
    if (await onlineBackup(launch)) lastBackupAt = Date.now();
  } finally {
    nightBackupRunning = false;
  }
}

/** Server ishlab turgan paytda izchil nusxa (SQLite backup API) — faylni to'g'ridan-to'g'ri ko'chirish xavfli */
function onlineBackup(launch: ServerLaunch): Promise<boolean> {
  return new Promise((resolve) => {
    const sqliteDir = join(launch.cwd, 'node_modules', 'better-sqlite3');
    if (!existsSync(launch.dbFile) || !existsSync(sqliteDir)) {
      resolve(false);
      return;
    }
    let target = '';
    let part = '';
    let child: ChildProcess;
    try {
      mkdirSync(launch.backupsDir, { recursive: true });
      target = join(launch.backupsDir, `dasturxon-${fileStamp()}.db`);
      part = target + '.part';
      child = spawn(launch.runner, ['-e', ONLINE_BACKUP_SCRIPT, sqliteDir, launch.dbFile, part], {
        cwd: launch.cwd,
        env: launch.env,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      supervisorLog('tungi zaxira boshlanmadi: ' + errText(e));
      resolve(false);
      return;
    }
    let stderr = '';
    let settled = false;
    const finish = (ok: boolean, why: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      try {
        if (ok && existsSync(part)) {
          renameSync(part, target);
          supervisorLog(`tungi zaxira nusxa: ${target} (${Math.round(statSync(target).size / 1024)} KB)`);
          pruneBackups(launch.backupsDir);
          resolve(true);
          return;
        }
      } catch (e) {
        why = errText(e);
      }
      supervisorLog(`tungi zaxira olinmadi (${why}) ${stderr.trim()}`.trim());
      for (const suffix of ['', ...DB_SIDE_FILES]) removeQuietly(part + suffix);
      resolve(false);
    };
    const killTimer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(false, 'vaqt tugadi');
    }, NIGHT_BACKUP_TIMEOUT_MS);
    child.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString('utf8')).slice(-2000);
    });
    child.on('error', (e) => finish(false, e.message));
    child.on('exit', (code) => finish(code === 0, `code=${code}`));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Windows yoqilganda ilova o'zi ochilsin (kassa terminali doim ishlab tursin).
// Faqat real o'rnatmada — dev/demoda kerak emas.
// ─────────────────────────────────────────────────────────────────────────────
function setupAutoStart(): void {
  if (__MOCK__ || !app.isPackaged || process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({ openAtLogin: true, args: [] });
  } catch {
    /* ignore */
  }
}

function focusMainWindow(): void {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

// Bitta nusxa: ikkinchi marta ochilsa (avto-start + ish stolidagi yorliq) ikkinchi server
// o'sha bazaga ulanmasin — mavjud oyna oldinga chiqadi, yangi nusxa darhol yopiladi.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    debugLog('ikkinchi nusxa ochishga urinish — mavjud oyna ko‘rsatildi');
    focusMainWindow();
  });

  app.whenReady().then(() => {
    // O'rnatilgan ilovada standart menyu yo'q: Ctrl+R (qayta yuklash), Ctrl+W (yopish),
    // DevTools va zoom tugmalari tasodifan bosilmasin. Dev rejimda menyu (DevTools) qoladi.
    if (app.isPackaged) Menu.setApplicationMenu(null);
    startEmbeddedServer();
    setupAutoStart();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('before-quit', () => {
  appQuitting = true;
});
app.on('will-quit', () => {
  stopEmbeddedServer();
  serverLog?.close();
});
app.on('window-all-closed', () => {
  stopEmbeddedServer();
  if (process.platform !== 'darwin') app.quit();
});
