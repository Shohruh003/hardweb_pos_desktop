// TZ 10-bo'lim: "Ma'lumotlar bazasi obyektlari" asosida turlar.
// Maydon nomlari kodda inglizcha (standart), izohlarda TZ nomi keltirilgan.

import {
  UserRole,
  TableStatus,
  OrderStatus,
  OrderItemStatus,
  PaymentType,
  DeviceType,
  PrinterConnection,
} from './enums';

/** users — xodimlar */
export interface User {
  id: string;
  name: string; // ism
  role: UserRole; // rol
  login: string;
  active: boolean; // faol
  // parol_hash faqat serverda saqlanadi, mijozga yuborilmaydi
}

/** tables — stollar */
export interface Table {
  id: string;
  number: number; // raqam
  hall: string; // zal
  capacity: number; // sig'im
  status: TableStatus; // holat
}

/** categories — menyu kategoriyalari */
export interface Category {
  id: string;
  name: string; // nom
  sortOrder: number; // tartib
}

/** menu_items — taomlar */
export interface MenuItem {
  id: string;
  name: string; // nom
  price: number; // narx
  categoryId: string; // kategoriya_id
  image?: string | null; // rasm
  available: boolean; // mavjud
  exciseRequired: boolean; // aksiz_kerakmi (2-bosqich)
}

/** order_items — buyurtmadagi taomlar */
export interface OrderItem {
  id: string;
  orderId: string; // buyurtma_id
  menuItemId: string; // taom_id
  quantity: number; // miqdor
  note?: string | null; // izoh (masalan "tuzsiz")
  status: OrderItemStatus; // holat
  // Qulaylik uchun (server to'ldiradi):
  menuItemName?: string;
  price?: number;
}

/** orders — buyurtmalar */
export interface Order {
  id: string;
  tableId: string; // stol_id
  waiterId: string; // ofitsiant_id
  status: OrderStatus; // holat
  openedAt: string; // ochilgan_vaqt (ISO)
  closedAt?: string | null; // yopilgan_vaqt
  queueNumber?: number | null; // navbat_raqami
  items: OrderItem[];
  // Qulaylik uchun:
  tableNumber?: number;
  total?: number; // jami summa
}

/** payments — to'lovlar */
export interface Payment {
  id: string;
  orderId: string; // buyurtma_id
  amount: number; // summa
  type: PaymentType; // tur
  cashierId: string; // kassir_id
  createdAt: string; // vaqt
}

/** devices — qurilmalar (printer/skaner/ekran) */
export interface Device {
  id: string;
  type: DeviceType; // tur
  name: string; // nom
  connection: PrinterConnection | string; // ulanish
  settings: Record<string, unknown>; // sozlamalar (JSON)
}

/** shifts — smenalar */
export interface Shift {
  id: string;
  employeeId: string; // xodim_id
  startedAt: string; // boshlanish
  endedAt?: string | null; // tugash
}

/** fiscal_docs — fiskal hujjatlar (2-bosqich) */
export interface FiscalDoc {
  id: string;
  orderId: string;
  fiscalNumber: string; // fiskal_raqam
  qrCode: string; // qr_kod
  createdAt: string; // vaqt
}

/** Chek satri (chek shabloni uchun) */
export interface ReceiptLine {
  name: string;
  quantity: number;
  price: number;
  sum: number; // price * quantity
}

/** Chek ma'lumoti — kassa to'lovni yopganda qaytadi (TZ F-3.4 / 6-bo'lim) */
export interface Receipt {
  orderId: string;
  tableNumber?: number;
  waiterName?: string;
  cashierName?: string;
  lines: ReceiptLine[];
  subtotal: number; // chegirmagacha jami
  discountPercent: number;
  discountAmount: number;
  serviceFeePercent: number;
  serviceFeeAmount: number;
  total: number; // to'lanadigan yakuniy summa
  paymentType: PaymentType;
  createdAt: string;
  // Fiskal QR uchun joy (TZ F-6.7)
  fiscalQrPlaceholder: boolean;
  // Fiskal modul yoqilgan bo'lsa to'ldiriladi (TZ 8.1)
  fiscalNumber?: string;
  fiscalQr?: string; // QR ichidagi ma'lumot (chekda QR rasm sifatida chiziladi)
}
