// Chek printeri servisi (main jarayon). ESC/POS buferini tarmoq (TCP) printerga yuboradi.
// TZ F-6.2: ulanish turlari — Tarmoq (LAN/Wi-Fi/IP). USB keyingi bosqichda.
import { app } from 'electron';
import { connect } from 'net';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Receipt } from '@hardweb-pos/shared';
import { buildReceiptBuffer } from './escpos';

export interface PrinterConfig {
  type: 'network' | 'none';
  host: string;
  port: number; // odatda 9100
  width: number; // 32 (58mm) yoki 48 (80mm)
}

const DEFAULT_CONFIG: PrinterConfig = {
  type: 'none',
  host: '192.168.1.50',
  port: 9100,
  width: 32,
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

export interface PrintResult {
  ok: boolean;
  message: string;
}

export async function printReceipt(receipt: Receipt): Promise<PrintResult> {
  const cfg = getConfig();
  if (cfg.type === 'none') {
    return { ok: false, message: 'Printer sozlanmagan (Administrator → Qurilmalar)' };
  }
  try {
    const buffer = buildReceiptBuffer(receipt, cfg.width);
    await sendToNetwork(cfg.host, cfg.port, buffer);
    return { ok: true, message: 'Chek chop etildi' };
  } catch (e) {
    // TZ F-6.8: printer xatosi (qog'oz tugashi, uzilish) holatida xabar
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
