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
  OrderType,
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
  hasPassword?: boolean; // login/parol bilan kira oladimi (parol o'rnatilgan)
  mustChangePassword?: boolean; // birinchi kirishda parolni almashtirish shart
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
  extraStationIds?: string[] | null; // qo'shimcha printerlar: chek nusxasi ham shu bo'limlarga (masalan Kassa nazorati)
  image?: string | null; // rasm (data URL) — FAQAT yuklash/tahrirlashda yuboriladi; ro'yxatlarda kelmaydi
  imageUrl?: string | null; // rasm manzili: '/api/menu/items/<id>/image?v=<n>' (server URL oldiga qo'shiladi)
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
  /** o'rtacha og'irlikdagi birlik tannarxi (so'm, 4 xonagacha) — server hisoblaydi (0.3.3) */
  avgCost?: number;
  /** nechta taom retseptida ishlatiladi (o'chirish va ko'rsatish uchun) */
  recipeCount?: number;
  /** harakatlari bormi — bor bo'lsa o'lchov birligi o'zgarmaydi */
  hasHistory?: boolean;
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
  supplier: string; // ta'minotchi nomi (kim/qayerdan)
  supplierId?: string | null; // ta'minotchi (0.3.3 — ro'yxatdan)
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
  createdAt?: string; // ISO — taom buyurtmaga qo'shilgan vaqt (ofitsiant ekranida HH:MM)
  takeaway?: boolean; // stoldagi mehmon olib ketadi (saboy) — xizmat haqi olinmaydi, oshxona cheki/KDS'da belgilanadi
  priceOverridden?: boolean; // narx kassir/direktor tomonidan qo'lda o'zgartirilgan (chek/tarixda belgilanadi)
  originalPrice?: number | null; // menyudagi asl narx (o'zgartirilgan bo'lsa)
  // Qulaylik uchun (server to'ldiradi):
  menuItemName?: string;
  price?: number;
}

/** orders — buyurtmalar */
export interface Order {
  id: string;
  type?: OrderType; // buyurtma turi (server doim to'ldiradi; eski buyurtmalar — 'stol')
  phone?: string | null; // yetkazish: mijoz telefoni (+998901234567 ko'rinishida)
  deliveryFee?: number; // yetkazish narxi (so'm; faqat yetkazishda; jami summaga qo'shiladi)
  address?: string | null; // yetkazish: manzil
  tableId: string | null; // stol_id (olib ketish / yetkazishda null)
  checkNo?: number | null; // stolda alohida hisob raqami: 1, 2, 3… (bitta stolda bir nechta hisob); boshqa turlarda null
  billPrintedAt?: string | null; // schot (hisob cheki) mijozga berilgan vaqt — "chek berildi"; yangi taom qo'shilsa tozalanadi
  waiterId: string; // ofitsiant_id
  status: OrderStatus; // holat
  openedAt: string; // ochilgan_vaqt (ISO)
  closedAt?: string | null; // yopilgan_vaqt
  queueNumber?: number | null; // olib ketish / yetkazish: kunlik tartib raqam (#12, har kuni 1 dan); stolda null
  items: OrderItem[];
  // Chek sozlamalari (ofitsiant/kassir kiritadi):
  servicePercent?: number; // xizmat haqi foizi (Обслуга %) — yaratilganda: stolga = sozlamadagi foiz, boshqasi = 0
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
  total?: number; // jami (to'lanadigan) summa = subtotal - chegirma + xizmat (calcOrderTotals; ustiga yana xizmat QO'SHILMAYDI)
  paidAmount?: number; // to'langan summa (bo'lib to'lash uchun)
  payments?: Payment[]; // to'lovlar ro'yxati (naqd/karta/click)
  waiterName?: string | null; // ofitsiant ismi (tarix uchun)
  paymentType?: PaymentType | (string & {}); // asosiy to'lov usuli kaliti (yopilgan bo'lsa)
  refunded?: boolean; // vozvrat qilinganmi
  refundReason?: string | null; // vozvrat sababi
  refundedAt?: string | null; // vozvrat vaqti (ISO)
  refundedByName?: string | null; // kim vozvrat qildi (tarix qatorlarida)
}

/**
 * POST /api/orders/:id/split — stol hisobini bo'lish ("Hisob 1 / Hisob 2").
 * Tanlangan taomlar (miqdori bilan) yangi hisobga (yoki shu stoldagi boshqa ochiq hisobga) ko'chadi.
 */
