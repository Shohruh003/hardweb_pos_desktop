// Chek printeri servisi (main jarayon). ESC/POS buferini printerga yuboradi.
// Ulanish turlari: Tarmoq (LAN/TCP) va USB (Windows RAW spooler).
import { app } from 'electron';
import { connect } from 'net';
import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Order, Receipt } from '@hardweb-pos/shared';
import { buildKitchenTicketBuffer, buildReceiptBuffer } from './escpos';

// Oshxona printeri (LAN) — bir nechta bo'lishi mumkin (2-3 ta)
export interface KitchenPrinter {
  name: string; // masalan "Issiq sex", "Sovuq sex"
  host: string;
  port: number;
  width: number;
}

export interface PrinterConfig {
  type: 'network' | 'usb' | 'none';
  host: string;
  port: number; // odatda 9100
  width: number; // 32 (58mm) yoki 48 (80mm)
  printerName: string; // USB rejimida Windows printer nomi
  autoCut: boolean; // qog'ozni avtomatik qirqish (cutter muammo qilsa o'chiriladi)
  kitchen: KitchenPrinter[]; // oshxona LAN printerlari
}

const DEFAULT_CONFIG: PrinterConfig = {
  type: 'none',
  host: '192.168.1.50',
  port: 9100,
  width: 48, // XPRINTER 80T — 80mm (48 belgi)
  printerName: '',
  autoCut: true,
  kitchen: [],
};

function configPath(): string {
  return join(app.getPath('userData'), 'printer-config.json');
}

export function getConfig(): PrinterConfig {
  try {
    const p = configPath();
    if (existsSync(p)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(p, 'utf-8')) };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_CONFIG;
}

export function setConfig(cfg: Partial<PrinterConfig>): PrinterConfig {
  const merged = { ...getConfig(), ...cfg };
  writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

// Bayt buferini tarmoq printerga yuborish
function sendToNetwork(
  host: string,
  port: number,
  data: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port }, () => {
      socket.write(data, () => socket.end());
    });
    socket.setTimeout(5000);
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Printer javob bermadi (timeout)'));
    });
    socket.on('close', () => resolve());
  });
}

// Windows RAW spooler orqali USB printerga bayt buferini yuborish.
// winspool P/Invoke (RawPrint) — powershell orqali, native modul kerak emas.
function sendToUsb(printerName: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!printerName) return reject(new Error('USB printer tanlanmagan'));
    const stamp = `${process.pid}-${data.length}`;
    const binFile = join(tmpdir(), `dasturxon-print-${stamp}.bin`);
    writeFileSync(binFile, data);
    const ps = `
$code = @'
using System;using System.Runtime.InteropServices;
public class RawPrint {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct DI { [MarshalAs(UnmanagedType.LPWStr)] public string n; [MarshalAs(UnmanagedType.LPWStr)] public string o; [MarshalAs(UnmanagedType.LPWStr)] public string t; }
 [DllImport("winspool.Drv",EntryPoint="OpenPrinterW",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string s,out IntPtr h,IntPtr p);
 [DllImport("winspool.Drv",EntryPoint="ClosePrinter")] public static extern bool ClosePrinter(IntPtr h);
 [DllImport("winspool.Drv",EntryPoint="StartDocPrinterW",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool StartDocPrinter(IntPtr h,int l,ref DI d);
 [DllImport("winspool.Drv",EntryPoint="EndDocPrinter")] public static extern bool EndDocPrinter(IntPtr h);
 [DllImport("winspool.Drv",EntryPoint="StartPagePrinter")] public static extern bool StartPagePrinter(IntPtr h);
 [DllImport("winspool.Drv",EntryPoint="EndPagePrinter")] public static extern bool EndPagePrinter(IntPtr h);
 [DllImport("winspool.Drv",EntryPoint="WritePrinter")] public static extern bool WritePrinter(IntPtr h,byte[] b,int c,out int w);
 public static bool Send(string p,byte[] b){IntPtr h;if(!OpenPrinter(p,out h,IntPtr.Zero))return false;DI d=new DI();d.n="ESCPOS";d.t="RAW";bool ok=false;if(StartDocPrinter(h,1,ref d)){if(StartPagePrinter(h)){int w;ok=WritePrinter(h,b,b.Length,out w);EndPagePrinter(h);}EndDocPrinter(h);}ClosePrinter(h);return ok;}
}
'@
Add-Type -TypeDefinition $code -Language CSharp
$b=[System.IO.File]::ReadAllBytes('${binFile.replace(/\\/g, '\\\\')}')
if([RawPrint]::Send('${printerName.replace(/'/g, "''")}',$b)){exit 0}else{exit 1}
`;
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true },
    );
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `RAW yuborish muvaffaqiyatsiz (kod ${code})`));
    });
  });
}

