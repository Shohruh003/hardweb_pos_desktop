// Direktor hisobotlari uchun turlar (TZ 5.5)
import { PaymentType } from './enums';

export type ReportPeriod = 'day' | 'week' | 'month';

export interface ReportSummary {
  period: ReportPeriod;
  revenue: number; // umumiy tushum
  ordersCount: number; // yopilgan hisoblar soni
  avgCheck: number; // o'rtacha chek
  paymentBreakdown: { type: PaymentType; amount: number }[]; // to'lov turlari bo'yicha
}

export interface TopItem {
  name: string;
  quantity: number;
  sum: number;
}

export interface WaiterStat {
  waiterName: string;
  ordersCount: number;
  revenue: number;
}
