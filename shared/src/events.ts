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
} as const;

export interface OrderCreatedPayload {
  order: Order;
}

export interface OrderUpdatedPayload {
  orderId: string;
  status: OrderStatus;
  order: Order;
}
