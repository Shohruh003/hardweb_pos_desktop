// Socket.IO real-time event nomlari (TZ 2.2 ma'lumotlar oqimi).
// Server <-> terminal (ofitsiant/kassa/KDS/navbat) o'rtasida.

import { Order, OrderStatus } from './index';

export const SOCKET_EVENTS = {
  // Server -> KDS / navbat: yangi buyurtma keldi
  ORDER_CREATED: 'order:created',
  // Server -> hammaga: buyurtma holati o'zgardi (tayyorlanmoqda/tayyor)
  ORDER_UPDATED: 'order:updated',
  // Server -> ofitsiant/navbat: buyurtma tayyor bo'ldi
  ORDER_READY: 'order:ready',
  // Server -> hammaga: buyurtma yopildi (hisob to'landi)
  ORDER_CLOSED: 'order:closed',
  // Server -> printerli terminal (kassa): hisob (schot) chekini chop et
  PRINT_BILL: 'print:bill',
  // Server -> printerli terminal (kassa): to'lov chekini chop et
  PRINT_RECEIPT: 'print:receipt',
  // Server -> hammaga (kassa ko'rsatadi): bo'lim (oshxona/bar) printeriga chek chiqmadi
  PRINT_FAILED: 'print:failed',
  // Server -> hammaga (kassa ko'rsatadi): navbatda turgan (chiqmay qolgan) chek keyinroq chiqarildi
  PRINT_RECOVERED: 'print:recovered',
  // Server -> hammaga (KDS/oshxona ko'rsatadi): yuborilgan taom(lar) otkaz qilindi (bekor qilindi)
  ORDER_VOIDED: 'order:voided',
  // Server -> hammaga (kassa/admin holat qatori): printerlar holati o'zgardi (yoqiq / javob bermayapti)
  PRINTERS_STATUS: 'printers:status',
  // Server -> hammaga: menyu o'zgardi (stop list — taom tugadi / qaytdi, narx, rasm) — ekranlar menyuni yangilaydi
  MENU_CHANGED: 'menu:changed',
} as const;

/** Bo'lim printeri holati — GET /api/printing/status va 'printers:status' hodisasi */
export interface PrinterStatus {
  stationId: string;
  stationName: string; // "Oshxona"
  host: string; // "192.168.1.221"
  port: number;
  online: boolean; // oxirgi tekshiruvda javob berdimi
  lastCheckAt: string | null; // ISO
  lastOkAt: string | null; // ISO — oxirgi marta javob bergan vaqt
  pendingJobs: number; // navbatda chiqmay turgan cheklar soni (B17)
}

export interface PrintersStatusPayload {
  printers: PrinterStatus[];
}

/** Otkaz: yuborilgan taom(lar) yoki butun hisob bekor qilinganda */
export interface OrderVoidedPayload {
  orderId: string;
  orderName: string; // "Stol 5" / "Olib ketish #12"
  items: { name: string; quantity: number; unit?: string | null; stationName?: string | null }[];
  reason: string | null;
  userName: string | null; // kim otkaz qildi
  wholeOrder: boolean; // butun hisob bekor qilindimi
}

/** Bo'lim printeriga chek chiqmaganda server yuboradigan xabar */
export interface PrintFailedPayload {
  orderId?: string;
  tableNumber?: number;
  orderName?: string; // "Stol 5" / "Olib ketish #12" / "Yetkazish #5" (orderDisplayName)
  station: string; // bo'lim nomi (masalan "Oshxona")
  host: string; // printer IP
  message: string; // xato sababi (o'zbekcha)
}

/** Chiqmay qolgan chek (svet/printer o'chgan) printer tiklangach chiqarilganda */
export interface PrintRecoveredPayload {
  jobId: string;
  orderId?: string | null;
  orderName?: string | null; // "Olib ketish #12"
  station: string; // bo'lim nomi
  host: string; // printer IP
  delayedSeconds: number; // buyurtmadan necha soniya keyin chiqdi
}

export interface OrderCreatedPayload {
  order: Order;
}

export interface OrderUpdatedPayload {
  orderId: string;
  status: OrderStatus;
  order: Order;
}