// Windows'dagi o'rnatilgan printerlar ro'yxati (USB tanlash uchun)
export function listPrinters(): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name'],
      { windowsHide: true },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', () => resolve([]));
    child.on('close', () => {
      resolve(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    });
  });
}

export interface PrintResult {
  ok: boolean;
  message: string;
}

// Konfiguratsiyaga qarab buferni printerga yuborish (tarmoq yoki USB)
async function sendBuffer(cfg: PrinterConfig, buffer: Buffer): Promise<void> {
  if (cfg.type === 'usb') return sendToUsb(cfg.printerName, buffer);
  return sendToNetwork(cfg.host, cfg.port, buffer);
}

export async function printReceipt(receipt: Receipt): Promise<PrintResult> {
  const cfg = getConfig();
  if (cfg.type === 'none') {
    return { ok: false, message: 'Printer sozlanmagan (Administrator → Qurilmalar)' };
  }
  try {
    const buffer = buildReceiptBuffer(receipt, cfg.width, cfg.autoCut);
    await sendBuffer(cfg, buffer);
    return { ok: true, message: 'Chek chop etildi' };
  } catch (e) {
    // TZ F-6.8: printer xatosi (qog'oz tugashi, uzilish) holatida xabar
    return { ok: false, message: `Printer xatosi: ${(e as Error).message}` };
  }
}

// Oshxona chekini barcha oshxona printerlariga yuborish (buyurtma yuborilganda).
// Best-effort: ba'zi printer ishlamasa ham qolganlariga yuboriladi.
export async function printKitchen(order: Order): Promise<PrintResult> {
  const cfg = getConfig();
  const printers = cfg.kitchen || [];
  if (printers.length === 0) {
    return { ok: false, message: 'Oshxona printeri sozlanmagan' };
  }
  const results = await Promise.allSettled(
    printers.map((p) =>
      sendToNetwork(p.host, p.port, buildKitchenTicketBuffer(order, p.width || 48, cfg.autoCut)),
    ),
  );
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const fail = results.length - ok;
  return {
    ok: ok > 0,
    message: fail === 0 ? `Oshxonaga chop etildi (${ok})` : `${ok} ta chop etildi, ${fail} ta xato`,
  };
}

// Zakas cheki — asosiy (kassa) printerga. Har terminaldagi buyurtma kassada chiqadi (#11).
export async function printOrderTicket(order: Order): Promise<PrintResult> {
  const cfg = getConfig();
  if (cfg.type === 'none') {
    return { ok: false, message: 'Printer sozlanmagan' };
  }
  try {
    const buffer = buildKitchenTicketBuffer(order, cfg.width, cfg.autoCut);
    await sendBuffer(cfg, buffer);
    return { ok: true, message: 'Zakas cheki chop etildi' };
  } catch (e) {
    return { ok: false, message: `Printer xatosi: ${(e as Error).message}` };
  }
}

// Sinov cheki (Admin sozlamalarini tekshirish uchun)
export async function testPrint(): Promise<PrintResult> {
  const demo: Receipt = {
    orderId: 'test',
    tableNumber: 0,
    waiterName: 'Sinov',
    cashierName: 'Sinov',
    lines: [{ name: 'Sinov taom', quantity: 1, price: 10000, sum: 10000 }],
    subtotal: 10000,
    discountPercent: 0,
    discountAmount: 0,
    serviceFeePercent: 0,
    serviceFeeAmount: 0,
    total: 10000,
    paymentType: 'naqd' as Receipt['paymentType'],
    createdAt: new Date().toISOString(),
    fiscalQrPlaceholder: true,
  };
  return printReceipt(demo);
}
