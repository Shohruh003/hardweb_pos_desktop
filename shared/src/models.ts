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
  MenuUnit,
  ProductUnit,
} from './enums';

/** users — xodimlar */
export interface User {
  id: string;
  name: string; // ism
  role: UserRole; // rol
  login?: string | null;
  pin?: string | null; // 4 xonali kirish kodi
  active: boolean; // faol
  permissions?: string[]; // qo'shimcha ruxsatlar (direktor beradi)
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

/** stations — tayyorlash bo'limlari (sexlar): oshxona, bar, somsaxona, novvoyxona */
export interface Station {
  id: string;
  name: string; // nom (Oshxona, Bar, Somsaxona, Novvoyxona)
  printerHost: string; // bo'lim printeri IP (LAN) — bo'sh bo'lsa chek chiqmaydi
  printerPort: number; // odatda 9100
  printerWidth: number; // 32 (58mm) yoki 48 (80mm)
  sortOrder: number;
}

/** menu_items — taomlar */
export interface MenuItem {
  id: string;
  name: string; // nom
  price: number; // narx (dona uchun — bir dona narxi; kg uchun — 1 kg narxi)
  categoryId: string; // kategoriya_id (birinchi/ikkinchi taom, salat, shirinlik...)
  stationId?: string | null; // qaysi bo'limdan chiqadi (oshxona/bar/somsaxona...)
  image?: string | null; // rasm
  ingredients?: string | null; // taomga ketadigan mahsulotlar
  available: boolean; // mavjud
  exciseRequired: boolean; // aksiz_kerakmi (2-bosqich)
  unit?: MenuUnit; // dona yoki kg (kiloda sotiladigan taomlar uchun)
  favorite?: boolean; // sevimli (tez-tez sotiladigan) — ofitsiantда tez topish uchun
}

/** products — sklad (ombor) mahsulotlari (masalan: guruch, go'sht, non) */
export interface Product {
  id: string;
  name: string; // nom
  unit: ProductUnit; // o'lchov birligi (kg, g, l, ml, dona)
  stock: number; // ombordagi qoldiq
  minStock: number; // minimal qoldiq (kam qolganda ogohlantirish)
}

/** customers — mijozlar (CRM) */
export interface Customer {
  id: string;
  name: string;
  phone: string;
  note?: string | null;
  createdAt: string;
}

/** purchases — sklad kirimi: mahsulot kimdan/qayerdan, qancha narxда olindi */
export interface Purchase {
  id: string;
  productId: string;
  productName: string; // nom (kirim paytидаги)
  unit: ProductUnit; // o'lchov birligi
  supplier: string; // ta'minotchi (kim/qayerdan)
  quantity: number; // olingan miqdor
  unitPrice: number; // birlik narxi (so'm)
  total: number; // umumiy summa (quantity * unitPrice)
  note?: string | null;
  createdAt: string; // ISO
}

/** recipe_items — taom retsepti: bir taomga qaysi mahsulotdan qancha ketadi */
export interface RecipeItem {
  id: string;
  menuItemId: string; // taom_id
  productId: string; // mahsulot_id
  amount: number; // taomning 1 birligiga ketadigan miqdor (mahsulot birligida)
  // Qulaylik uchun (server to'ldiradi):
  productName?: string;
  productUnit?: ProductUnit;
}

/** order_items — buyurtmadagi taomlar */
export interface OrderItem {
  id: string;
  orderId: string; // buyurtma_id
  menuItemId: string; // taom_id
  quantity: number; // miqdor (dona: butun son; kg: kasr bo'lishi mumkin — 1.5, 1.75)
  unit?: MenuUnit; // dona yoki kg
  stationId?: string | null; // qaysi bo'lim tayyorlaydi (chek yo'naltirish uchun)
  stationName?: string | null; // bo'lim nomi (snapshot)
  note?: string | null; // izoh (masalan "tuzsiz")
  status: OrderItemStatus; // holat
  exciseRequired?: boolean; // aksiz kodi kerakmi (TZ F-8.5)
  exciseCode?: string | null; // skanerlangan aksiz kodi (bo'lsa)
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
  // Chek sozlamalari (ofitsiant/kassir kiritadi):
  servicePercent?: number; // xizmat haqi foizi (Обслуга %)
  discountPercent?: number; // chegirma foizi (Скидка %)
  note?: string | null; // chekka izoh (Примечание)
  customerId?: string | null; // mijoz (CRM)
  customerName?: string | null; // mijoz ismi
  // Qulaylik uchun (server to'ldiradi):
  tableNumber?: number;
  hall?: string | null; // zal nomi (tarix/filtr uchun)
  subtotal?: number; // taomlar summasi (chegirma/xizmatsiz)
  serviceAmount?: number; // xizmat haqi summasi
  discountAmount?: number; // chegirma summasi
  total?: number; // jami summa (subtotal + xizmat - chegirma)
  paidAmount?: number; // to'langan summa (bo'lib to'lash uchun)
  payments?: Payment[]; // to'lovlar ro'yxati (naqd/karta/click)
  waiterName?: string | null; // ofitsiant ismi (tarix uchun)
  paymentType?: PaymentType; // to'lov turi (yopilgan bo'lsa)
  refunded?: boolean; // vozvrat qilinganmi
  refundReason?: string | null; // vozvrat sababi
  refundedAt?: string | null; // vozvrat vaqti (ISO)
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
  unit?: MenuUnit; // dona yoki kg (chekда "2 kg x ..." ko'rinishida chiqarish uchun)
}

/** Chek ma'lumoti — kassa to'lovni yopganda qaytadi (TZ F-3.4 / 6-bo'lim) */
export interface Receipt {
  orderId: string;
  tableNumber?: number;
  hall?: string | null; // zal / etaj nomi (chekда ko'rsatiladi)
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
  payments?: { type: PaymentType; amount: number }[]; // bo'lib to'langan bo'lsa (naqd+karta+...)
  note?: string | null; // chekka izoh (Примечание)
  customerName?: string | null; // mijoz (CRM)
  createdAt: string;
  // Fiskal QR uchun joy (TZ F-6.7)
  fiscalQrPlaceholder: boolean;
  // Fiskal modul yoqilgan bo'lsa to'ldiriladi (TZ 8.1)
  fiscalNumber?: string;
  fiscalQr?: string; // QR ichidagi ma'lumot (chekda QR rasm sifatida chiziladi)
}
