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
} as const;

/** Bo'lim printeriga chek chiqmaganda server yuboradigan xabar */
export interface PrintFailedPayload {
  orderId?: string;
  tableNumber?: number;
  station: string; // bo'lim nomi (masalan "Oshxona")
  host: string; // printer IP
  message: string; // xato sababi (o'zbekcha)
}

export interface OrderCreatedPayload {
  order: Order;
}

export interface OrderUpdatedPayload {
  orderId: string;
  status: OrderStatus;
  order: Order;
}