export interface SplitOrderRequest {
  items: { orderItemId: string; quantity: number }[];
  targetOrderId?: string; // berilmasa — shu stolda YANGI hisob ochiladi
}

export interface SplitOrderResult {
  source: Order; // qolgan hisob
  target: Order; // taomlar ko'chgan hisob
}

/**
 * Otkaz (yuborilgan taomni bekor qilish) — POST /api/orders/:id/remove-items.
 * items: qator va miqdor (qisman otkaz: 3 tadan 1 tasi). itemIds — eski shakl (butun qator).
 * Faqat 'void' ruxsati bor xodim (kassir / administrator / direktor).
 */
export interface VoidItemsRequest {
  items?: { orderItemId: string; quantity: number }[];
  itemIds?: string[];
  reason?: string; // otkaz sababi ("Mijoz voz kechdi", "Xato kiritildi" …)
}

/** POST /api/orders/:id/cancel — butun hisobni bekor qilish (to'lov bo'lmasa) */
export interface CancelOrderRequest {
  reason?: string;
}

/** void_log — otkazlar jurnali (direktor nazorati: kim, qachon, nimani, nima sababdan) */
export interface VoidLog {
  id: string;
  createdAt: string; // ISO
  orderId: string;
  orderName: string | null;
  orderType: OrderType | null;
  menuItemId: string | null;
  name: string; // taom nomi (snapshot)
  quantity: number;
  unit: MenuUnit | null;
  price: number;
  sum: number; // lineSum(price, quantity)
  reason: string | null;
  userId: string | null;
  userName: string | null;
  wholeOrder: boolean; // butun hisob bekor qilinganda
  sentToKitchen: boolean; // oshxonaga yuborilgan edimi (OTKAZ cheki chiqarildimi)
}

/**
 * POST /api/orders/:id/change-type — buyurtma turini o'zgartirish (eski POS'dagi "Turi" tugmasi):
 * Stolga / Olib ketish / Yetkazib berish. Stolga o'tkazishda stol (va ixtiyoriy hisob raqami),
 * yetkazishga o'tkazishda telefon + manzil kerak.
 */
export interface ChangeOrderTypeRequest {
  type: OrderType;
  tableId?: string; // 'stol' ga o'tkazishda — qaysi stol
  checkNo?: number; // shu stolda qaysi hisob (berilmasa — keyingi bo'sh raqam)
  phone?: string; // 'yetkazish' uchun
  address?: string; // 'yetkazish' uchun
}

/** GET /api/orders/delivery-lookup?phone= — shu telefon bilan oldingi yetkazish (manzilni avtomatik to'ldirish) */
export interface DeliveryLookup {
  phone: string; // normallashtirilgan: +998901234567
  address: string | null; // oxirgi yetkazish manzili
  customerName: string | null; // CRM'dagi mijoz ismi (bo'lsa)
  ordersCount: number; // shu raqam bilan avvalgi yetkazishlar soni
}

/** POS uchun ochiq sozlamalar (GET /api/settings/pos — istalgan xodim o'qiydi) */
export interface PosSettings {
  restaurantName: string;
  serviceDineInPercent: number; // stolga buyurtmalarga avtomatik xizmat haqi foizi (masalan 6) — umumiy
  // Quyidagilar server tomonidan doim to'ldiriladi (ixtiyoriy — eski/qisman javoblar bilan moslik uchun):
  hallServicePercent?: Record<string, number>; // zal bo'yicha alohida foiz (masalan {"Banket zal": 10}); yo'q bo'lsa — umumiy
  waiterSharePercent?: number; // ofitsiant ulushi: stolga buyurtmalar summasidan % (masalan 5) — ofitsiantlar hisobotida
  deliveryFeeDefault?: number; // yangi yetkazish buyurtmasi uchun standart yetkazish narxi (so'm; 0 = yo'q)
  paymentMethods?: PaymentMethod[]; // faol to'lov usullari (to'lov oynasida shu tartibda)
  hallOrder: string[]; // zallar tartibi (ofitsiant/kassa ekranida shu tartibda chiqadi)
  /** restoran Sklad (ombor) ishlatadimi — kamida bitta mahsulot bor (vozvratda "skladga qaytarish" belgisi) */
  skladEnabled?: boolean;
}

/**
 * print_jobs — bo'lim (oshxona/bar) cheklari navbati. Har bir chek avval bazaga yoziladi, keyin
 * chop etiladi; printer/svet o'chgan bo'lsa navbatda qoladi va printer tiklanishi bilan avtomatik chiqadi.
 *  pending   — hali chiqmagan (avtomatik qayta urinilmoqda)
 *  printed   — chiqdi
 *  expired   — 3 soat ichida chiqmadi (avtomatik urinish to'xtadi — qo'lda chiqarish mumkin)
 *  cancelled — xodim bekor qildi
 */
