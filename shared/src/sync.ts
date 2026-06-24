// Lokal server -> Bulut bir tomonlama sinxronlash uchun turlar (TZ 2.3, 5-bosqich).
import { OrderStatus, PaymentType } from './enums';

// Bulutga yuboriladigan yopilgan buyurtma (denormalizatsiya — chek/hisobot uchun yetarli)
export interface SyncOrder {
  id: string;
  tableNumber: number | null;
  waiterName: string | null;
  status: OrderStatus;
  total: number;
  closedAt: string | null;
  openedAt: string;
  items: { name: string; quantity: number; price: number }[];
}

export interface SyncPayment {
  id: string;
  orderId: string;
  amount: number;
  type: PaymentType;
  createdAt: string;
}

// /api/sync ga yuboriladigan partiya
export interface SyncPayload {
  orders: SyncOrder[];
  payments: SyncPayment[];
}

export interface SyncResult {
  ordersSaved: number;
  paymentsSaved: number;
}