export type PrintJobStatus = 'pending' | 'printed' | 'expired' | 'cancelled';

export interface PrintJob {
  id: string;
  createdAt: string; // ISO — chek navbatga qo'yilgan vaqt (buyurtma vaqti)
  orderId: string | null;
  orderName: string | null; // "Stol 5" / "Olib ketish #12"
  stationId: string | null;
  stationName: string;
  host: string;
  port: number;
  append: boolean; // QO'SHIMCHA cheki
  itemsCount: number; // chekdagi qatorlar soni
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: string | null;
  printedAt: string | null;
}

/** To'lov usuli turi: naqd, karta (terminal), onlayn (Click/Payme/QR), qarz, boshqa (maxsus) */
export type PaymentMethodKind = 'cash' | 'card' | 'online' | 'debt' | 'other';

/** Sozlamadagi to'lov usuli (direktor nomini o'zgartiradi, o'chiradi, yangisini qo'shadi) */
export interface PaymentMethod {
  key: string; // payments.type ga yoziladi: 'naqd', 'karta', 'click', 'payme', 'qr', 'qarz', yoki maxsus slug
  label: string; // ekrandagi va chekdagi nom: "Naqd", "Terminal (karta)", "Click", "Qarzga"
  kind: PaymentMethodKind;
  active: boolean;
}

/**
 * POST /api/orders/:id/pay-multi — bir nechta usul bilan birdaniga to'lash (eski POS'dagi to'lov oynasi):
 * masalan 20 000 naqd + 8 620 Click. 'debt' (qarzga) usuli uchun debtor (ism, telefon) majburiy.
 */
export interface PayMultiRequest {
  payments: { type: string; amount: number }[];
  discountPercent?: number;
  serviceFeePercent?: number;
  debtor?: { name: string; phone?: string };
}

/** payments — to'lovlar */
export interface Payment {
  id: string;
  orderId: string; // buyurtma_id
  amount: number; // summa
  type: PaymentType | (string & {}); // to'lov usuli kaliti: 'naqd' | 'karta' | 'qr' | 'click' | 'payme' | 'qarz' | maxsus (sozlamadagi paymentMethods)
  cashierId: string; // kassir_id
  createdAt: string; // vaqt
  debtorName?: string | null; // 'qarzga' to'lovida — kim qarzdor
  debtorPhone?: string | null;
  label?: string; // to'lov usuli nomi (server to'ldiradi)
  cashierName?: string | null; // kim qabul qildi (server to'ldiradi)
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
  takeaway?: boolean; // olib ketish (saboy) qatori — chekda belgilanadi, xizmat haqi olinmagan
  priceOverridden?: boolean; // narx qo'lda o'zgartirilgan (B31)
  originalPrice?: number | null; // menyudagi asl narx
}

/** Chek ma'lumoti — kassa to'lovni yopganda qaytadi (TZ F-3.4 / 6-bo'lim) */
export interface Receipt {
  orderId: string;
  orderType?: OrderType; // stol / olib ketish / yetkazish (chek sarlavhasi uchun)
  queueNumber?: number | null; // olib ketish / yetkazish raqami (#12)
  checkNo?: number | null; // stol hisobi raqami (2 va undan katta bo'lsa chekda "Hisob 2")
  phone?: string | null; // yetkazish: mijoz telefoni
  address?: string | null; // yetkazish: manzil
  deliveryFee?: number; // yetkazish narxi
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
  paymentType: PaymentType | (string & {}); // asosiy (oxirgi) to'lov usuli kaliti
  payments?: { type: PaymentType | (string & {}); amount: number; label?: string }[]; // bo'lib to'langan bo'lsa (naqd+karta+...); label — usul nomi
  restaurantName?: string; // chek sarlavhasi (sozlamadagi restoran nomi)
  note?: string | null; // chekka izoh (Примечание)
  customerName?: string | null; // mijoz (CRM)
  createdAt: string;
  // Fiskal QR uchun joy (TZ F-6.7)
  fiscalQrPlaceholder: boolean;
  // Fiskal modul yoqilgan bo'lsa to'ldiriladi (TZ 8.1)
  fiscalNumber?: string;
  fiscalQr?: string; // QR ichidagi ma'lumot (chekda QR rasm sifatida chiziladi)
}
