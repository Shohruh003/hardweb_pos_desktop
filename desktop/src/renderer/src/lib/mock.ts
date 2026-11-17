// Mock (soxta) rejim — prezentatsiya (DEMO o'rnatuvchisi, Netlify) uchun. Serversiz, in-memory
// ma'lumotlar bilan barcha ekranlar ishlaydi; real-time hodisalar (KDS, navbat, kassa, ofitsiant)
// ilova ichidagi socket shinasi (mockEmit) orqali yuboriladi.
// Bu modul FAQAT VITE_MOCK=1 bo'lganda api.ts tomonidan dinamik yuklanadi — real buildda
// bajarilmaydi. Ma'lumotlar birinchi so'rovda yaratiladi (lazy seed).
// Qoidalar va xato matnlari real server (server/src, 0.3.0) bilan BIR XIL saqlanadi: buyurtma turlari
// (stol / olib ketish / yetkazish), kunlik raqam, bitta stolda bir nechta hisob, bo'lish, otkaz,
// buyurtma amallari, to'lov usullari, qarz, kirim/chiqim, stop list, zallar, taom rasmlari va
// hisobotlar — demo real xatolarni yashirmasin va real xatti-harakatni ko'rsatsin.
import {
  ALL_CAPABILITY_KEYS,
  BILL_FORBIDDEN_MESSAGE,
  CHANGE_TYPE_FORBIDDEN_MESSAGE,
  MOVE_TABLE_FORBIDDEN_MESSAGE,
  ORDER_OWNER_MESSAGE,
  SPLIT_FORBIDDEN_MESSAGE,
  TABLE_OWNER_MESSAGE,
  canSeeOrder,
  canServeTable,
  capabilitiesForRole,
  isOrderManager,
  DEFAULT_PAYMENT_METHODS,
  MenuUnit,
  ORDER_TYPES,
  OrderItemStatus,
  OrderStatus,
  OrderType,
  ProductUnit,
  SETTABLE_ORDER_STATUSES,
  SOCKET_EVENTS,
  TableStatus,
  UserRole,
  calcOrderTotals,
  canChangeOrderStatus,
  clampPercent,
  defaultCapabilitiesForRole,
  hallServicePercentFor,
  hasCapability,
  isFullAccessRole,
  lineSum,
  normalizeUzPhone,
  orderDisplayName,
  orderTypeOf,
  paymentMethodLabel,
  remainingAmount,
  roundSum,
  sumPayments,
  // Sklad (0.3.3) — server bilan bir xil xabarlar va qoidalar
  COUNT_ITEMS_REQUIRED_MESSAGE,
  COUNT_VALUE_INVALID_MESSAGE,
  PRODUCTION_INPUTS_REQUIRED_MESSAGE,
  PRODUCTION_OUTPUT_REQUIRED_MESSAGE,
  PRODUCTION_SELF_MESSAGE,
  PRODUCT_NAME_REQUIRED_MESSAGE,
  PRODUCT_NAME_TAKEN_MESSAGE,
  PRODUCT_NOT_FOUND_MESSAGE,
  STOCK_MOVEMENT_TYPES,
  STOCK_PRICE_INVALID_MESSAGE,
  STOCK_QTY_INVALID_MESSAGE,
  STOCK_QTY_POSITIVE_MESSAGE,
  STOCK_UNIT_LOCKED_MESSAGE,
  SUPPLIER_IN_USE_MESSAGE,
  SUPPLIER_NAME_REQUIRED_MESSAGE,
  SUPPLIER_NAME_TAKEN_MESSAGE,
  SUPPLIER_NOT_FOUND_MESSAGE,
  SUPPLIER_PAYMENT_AMOUNT_MESSAGE,
  SUPPLIER_PAYMENT_NOT_FOUND_MESSAGE,
  nextAvgCost,
  productInRecipesMessage,
  roundStockCost,
  roundStockQty,
  stockNotEnoughMessage,
} from '@hardweb-pos/shared';
import type {
  CashSummary,
  DebtRow,
  DeliveryLookup,
  MenuItem,
  MyShare,
  Order,
  OrderItem,
  OrderTotals,
  OrderVoidedPayload,
  PaginatedMovements,
  Payment,
  PaymentMethod,
  PaymentMethodKind,
  PosSettings,
  PrinterStatus,
  Product,
  Purchase,
  Receipt,
  RecipeItem,
  SplitOrderResult,
  StockMovement,
  StockMovementType,
  Supplier,
  SupplierPayment,
  TopItem,
  User,
  VoidLog,
  VoidReport,
  WaiterShareReport,
  WaiterShareRow,
} from '@hardweb-pos/shared';
import { mockEmit } from './socket';

// ---- Noyob id ----
// crypto.randomUUID faqat xavfsiz kontekstda (https/localhost/file) mavjud; LAN'dagi http
// sahifada yo'q. Shuning uchun getRandomValues (hamma joyda bor) va Math.random zaxirasi.
function uid(): string {
  const c: Crypto | undefined = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* pastdagi usullar */
    }
  }
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // UUID v4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 varianti
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Demo xodimlarining id'si barqaror — sahifa yangilansa ham saqlangan sessiya (token) ishlayveradi
const demoUserId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// =============================================================================================
// Turlar
// =============================================================================================

interface MockUser {
  id: string;
  name: string;
  role: UserRole;
  login: string | null;
  pin: string | null;
  active: boolean;
  permissions: string[] | null;
  password: string | null; // demo: ochiq matn (real serverda bcrypt)
  mustChangePassword: boolean;
}
interface MockItem {
  id: string;
  orderId: string;
  menuItemId: string;
  menuItemName: string;
  price: number;
  quantity: number;
  unit: MenuUnit;
  note: string | null;
  status: OrderItemStatus;
  exciseRequired: boolean;
  exciseCode: string | null;
  stationId: string | null;
  stationName: string | null;
  createdAt: string; // taom buyurtmaga qo'shilgan vaqt (ISO)
  takeaway: boolean; // stoldagi mehmon olib ketadi (saboy) — xizmat haqi olinmaydi
  priceOverridden: boolean;
  originalPrice: number | null;
}
// Bazadagi buyurtma qatori (server OrderEntity kabi) — DTO (stol raqami, summalar...) toDto()da quriladi
interface MockOrder {
  id: string;
  type: OrderType;
  tableId: string | null;
  checkNo: number | null;
  waiterId: string;
  status: OrderStatus;
  openedAt: string;
  closedAt: string | null;
  queueNumber: number | null;
  businessDate: string | null;
  phone: string | null;
  address: string | null;
  deliveryFee: number;
  billPrintedAt: string | null;
  items: MockItem[];
  note: string | null;
  discountPercent: number;
  servicePercent: number;
  customerId: string | null;
  customerName: string | null;
  refunded: boolean;
  refundReason: string | null;
  refundedAt: string | null;
  refundedBy: string | null;
}
interface MockCustomer { id: string; name: string; phone: string; note: string | null; createdAt: string }
interface MockPayment {
  id: string;
  orderId: string;
  amount: number;
  type: string; // to'lov usuli kaliti
  cashierId: string;
  createdAt: string;
  debtorName: string | null; // 'Qarzga' to'lovida
  debtorPhone: string | null;
  debtRepaidAt: string | null; // qarz qaytarilganda (B34)
  debtRepaidBy: string | null;
  debtRepaidType: string | null;
}
interface MockTable { id: string; number: number; hall: string; capacity: number; status: TableStatus }
interface MockCategory { id: string; name: string; sortOrder: number }
interface MockStation {
  id: string;
  name: string;
  printerHost: string;
  printerPort: number;
  printerWidth: number;
  sortOrder: number;
}
interface MockMenuItem {
  id: string;
  name: string;
  price: number;
  categoryId: string;
  stationId: string | null;
  available: boolean;
  exciseRequired: boolean;
  image: string | null; // data URL (demo xotirada saqlaydi)
  imageVersion: number;
  unit: MenuUnit;
  favorite: boolean;
  ingredients: string | null;
}
// ---- Sklad (ombor) — server products / recipe_items / purchases / suppliers / supplier_payments /
// stock_movements jadvallari kabi (0.3.3) ----
interface MockProduct {
  id: string;
  name: string;
  unit: ProductUnit;
  stock: number; // 3 xona
  minStock: number;
  avgCost: number; // o'rtacha og'irlikdagi birlik tannarxi (4 xona)
}
/** Taom retsepti qatori: 1 birlik taomga ketadigan mahsulot miqdori */
interface MockRecipeItem { id: string; menuItemId: string; productId: string; amount: number }
interface MockSupplier { id: string; name: string; phone: string | null; note: string | null; createdAt: string }
/** Kirim (quantity > 0) yoki ta'minotchiga vozvrat (quantity < 0, total < 0) */
interface MockPurchase {
  id: string;
  productId: string;
  productName: string; // snapshot
  unit: ProductUnit;
  supplier: string; // ta'minotchi nomi (snapshot; ta'minotchi qayta nomlansa — yangilanadi)
  supplierId: string | null;
  quantity: number;
  unitPrice: number;
  total: number; // butun so'm
  note: string | null;
  createdAt: string;
}
interface MockSupplierPayment {
  id: string;
  supplierId: string | null;
  supplier: string; // nom (snapshot; qayta nomlansa — yangilanadi)
  amount: number;
  note: string | null;
  userName: string | null;
  createdAt: string;
}
/** Ombor harakati (jurnal qatori) — userId faqat ichkarida saqlanadi */
interface MockMovement extends StockMovement {
  userId: string | null;
}
type CashKind = 'kirim' | 'chiqim';
interface MockExpense {
  id: string;
  amount: number;
  note: string | null;
  kind: CashKind;
  cashierId: string;
  cashierName: string | null;
  createdAt: string;
}
interface MockSettings {
  id: 'main';
  restaurantName: string;
  telegramToken: string;
  telegramChatId: string;
  dailyReportTime: string;
  /** Har kuni bazaning zaxira nusxasi Telegram'ga (server TelegramBackupService) */
  telegramBackup: boolean;
  telegramBackupAt: string | null;
  serviceDineInPercent: number;
  waiterSharePercent: number;
  hallOrder: string[];
  hallServicePercent: Record<string, number>;
  deliveryFeeDefault: number;
  paymentMethods: PaymentMethod[] | null; // null — standart ro'yxat
  dataVersion: number;
}
/** Takroriy so'rov (clientRequestId) yozuvi */
interface RememberedRequest { orderId: string; at: number; snapshot: Order }
/** Otkaz qilingan qator */
interface VoidedLine {
  menuItemId: string | null;
  name: string;
  quantity: number;
  unit: MenuUnit;
  price: number;
  stationId: string | null;
  stationName: string | null;
}
/** Pul hisobiga kerakli qator maydonlari */
interface MoneyItem { price: number | string; quantity: number | string; takeaway?: boolean | null }
/** POST /orders/:id/pay va /pay-multi javobi */
interface PayResult {
  order: Order;
  receipt?: Receipt;
  fullyPaid: boolean;
  paidAmount: number;
  total: number;
  payments: Payment[];
}

// =============================================================================================
// Xotiradagi "baza" (ensureSeeded() birinchi so'rovda to'ldiradi)
// =============================================================================================

let seeded = false;
let categories: MockCategory[] = [];
// Bo'limlar (sexlar) — chekni printerlarga yo'naltirish uchun
let stations: MockStation[] = [];
let menu: MockMenuItem[] = [];
let tables: MockTable[] = [];
// Sklad (ombor): mahsulotlar, retseptlar (1 birlik taomga), ta'minotchilar, kirim/vozvratlar,
// ta'minotchiga to'lovlar va harakatlar jurnali (qoldiqning HAR BIR o'zgarishi — applyMovement orqali)
let products: MockProduct[] = [];
let recipeItems: MockRecipeItem[] = [];
let suppliers: MockSupplier[] = [];
let purchases: MockPurchase[] = [];
let supplierPayments: MockSupplierPayment[] = [];
let movements: MockMovement[] = [];
let users: MockUser[] = [];
let settings: MockSettings = defaultSettings();
let terminals: any[] = [];
// Kassa harakatlari: chiqim (rasxod) va kirim (B33)
let expenses: MockExpense[] = [];
let orders: MockOrder[] = [];
let customers: MockCustomer[] = [];
let payments: MockPayment[] = [];
// Otkazlar jurnali (B19)
let voidLogs: VoidLog[] = [];
// Fiskal hujjatlar (orderId -> raqam, QR) — chekni qayta chop etish uchun
let fiscalDocs = new Map<string, { fiscalNumber: string; qr: string }>();
let fiscalCounter = 0;
// Kunlik buyurtma raqami hisoblagichi (B27b): businessDate -> oxirgi raqam (bekor qilingan raqam qaytmaydi)
let dailyCounters = new Map<string, number>();
// Takroriy yuborishdan himoya (B32): clientRequestId -> natija, 24 soat
let recentRequests = new Map<string, RememberedRequest>();

const A_CAPS = ['history', 'reports', 'menu', 'inventory', 'stations', 'tables', 'staff', 'devices', 'terminals', 'settings', 'refund', 'void', 'cashier', 'revenue'];

/** Demo: shu bo'lim printeri "javob bermayapti" (holat qatorida qizil holatni ko'rsatish uchun) */
const DEMO_OFFLINE_STATION = 'Somsaxona';

function defaultSettings(): MockSettings {
  return {
    id: 'main',
    restaurantName: 'DasturXon',
    telegramToken: '',
    telegramChatId: '',
    dailyReportTime: '23:59',
    telegramBackup: true,
    telegramBackupAt: null,
    // Demo: stolga buyurtmalarga 10% xizmat haqi (server demo seed'i bilan bir xil), VIP zalda alohida 15%,
    // ofitsiant ulushi 5%, yetkazish narxi 10 000 so'm — imkoniyatlar ko'rinib tursin
    serviceDineInPercent: 10,
    waiterSharePercent: 5,
    hallOrder: [],
    hallServicePercent: { 'VIP zal': 15 },
    deliveryFeeDefault: 10000,
    paymentMethods: null,
    dataVersion: 4,
  };
}

function ensureSeeded(): void {
  if (seeded) return;
  seeded = true;

  categories = [
    { id: uid(), name: 'Issiq taomlar', sortOrder: 1 },
    { id: uid(), name: 'Salatlar', sortOrder: 2 },
    { id: uid(), name: 'Ichimliklar', sortOrder: 3 },
  ];
  stations = [
    { id: uid(), name: 'Oshxona', printerHost: '192.168.1.221', printerPort: 9100, printerWidth: 48, sortOrder: 1 },
    { id: uid(), name: 'Bar', printerHost: '192.168.1.222', printerPort: 9100, printerWidth: 48, sortOrder: 2 },
    { id: uid(), name: 'Somsaxona', printerHost: '192.168.1.223', printerPort: 9100, printerWidth: 48, sortOrder: 3 },
    { id: uid(), name: 'Novvoyxona', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 4 },
  ];
  const stId = (n: string) => stations.find((s) => s.name === n)?.id ?? null;

  const dish = (name: string, price: number, categoryIdx: number, extra: Partial<MockMenuItem> = {}): MockMenuItem => ({
    id: uid(), name, price, categoryId: categories[categoryIdx].id, stationId: null, available: true,
    exciseRequired: false, image: null, imageVersion: 0, unit: MenuUnit.Piece, favorite: false, ingredients: null,
    ...extra,
  });
  menu = [
    dish('Osh', 35000, 0),
    dish('Lag‘mon', 32000, 0),
    dish('Shashlik', 28000, 0),
    dish('Qovurilgan go‘sht', 200000, 0, { unit: MenuUnit.Weight }),
    dish('Achchiq-chuchuk', 18000, 1),
    dish('Sezar', 30000, 1),
    dish('Choy', 8000, 2),
    dish('Coca-Cola', 12000, 2),
    // Stop list (B29) namunasi: kassir "tugadi" deb belgilagan taom — ekranda kulrang "Tugadi"
    dish('Pivo (0.5)', 22000, 2, { exciseRequired: true, available: false }),
  ];
  // Har taomni bo'limga biriktiramiz: ichimliklar -> Bar, qolgani -> Oshxona
  // va bir nechta taomni sevimli qilamiz (tez topish uchun)
  const favSet = new Set(['Osh', 'Lag‘mon', 'Shashlik', 'Coca-Cola', 'Choy']);
  menu.forEach((m) => {
    m.stationId = m.categoryId === categories[2].id ? stId('Bar') : stId('Oshxona');
    m.favorite = favSet.has(m.name);
  });
  tables = [
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: uid(), number: n, hall: 'Asosiy zal', capacity: 4, status: TableStatus.Free })),
    ...[7, 8, 9, 10].map((n) => ({ id: uid(), number: n, hall: 'VIP zal', capacity: 6, status: TableStatus.Free })),
  ];

  // Real seed bilan bir xil xodimlar (ism, PIN, ruxsatlar — 0.3.0 ma'lumot yangilanishlaridan keyingi
  // holat: kassir — 'waiter' va 'void', administrator — 'void'); demo paroli hammada '1234'
  const u = (n: number, name: string, role: UserRole, login: string, pin: string, permissions: string[]): MockUser => ({
    id: demoUserId(n), name, role, login, pin, active: true, permissions, password: '1234', mustChangePassword: false,
  });
  users = [
    u(1, 'Aziz Karimov', UserRole.Waiter, 'ofitsiant', '1111', ['waiter']),
    u(2, 'Kamola Yusupova', UserRole.Waiter, 'kamola', '2222', ['waiter']),
    u(3, 'Jasur Rahimov', UserRole.Waiter, 'jasur', '3333', ['waiter']),
    u(4, 'Nodira Salimova', UserRole.Waiter, 'nodira', '4444', ['waiter']),
    u(5, 'Bekzod Toshev', UserRole.Cook, 'oshpaz', '5555', ['kitchen']),
    u(6, 'Dilnoza Ergasheva', UserRole.Cashier, 'kassir', '1234', ['cashier', 'waiter', 'void', 'history', 'revenue']),
    u(7, 'Malika Nazarova', UserRole.Cashier, 'kassir2', '4321', ['cashier', 'waiter', 'void']),
    u(8, 'Sardor Admin', UserRole.Admin, 'admin', '9999', [...A_CAPS]),
    u(9, 'Direktor', UserRole.Director, 'direktor', '0000', []),
    u(10, 'Super Admin (vendor)', UserRole.SuperAdmin, 'superadmin', '7777', []),
  ];

  // Sklad (ombor): ta'minotchilar, mahsulotlar, retseptlar, kirimlar va to'lovlar (xodimlardan keyin —
  // harakatlarda kim bajargani yoziladi)
  seedInventory();

  // Demo uchun: sozlamalar, terminallar (in-memory)
  settings = defaultSettings();
  terminals = [
    { id: uid(), name: 'Kassa 1', hall: 'Asosiy zal', note: null },
    { id: uid(), name: 'Ofitsiant terminali', hall: 'VIP zal', note: null },
  ];
  orders = [];
  customers = [
    { id: uid(), name: 'Aziz Karimov', phone: '+998 90 123 45 67', note: 'Doimiy mijoz', createdAt: new Date().toISOString() },
    { id: uid(), name: 'Dilnoza Yusupova', phone: '+998 91 234 56 78', note: null, createdAt: new Date().toISOString() },
  ];
  payments = [];
  expenses = [];
  voidLogs = [];
  fiscalDocs = new Map();
  fiscalCounter = 0;
  dailyCounters = new Map();
  recentRequests = new Map();

  seedOrders();
  // Bugungi yopilgan cheklar — to'lovdagidek sotuv harakatlari (sklad jurnalida ko'rinadi)
  seedSales();
}

/**
 * Demo sklad (real restoranga o'xshash): 4 ta ta'minotchi, 9 ta mahsulot (o'rtacha tannarx va
 * boshlang'ich qoldiq harakati bilan), 6 ta taom retsepti, kirimlar, ta'minotchiga vozvrat,
 * inventarizatsiya, hisobdan chiqarish va to'lovlar. Har qoldiq o'zgarishi applyMovement orqali —
 * jurnal (balanceAfter) va qoldiq bir-biriga mos. Vaqtlar: kechagi yozuvlar 20:00 gacha, bugungilar —
 * oxirgi 4 soat ichida (yarim tunda ochilsa ham har mahsulot jurnali vaqt tartibida qoladi).
 */
function seedInventory(): void {
  const P = ProductUnit;
  const admin = users.find((x) => x.role === UserRole.Admin) ?? null;
  const director = users.find((x) => x.role === UserRole.Director) ?? null;
  const daysAgoAt = (days: number, h: number, m = 0) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const minAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const by = (u: MockUser | null, at: string, extra: Partial<MoveCtx> = {}): MoveCtx => ({
    userId: u?.id ?? null,
    userName: u?.name ?? null,
    at,
    ...extra,
  });

  movements = [];
  purchases = [];
  supplierPayments = [];
  suppliers = [
    { id: uid(), name: 'Baraka Go‘sht', phone: '+998 90 111 22 33', note: 'Mol go‘shti — har kuni ertalab olib keladi', createdAt: daysAgoAt(40, 10) },
    { id: uid(), name: 'Oltin Don', phone: '+998 71 200 30 40', note: 'Guruch, un, yog‘ (ulgurji)', createdAt: daysAgoAt(40, 10, 5) },
    { id: uid(), name: 'Dehqon bozori', phone: null, note: 'Sabzavotlar, naqd pulga', createdAt: daysAgoAt(40, 10, 10) },
    { id: uid(), name: 'Ichimliklar ulgurji', phone: '+998 93 555 44 22', note: null, createdAt: daysAgoAt(20, 12) },
  ];

  // [nom, birlik, boshlang'ich qoldiq, minimal qoldiq, birlik tannarxi (so'm)]
  const list: [string, ProductUnit, number, number, number][] = [
    ['Guruch', P.Kg, 40, 10, 21_000],
    ['Go‘sht (mol)', P.Kg, 12, 8, 92_000],
    ['Sabzi', P.Kg, 10, 5, 6_000],
    ['Piyoz', P.Kg, 8, 5, 4_500],
    ['Yog‘', P.Litr, 6, 3, 24_000],
    ['Un', P.Kg, 15, 10, 7_500],
    ['Pomidor', P.Kg, 4, 5, 12_000], // minimaldan kam — "kam qolgan" ogohlantirishi ko'rinsin
    ['Ko‘k choy', P.Gram, 2000, 300, 180],
    ['Coca-Cola 0,5 l', P.Dona, 24, 12, 6_500],
  ];
  products = [];
  const opening = daysAgoAt(3, 8);
  for (const [name, unit, stock, minStock, avgCost] of list) {
    const p: MockProduct = { id: uid(), name, unit, stock: 0, minStock, avgCost };
    products.push(p);
    applyMovement(p, 'initial', { delta: stock }, avgCost, by(null, opening, { note: INITIAL_STOCK_NOTE }));
  }
  const prod = (name: string) => products.find((p) => p.name === name)!;
  const sup = (name: string) => suppliers.find((s) => s.name === name)!;

  // Retseptlar — 1 birlik taomga (Qovurilgan go'sht — 1 kg ga); Shashlik, Sezar va Pivo retseptsiz
  // (retseptsiz taom skladga ta'sir qilmaydi)
  recipeItems = [];
  const addRecipe = (dishName: string, lines: [string, number][]) => {
    const mid = menu.find((m) => m.name === dishName)?.id;
    if (!mid) return;
    lines.forEach(([pname, amount]) => recipeItems.push({ id: uid(), menuItemId: mid, productId: prod(pname).id, amount }));
  };
  addRecipe('Osh', [['Guruch', 0.2], ['Go‘sht (mol)', 0.15], ['Sabzi', 0.1], ['Yog‘', 0.05]]);
  addRecipe('Lag‘mon', [['Un', 0.15], ['Go‘sht (mol)', 0.1], ['Sabzi', 0.1]]);
  addRecipe('Qovurilgan go‘sht', [['Go‘sht (mol)', 1], ['Yog‘', 0.05], ['Piyoz', 0.1]]);
  addRecipe('Achchiq-chuchuk', [['Pomidor', 0.2], ['Piyoz', 0.05]]);
  addRecipe('Choy', [['Ko‘k choy', 5]]);
  addRecipe('Coca-Cola', [['Coca-Cola 0,5 l', 1]]);

  // Kirimlar, vozvrat, inventarizatsiya, chiqim va to'lovlar — vaqt tartibida
  recordPurchase(prod('Go‘sht (mol)'), sup('Baraka Go‘sht'), 20, 98_000, null, by(admin, daysAgoAt(2, 9, 30)));
  recordPurchase(prod('Sabzi'), sup('Dehqon bozori'), 30, 6_500, null, by(admin, daysAgoAt(2, 10, 15)));
  recordPurchase(prod('Piyoz'), sup('Dehqon bozori'), 20, 5_000, null, by(admin, daysAgoAt(2, 10, 20)));
  recordPurchase(prod('Coca-Cola 0,5 l'), sup('Ichimliklar ulgurji'), 48, 6_800, '2 quti', by(admin, daysAgoAt(2, 14)));
  recordPurchase(prod('Guruch'), sup('Oltin Don'), 25, 23_000, 'Devzira', by(admin, daysAgoAt(1, 9)));
  recordPurchase(prod('Un'), sup('Oltin Don'), 50, 7_800, null, by(admin, daysAgoAt(1, 9, 5)));
  recordPurchase(prod('Yog‘'), sup('Oltin Don'), 10, 25_000, null, by(admin, daysAgoAt(1, 9, 10)));
  recordSupplierPayment(sup('Baraka Go‘sht'), 1_500_000, 'Naqd', by(director, daysAgoAt(1, 10)));
  recordReturn(prod('Piyoz'), sup('Dehqon bozori'), 3, 5_000, 'Chirigan', by(admin, daysAgoAt(1, 16)));
  recordSupplierPayment(sup('Dehqon bozori'), 280_000, null, by(director, daysAgoAt(1, 17)));
  // Kechki inventarizatsiya: unda 0,5 kg kam chiqdi
  const un = prod('Un');
  applyMovement(un, 'count', { absolute: un.stock - 0.5 }, un.avgCost,
    by(admin, daysAgoAt(1, 19, 30), { reference: uid(), referenceLabel: COUNT_LABEL }));
  // Bugun: sifatsiz sabzi hisobdan chiqarildi, Oltin Don'ga qisman to'lov
  const sabzi = prod('Sabzi');
  applyMovement(sabzi, 'writeoff', { delta: -1.5 }, sabzi.avgCost, by(admin, minAgo(240), { note: 'Chirigan, sifatsiz' }));
  recordSupplierPayment(sup('Oltin Don'), 1_000_000, 'Bank o‘tkazmasi', by(director, minAgo(200)));
}

/** Seed'dagi yopilgan cheklar — to'lov paytidagidek sotuv harakatlari (yopilgan vaqti tartibida) */
function seedSales(): void {
  orders
    .filter((o) => o.status === OrderStatus.Closed && o.closedAt)
    .sort((a, b) => Date.parse(a.closedAt!) - Date.parse(b.closedAt!))
    .forEach((o) => {
      const last = orderPayments(o.id).pop();
      writeSaleMovements(o, last?.cashierId ?? null, o.closedAt!);
    });
}

// Prezentatsiya uchun tayyor ma'lumot (bugun): yopilgan hisoblar (stol, olib ketish, yetkazish, qarzga,
// bo'lib to'lash, saboy qatori) va ochiq buyurtmalar — stolda 2 ta hisob, "chek berildi" stoli,
// 2 ta olib ketish (biri tayyor), 1 ta yetkazish; bitta otkaz va kassa kirim/chiqimi.
function seedOrders(): void {
  const [aziz, kamola] = users;
  const kassir = users.find((x) => x.role === UserRole.Cashier)!;
  const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
  const T = (n: number) => tables.find((t) => t.number === n)!;
  const M = (name: string) => menu.find((m) => m.name === name)!;

  interface SeedLine { dish: string; qty: number; takeaway?: boolean; minAgo?: number; note?: string; status?: OrderItemStatus }
  interface SeedPay { type: string; amount?: number; debtor?: { name: string; phone: string | null } }
  interface SeedSpec {
    type: OrderType;
    table?: number;
    checkNo?: number;
    waiter: MockUser;
    status: OrderStatus;
    openedMin: number;
    closedMin?: number;
    lines: SeedLine[];
    phone?: string;
    address?: string;
    note?: string;
    billPrintedMin?: number;
    pays?: SeedPay[];
  }

  const make = (s: SeedSpec): MockOrder => {
    const openedAt = at(s.openedMin);
    const businessDate = businessDateOf(new Date(openedAt));
    const dineIn = s.type === OrderType.DineIn;
    const table = dineIn ? T(s.table!) : null;
    const itemStatus =
      s.status === OrderStatus.Ready || s.status === OrderStatus.Closed
        ? OrderItemStatus.Ready
        : s.status === OrderStatus.Cooking
          ? OrderItemStatus.Cooking
          : OrderItemStatus.Pending;
    const phone = s.phone ? normalizePhone(s.phone) : null;
    const customer = s.type === OrderType.Delivery && phone ? findCustomerByPhone(phone) : null;
    const o: MockOrder = {
      id: uid(),
      type: s.type,
      tableId: table?.id ?? null,
      checkNo: dineIn ? s.checkNo ?? 1 : null,
      waiterId: s.waiter.id,
      status: s.status,
      openedAt,
      closedAt: null,
      queueNumber: nextDailyNumber(businessDate),
      businessDate,
      phone: dineIn ? null : phone,
      address: s.type === OrderType.Delivery ? s.address ?? null : null,
      deliveryFee: s.type === OrderType.Delivery ? normalizeFee(settings.deliveryFeeDefault) : 0,
      billPrintedAt: s.billPrintedMin != null ? at(s.billPrintedMin) : null,
      items: [],
      note: s.note ?? null,
      discountPercent: 0,
      servicePercent: dineIn ? hallPercent(table!.hall) : 0,
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? null,
      refunded: false,
      refundReason: null,
      refundedAt: null,
      refundedBy: null,
    };
    o.items = s.lines.map((l) =>
      makeItem(o.id, M(l.dish), l.qty, {
        note: l.note ?? null,
        createdAt: at(l.minAgo ?? s.openedMin),
        takeaway: dineIn && !!l.takeaway,
        status: l.status ?? itemStatus,
      }),
    );
    orders.push(o);
    if (s.status === OrderStatus.Closed) {
      o.closedAt = at(s.closedMin ?? s.openedMin);
      let left = orderTotalsOf(o).total;
      const pays = s.pays ?? [{ type: 'naqd' }];
      pays.forEach((p, i) => {
        const amount = i === pays.length - 1 ? left : Math.min(roundSum(p.amount), left);
        left -= amount;
        payments.push({
          id: uid(), orderId: o.id, amount, type: p.type, cashierId: kassir.id, createdAt: o.closedAt!,
          debtorName: p.debtor?.name ?? null, debtorPhone: p.debtor?.phone ?? null,
          debtRepaidAt: null, debtRepaidBy: null, debtRepaidType: null,
        });
      });
      issueFiscal(o, orderTotalsOf(o).total);
    } else if (table) {
      table.status = TableStatus.Busy;
    }
    return o;
  };

  // Yopilgan hisoblar (vaqt tartibida — kunlik raqam shu tartibda beriladi)
  make({ type: OrderType.DineIn, table: 2, waiter: aziz, status: OrderStatus.Closed, openedMin: 205, closedMin: 160,
    lines: [{ dish: 'Osh', qty: 3 }, { dish: 'Sezar', qty: 3 }], pays: [{ type: 'naqd' }] });
  make({ type: OrderType.Takeaway, waiter: kassir, status: OrderStatus.Closed, openedMin: 190, closedMin: 182,
    lines: [{ dish: 'Lag‘mon', qty: 2 }, { dish: 'Choy', qty: 2 }], pays: [{ type: 'karta' }] });
  make({ type: OrderType.DineIn, table: 3, waiter: kamola, status: OrderStatus.Closed, openedMin: 170, closedMin: 125,
    lines: [{ dish: 'Shashlik', qty: 2 }, { dish: 'Achchiq-chuchuk', qty: 1 }, { dish: 'Coca-Cola', qty: 2 }],
    pays: [{ type: 'click' }] });
  make({ type: OrderType.Delivery, waiter: kassir, status: OrderStatus.Closed, openedMin: 150, closedMin: 105,
    phone: '+998912345678', address: 'Yunusobod, 4-mavze, 17-uy (2-podyezd, 3-qavat)',
    lines: [{ dish: 'Osh', qty: 2 }, { dish: 'Coca-Cola', qty: 2 }], pays: [{ type: 'payme' }] });
  make({ type: OrderType.Takeaway, waiter: kassir, status: OrderStatus.Closed, openedMin: 130, closedMin: 122,
    phone: '+998935556677', lines: [{ dish: 'Qovurilgan go‘sht', qty: 0.75 }],
    pays: [{ type: 'qarz', debtor: { name: 'Botir Xolmatov', phone: '+998935556677' } }] });
  make({ type: OrderType.DineIn, table: 4, waiter: aziz, status: OrderStatus.Closed, openedMin: 115, closedMin: 62,
    lines: [{ dish: 'Osh', qty: 2 }, { dish: 'Shashlik', qty: 2, takeaway: true }, { dish: 'Choy', qty: 2 }],
    pays: [{ type: 'naqd', amount: 100000 }, { type: 'karta' }] });

  // Ochiq buyurtmalar (KDS, kassa, ofitsiant ekranlari uchun)
  const t1 = make({ type: OrderType.DineIn, table: 1, checkNo: 1, waiter: aziz, status: OrderStatus.Cooking, openedMin: 38,
    lines: [
      { dish: 'Osh', qty: 2 },
      { dish: 'Sezar', qty: 2 },
      { dish: 'Choy', qty: 2, minAgo: 14, status: OrderItemStatus.Pending },
    ] });
  make({ type: OrderType.DineIn, table: 7, waiter: kamola, status: OrderStatus.Ready, openedMin: 31, billPrintedMin: 3,
    lines: [{ dish: 'Shashlik', qty: 1 }, { dish: 'Achchiq-chuchuk', qty: 1 }, { dish: 'Choy', qty: 2 }] });
  make({ type: OrderType.Takeaway, waiter: kassir, status: OrderStatus.Ready, openedMin: 24,
    lines: [{ dish: 'Lag‘mon', qty: 1 }, { dish: 'Coca-Cola', qty: 1 }] });
  make({ type: OrderType.DineIn, table: 1, checkNo: 2, waiter: aziz, status: OrderStatus.Accepted, openedMin: 12,
    lines: [{ dish: 'Coca-Cola', qty: 1 }, { dish: 'Lag‘mon', qty: 1 }] });
  make({ type: OrderType.Takeaway, waiter: kassir, status: OrderStatus.Cooking, openedMin: 7, phone: '+998935556677',
    lines: [{ dish: 'Shashlik', qty: 3, note: 'Achchiq qalampirsiz' }, { dish: 'Achchiq-chuchuk', qty: 1 }] });
  make({ type: OrderType.Delivery, waiter: kassir, status: OrderStatus.Accepted, openedMin: 4,
    phone: '+998901234567', address: 'Chilonzor tumani, 9-kvartal, 12-uy, 45-xonadon',
    note: 'Eshik oldida qo‘ng‘iroq qiling',
    lines: [{ dish: 'Osh', qty: 2 }, { dish: 'Sezar', qty: 1 }, { dish: 'Coca-Cola', qty: 2 }] });

  // Otkaz namunasi (B19): 1-stoldan bitta choy qaytarilgan
  const choy = M('Choy');
  voidLogs.push({
    id: uid(), createdAt: at(8), orderId: t1.id, orderName: orderDisplayName(toDto(t1)), orderType: OrderType.DineIn,
    menuItemId: choy.id, name: choy.name, quantity: 1, unit: MenuUnit.Piece, price: choy.price,
    sum: lineSum(choy.price, 1), reason: 'Mijoz voz kechdi', userId: kassir.id, userName: kassir.name,
    wholeOrder: false, sentToKitchen: true,
  });

  // Kassa harakatlari (B33): ertalabki maydalik va bozor xarajati
  expenses.push(
    { id: uid(), amount: 200000, note: 'Ertalabki maydalik (qaytim uchun)', kind: 'kirim', cashierId: kassir.id, cashierName: kassir.name, createdAt: at(215) },
    { id: uid(), amount: 45000, note: 'Non va ko‘kat (bozor)', kind: 'chiqim', cashierId: kassir.id, cashierName: kassir.name, createdAt: at(95) },
  );
}

// =============================================================================================
// Yordamchilar: javob, xato, hodisa
// =============================================================================================

type MockError = Error & { status: number };

/** Javob — serverdagidek mustaqil nusxa (JSON): ekran xotiradagi "baza"ni o'zgartirib qo'ymasin */
function clone<T>(v: T): T {
  return v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T);
}
const ok = (data: any) => Promise.resolve(clone(data));
const fail = (message: string, status = 400) =>
  Promise.reject(Object.assign(new Error(message), { status }) as MockError);
const httpError = (message: string, status: number): MockError =>
  Object.assign(new Error(message), { status }) as MockError;
const bad = (message: string) => httpError(message, 400);
const notFound = (message = ORDER_NOT_FOUND_MESSAGE) => httpError(message, 404);
const FORBIDDEN = 'Bu amal uchun ruxsat yo‘q';
const forbidden = (message = FORBIDDEN) => httpError(message, 403);

/**
 * Socket hodisasi — real tarmoqdagidek: HTTP javobidan KEYIN (keyingi tsiklda) va JSON nusxa bilan.
 * Tinglovchi xatosi so'rovga ta'sir qilmaydi (mockEmit o'zi ushlaydi).
 */
function emit(ev: string, payload: unknown): void {
  const data = clone(payload);
  setTimeout(() => mockEmit(ev, data), 0);
}
// Real server OrdersGateway yuklari bilan bir xil
// source 'split' — hisob bo'lishdan paydo bo'lgan yangi hisob (kassa "zakas cheki" chiqmaydi)
const emitCreated = (o: Order, source?: 'split') =>
  emit(SOCKET_EVENTS.ORDER_CREATED, source ? { order: o, source } : { order: o });
const emitUpdated = (o: Order) => emit(SOCKET_EVENTS.ORDER_UPDATED, { orderId: o.id, status: o.status, order: o });
const emitClosed = (o: Order) => emit(SOCKET_EVENTS.ORDER_CLOSED, { order: o });

const nowIso = () => new Date().toISOString();
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Mahalliy ish kuni kaliti 'YYYY-MM-DD' (restoran vaqti) — kunlik raqamlash va hisobotlar uchun */
function businessDateOf(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Mahalliy sana chegarasi ('YYYY-MM-DD' yoki 'YYYY-MM-DDTHH:MM[:SS]') -> vaqt (ms, soniya aniqligida).
 * end=true — chegara KIRADI: kun oxiri 23:59:59, daqiqa berilsa — shu daqiqaning 59-soniyasi.
 * Noto'g'ri qiymat — null (server localBoundToUtc bilan bir xil qoida).
 */
function localBound(value: string | undefined | null, end: boolean): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(value).trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hasTime = m[4] !== undefined;
  const h = hasTime ? Number(m[4]) : end ? 23 : 0;
  const mi = hasTime ? Number(m[5]) : end ? 59 : 0;
  const s = m[6] !== undefined ? Number(m[6]) : end ? 59 : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, s, 0);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.getTime();
}

/** Vaqtni soniyagacha qisqartirish (SQLite datetime() solishtirishi kabi) */
const toSecond = (ms: number) => Math.floor(ms / 1000) * 1000;

// ---- Hisobot sanalari (server reports/report-dates.ts bilan bir xil qoida va xabarlar) ----
const DATE_INVALID_MESSAGE = 'Sana noto‘g‘ri (YYYY-MM-DD yoki YYYY-MM-DDTHH:MM)';
const RANGE_INVALID_MESSAGE = 'Sana oralig‘i noto‘g‘ri';
const RANGE_TOO_LONG_MESSAGE = 'Sana oralig‘i juda katta (1 yilgacha)';
const RANGE_MAX_DAYS = 366;

/** Mahalliy kunlar oralig'i: from..to (ikkalasi kiradi); vaqt chegaralari [startMs, endMs) */
interface LocalRange { from: string; to: string; startMs: number; endMs: number }

/** So'rov parametri berilganmi (bo'sh satr — berilmagan) */
const paramGiven = (v: string | null | undefined) => v !== undefined && v !== null && v.trim() !== '';

/** 'YYYY-MM-DD' -> shu kunning mahalliy 00:00 vaqti; noto'g'ri yoki mavjud bo'lmagan sana -> null */
function parseLocalDate(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 0, 0, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

const dayStartOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const nextDayStartOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);

/** Bitta mahalliy kun oralig'i */
function dayRangeOf(day: Date): LocalRange {
  const start = dayStartOf(day);
  const key = businessDateOf(start);
  return { from: key, to: key, startMs: start.getTime(), endMs: nextDayStartOf(start).getTime() };
}

/**
 * ?from=&to= (mahalliy 'YYYY-MM-DD', ikkalasi kiradi) -> oraliq. Hech biri — bugun; faqat from —
 * from..bugun (kelajakda bo'lsa — faqat from kuni); faqat to — shu bitta kun. Noto'g'ri sana, teskari
 * yoki 1 yildan uzun oraliq — 400.
 */
function resolveRange(fromRaw: string | null, toRaw: string | null): LocalRange {
  const fromGiven = paramGiven(fromRaw);
  const toGiven = paramGiven(toRaw);
  const from = fromGiven ? parseLocalDate(fromRaw) : null;
  const to = toGiven ? parseLocalDate(toRaw) : null;
  if ((fromGiven && !from) || (toGiven && !to)) throw bad(DATE_INVALID_MESSAGE);
  const today = dayStartOf(new Date());
  const start = from ?? to ?? today;
  const end = to ?? (from ? (from.getTime() > today.getTime() ? from : today) : today);
  if (end.getTime() < start.getTime()) throw bad(RANGE_INVALID_MESSAGE);
  const days = Math.round((nextDayStartOf(end).getTime() - start.getTime()) / 86_400_000);
  if (days > RANGE_MAX_DAYS) throw bad(RANGE_TOO_LONG_MESSAGE);
  return { from: businessDateOf(start), to: businessDateOf(end), startMs: start.getTime(), endMs: nextDayStartOf(end).getTime() };
}

/** ?date=YYYY-MM-DD (bitta kun; berilmasa — bugun). Noto'g'ri sana — 400 */
function resolveDay(dateRaw: string | null): LocalRange {
  if (!paramGiven(dateRaw)) return dayRangeOf(new Date());
  const d = parseLocalDate(dateRaw);
  if (!d) throw bad(DATE_INVALID_MESSAGE);
  return dayRangeOf(d);
}

/** Vaqt (ISO) oraliqdami: [startMs, endMs) */
const inRange = (iso: string | null | undefined, r: { startMs: number; endMs: number }) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) && t >= r.startMs && t < r.endMs;
};

// =============================================================================================
// Server qoidalari va xabarlari (server/src/orders/order-rules.ts bilan bir xil)
// =============================================================================================

const NO_ITEMS_MESSAGE = 'Buyurtmada taom yo‘q';
const TABLE_REQUIRED_MESSAGE = 'Stol tanlanmagan';
const TABLE_NOT_FOUND_MESSAGE = 'Stol topilmadi';
const ORDER_NOT_FOUND_MESSAGE = 'Buyurtma topilmadi';
const ORDER_CLOSED_MESSAGE = 'Buyurtma yopilgan';
const ORDER_OTHER_TABLE_MESSAGE = 'Buyurtma boshqa stolga tegishli';
const PHONE_INVALID_MESSAGE = 'Telefon raqami noto‘g‘ri (masalan: 90 123 45 67)';
const ADDRESS_REQUIRED_MESSAGE = 'Yetkazish manzili kiritilmagan';
const ADDRESS_TOO_LONG_MESSAGE = 'Manzil juda uzun (300 belgigacha)';
const NOT_DELIVERY_MESSAGE = 'Bu buyurtma yetkazish emas';
const NOT_TABLE_ORDER_MESSAGE = 'Bu buyurtma stolga bog‘lanmagan';
const ORDER_TYPE_INVALID_MESSAGE = 'Noto‘g‘ri buyurtma turi';
const CHECK_NO_INVALID_MESSAGE = 'Hisob raqami noto‘g‘ri (1 dan 20 gacha)';
const SPLIT_ONLY_TABLE_MESSAGE = 'Faqat stol hisobini bo‘lish mumkin';
const ITEM_LINE_NOT_FOUND_MESSAGE = 'Taom qatori topilmadi';
const SPLIT_QTY_INVALID_MESSAGE = 'Ko‘chiriladigan miqdor noto‘g‘ri';
const SPLIT_KEEP_ONE_MESSAGE = 'Hisobda kamida bitta taom qolishi kerak';
const SPLIT_NOTHING_MESSAGE = 'Ko‘chiriladigan taomni tanlang';
const SPLIT_SAME_CHECK_MESSAGE = 'Taomni shu hisobning o‘ziga ko‘chirib bo‘lmaydi';
const CHECK_OTHER_TABLE_MESSAGE = 'Hisob boshqa stolga tegishli';
const BELOW_PAID_MESSAGE = 'Qolgan summa to‘langan summadan kam bo‘lib qoladi';
const HAS_PAYMENTS_MESSAGE = 'Bu hisobda to‘lov bor — avval to‘lovlarni o‘chiring';
const VOID_FORBIDDEN_MESSAGE = 'Otkaz qilish uchun ruxsat yo‘q — kassir yoki direktorga murojaat qiling';
const VOID_QTY_INVALID_MESSAGE = 'Otkaz miqdori noto‘g‘ri';
const VOID_REASON_TOO_LONG_MESSAGE = 'Sabab juda uzun (200 belgigacha)';
const VOID_REASON_MAX_LENGTH = 200;
const TYPE_UNCHANGED_MESSAGE = 'Buyurtma turi o‘zgarmadi';
const WAITER_CHANGE_FORBIDDEN_MESSAGE = 'Ofitsiantni faqat kassir yoki direktor almashtira oladi';
const ORDER_NOT_CLOSED_MESSAGE = 'Buyurtma hali yopilmagan';
const PRICE_FORBIDDEN_MESSAGE = 'Narxni faqat kassir yoki direktor o‘zgartira oladi';
const PRICE_INVALID_MESSAGE = 'Narx noto‘g‘ri (0 dan 100 000 000 gacha)';
const PRICE_MAX = 100_000_000;
const PAYMENT_TYPE_INVALID_MESSAGE = 'To‘lov turi noto‘g‘ri';
const PAYMENT_AMOUNT_INVALID_MESSAGE = 'To‘lov summasi noto‘g‘ri';
const PAYMENT_EXCEEDS_MESSAGE = 'To‘lov summasi qoldiqdan katta';
const DEBTOR_REQUIRED_MESSAGE = 'Qarzga yozish uchun mijoz ismini kiriting';
const ORDER_ALREADY_CLOSED_MESSAGE = 'Hisob allaqachon yopilgan';
const DELIVERY_FEE_INVALID_MESSAGE = 'Yetkazish narxi noto‘g‘ri (0 dan 1 000 000 gacha)';
const DELIVERY_FEE_MAX = 1_000_000;
const ITEM_QTY_INVALID_MESSAGE = 'Taom miqdori noto‘g‘ri (dona — butun son, kg — 6 xonagacha)';
const MENU_ITEM_INVALID_MESSAGE = 'Taom tanlanmagan';
const DISCOUNT_PERCENT_MESSAGE = 'Chegirma foizi 0 dan 100 gacha bo‘lishi kerak';
const SERVICE_PERCENT_MESSAGE = 'Xizmat haqi foizi 0 dan 100 gacha bo‘lishi kerak';
const stopListMessage = (name: string) => `«${name}» tugagan (stop list)`;
const quantityInvalidMessage = (name: string) => `«${name}» miqdori noto‘g‘ri`;
const ADDRESS_MAX_LENGTH = 300;
const MAX_CHECK_NO = 20;
const QTY_DECIMALS = 6;
/** Miqdorlarni solishtirishda kasr xatoligi chegarasi */
const QTY_EPS = 1e-9;
/** Takroriy so'rov himoyasi (clientRequestId) — shuncha vaqt eslab qolinadi */
const REQUEST_ID_TTL_MS = 24 * 60 * 60_000;
const REQUEST_ID_MAX = 20_000;
/** Tarix qidiruvida telefon bo'yicha moslik uchun kamida shuncha raqam */
const PHONE_SEARCH_MIN_DIGITS = 4;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
/** Qiymat berilganmi: undefined, null va bo'sh satr — "berilmagan" (server isGiven) */
const isGiven = (v: unknown) => v !== undefined && v !== null && v !== '';
/** class-validator IsNumber (NaN/Infinity'siz) */
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** class-validator IsInt */
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

/** O'zbekiston telefon raqami -> "+998901234567" yoki null (avval faqat raqamlar — server kabi) */
function normalizePhone(input: unknown): string | null {
  if (input == null) return null;
  return normalizeUzPhone(String(input).replace(/\D/g, ''));
}

/** So'rov parametri -> buyurtma turi; bo'sh yoki noma'lum qiymat -> undefined (filtr yo'q) */
function parseOrderType(value: unknown): OrderType | undefined {
  return (ORDER_TYPES as string[]).includes(String(value ?? '')) ? (value as OrderType) : undefined;
}

/** Stoldagi hisob raqami: eski (raqamsiz) ochiq buyurtma — 1-hisob */
function checkNoOf(o: { checkNo?: number | null }): number {
  const n = Number(o.checkNo);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Stoldagi keyingi bo'sh hisob raqami: ochiq hisoblar ichidagi eng katta raqam + 1 (hisob yo'q — 1) */
function nextFreeCheckNo(openChecks: { checkNo?: number | null }[]): number {
  return openChecks.reduce((max, o) => Math.max(max, checkNoOf(o)), 0) + 1;
}

/** Otkaz sababi: chetidagi bo'shliqlarsiz, 200 belgigacha; bo'sh — null */
function cleanReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s ? s.slice(0, VOID_REASON_MAX_LENGTH) : null;
}

/** Miqdorni 6 xonagacha yaxlitlash */
function roundQty(value: number | string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** QTY_DECIMALS) / 10 ** QTY_DECIMALS;
}

/** Sonning kasr xonalari soni (JSON'dagi yozuvi bo'yicha) */
function decimalPlaces(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const s = String(n);
  const exp = /e-(\d+)$/i.exec(s);
  if (exp) {
    const mantissa = s.slice(0, exp.index);
    const frac = mantissa.includes('.') ? mantissa.split('.')[1].length : 0;
    return frac + Number(exp[1]);
  }
  return s.includes('.') ? s.split('.')[1].length : 0;
}

/** Miqdor shu birlik uchun to'g'rimi: musbat; dona — butun; kg — 6 xonagacha kasr */
function isValidQuantity(value: unknown, unit: MenuUnit | string | null | undefined): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false;
  if (unit === MenuUnit.Weight) return decimalPlaces(value) <= QTY_DECIMALS;
  return Number.isInteger(value);
}

/**
 * Buyurtma summalari — YAGONA qoida (server orderTotalsOf): saboy qatorlariga xizmat haqi olinmaydi,
 * yetkazish narxi FAQAT yetkazishda. items berilsa — buyurtmaning o'z qatorlari o'rniga.
 */
function orderTotalsOf(
  o: Pick<MockOrder, 'type' | 'discountPercent' | 'servicePercent' | 'deliveryFee'> & { items?: MoneyItem[] },
  items: MoneyItem[] | null | undefined = o.items,
): OrderTotals {
  const fee = orderTypeOf(o) === OrderType.Delivery ? o.deliveryFee : 0;
  return calcOrderTotals(
    (items || []).map((it) => ({ price: it.price, quantity: it.quantity, takeaway: !!it.takeaway })),
    o.discountPercent,
    o.servicePercent,
    fee,
  );
}

/** Yetkazish narxi: butun so'm, 0..1 000 000 */
function normalizeFee(value: unknown): number {
  return Math.min(DELIVERY_FEE_MAX, Math.max(0, roundSum(value as number)));
}

// ---- Ruxsatlar (rol emas — ruxsat; Direktor/SuperAdmin hammasiga ega) ----
const TOKEN_PREFIX = 'mock-token.';
const tokenFor = (u: MockUser) => `${TOKEN_PREFIX}${u.id}`;

/** Token egasi — real JwtStrategy kabi: o'chirilgan/bloklangan xodim -> null (401) */
function actorOf(token: string | null | undefined): MockUser | null {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  const id = token.slice(TOKEN_PREFIX.length);
  const u = users.find((x) => x.id === id);
  return u && u.active ? u : null;
}

/** Login/me javobidagi foydalanuvchi (PIN va parolsiz; Direktor/SuperAdmin — barcha ruxsatlar) */
function sessionUser(u: MockUser): User {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    login: u.login ?? null,
    active: u.active,
    permissions: isFullAccessRole(u.role) ? [...ALL_CAPABILITY_KEYS] : capabilitiesForRole(u.role, u.permissions),
    hasPassword: !!u.password,
    mustChangePassword: !!u.mustChangePassword,
  };
}

/** Xodimlar ro'yxati qatori (GET/POST/PATCH /users) — PIN ko'rinadi, parol hech qachon */
function staffRow(u: MockUser): User {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    login: u.login ?? null,
    pin: u.pin ?? null,
    active: u.active,
    permissions: capabilitiesForRole(u.role, u.permissions),
    hasPassword: !!u.password,
    mustChangePassword: !!u.mustChangePassword,
  };
}

const can = (u: MockUser, capability: string) => hasCapability(sessionUser(u), capability);
const MANAGER_ROLES: string[] = [UserRole.Admin, UserRole.Director, UserRole.SuperAdmin];
/** Administrator / direktor / superadmin */
const isAdminRole = (u: MockUser) => MANAGER_ROLES.includes(u.role);
/** Buyurtma bilan ishlash (stol ko'chirish, tur, bo'lish, schot, yetkazish): ofitsiant yoki kassir */
const canOperateOrders = (u: MockUser) => can(u, 'waiter') || can(u, 'cashier');
/** Kassa amallari (stol ko'chirish, tur, bo'lish, schot) — kassir / administrator / direktor (0.3.3) */
const canManageOrders = (u: MockUser) => isOrderManager(sessionUser(u));
/** Otkaz — faqat 'void' ruxsati (kassir, administrator, direktor) */
const canVoid = (u: MockUser) => can(u, 'void');
/** Narxni qo'lda o'zgartirish: kassir yoki 'void' ruxsati bor xodim */
const canOverridePrice = (u: MockUser) => can(u, 'cashier') || can(u, 'void');
/** Ofitsiantni almashtirish: kassir yoki administrator / direktor */
const canChangeWaiter = (u: MockUser) => can(u, 'cashier') || isAdminRole(u);
/** Cheklar tarixini to'liq ko'rish: 'history' ruxsati yoki administrator / direktor */
const canViewAllHistory = (u: MockUser) => can(u, 'history') || isAdminRole(u);
/** Kassa boshqaruvi (stop list, chek navbati): 'cashier' ruxsati yoki administrator (direktor — doim) */
const canManageKassa = (u: MockUser) => can(u, 'cashier') || u.role === UserRole.Admin;
/** Hisobotlar marshruti (server ReportsController @Roles) */
const REPORT_ROLES: string[] = [UserRole.Director, UserRole.Admin, UserRole.Cashier, UserRole.SuperAdmin];
/** Ofitsiantlar ulushi hisoboti: administrator / direktor yoki 'reports' ruxsati */
const canSeeShares = (u: MockUser) => isAdminRole(u) || can(u, 'reports');
/** Otkazlar hisoboti: hisobot ko'radiganlar va tushumni ko'radigan kassir ('revenue') */
const canSeeVoids = (u: MockUser) => canSeeShares(u) || can(u, 'revenue');
/** Kassa holati va qarzlar ro'yxati: 'cashier' yoki 'reports' ruxsati yoki administrator / direktor */
const canSeeCash = (u: MockUser) => can(u, 'cashier') || can(u, 'reports') || isAdminRole(u);
/** Kassa harakatlari (kirim/chiqim) — kassir, administrator, direktor, superadmin */
const EXPENSE_ROLES: string[] = [UserRole.Cashier, UserRole.Admin, UserRole.Director, UserRole.SuperAdmin];

// =============================================================================================
// Sozlamalar (server SettingsService bilan bir xil normallashtirish)
// =============================================================================================

const DEFAULT_RESTAURANT_NAME = 'DasturXon';
const PAYMENT_KINDS: PaymentMethodKind[] = ['cash', 'card', 'online', 'debt', 'other'];
const PAYMENT_KEY_RE = /^[a-z0-9_-]{1,32}$/;
const PAYMENT_LABEL_MAX = 40;

/** Foiz: 0..100, 2 xonagacha */
function percent2(value: unknown): number {
  return Math.round(clampPercent(value as number) * 100) / 100;
}

/** Zallar ro'yxati: faqat satrlar, chetidagi bo'shliqlarsiz, bo'shlarsiz, takrorlarsiz */
function normalizeHallList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Zal bo'yicha xizmat haqi xaritasi -> toza ko'rinish (zal nomi -> 0..100 foiz) */
function normalizeHallServiceMap(map: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
  for (const [rawHall, rawValue] of Object.entries(map as Record<string, unknown>)) {
    const hall = rawHall.trim();
    if (!hall || rawValue === null || rawValue === undefined || rawValue === '') continue;
    const n = Number(rawValue);
    if (!Number.isFinite(n)) continue;
    out[hall] = percent2(n);
  }
  return out;
}

/** Standart to'lov usullari (yangi nusxa) */
function defaultPaymentMethods(): PaymentMethod[] {
  return DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m }));
}

/** Sozlamadagi to'lov usullari -> toza ro'yxat; bo'sh/noto'g'ri -> standart ro'yxat */
function normalizePaymentMethods(list: unknown): PaymentMethod[] {
  if (!Array.isArray(list) || list.length === 0) return defaultPaymentMethods();
  const out: PaymentMethod[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<PaymentMethod>;
    const key = typeof r.key === 'string' ? r.key.trim() : '';
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    if (!PAYMENT_KEY_RE.test(key) || !label || out.some((m) => m.key === key)) continue;
    const kind = PAYMENT_KINDS.includes(r.kind as PaymentMethodKind) ? (r.kind as PaymentMethodKind) : 'other';
    out.push({ key, label: label.slice(0, PAYMENT_LABEL_MAX), kind, active: r.active !== false });
  }
  return out.length ? out : defaultPaymentMethods();
}

/** Direktor yuborgan to'lov usullari ro'yxatini tekshirish (server validatePaymentMethods) */
function validatePaymentMethods(list: unknown): string | null {
  if (!Array.isArray(list) || list.length === 0) return 'To‘lov turlari ro‘yxati noto‘g‘ri';
  if (list.length > 30) return 'To‘lov turlari juda ko‘p (30 tagacha)';
  const keys = new Set<string>();
  let activeCash = false;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') return 'To‘lov turlari ro‘yxati noto‘g‘ri';
    const r = raw as Partial<PaymentMethod>;
    const key = typeof r.key === 'string' ? r.key.trim() : '';
    if (!PAYMENT_KEY_RE.test(key)) {
      return `To‘lov turi kaliti noto‘g‘ri: «${key || '—'}» (faqat a-z, 0-9, _ va -)`;
    }
    if (keys.has(key)) return `To‘lov turi kaliti takrorlangan: «${key}»`;
    keys.add(key);
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    if (!label) return 'To‘lov turi nomi kiritilmagan';
    if (label.length > PAYMENT_LABEL_MAX) return `To‘lov turi nomi juda uzun (${PAYMENT_LABEL_MAX} belgigacha)`;
    if (!PAYMENT_KINDS.includes(r.kind as PaymentMethodKind)) return 'To‘lov turi toifasi noto‘g‘ri';
    if (r.active !== undefined && typeof r.active !== 'boolean') return 'To‘lov turlari ro‘yxati noto‘g‘ri';
    if (r.kind === 'cash' && r.active !== false) activeCash = true;
  }
  if (!activeCash) return 'Kamida bitta faol naqd to‘lov turi bo‘lishi kerak';
  return null;
}

/** Joriy to'lov usullari (faol va nofaol) */
const paymentMethods = () => normalizePaymentMethods(settings.paymentMethods);

/** Sozlamadagi FAOL to'lov usuli (kalit bo'yicha); topilmasa/o'chirilgan bo'lsa — null */
function activeMethodOf(methods: PaymentMethod[], key: unknown): PaymentMethod | null {
  if (typeof key !== 'string') return null;
  return methods.find((m) => m.key === key && m.active) ?? null;
}

/** POS uchun ochiq sozlamalar (GET /settings/pos) — maxfiy maydonlarsiz */
function toPosSettings(): PosSettings {
  return {
    restaurantName: (settings.restaurantName ?? '').trim() || DEFAULT_RESTAURANT_NAME,
    serviceDineInPercent: clampPercent(settings.serviceDineInPercent),
    hallServicePercent: normalizeHallServiceMap(settings.hallServicePercent),
    waiterSharePercent: clampPercent(settings.waiterSharePercent),
    deliveryFeeDefault: normalizeFee(settings.deliveryFeeDefault ?? 0),
    paymentMethods: paymentMethods(),
    hallOrder: normalizeHallList(settings.hallOrder),
    skladEnabled: products.length > 0,
  };
}

/** GET /settings — sozlamalar qatori, xaritalar/ro'yxatlar toza ko'rinishda */
function settingsView() {
  return {
    ...settings,
    hallOrder: normalizeHallList(settings.hallOrder),
    hallServicePercent: normalizeHallServiceMap(settings.hallServicePercent),
    deliveryFeeDefault: normalizeFee(settings.deliveryFeeDefault),
    paymentMethods: paymentMethods(),
  };
}

const restaurantName = () => (settings.restaurantName ?? '').trim() || DEFAULT_RESTAURANT_NAME;

/** Stolga hisob uchun xizmat haqi foizi: zalning alohida foizi (B24), yo'q bo'lsa — umumiy */
function hallPercent(hall: string | null | undefined): number {
  return hallServicePercentFor(
    {
      serviceDineInPercent: Number(settings.serviceDineInPercent) || 0,
      hallServicePercent: normalizeHallServiceMap(settings.hallServicePercent),
    },
    (hall ?? '').trim(),
  );
}

/** Zalning alohida xizmat haqi foizi (null — o'chirish, umumiy foiz qo'llanadi) */
function setHallServicePercent(hall: string, percent: number | null): Record<string, number> {
  const map = normalizeHallServiceMap(settings.hallServicePercent);
  const name = hall.trim();
  if (percent === null) delete map[name];
  else map[name] = percent2(percent);
  settings.hallServicePercent = normalizeHallServiceMap(map);
  return normalizeHallServiceMap(settings.hallServicePercent);
}

/** Zallar tartibi bo'yicha solishtiruvchi (ro'yxatdagilar o'sha tartibda, qolganlari — alifbo) */
function hallComparator(hallOrder: readonly string[] | null | undefined): (a: string, b: string) => number {
  const pos = new Map<string, number>();
  (Array.isArray(hallOrder) ? hallOrder : []).forEach((h, i) => {
    if (typeof h === 'string' && !pos.has(h)) pos.set(h, i);
  });
  return (a, b) => {
    const pa = pos.get(a);
    const pb = pos.get(b);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return (a ?? '').localeCompare(b ?? '', 'uz');
  };
}

// =============================================================================================
// Kirish urinishlarini cheklash — real server LoginThrottle bilan bir xil
// 60 soniya ichida 5 ta noto'g'ri urinish -> 60 soniya 429; muvaffaqiyatli kirish hisoblagichni
// nolga tushiradi. Demo bitta brauzerda ishlaydi, shuning uchun "IP" o'rniga bitta hisoblagich.
// =============================================================================================

const THROTTLE_MAX_FAILURES = 5;
const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_BLOCK_MS = 60_000;
const TOO_MANY_ATTEMPTS_MESSAGE = 'Juda ko‘p noto‘g‘ri urinish. 1 daqiqadan so‘ng qayta urinib ko‘ring';
let loginFailures: number[] = [];
let loginBlockedUntil = 0;

const loginBlocked = () => Date.now() < loginBlockedUntil;
function recordLoginFailure(): void {
  const now = Date.now();
  loginFailures = loginFailures.filter((t) => now - t < THROTTLE_WINDOW_MS);
  loginFailures.push(now);
  if (loginFailures.length >= THROTTLE_MAX_FAILURES) {
    loginBlockedUntil = now + THROTTLE_BLOCK_MS;
    loginFailures = [];
  }
}
function recordLoginSuccess(): void {
  loginFailures = [];
  loginBlockedUntil = 0;
}

// ---- Xodimlar: real UsersService / DTO qoidalari va matnlari bilan bir xil ----
const PIN_PATTERN = /^\d{4,10}$/;
const LOGIN_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const NAME_MAX = 80;
const NAME_MESSAGE = `Ism kiriting (1–${NAME_MAX} belgi)`;
const ROLE_MESSAGE = 'Rol noto‘g‘ri';
const PIN_MESSAGE = 'PIN 4–10 ta raqamdan iborat bo‘lishi kerak';
const LOGIN_MESSAGE = 'Login 3–32 belgi bo‘lishi kerak: lotin harflari, raqamlar, nuqta (.), _ yoki -';
const PASSWORD_MESSAGE = 'Parol 4–64 ta belgidan iborat bo‘lishi kerak';
const PERMISSIONS_MESSAGE = 'Ruxsatlar ro‘yxat ko‘rinishida bo‘lishi kerak';
const LAST_DIRECTOR_MESSAGE = 'Kamida bitta faol direktor qolishi kerak';
const CREDENTIALS_REQUIRED_MESSAGE = 'Bu rol uchun login va parol majburiy (PIN bilan kira olmaydi)';
const PIN_TAKEN_ON_CREATE = 'Bu PIN band — boshqa 4 xonali kod tanlang';
const PIN_TAKEN_ON_UPDATE = 'Bu PIN band — boshqa kod tanlang';

const isValidRole = (r: unknown): r is UserRole => Object.values(UserRole).includes(r as UserRole);

/** Server DTO (ValidationPipe) tekshiruvi — birinchi xato matni yoki null */
function validateUserDto(b: any, create: boolean): string | null {
  const name = trimmed(b.name);
  if (create || b.name !== undefined) {
    if (typeof name !== 'string' || name.length < 1 || name.length > NAME_MAX) return NAME_MESSAGE;
  }
  if ((create || b.role !== undefined) && !isValidRole(b.role)) return ROLE_MESSAGE;
  if (!create && b.active !== undefined && typeof b.active !== 'boolean') return 'Faollik qiymati noto‘g‘ri';
  const pin = trimmed(b.pin);
  if (isGiven(pin) && (typeof pin !== 'string' || !PIN_PATTERN.test(pin))) return PIN_MESSAGE;
  const login = trimmed(b.login);
  if (isGiven(login) && (typeof login !== 'string' || !LOGIN_PATTERN.test(login))) return LOGIN_MESSAGE;
  const pw = b.password;
  if (isGiven(pw) && (typeof pw !== 'string' || pw.length < 4 || pw.length > 64)) return PASSWORD_MESSAGE;
  const perms = b.permissions;
  if (perms !== undefined && perms !== null && (!Array.isArray(perms) || perms.some((k: unknown) => typeof k !== 'string'))) {
    return PERMISSIONS_MESSAGE;
  }
  return null;
}

/** Faqat ma'lum ruxsat kalitlari, takrorlarsiz (tartib saqlanadi) */
function normalizePermissions(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const key of list) {
    if (typeof key === 'string' && ALL_CAPABILITY_KEYS.includes(key) && !out.includes(key)) out.push(key);
  }
  return out;
}
const samePermissions = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));

/** Rol ierarxiyasi: SuperAdmin'ga faqat SuperAdmin; Direktor/SuperAdmin'ga faqat Direktor/SuperAdmin */
function hierarchyAllows(actor: MockUser, target: MockUser | null, nextRole: string): boolean {
  const touched = [nextRole, target?.role].filter((r): r is string => !!r);
  if (touched.includes(UserRole.SuperAdmin) && actor.role !== UserRole.SuperAdmin) return false;
  if (touched.some((r) => isFullAccessRole(r)) && !isFullAccessRole(actor.role)) return false;
  return true;
}
function loginTaken(login: string, exceptId?: string): boolean {
  const l = login.toLowerCase();
  return users.some((x) => x.id !== exceptId && (x.login ?? '').toLowerCase() === l);
}
const isLastActiveDirector = () => users.filter((x) => x.role === UserRole.Director && x.active).length <= 1;

// =============================================================================================
// Buyurtma: qatorlar, DTO, stol, raqam
// =============================================================================================

/** Yangi taom qatori (menyudagi narx, birlik va bo'lim nusxasi bilan) */
function makeItem(
  orderId: string,
  mi: MockMenuItem,
  quantity: number,
  opts: { note?: string | null; createdAt?: string; takeaway?: boolean; status?: OrderItemStatus; price?: number | null } = {},
): MockItem {
  const st = mi.stationId ? stations.find((s) => s.id === mi.stationId) : null;
  const override = opts.price ?? null;
  return {
    id: uid(),
    orderId,
    menuItemId: mi.id,
    menuItemName: mi.name,
    price: override ?? Number(mi.price),
    quantity: roundQty(quantity),
    unit: mi.unit ?? MenuUnit.Piece,
    note: opts.note ?? null,
    status: opts.status ?? OrderItemStatus.Pending,
    exciseRequired: !!mi.exciseRequired,
    exciseCode: null,
    stationId: mi.stationId ?? null,
    stationName: st?.name ?? null,
    createdAt: opts.createdAt ?? nowIso(),
    takeaway: !!opts.takeaway,
    priceOverridden: override !== null,
    originalPrice: override !== null ? Number(mi.price) : null,
  };
}

const userName = (id: string | null | undefined): string | null => (id ? users.find((u) => u.id === id)?.name ?? null : null);
const orderPayments = (orderId: string) =>
  payments.filter((p) => p.orderId === orderId).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

/** Buyurtma stoli — FAQAT stolga buyurtmada (olib ketish / yetkazishda null) */
function tableOf(o: Pick<MockOrder, 'type' | 'tableId'>): MockTable | null {
  if (orderTypeOf(o) !== OrderType.DineIn || !o.tableId) return null;
  return tables.find((t) => t.id === o.tableId) ?? null;
}

/** Buyurtma (taomlari bilan) yoki 404 */
function findEntity(id: string | undefined): MockOrder {
  const o = id ? orders.find((x) => x.id === id) : undefined;
  if (!o) throw notFound(ORDER_NOT_FOUND_MESSAGE);
  return o;
}

function itemDto(it: MockItem): OrderItem {
  return {
    id: it.id,
    orderId: it.orderId,
    menuItemId: it.menuItemId,
    menuItemName: it.menuItemName,
    price: Number(it.price),
    quantity: Number(it.quantity),
    unit: it.unit ?? MenuUnit.Piece,
    stationId: it.stationId ?? null,
    stationName: it.stationName ?? null,
    note: it.note,
    status: it.status,
    exciseRequired: it.exciseRequired,
    exciseCode: it.exciseCode,
    createdAt: it.createdAt,
    takeaway: !!it.takeaway,
    priceOverridden: !!it.priceOverridden,
    originalPrice: it.originalPrice != null ? Number(it.originalPrice) : null,
  };
}

/** To'lov qatori: usul nomi (sozlamadan), kassir ismi, qarzdor */
function paymentView(p: MockPayment, methods: PaymentMethod[] = paymentMethods()): Payment {
  return {
    id: p.id,
    orderId: p.orderId,
    amount: roundSum(p.amount),
    type: p.type,
    cashierId: p.cashierId,
    createdAt: p.createdAt,
    debtorName: p.debtorName ?? null,
    debtorPhone: p.debtorPhone ?? null,
    label: paymentMethodLabel(methods, p.type),
    cashierName: userName(p.cashierId),
  };
}

/** Qatorlar qo'shilgan vaqt bo'yicha (teng bo'lsa — kiritilgan tartib saqlanadi) */
const byCreatedAt = (a: MockItem, b: MockItem) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);

/**
 * Buyurtma -> shared Order (server toDto/fullDto bilan bir xil shakl): type doim to'ldiriladi;
 * tableNumber, hall, checkNo — faqat stolga; total — TO'LANADIGAN summa (chegirma/xizmat/yetkazish
 * bilan; ustiga xizmat qo'shilmaydi); paidAmount doim; withPayments — to'lovlar ro'yxati bilan.
 */
function toDto(o: MockOrder, opts: { withPayments?: boolean } = {}): Order {
  const type = orderTypeOf(o);
  const dineIn = type === OrderType.DineIn;
  const totals = orderTotalsOf(o);
  const pays = orderPayments(o.id);
  const dto: Order = {
    id: o.id,
    type,
    tableId: dineIn ? o.tableId ?? null : null,
    checkNo: dineIn ? checkNoOf(o) : null,
    billPrintedAt: o.billPrintedAt ?? null,
    waiterId: o.waiterId,
    status: o.status,
    openedAt: o.openedAt,
    closedAt: o.closedAt ?? null,
    queueNumber: o.queueNumber ?? null,
    phone: o.phone ?? null,
    address: o.address ?? null,
    deliveryFee: totals.deliveryFee,
    note: o.note ?? null,
    customerId: o.customerId ?? null,
    customerName: o.customerName ?? null,
    discountPercent: totals.discountPercent,
    servicePercent: totals.servicePercent,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    serviceAmount: totals.serviceAmount,
    total: totals.total,
    refunded: !!o.refunded,
    refundReason: o.refundReason ?? null,
    refundedAt: o.refundedAt ?? null,
    items: [...o.items].sort(byCreatedAt).map(itemDto),
  };
  if (dineIn) {
    const table = tableOf(o);
    dto.tableNumber = table?.number;
    dto.hall = table?.hall ?? null;
  }
  dto.waiterName = userName(o.waiterId);
  dto.paidAmount = sumPayments(pays);
  if (opts.withPayments) {
    const methods = paymentMethods();
    dto.payments = pays.map((p) => paymentView(p, methods));
  }
  return dto;
}

/** Stoldagi ochiq hisoblar — hisob raqami bo'yicha (eskisi — 1) */
function openChecksAt(tableId: string): MockOrder[] {
  if (!tableId) return [];
  return orders
    .filter((o) => o.tableId === tableId && o.status !== OrderStatus.Closed && orderTypeOf(o) === OrderType.DineIn)
    .sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt))
    .sort((a, b) => checkNoOf(a) - checkNoOf(b));
}

/** Stoldagi barcha ochiq buyurtmalar (hisob raqami hisoblash uchun) */
const openAtTable = (tableId: string) => orders.filter((o) => o.tableId === tableId && o.status !== OrderStatus.Closed);

/**
 * Stol holatini hisoblar bo'yicha tiklash: ochiq hisob qolmagan bo'lsa — bo'sh; bor bo'lsa va stol
 * "bo'sh" deb turgan bo'lsa — band (aks holda holati saqlanadi, masalan "hisob kutilmoqda").
 */
function settleTable(tableId: string | null | undefined): void {
  if (!tableId) return;
  const table = tables.find((t) => t.id === tableId);
  if (!table) return;
  const open = openAtTable(tableId).length;
  table.status = open === 0 ? TableStatus.Free : table.status === TableStatus.Free ? TableStatus.Busy : table.status;
}

/**
 * Kunlik buyurtma raqami (B27/B27b): BARCHA turlar uchun bitta ketma-ketlik, har mahalliy kun 1 dan.
 * Bekor qilingan buyurtmaning raqami QAYTA berilmaydi (hisoblagich alohida saqlanadi). Kunning
 * birinchi raqamida hisoblagich shu kundagi eng katta raqamdan boshlanadi.
 */
function nextDailyNumber(businessDate: string): number {
  let last = dailyCounters.get(businessDate);
  if (last === undefined) {
    last = orders
      .filter((o) => o.businessDate === businessDate)
      .reduce((max, o) => Math.max(max, Number(o.queueNumber) || 0), 0);
  }
  last += 1;
  dailyCounters.set(businessDate, last);
  return last;
}

/** Eslab qolingan takroriy so'rov (24 soat ichida) */
function recalledRequest(id: string): RememberedRequest | null {
  const r = recentRequests.get(id);
  if (!r) return null;
  if (Date.now() - r.at > REQUEST_ID_TTL_MS) {
    recentRequests.delete(id);
    return null;
  }
  return r;
}

/** So'rov natijasini eslab qolish; eskirganlari (Map tartibi — eng eskisi boshida) tozalanadi */
function rememberRequest(id: string, order: Order): void {
  const now = Date.now();
  recentRequests.delete(id);
  recentRequests.set(id, { orderId: order.id, at: now, snapshot: order });
  for (const [key, r] of recentRequests) {
    if (now - r.at <= REQUEST_ID_TTL_MS && recentRequests.size <= REQUEST_ID_MAX) break;
    recentRequests.delete(key);
  }
}

/** CRM'dagi shu telefon raqamli mijoz (bir nechta bo'lsa — eng yangisi) */
function findCustomerByPhone(phone: string): MockCustomer | null {
  return (
    [...customers]
      .filter((c) => c.phone)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .find((c) => normalizePhone(c.phone) === phone) ?? null
  );
}

/** Fiskal hujjat (to'liq to'langanda) — raqam va QR */
function issueFiscal(o: MockOrder, total: number): { fiscalNumber: string; qr: string } {
  fiscalCounter++;
  const fiscalNumber = String(fiscalCounter).padStart(10, '0');
  const doc = { fiscalNumber, qr: `https://ofd.soliq.uz/check?fn=${fiscalNumber}&sum=${total}&t=${Date.parse(o.closedAt ?? nowIso())}` };
  fiscalDocs.set(o.id, doc);
  return doc;
}

// =============================================================================================
// Sklad (ombor) — 0.3.3 shartnomasi: qoldiqning har bir o'zgarishi jurnalga yoziladi
// =============================================================================================

const COUNT_LABEL = 'Inventarizatsiya';
const PRODUCTION_LABEL = 'Ishlab chiqarish';
/** Boshlang'ich qoldiq harakatining izohi (server bilan aynan bir xil) */
const INITIAL_STOCK_NOTE = 'Sklad jurnali boshlanishidagi qoldiq';
const PRODUCT_UNITS = Object.values(ProductUnit) as string[];
// Server xabarlari (inventory-rules.ts, dto.ts, reports/report-dates.ts) — shared'da yo'q
const PRODUCT_UNIT_INVALID_MESSAGE = 'O‘lchov birligi noto‘g‘ri (kg, g, l, ml yoki dona)';
const STOCK_TEXT_INVALID_MESSAGE = 'Matn noto‘g‘ri';
const ADJUST_TYPE_INVALID_MESSAGE = 'Harakat turi noto‘g‘ri (writeoff yoki adjust)';
const STOCK_DATE_INVALID_MESSAGE = 'Sana noto‘g‘ri (YYYY-MM-DD yoki YYYY-MM-DDTHH:MM)';

/** Harakat konteksti (server applyMovements ctx): kim, qaysi hujjat, izoh; at — faqat demo seed uchun */
interface MoveCtx {
  userId: string | null;
  userName: string | null;
  reference?: string | null;
  referenceLabel?: string | null;
  note?: string | null;
  at?: string;
}

/**
 * Qoldiqni o'zgartirishning YAGONA yo'li (server applyMovements): qoldiq yangilanadi (3 xona; count —
 * mutlaq qiymat), yangi qoldiq harakatga balanceAfter bo'lib yoziladi.
 */
function applyMovement(
  p: MockProduct,
  type: StockMovementType,
  change: { delta: number } | { absolute: number },
  unitCost: number,
  ctx: MoveCtx,
): MockMovement {
  const before = roundStockQty(p.stock);
  const absolute = 'absolute' in change;
  const after = absolute ? roundStockQty(change.absolute) : roundStockQty(before + change.delta);
  p.stock = after;
  const m: MockMovement = {
    id: uid(),
    productId: p.id,
    productName: p.name,
    unit: p.unit,
    type,
    quantity: absolute ? roundStockQty(after - before) : roundStockQty(change.delta),
    balanceAfter: after,
    unitCost: roundStockCost(unitCost),
    reference: ctx.reference ?? null,
    referenceLabel: ctx.referenceLabel ?? null,
    note: ctx.note ?? null,
    userId: ctx.userId,
    userName: ctx.userName,
    createdAt: ctx.at ?? nowIso(),
  };
  movements.push(m);
  return m;
}

/**
 * Buyurtmaning sklad jurnalidagi nomi (server orderStockLabel): orderDisplayName ("Olib ketish #12",
 * "Stol 5 · Hisob 2"), stolga buyurtmada esa kunlik raqam ham — "Stol 5 · №12".
 */
function orderRefLabel(o: MockOrder): string {
  const dto = toDto(o);
  const name = orderDisplayName(dto);
  const n = Number(dto.queueNumber);
  return orderTypeOf(dto) === OrderType.DineIn && Number.isInteger(n) && n > 0 ? `${name} · №${n}` : name;
}

/**
 * Sotuv (server deductForOrder, to'lov tranzaksiyasida): retseptli taomlar bo'yicha har mahsulotga
 * bitta 'sale' harakati, o'rtacha tannarx bilan. Qoldiq manfiyga tushishi mumkin — sotuv to'lovda
 * hech qachon to'xtatilmaydi. Retseptsiz buyurtma — hech narsa yozilmaydi.
 */
function writeSaleMovements(o: MockOrder, userId: string | null, at?: string): void {
  const need = sumNeed(o.items.map((it) => ({ menuItemId: it.menuItemId, quantity: Number(it.quantity) })));
  if (need.size === 0) return;
  const ctx: MoveCtx = { userId, userName: userName(userId), reference: o.id, referenceLabel: orderRefLabel(o), at };
  for (const [productId, amount] of need) {
    const p = products.find((x) => x.id === productId);
    const qty = roundStockQty(amount);
    if (!p || !(qty > 0)) continue;
    applyMovement(p, 'sale', { delta: -qty }, p.avgCost, ctx);
  }
}

/**
 * Vozvrat (returnStock, server returnSaleStock): chekning 'sale' harakatlari aynan teskarisiga — o'sha
 * mahsulotlar, miqdorlar va tannarx bilan 'refund' (+). Sotuv harakati yo'q — hech narsa; ikkinchi marta yo'q.
 */
function writeRefundMovements(o: MockOrder, actor: MockUser): void {
  if (movements.some((m) => m.type === 'refund' && m.reference === o.id)) return;
  const byProduct = new Map<string, { qty: number; cost: number }>();
  for (const s of movements) {
    if (s.type !== 'sale' || s.reference !== o.id) continue;
    const cur = byProduct.get(s.productId) ?? { qty: 0, cost: 0 };
    cur.qty += -s.quantity;
    cur.cost += -s.quantity * s.unitCost;
    byProduct.set(s.productId, cur);
  }
  if (byProduct.size === 0) return;
  const ctx: MoveCtx = { userId: actor.id, userName: actor.name, reference: o.id, referenceLabel: `Vozvrat: ${orderRefLabel(o)}` };
  for (const [productId, v] of byProduct) {
    const p = products.find((x) => x.id === productId);
    const qty = roundStockQty(v.qty);
    if (p && qty !== 0) applyMovement(p, 'refund', { delta: qty }, v.qty ? v.cost / v.qty : 0, ctx);
  }
}

// Retsept bo'yicha kerakli mahsulot miqdorlari (productId -> amount)
function sumNeed(items: { menuItemId: string; quantity: number }[]) {
  const m = new Map<string, number>();
  items.forEach((it) => {
    recipeItems
      .filter((r) => r.menuItemId === it.menuItemId)
      .forEach((r) => m.set(r.productId, (m.get(r.productId) || 0) + Number(r.amount) * Number(it.quantity)));
  });
  return m;
}

// Ombor yetarli emasligini tekshirish — yetmasa xabar qaytaradi (aks holda null)
function stockShortage(newItems: { menuItemId: string; quantity: number }[]): string | null {
  const need = sumNeed(newItems);
  if (need.size === 0) return null;
  const openItems = orders
    .filter((o) => o.status !== OrderStatus.Closed)
    .flatMap((o) => o.items.map((it) => ({ menuItemId: it.menuItemId, quantity: it.quantity })));
  const reserved = sumNeed(openItems);
  for (const [pid, needed] of need) {
    const p = products.find((x) => x.id === pid);
    if (!p) continue;
    const available = Number(p.stock) - (reserved.get(pid) || 0);
    if (needed > available + 1e-6) return stockNotEnoughMessage(p.name, available, p.unit);
  }
  return null;
}

/**
 * Tarix qatoridagi to'lov turi (server mainPaymentType): filtr qo'yilgan bo'lsa — o'sha tur;
 * aks holda eng ko'p summa to'langan tur; teng bo'lsa — birinchi to'lov turi.
 */
function mainPaymentType(pays: MockPayment[], preferred?: string | null): string {
  if (preferred && pays.some((p) => p.type === preferred)) return preferred;
  const byType = new Map<string, number>();
  for (const p of pays) byType.set(p.type, (byType.get(p.type) ?? 0) + roundSum(p.amount));
  let best = pays[0].type;
  let bestSum = -Infinity;
  for (const [type, sum] of byType) {
    if (sum > bestSum) {
      best = type;
      bestSum = sum;
    }
  }
  return best;
}

// =============================================================================================
// Buyurtma: so'rov tekshiruvi (server DTO / ValidationPipe xabarlari bilan bir xil)
// =============================================================================================

/** POST /orders tanasi (CreateOrderDto) — birinchi xato matni yoki null */
function validateCreateOrder(b: any): string | null {
  if (b.type != null && !(ORDER_TYPES as unknown[]).includes(b.type)) return ORDER_TYPE_INVALID_MESSAGE;
  const type = b.type ?? OrderType.DineIn;
  if (type === OrderType.DineIn && isGiven(b.tableId) && !isUuid(b.tableId)) return TABLE_REQUIRED_MESSAGE;
  if (isGiven(b.orderId) && !isUuid(b.orderId)) return ORDER_NOT_FOUND_MESSAGE;
  if (isGiven(b.checkNo) && !(isInt(b.checkNo) && b.checkNo >= 1 && b.checkNo <= MAX_CHECK_NO)) {
    return CHECK_NO_INVALID_MESSAGE;
  }
  if (b.newCheck != null && typeof b.newCheck !== 'boolean') return 'newCheck must be a boolean value';
  if (b.waiterId != null && !isUuid(b.waiterId)) return 'waiterId must be a UUID';
  if (!Array.isArray(b.items)) return NO_ITEMS_MESSAGE;
  for (const i of b.items) {
    if (!i || typeof i !== 'object') return 'nested property items must be either object or array';
    if (!isUuid(i.menuItemId)) return MENU_ITEM_INVALID_MESSAGE;
    if (!isNum(i.quantity) || decimalPlaces(i.quantity) > QTY_DECIMALS || i.quantity < 1 / 10 ** QTY_DECIMALS) {
      return ITEM_QTY_INVALID_MESSAGE;
    }
    if (i.note != null && typeof i.note !== 'string') return 'note must be a string';
    if (i.takeaway != null && typeof i.takeaway !== 'boolean') return 'takeaway must be a boolean value';
    if (i.price != null && !(isNum(i.price) && i.price >= 0 && i.price <= PRICE_MAX)) return PRICE_INVALID_MESSAGE;
  }
  if (b.note != null && typeof b.note !== 'string') return 'note must be a string';
  if (b.customerId != null && !isUuid(b.customerId)) return 'customerId must be a UUID';
  if (b.phone != null && (b.type === OrderType.Takeaway || b.type === OrderType.Delivery) && typeof b.phone !== 'string') {
    return PHONE_INVALID_MESSAGE;
  }
  if (b.address != null && b.type === OrderType.Delivery) {
    if (typeof b.address !== 'string') return ADDRESS_REQUIRED_MESSAGE;
    if (b.address.length > ADDRESS_MAX_LENGTH) return ADDRESS_TOO_LONG_MESSAGE;
  }
  if (b.deliveryFee != null && b.type === OrderType.Delivery && !(isInt(b.deliveryFee) && b.deliveryFee >= 0 && b.deliveryFee <= DELIVERY_FEE_MAX)) {
    return DELIVERY_FEE_INVALID_MESSAGE;
  }
  if (b.clientRequestId != null) {
    if (typeof b.clientRequestId !== 'string') return 'clientRequestId must be a string';
    if (b.clientRequestId.length > 64) return 'clientRequestId must be shorter than or equal to 64 characters';
  }
  return null;
}

/** Otkaz/bo'lish qatorlari ({orderItemId, quantity}[]) tekshiruvi */
function validateLineQty(list: unknown, arrayMessage: string, qtyMessage: string): string | null {
  if (!Array.isArray(list)) return arrayMessage;
  for (const r of list) {
    if (!r || typeof r !== 'object') return 'nested property items must be either object or array';
    if (!isUuid((r as any).orderItemId)) return ITEM_LINE_NOT_FOUND_MESSAGE;
    if (!isNum((r as any).quantity)) return qtyMessage;
  }
  return null;
}

/** Qarzdor (pay / pay-multi debtor) tekshiruvi */
function validateDebtorDto(d: any): string | null {
  if (d == null) return null;
  if (typeof d !== 'object') return 'nested property debtor must be either object or array';
  if (d.name != null) {
    if (typeof d.name !== 'string') return 'name must be a string';
    if (d.name.length > 100) return 'name must be shorter than or equal to 100 characters';
  }
  if (d.phone != null) {
    if (typeof d.phone !== 'string') return 'phone must be a string';
    if (d.phone.length > 32) return 'phone must be shorter than or equal to 32 characters';
  }
  return null;
}

/** To'lov foizlari (chegirma / xizmat haqi) tekshiruvi */
function validatePercents(b: any): string | null {
  if (b.discountPercent != null && !(isNum(b.discountPercent) && b.discountPercent >= 0 && b.discountPercent <= 100)) {
    return DISCOUNT_PERCENT_MESSAGE;
  }
  if (b.serviceFeePercent != null && !(isNum(b.serviceFeePercent) && b.serviceFeePercent >= 0 && b.serviceFeePercent <= 100)) {
    return SERVICE_PERCENT_MESSAGE;
  }
  return null;
}

// =============================================================================================
// Buyurtma: o'qish (faol, tarix, chek)
// =============================================================================================

// Faol (yopilmagan) buyurtmalar — barcha turlar (yoki ?type=). Tartib: stolga (zallar tartibi, stol
// raqami, hisob raqami), keyin olib ketish va yetkazish (ish kuni, kunlik raqam).
function findActive(type?: string | null): Order[] {
  const filter = parseOrderType(type);
  const list = orders
    .filter((o) => o.status !== OrderStatus.Closed && (!filter || orderTypeOf(o) === filter))
    .sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));
  const hallCmp = hallComparator(settings.hallOrder);
  const rows = list.map((o) => ({ o, dto: toDto(o) }));
  rows.sort((a, b) => {
    const ta = orderTypeOf(a.dto);
    const tb = orderTypeOf(b.dto);
    if (ta !== tb) return ORDER_TYPES.indexOf(ta) - ORDER_TYPES.indexOf(tb);
    if (ta === OrderType.DineIn) {
      return (
        hallCmp(a.dto.hall ?? '', b.dto.hall ?? '') ||
        (a.dto.tableNumber ?? 0) - (b.dto.tableNumber ?? 0) ||
        checkNoOf(a.o) - checkNoOf(b.o) ||
        a.dto.openedAt.localeCompare(b.dto.openedAt)
      );
    }
    return (
      (a.o.businessDate ?? '').localeCompare(b.o.businessDate ?? '') ||
      (a.dto.queueNumber ?? 0) - (b.dto.queueNumber ?? 0) ||
      a.dto.openedAt.localeCompare(b.dto.openedAt)
    );
  });
  return rows.map((r) => r.dto);
}

/** O'zbekcha apostrof turlari (‘ ’ ʼ ` ´) -> oddiy ' (qidiruvda "Go‘sht" = "Go'sht") */
const normalizeApostrophes = (s: string) => s.replace(/[‘’ʼ`´]/g, "'");

/**
 * Tarix qidiruvi (server applySearch): "#12" — faqat kunlik raqam; aks holda stol raqami (qism-satr),
 * kunlik raqam (aniq), telefon raqamlari (kamida 4 ta), taom nomi, mijoz ismi, buyurtma id boshi.
 */
function matchesSearch(o: MockOrder, search: string): boolean {
  const hash = /^#\s*(\d{1,9})$/.exec(search);
  if (hash) return o.queueNumber === Number(hash[1]);
  const table = o.tableId ? tables.find((t) => t.id === o.tableId) : undefined;
  if (table && String(table.number).includes(search)) return true;
  if (/^\d{1,9}$/.test(search) && o.queueNumber === Number(search)) return true;
  const digits = search.replace(/\D/g, '');
  if (digits.length >= PHONE_SEARCH_MIN_DIGITS && (o.phone ?? '').includes(digits)) return true;
  const text = normalizeApostrophes(search).toLowerCase();
  if (o.items.some((it) => normalizeApostrophes(it.menuItemName).toLowerCase().includes(text))) return true;
  if (o.customerName && normalizeApostrophes(o.customerName).toLowerCase().includes(text)) return true;
  if (/^[0-9a-f-]{4,36}$/i.test(search) && o.id.startsWith(search.toLowerCase())) return true;
  return false;
}

/** So'rov parametri -> musbat butun son; noto'g'ri bo'lsa — fallback, katta bo'lsa — max */
function positiveInt(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * Cheklar tarixi (B25): eski va yangi filtrlar, sahifalash, butun filtr bo'yicha yig'indi.
 * Ruxsat: 'history' / admin — hammasi; oshxona — ko'radi; ofitsiant — faqat o'zinikini; boshqalar — 403.
 */
function history(params: URLSearchParams, actor: MockUser) {
  let forcedWaiterId: string | undefined;
  // Ofitsiant (lavozim) — har doim faqat o'z savdosi, KDS ruxsati belgilangan bo'lsa ham (server bilan bir xil)
  const kitchenSeesAll = can(actor, 'kitchen') && actor.role !== UserRole.Waiter;
  if (!canViewAllHistory(actor) && !kitchenSeesAll) {
    if (can(actor, 'waiter')) forcedWaiterId = actor.id;
    else throw forbidden();
  }
  const str = (k: string) => {
    const v = params.get(k);
    if (v == null) return undefined;
    const s = v.trim();
    return s === '' ? undefined : s;
  };
  const num = (k: string) => {
    const s = str(k);
    if (s === undefined) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };
  const iso = (k: string) => {
    const s = str(k);
    const t = s ? Date.parse(s) : NaN;
    return Number.isFinite(t) ? t : null;
  };
  const page = positiveInt(str('page'), 1, 100_000);
  const limit = positiveInt(str('limit'), 20, 100);
  const type = parseOrderType(str('type'));
  const waiterId = forcedWaiterId ?? str('waiterId');
  const status = str('status');
  const hall = str('hall');
  const tableNumber = num('tableNumber');
  const dateFrom = iso('dateFrom');
  const dateTo = iso('dateTo');
  const from = localBound(str('from'), false);
  const to = localBound(str('to'), true);
  const paymentType = str('paymentType');
  const cashierId = str('cashierId');
  const refunded = str('refunded')?.toLowerCase();
  const minTotal = num('minTotal');
  const maxTotal = num('maxTotal');
  const searches = [str('search'), str('q')].filter((s): s is string => !!s);

  const list = orders
    .filter((o) => {
      if (type && orderTypeOf(o) !== type) return false;
      if (waiterId && o.waiterId !== waiterId) return false;
      if (status === 'open' ? o.status === OrderStatus.Closed : status && o.status !== status) return false;
      const table = o.tableId ? tables.find((t) => t.id === o.tableId) : undefined;
      if (hall && table?.hall !== hall) return false;
      if (tableNumber !== undefined && Number.isInteger(tableNumber) && table?.number !== tableNumber) return false;
      const opened = Date.parse(o.openedAt);
      if (dateFrom !== null && opened < dateFrom) return false;
      if (dateTo !== null && opened > dateTo) return false;
      const when = toSecond(Date.parse(o.closedAt ?? o.openedAt));
      if (from !== null && when < from) return false;
      if (to !== null && when > to) return false;
      if (paymentType && !payments.some((p) => p.orderId === o.id && p.type === paymentType)) return false;
      if (cashierId && !payments.some((p) => p.orderId === o.id && p.cashierId === cashierId)) return false;
      if ((refunded === 'true' || refunded === '1') && !o.refunded) return false;
      if ((refunded === 'false' || refunded === '0') && o.refunded) return false;
      if (minTotal !== undefined || maxTotal !== undefined) {
        const total = orderTotalsOf(o).total;
        if (minTotal !== undefined && total < minTotal) return false;
        if (maxTotal !== undefined && total > maxTotal) return false;
      }
      return searches.every((s) => matchesSearch(o, s));
    })
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt) || b.id.localeCompare(a.id));

  const summary = list.reduce(
    (acc, o) => {
      const total = orderTotalsOf(o).total;
      acc.count += 1;
      acc.total += total;
      if (o.refunded) {
        acc.refundedCount += 1;
        acc.refundedTotal += total;
      }
      return acc;
    },
    { count: 0, total: 0, refundedCount: 0, refundedTotal: 0 },
  );
  // Har qator — to'liq buyurtma: to'lovlar (usul nomi, kassir), asosiy to'lov turi, vozvrat qilgan xodim
  const items = list.slice((page - 1) * limit, page * limit).map((o) => {
    const dto = toDto(o, { withPayments: true });
    const pays = orderPayments(o.id);
    if (pays.length) dto.paymentType = mainPaymentType(pays, paymentType);
    if (o.refunded) dto.refundedByName = userName(o.refundedBy);
    return dto;
  });
  return { items, total: list.length, page, limit, hasMore: page * limit < list.length, summary };
}

/**
 * Chek (B9): tur, kunlik raqam, stol hisobi, telefon/manzil, yetkazish narxi, saboy qatorlari,
 * restoran nomi, har bir to'lov usul nomi bilan. Stol raqami va zal — faqat stolga buyurtmada.
 */
function buildReceipt(
  o: MockOrder,
  parts: { cashierName: string | null; payments: Payment[]; fallbackType: string; createdAt: string },
): Receipt {
  const type = orderTypeOf(o);
  const dineIn = type === OrderType.DineIn;
  const totals = orderTotalsOf(o);
  const table = tableOf(o);
  const last = parts.payments[parts.payments.length - 1];
  const fiscal = fiscalDocs.get(o.id);
  return {
    orderId: o.id,
    orderType: type,
    queueNumber: o.queueNumber ?? null,
    checkNo: dineIn ? checkNoOf(o) : null,
    phone: o.phone ?? null,
    address: o.address ?? null,
    deliveryFee: totals.deliveryFee,
    ...(dineIn ? { tableNumber: table?.number, hall: table?.hall ?? null } : {}),
    waiterName: userName(o.waiterId) ?? undefined,
    cashierName: parts.cashierName ?? undefined,
    lines: [...o.items].sort(byCreatedAt).map((it) => ({
      name: it.menuItemName,
      quantity: Number(it.quantity),
      price: Number(it.price),
      sum: lineSum(it.price, it.quantity),
      unit: it.unit ?? MenuUnit.Piece,
      takeaway: !!it.takeaway,
      priceOverridden: !!it.priceOverridden,
      originalPrice: it.originalPrice != null ? Number(it.originalPrice) : null,
    })),
    subtotal: totals.subtotal,
    discountPercent: totals.discountPercent,
    discountAmount: totals.discountAmount,
    serviceFeePercent: totals.servicePercent,
    serviceFeeAmount: totals.serviceAmount,
    total: totals.total,
    paymentType: last?.type ?? parts.fallbackType,
    payments: parts.payments.map((p) => ({ type: p.type, amount: p.amount, label: p.label })),
    restaurantName: restaurantName(),
    note: o.note ?? null,
    customerName: o.customerName ?? null,
    createdAt: parts.createdAt,
    fiscalQrPlaceholder: false,
    fiscalNumber: fiscal?.fiscalNumber,
    fiscalQr: fiscal?.qr,
  };
}

// GET /orders/:id/receipt — yopilgan chekning nusxasi (qayta chop etish uchun)
function receiptOf(id: string): Receipt {
  const order = findEntity(id);
  if (order.status !== OrderStatus.Closed) throw bad(ORDER_NOT_CLOSED_MESSAGE);
  const methods = paymentMethods();
  const pays = orderPayments(id);
  const lastPay = pays[pays.length - 1];
  return buildReceipt(order, {
    cashierName: lastPay ? userName(lastPay.cashierId) : null,
    payments: pays.map((p) => paymentView(p, methods)),
    fallbackType: lastPay?.type ?? 'naqd',
    createdAt: order.closedAt || nowIso(),
  });
}

// =============================================================================================
// Buyurtma: yaratish / qo'shish (B2, B18, B21, B27–B29, B31, B32)
// =============================================================================================

interface CreateInput {
  type: OrderType;
  appendTo: string | null;
  phone: string | null;
  address: string | null;
  deliveryFee: number | null;
}

// Yangi buyurtma yoki mavjud ochiq buyurtmaga qo'shimcha (server create bilan bir xil qoidalar):
//  • stol: stol majburiy; checkNo — shu raqamli ochiq hisobga yoki aynan shu raqamli yangi hisob;
//    newCheck — keyingi bo'sh raqamli yangi hisob; hech biri — eng kichik raqamli ochiq hisobga;
//  • olib ketish / yetkazish: (orderId'siz) HAR DOIM yangi buyurtma;
//  • orderId — aynan shu ochiq buyurtmaga. clientRequestId takrorlansa — avvalgi natija.
function createOrder(body: any, actor: MockUser): Order {
  const dtoError = validateCreateOrder(body);
  if (dtoError) throw bad(dtoError);
  if (body.items.length === 0) throw bad(NO_ITEMS_MESSAGE);
  const appendTo: string | null = body.orderId || null;
  const type = orderTypeOf({ type: body.type });

  let phone: string | null = null;
  let address: string | null = null;
  let deliveryFee: number | null = null;
  if (!appendTo) {
    if (type === OrderType.DineIn) {
      if (!body.tableId) throw bad(TABLE_REQUIRED_MESSAGE);
    } else {
      // Telefon: yetkazishda majburiy, olib ketishda ixtiyoriy (berilsa — to'g'ri bo'lishi shart)
      const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
      if (type === OrderType.Delivery || rawPhone) {
        phone = normalizePhone(rawPhone);
        if (!phone) throw bad(PHONE_INVALID_MESSAGE);
      }
      if (type === OrderType.Delivery) {
        address = typeof body.address === 'string' ? body.address.trim() : '';
        if (!address) throw bad(ADDRESS_REQUIRED_MESSAGE);
        if (body.deliveryFee != null) deliveryFee = normalizeFee(body.deliveryFee);
      }
    }
  }

  const requestId = typeof body.clientRequestId === 'string' ? body.clientRequestId.trim() : '';
  if (requestId) {
    // Takroriy so'rov (oflayn navbat qayta yubordi) — yangi narsa yaratilmaydi
    const prev = recalledRequest(requestId);
    if (prev) {
      const existing = orders.find((o) => o.id === prev.orderId);
      return existing ? toDto(existing) : prev.snapshot;
    }
  }
  const waiterId = body.waiterId && canManageOrders(actor) ? body.waiterId : actor.id;
  const out = createLocked(body, waiterId, { type, appendTo, phone, address, deliveryFee }, actor);
  if (requestId) rememberRequest(requestId, out);
  return out;
}

function createLocked(body: any, waiterId: string, input: CreateInput, actor: MockUser): Order {
  // 1) Qaysi buyurtmaga qo'shiladi yoki yangi buyurtma qaysi stolda / qaysi hisob raqami bilan
  let target: MockOrder | null = null;
  let table: MockTable | null = null;
  let newCheckNo: number | null = null;
  let tableHadOpen = false;
  if (input.appendTo) {
    target = orders.find((o) => o.id === input.appendTo) ?? null;
    if (!target) throw notFound(ORDER_NOT_FOUND_MESSAGE);
    if (target.status === OrderStatus.Closed) throw bad(ORDER_CLOSED_MESSAGE);
    if (orderTypeOf(target) === OrderType.DineIn) {
      if (body.tableId && target.tableId && body.tableId !== target.tableId) throw bad(ORDER_OTHER_TABLE_MESSAGE);
      table = tableOf(target);
      // Stol egasi: boshqa ofitsiant ochgan stolga taom qo'sha olmaydi
      if (table && !canServeTable(sessionUser(actor), openChecksAt(table.id))) throw forbidden(TABLE_OWNER_MESSAGE);
    } else if (!canSeeOrder(sessionUser(actor), target)) {
      // Olib ketish / yetkazish: boshqa ofitsiantning buyurtmasiga taom qo'sha olmaydi
      throw forbidden(ORDER_OWNER_MESSAGE);
    }
  } else if (input.type === OrderType.DineIn) {
    table = tables.find((t) => t.id === body.tableId) ?? null;
    if (!table) throw notFound(TABLE_NOT_FOUND_MESSAGE);
    const open = openChecksAt(table.id);
    // Stol egasi: boshqa ofitsiant ochgan stolga taom qo'sha / yangi hisob ocha olmaydi
    if (!canServeTable(sessionUser(actor), open)) throw forbidden(TABLE_OWNER_MESSAGE);
    tableHadOpen = open.length > 0;
    if (body.checkNo != null) {
      // "Hisob-2" yorlig'i: shu raqamli ochiq hisob bo'lsa — unga, aks holda aynan shu raqam bilan yangi
      target = open.find((o) => checkNoOf(o) === body.checkNo) ?? null;
      if (!target) newCheckNo = body.checkNo;
    } else if (body.newCheck) {
      newCheckNo = nextFreeCheckNo(open);
    } else {
      // Eski / oflayn mijozlar: stoldagi eng kichik raqamli ochiq hisobga (hech qachon xato bermaydi)
      target = open[0] ?? null;
      if (!target) newCheckNo = 1;
    }
  }
  const orderType = target ? orderTypeOf(target) : input.type;
  const dineIn = orderType === OrderType.DineIn;

  // 2) Mijoz (CRM): aniq tanlangan, yoki yangi yetkazishda — shu telefon raqamli mijoz (yaratilmaydi)
  let customer = body.customerId ? customers.find((c) => c.id === body.customerId) ?? null : null;
  if (!customer && !target && orderType === OrderType.Delivery && input.phone) {
    customer = findCustomerByPhone(input.phone);
  }

  // 3) Menyu: mavjudligi, stop list, miqdor, narx
  const menuById = new Map(menu.map((m) => [m.id, m]));
  const lines: any[] = body.items;
  const unknown = lines.find((i) => !menuById.has(i.menuItemId));
  if (unknown) throw bad(`Taom topilmadi: ${unknown.menuItemId}`);
  for (const i of lines) {
    const mi = menuById.get(i.menuItemId)!;
    if (mi.available === false) throw bad(stopListMessage(mi.name));
    if (!isValidQuantity(Number(i.quantity), mi.unit ?? MenuUnit.Piece)) throw bad(quantityInvalidMessage(mi.name));
  }
  // Narxni qo'lda o'zgartirish (B31) — faqat kassir / 'void'; menyudagi narxga teng — o'zgartirish emas
  const overridden = (i: any): number | null => {
    if (i.price == null) return null;
    const price = Math.round(Number(i.price) * 100) / 100;
    return price === Number(menuById.get(i.menuItemId)!.price) ? null : price;
  };
  if (lines.some((i) => overridden(i) !== null) && !canOverridePrice(actor)) throw forbidden(PRICE_FORBIDDEN_MESSAGE);

  // 4) Ombor yetarliligi (ochiq buyurtmalar band hisoblanadi)
  const shortage = stockShortage(lines.map((i) => ({ menuItemId: i.menuItemId, quantity: Number(i.quantity) })));
  if (shortage) throw bad(shortage);

  const createdAt = nowIso();
  const buildItems = (orderId: string) =>
    lines.map((i) =>
      makeItem(orderId, menuById.get(i.menuItemId)!, Number(i.quantity), {
        note: typeof i.note === 'string' && i.note.trim() ? i.note.trim() : null,
        createdAt,
        // Saboy (B21) — faqat stoldagi buyurtmada ma'noli
        takeaway: dineIn ? !!i.takeaway : false,
        price: overridden(i),
      }),
    );

  // 5a) Mavjud ochiq buyurtmaga (hisobga) qo'shimcha
  if (target) {
    target.items.push(...buildItems(target.id));
    if (body.note !== undefined) target.note = body.note?.trim() || null;
    if (customer) {
      target.customerId = customer.id;
      target.customerName = customer.name;
    }
    // Yangi taomlar tayyorlanishi kerak — buyurtma yana faollashadi
    if (target.status === OrderStatus.Ready) target.status = OrderStatus.Cooking;
    // Berilgan schot eskirdi (B23) — "chek berildi" belgisi olinadi
    target.billPrintedAt = null;
    const dto = toDto(target);
    emitUpdated(dto);
    return dto;
  }

  // 5b) Yangi buyurtma (hisob). Xizmat haqi: stolga — zal foizi; olib ketish/yetkazish — 0.
  const businessDate = businessDateOf();
  const id = uid();
  const order: MockOrder = {
    id,
    type: orderType,
    tableId: dineIn ? table!.id : null,
    checkNo: dineIn ? newCheckNo ?? 1 : null,
    waiterId,
    status: OrderStatus.Accepted,
    openedAt: createdAt,
    closedAt: null,
    queueNumber: nextDailyNumber(businessDate),
    businessDate,
    phone: dineIn ? null : input.phone,
    address: orderType === OrderType.Delivery ? input.address : null,
    deliveryFee: orderType === OrderType.Delivery ? input.deliveryFee ?? normalizeFee(settings.deliveryFeeDefault) : 0,
    billPrintedAt: null,
    items: buildItems(id),
    note: body.note?.trim() || null,
    discountPercent: 0,
    servicePercent: dineIn ? hallPercent(table!.hall) : 0,
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? null,
    refunded: false,
    refundReason: null,
    refundedAt: null,
    refundedBy: null,
  };
  orders.push(order);
  // Stol band (stolda boshqa ochiq hisob bo'lsa — holati, masalan "hisob kutilmoqda", saqlanadi)
  if (dineIn && table && (!tableHadOpen || table.status === TableStatus.Free)) table.status = TableStatus.Busy;
  const dto = toDto(order);
  emitCreated(dto);
  return dto;
}

// =============================================================================================
// Hisobni bo'lish (B18)
// =============================================================================================

function splitOrder(id: string, body: any): SplitOrderResult {
  const source = findEntity(id);
  if (orderTypeOf(source) !== OrderType.DineIn || !source.tableId) throw bad(SPLIT_ONLY_TABLE_MESSAGE);
  if (source.status === OrderStatus.Closed) throw bad(ORDER_CLOSED_MESSAGE);
  const requested: { orderItemId: string; quantity: number }[] = Array.isArray(body.items) ? body.items : [];
  if (requested.length === 0) throw bad(SPLIT_NOTHING_MESSAGE);

  // Har qator uchun ko'chadigan miqdor (bir qator bir necha marta kelsa — qo'shiladi)
  const lineById = new Map(source.items.map((it) => [it.id, it]));
  const moveQty = new Map<string, number>();
  for (const r of requested) {
    const line = lineById.get(r.orderItemId);
    if (!line) throw bad(ITEM_LINE_NOT_FOUND_MESSAGE);
    if (!isValidQuantity(Number(r.quantity), line.unit)) throw bad(SPLIT_QTY_INVALID_MESSAGE);
    moveQty.set(line.id, roundQty((moveQty.get(line.id) ?? 0) + Number(r.quantity)));
  }
  const whole: MockItem[] = [];
  const parts: { line: MockItem; qty: number; left: number }[] = [];
  const remaining: MoneyItem[] = [];
  for (const line of source.items) {
    const qty = moveQty.get(line.id);
    if (qty === undefined) {
      remaining.push(line);
      continue;
    }
    const lineQty = Number(line.quantity);
    if (qty > lineQty + QTY_EPS) throw bad(SPLIT_QTY_INVALID_MESSAGE);
    const left = roundQty(lineQty - qty);
    if (left <= 0) whole.push(line);
    else {
      parts.push({ line, qty, left });
      remaining.push({ price: line.price, quantity: left, takeaway: line.takeaway });
    }
  }
  if (remaining.length === 0) throw bad(SPLIT_KEEP_ONE_MESSAGE);

  // To'lovi bor hisob: qoladigan summa to'langandan kam bo'lmasin
  const paid = sumPayments(orderPayments(source.id));
  if (paid > 0 && orderTotalsOf(source, remaining).total < paid) throw bad(BELOW_PAID_MESSAGE);

  // Qabul qiluvchi hisob: berilsa — shu stoldagi OCHIQ hisob; aks holda yangi hisob ochiladi
  let target: MockOrder | null = null;
  if (body.targetOrderId) {
    if (body.targetOrderId === source.id) throw bad(SPLIT_SAME_CHECK_MESSAGE);
    target = orders.find((o) => o.id === body.targetOrderId) ?? null;
    if (!target) throw notFound(ORDER_NOT_FOUND_MESSAGE);
    if (orderTypeOf(target) !== OrderType.DineIn || target.tableId !== source.tableId) throw bad(CHECK_OTHER_TABLE_MESSAGE);
    if (target.status === OrderStatus.Closed) throw bad(ORDER_CLOSED_MESSAGE);
  }

  let tgt = target;
  if (!tgt) {
    // Yangi hisob: shu stol, ofitsiant, xizmat/chegirma foizi meros; keyingi bo'sh hisob raqami va
    // kunlik raqam (B27)
    const businessDate = businessDateOf();
    tgt = {
      id: uid(),
      type: OrderType.DineIn,
      tableId: source.tableId,
      checkNo: nextFreeCheckNo(openAtTable(source.tableId)),
      waiterId: source.waiterId,
      status: source.status,
      openedAt: nowIso(),
      closedAt: null,
      queueNumber: nextDailyNumber(businessDate),
      businessDate,
      phone: null,
      address: null,
      deliveryFee: 0,
      billPrintedAt: null,
      items: [],
      note: null,
      discountPercent: source.discountPercent,
      servicePercent: source.servicePercent,
      customerId: null,
      customerName: null,
      refunded: false,
      refundReason: null,
      refundedAt: null,
      refundedBy: null,
    };
    orders.push(tgt);
  }
  // To'liq qatorlar — o'zi ko'chadi (id, KDS holati, bo'lim, aksiz, qo'shilgan vaqt saqlanadi)
  const wholeIds = new Set(whole.map((l) => l.id));
  source.items = source.items.filter((l) => !wholeIds.has(l.id));
  for (const line of whole) {
    line.orderId = tgt.id;
    tgt.items.push(line);
  }
  // Qisman — manba qatori kamayadi, yangi hisobda nusxa (narx, bo'lim, izoh, holat, saboy bilan)
  for (const { line, qty, left } of parts) {
    line.quantity = left;
    tgt.items.push({ ...line, id: uid(), orderId: tgt.id, quantity: qty, exciseCode: null });
  }
  // Ikkala hisob summasi o'zgardi — berilgan schotlar eskirdi
  source.billPrintedAt = null;
  tgt.billPrintedAt = null;

  const sourceDto = toDto(source);
  const targetDto = toDto(tgt);
  emitUpdated(sourceDto);
  if (target) emitUpdated(targetDto);
  else emitCreated(targetDto, 'split');
  return { source: sourceDto, target: targetDto };
}

// =============================================================================================
// Buyurtma amallari: yetkazish, tur, stol, ofitsiant, schot (B8, B22, B23, B24, B28)
// =============================================================================================

// PATCH /orders/:id/delivery — yetkazish ma'lumotlari (telefon, manzil, izoh, yetkazish narxi)
function updateDelivery(id: string, body: any): Order {
  const order = findEntity(id);
  if (orderTypeOf(order) !== OrderType.Delivery) throw bad(NOT_DELIVERY_MESSAGE);
  if (order.status === OrderStatus.Closed) throw bad(ORDER_CLOSED_MESSAGE);

  // Avval hammasi tekshiriladi — keyin o'zgartiriladi
  const phone = body.phone != null ? normalizePhone(body.phone) : undefined;
  if (phone === null) throw bad(PHONE_INVALID_MESSAGE);
  const address = body.address != null ? String(body.address).trim() : undefined;
  if (address === '') throw bad(ADDRESS_REQUIRED_MESSAGE);
  const fee = body.deliveryFee != null ? normalizeFee(body.deliveryFee) : undefined;
  const feeChanged = fee !== undefined && fee !== normalizeFee(order.deliveryFee);
  if (feeChanged) {
    const paid = sumPayments(orderPayments(order.id));
    if (paid > 0 && orderTotalsOf({ ...order, deliveryFee: fee! }).total < paid) throw bad(BELOW_PAID_MESSAGE);
  }

  if (phone !== undefined && phone !== order.phone) {
    const oldPhone = order.phone;
    order.phone = phone;
    const match = findCustomerByPhone(phone);
    if (match) {
      order.customerId = match.id;
      order.customerName = match.name;
    } else if (order.customerId) {
      // Eski telefon bo'yicha bog'langan mijoz endi bu buyurtmaga tegishli emas
      const current = customers.find((c) => c.id === order.customerId);
      if (!current || (oldPhone && normalizePhone(current.phone) === oldPhone)) {
        order.customerId = null;
        order.customerName = null;
      }
    }
  }
  if (address !== undefined) order.address = address;
  if (body.note !== undefined) order.note = typeof body.note === 'string' ? body.note.trim() || null : null;
  if (feeChanged) {
    order.deliveryFee = fee!;
    order.billPrintedAt = null; // summa o'zgardi — berilgan schot eskirdi
  }
  const dto = toDto(order);
  emitUpdated(dto);
  return dto;
}

// GET /orders/delivery-lookup?phone= — oxirgi yetkazish manzili, CRM'dagi ism, yetkazishlar soni; yo'q — null
function deliveryLookup(rawPhone: string | null): DeliveryLookup | null {
  const phone = normalizePhone(rawPhone ?? undefined);
  if (!phone) throw bad(PHONE_INVALID_MESSAGE);
  const list = orders
    .filter((o) => orderTypeOf(o) === OrderType.Delivery && o.phone === phone)
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  const last = list[0];
  const customer = findCustomerByPhone(phone);
  if (!last && !customer) return null;
  return {
    phone,
    address: last?.address ?? null,
    customerName: customer?.name ?? last?.customerName ?? null,
    ordersCount: list.length,
  };
}

/**
 * POST /orders/:id/change-type — buyurtma turini o'zgartirish (Stolga / Olib ketish / Yetkazib berish).
 * Kunlik raqam saqlanadi; oshxona cheki yo'q.
 */
function changeType(id: string, body: any): Order {
  const order = findEntity(id);
  if (order.status === OrderStatus.Closed) throw bad(ORDER_CLOSED_MESSAGE);
  if (!(ORDER_TYPES as string[]).includes(body.type)) throw bad(ORDER_TYPE_INVALID_MESSAGE);
  const from = orderTypeOf(order);
  const to: OrderType = body.type;
  if (from === to) throw bad(TYPE_UNCHANGED_MESSAGE);
  const paid = sumPayments(orderPayments(order.id));

  let newTable: MockTable | null = null;
  let phone: string | null = null;
  let address: string | null = null;
  if (to === OrderType.DineIn) {
    if (!body.tableId) throw bad(TABLE_REQUIRED_MESSAGE);
    newTable = tables.find((t) => t.id === body.tableId) ?? null;
    if (!newTable) throw notFound(TABLE_NOT_FOUND_MESSAGE);
  } else {
    // Telefon: berilsa — tekshiriladi; berilmasa — buyurtmadagisi (olib ketishda ixtiyoriy)
    const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (rawPhone) {
      phone = normalizePhone(rawPhone);
      if (!phone) throw bad(PHONE_INVALID_MESSAGE);
    } else {
      phone = order.phone ?? null;
    }
    if (to === OrderType.Delivery) {
      if (!phone) throw bad(PHONE_INVALID_MESSAGE);
      const rawAddress = typeof body.address === 'string' ? body.address.trim() : '';
      address = rawAddress || (order.address ?? '').trim();
      if (!address) throw bad(ADDRESS_REQUIRED_MESSAGE);
    }
  }

  // Yangi pul parametrlari: stolga — zal foizi (to'lov bo'lsa o'zgarmaydi), boshqasi — 0
  const servicePercent =
    to === OrderType.DineIn ? (paid > 0 ? Number(order.servicePercent) || 0 : hallPercent(newTable!.hall)) : 0;
  const deliveryFee =
    to === OrderType.Delivery
      ? from === OrderType.Delivery
        ? normalizeFee(order.deliveryFee)
        : normalizeFee(settings.deliveryFeeDefault)
      : 0;
  if (paid > 0 && orderTotalsOf({ ...order, type: to, servicePercent, deliveryFee }).total < paid) {
    throw bad(BELOW_PAID_MESSAGE);
  }
  // Yetkazishga o'tishda — shu telefon raqamli mijoz (bog'lanmagan bo'lsa)
  const customer = to === OrderType.Delivery && phone && !order.customerId ? findCustomerByPhone(phone) : null;

  const oldTableId = from === OrderType.DineIn ? order.tableId : null;
  let checkNo: number | null = null;
  if (to === OrderType.DineIn) {
    const open = openAtTable(newTable!.id);
    const wanted = body.checkNo;
    checkNo = wanted && !open.some((o) => checkNoOf(o) === wanted) ? wanted : nextFreeCheckNo(open);
    if (open.length === 0 || newTable!.status === TableStatus.Free) newTable!.status = TableStatus.Busy;
  }
  order.type = to;
  order.tableId = to === OrderType.DineIn ? newTable!.id : null;
  order.checkNo = checkNo;
  order.phone = to === OrderType.DineIn ? null : phone;
  order.address = to === OrderType.Delivery ? address : null;
  order.servicePercent = servicePercent;
  order.deliveryFee = deliveryFee;
  order.billPrintedAt = null; // nomi/summasi o'zgardi — berilgan schot eskirdi
  if (customer) {
    order.customerId = customer.id;
    order.customerName = customer.name;
  }
  // Raqamsiz (eski) buyurtma — bugungi ketma-ketlikdan raqam oladi
  if (order.queueNumber == null) {
    const today = businessDateOf();
    order.queueNumber = nextDailyNumber(today);
    order.businessDate = today;
  }
  // Eski stol: boshqa ochiq hisob qolmasa — bo'shaydi
  if (oldTableId) settleTable(oldTableId);
  const dto = toDto(order);
  emitUpdated(dto);
  return dto;
}

/**
 * Hisobni boshqa stolga ko'chirish — faqat stolga buyurtma, BITTA hisob. Yangi stol band bo'lsa —
 * u yerda qo'shimcha hisob bo'ladi. Boshqa zalga o'tganda (to'lov bo'lmasa) zal foizi qo'llanadi.
 */
function moveTable(id: string, newTableId: string): Order {
  const order = findEntity(id);
  if (orderTypeOf(order) !== OrderType.DineIn) throw bad(NOT_TABLE_ORDER_MESSAGE);
  if (order.status === OrderStatus.Closed) throw bad('Yopilgan buyurtmani ko‘chirib bo‘lmaydi');
  if (order.tableId === newTableId) return toDto(order);
  const newTable = tables.find((t) => t.id === newTableId);
  if (!newTable) throw notFound('Yangi stol topilmadi');
  const oldTable = tableOf(order);
  const oldTableId = order.tableId;
  const paid = sumPayments(orderPayments(order.id));

  let servicePercent = Number(order.servicePercent) || 0;
  if (paid === 0 && (!oldTable || (oldTable.hall ?? '').trim() !== (newTable.hall ?? '').trim())) {
    servicePercent = hallPercent(newTable.hall);
  }
  const percentChanged = servicePercent !== (Number(order.servicePercent) || 0);

  const open = openAtTable(newTable.id);
  order.tableId = newTable.id;
  order.checkNo = nextFreeCheckNo(open); // bo'sh stol — 1, band stol — keyingi hisob
  order.servicePercent = servicePercent;
  if (percentChanged) order.billPrintedAt = null;
  if (open.length === 0 || newTable.status === TableStatus.Free) newTable.status = TableStatus.Busy;
  if (oldTableId) settleTable(oldTableId);
  const dto = toDto(order);
  emitUpdated(dto);
  return dto;
}

// =============================================================================================
// Otkaz (B19) va narx (B31)
// =============================================================================================

function voidedLine(line: MockItem, quantity: number): VoidedLine {
  return {
    menuItemId: line.menuItemId ?? null,
    name: line.menuItemName,
    quantity: roundQty(quantity),
    unit: line.unit ?? MenuUnit.Piece,
    price: Number(line.price),
    stationId: line.stationId ?? null,
    stationName: line.stationName ?? null,
  };
}

/** void_log qatorlari: kim, qachon, nimani, qancha, nima sababdan */
function writeVoidLog(order: MockOrder, orderName: string, lines: VoidedLine[], reason: string | null, actor: MockUser, wholeOrder: boolean): void {
  const createdAt = nowIso();
  for (const l of lines) {
    voidLogs.push({
      id: uid(),
      createdAt,
      orderId: order.id,
      orderName,
      orderType: orderTypeOf(order),
      menuItemId: l.menuItemId,
      name: l.name,
      quantity: l.quantity,
      unit: l.unit,
      price: l.price,
      sum: lineSum(l.price, l.quantity),
      reason,
      userId: actor.id,
      userName: actor.name,
      wholeOrder,
      sentToKitchen: true,
    });
  }
}

/** Otkazdan keyin: KDS/kassaga order:voided (demo'da printer va Telegram yo'q) */
function afterVoid(order: Order, orderName: string, lines: VoidedLine[], reason: string | null, actor: MockUser, wholeOrder: boolean): void {
  if (lines.length === 0) return;
  const payload: OrderVoidedPayload = {
    orderId: order.id,
    orderName,
    items: lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, stationName: l.stationName })),
    reason,
    userName: actor.name,
    wholeOrder,
  };
  emit(SOCKET_EVENTS.ORDER_VOIDED, payload);
}

// Otkaz: yuborilgan taomlarni (qisman miqdor bilan) bekor qilish. Hamma taom ketsa — butun hisob bekor.
function removeItems(id: string, body: any, actor: MockUser): Order {
  const order = findEntity(id);
  if (order.status === OrderStatus.Closed) throw bad('Yopilgan buyurtmani o‘zgartirib bo‘lmaydi');
  const reason = cleanReason(body.reason);
  const lineById = new Map(order.items.map((it) => [it.id, it]));
  const voidQty = new Map<string, number>();
  for (const r of Array.isArray(body.items) ? body.items : []) {
    const line = lineById.get(r.orderItemId);
    if (!line) throw bad(ITEM_LINE_NOT_FOUND_MESSAGE);
    if (!isValidQuantity(Number(r.quantity), line.unit)) throw bad(VOID_QTY_INVALID_MESSAGE);
    voidQty.set(line.id, roundQty((voidQty.get(line.id) ?? 0) + Number(r.quantity)));
  }
  // Eski shakl: butun qator (noma'lum id'lar — e'tiborsiz)
  for (const lineId of Array.isArray(body.itemIds) ? body.itemIds : []) {
    const line = lineById.get(lineId);
    if (line) voidQty.set(line.id, Number(line.quantity));
  }
  if (voidQty.size === 0) return toDto(order);

  const voided: VoidedLine[] = [];
  const reduce: { line: MockItem; left: number }[] = [];
  const drop = new Set<string>();
  const remaining: MoneyItem[] = [];
  for (const line of order.items) {
    const qty = voidQty.get(line.id);
    if (qty === undefined) {
      remaining.push(line);
      continue;
    }
    const lineQty = Number(line.quantity);
    if (qty > lineQty + QTY_EPS) throw bad(VOID_QTY_INVALID_MESSAGE);
    const left = roundQty(lineQty - qty);
    voided.push(voidedLine(line, Math.min(qty, lineQty)));
    if (left <= 0) drop.add(line.id);
    else {
      reduce.push({ line, left });
      remaining.push({ price: line.price, quantity: left, takeaway: line.takeaway });
    }
  }

  const pays = orderPayments(id);
  // Hamma taom ketdi — butun hisob bekor qilinadi (to'lov bo'lsa — mumkin emas)
  if (remaining.length === 0) {
    if (pays.length > 0) throw bad(HAS_PAYMENTS_MESSAGE);
    return cancelOrder(order, reason, actor);
  }
  const paid = sumPayments(pays);
  if (paid > 0 && orderTotalsOf(order, remaining).total < paid) throw bad(BELOW_PAID_MESSAGE);

  const before = toDto(order);
  const orderName = orderDisplayName(before);
  for (const r of reduce) r.line.quantity = r.left;
  if (drop.size) order.items = order.items.filter((l) => !drop.has(l.id));
  order.billPrintedAt = null; // summa o'zgardi — berilgan schot eskirdi
  writeVoidLog(order, orderName, voided, reason, actor, false);
  const dto = toDto(order);
  emitUpdated(dto);
  afterVoid(before, orderName, voided, reason, actor, false);
  return dto;
}

// Hisobni bekor qilish — to'lanmagan buyurtma o'chiriladi, stolda boshqa ochiq hisob qolmasa stol bo'shaydi
function cancelOrder(order: MockOrder, reason: string | null, actor: MockUser): Order {
  if (order.status === OrderStatus.Closed) throw bad('To‘langan chekni bekor qilib bo‘lmaydi (vozvrat qiling)');
  if (orderPayments(order.id).length > 0) throw bad(HAS_PAYMENTS_MESSAGE);
  const dto = toDto(order);
  const orderName = orderDisplayName(dto);
  const voided = order.items.map((it) => voidedLine(it, Number(it.quantity)));
  if (voided.length) writeVoidLog(order, orderName, voided, reason, actor, true);
  orders = orders.filter((o) => o.id !== order.id);
  if (orderTypeOf(order) === OrderType.DineIn && order.tableId) settleTable(order.tableId);
  // Ro'yxatlardan (KDS/kassa/ofitsiant) olib tashlash uchun "yopildi" hodisasi
  emitClosed(dto);
  afterVoid(dto, orderName, voided, reason, actor, true);
  return dto;
}

// PATCH /orders/:id/items/:itemId/price — yuborilgan qator narxini o'zgartirish ('void' ruxsati)
function setItemPrice(id: string, itemId: string, body: any): Order {
  const order = findEntity(id);
  if (order.status === OrderStatus.Closed) throw bad(ORDER_CLOSED_MESSAGE);
  const line = order.items.find((it) => it.id === itemId);
  if (!line) throw bad(ITEM_LINE_NOT_FOUND_MESSAGE);
  const price = Math.round(Number(body.price) * 100) / 100;
  const oldPrice = Number(line.price);
  if (price === oldPrice) return toDto(order);
  const paid = sumPayments(orderPayments(order.id));
  const nextLines = order.items.map((it) => (it.id === line.id ? { price, quantity: it.quantity, takeaway: it.takeaway } : it));
  if (paid > 0 && orderTotalsOf(order, nextLines).total < paid) throw bad(BELOW_PAID_MESSAGE);
  const original = line.originalPrice != null ? Number(line.originalPrice) : oldPrice;
  line.price = price;
  line.priceOverridden = price !== original;
  line.originalPrice = line.priceOverridden ? original : null;
  order.billPrintedAt = null; // summa o'zgardi — schot eskirdi
  const dto = toDto(order);
  emitUpdated(dto);
  return dto;
}

// =============================================================================================
// To'lov (B4, B5, B9, B28, B30)
// =============================================================================================

/** Aksizli taomlar uchun kod skanerlangan bo'lishi shart */
function assertExcise(order: MockOrder): void {
  const missing = order.items.filter((it) => it.exciseRequired && !it.exciseCode);
  if (missing.length > 0) throw bad(`Aksiz kodi skanerlanmagan: ${missing.map((it) => it.menuItemName).join(', ')}`);
}

/** To'lovsiz yopish: chegirma jami summani to'langandan pastga tushirmasin */
function assertSettle(order: MockOrder, priorPaid: number, total: number, previousTotal: number): void {
  if (order.items.length === 0) throw bad('Buyurtmada taom yo‘q — hisobni bekor qiling');
  if (priorPaid > total && total < previousTotal) {
    throw bad('Jami summa to‘langan summadan kam bo‘lib qoladi — chegirmani kamaytiring yoki ortiqcha to‘lovni o‘chiring');
  }
}

/** 'Qarzga' to'lovidagi qarzdor: ism majburiy, telefon ixtiyoriy (berilsa — to'g'ri bo'lishi shart) */
function debtorOf(d: any): { name: string; phone: string | null } {
  const name = typeof d?.name === 'string' ? d.name.trim() : '';
  if (!name) throw bad(DEBTOR_REQUIRED_MESSAGE);
  const rawPhone = typeof d?.phone === 'string' ? d.phone.trim() : '';
  let phone: string | null = null;
  if (rawPhone) {
    phone = normalizePhone(rawPhone);
    if (!phone) throw bad(PHONE_INVALID_MESSAGE);
  }
  return { name: name.slice(0, 100), phone };
}

/** Berilgan foizlar bilan buyurtma (saqlanmaydi — avval tekshiruvlar o'tishi kerak) */
function withPercents(order: MockOrder, discount?: number | null, service?: number | null): MockOrder {
  return {
    ...order,
    discountPercent: discount != null ? clampPercent(discount) : order.discountPercent,
    servicePercent: service != null ? clampPercent(service) : order.servicePercent,
  };
}

interface PaymentEntry { type: string; amount: number; debtor: { name: string; phone: string | null } | null }

/**
 * To'lovlarni yozish va (to'liq bo'lsa) hisobni yopish: to'lovlar, foizlar, holat, stol (boshqa ochiq
 * hisob qolmasa bo'shaydi), ombordan ayirish, fiskal hujjat.
 */
function finishPayment(
  order: MockOrder,
  draft: MockOrder,
  args: { entries: PaymentEntry[]; prior: MockPayment[]; cashierId: string; fallbackType: string; methods: PaymentMethod[] },
): PayResult {
  // Tekshiruvlar o'tdi — foizlar buyurtmaga yoziladi (server tranzaksiyasi kabi)
  order.discountPercent = draft.discountPercent;
  order.servicePercent = draft.servicePercent;
  const total = orderTotalsOf(order).total;
  const priorPaid = sumPayments(args.prior);
  const paidNow = args.entries.reduce((s, e) => s + e.amount, 0);
  const newPaid = priorPaid + paidNow;
  const fullyPaid = newPaid >= total;
  const createdAt = nowIso();
  const saved = args.entries.map((e) => {
    const p: MockPayment = {
      id: uid(), orderId: order.id, amount: e.amount, type: e.type, cashierId: args.cashierId, createdAt,
      debtorName: e.debtor?.name ?? null, debtorPhone: e.debtor?.phone ?? null,
      debtRepaidAt: null, debtRepaidBy: null, debtRepaidType: null,
    };
    payments.push(p);
    return p;
  });
  if (fullyPaid) {
    order.status = OrderStatus.Closed;
    order.closedAt = createdAt;
    // Stol bo'shaydi — shu stolda boshqa ochiq hisob qolmagan bo'lsa
    if (orderTypeOf(order) === OrderType.DineIn && order.tableId) settleTable(order.tableId);
    // Sotildi — taomlarga ketgan mahsulotlar skladdan ayiriladi ('sale' harakatlari, chek nomi bilan)
    writeSaleMovements(order, args.cashierId, createdAt);
    issueFiscal(order, total);
  }
  const allPayments = [...args.prior, ...saved].map((p) => paymentView(p, args.methods));
  const dto = toDto(order);
  if (!fullyPaid) {
    // Qisman to'landi — buyurtma ochiq qoladi, chek chiqmaydi
    emitUpdated(dto);
    return { order: dto, fullyPaid: false, paidAmount: newPaid, total, payments: allPayments };
  }
  const receipt = buildReceipt(order, {
    cashierName: userName(args.cashierId),
    payments: allPayments,
    fallbackType: args.fallbackType,
    createdAt,
  });
  emitClosed(dto);
  return { order: dto, receipt, fullyPaid: true, paidAmount: newPaid, total, payments: allPayments };
}

// POST /orders/:id/pay — bitta usul bilan (qisman yoki to'liq); oldingi to'lovlar qoplagan bo'lsa — yopish
function pay(id: string, body: any, actor: MockUser): PayResult {
  const order = findEntity(id);
  if (order.status === OrderStatus.Closed) throw bad(ORDER_ALREADY_CLOSED_MESSAGE);
  const methods = paymentMethods();
  const method = activeMethodOf(methods, body.type);
  if (!method) throw bad(PAYMENT_TYPE_INVALID_MESSAGE);
  assertExcise(order);

  const previousTotal = orderTotalsOf(order).total;
  const draft = withPercents(order, body.discountPercent, body.serviceFeePercent);
  const total = orderTotalsOf(draft).total;
  const prior = orderPayments(order.id);
  const priorPaid = sumPayments(prior);
  const remaining = remainingAmount(total, priorPaid);
  const settleOnly = remaining <= 0;
  if (settleOnly) assertSettle(order, priorPaid, total, previousTotal);
  const amount = settleOnly ? 0 : body.amount != null ? Math.min(roundSum(body.amount), remaining) : remaining;
  if (!settleOnly && amount <= 0) throw bad(PAYMENT_AMOUNT_INVALID_MESSAGE);
  const debtor = amount > 0 && method.kind === 'debt' ? debtorOf(body.debtor) : null;
  return finishPayment(order, draft, {
    entries: amount > 0 ? [{ type: method.key, amount, debtor }] : [],
    prior,
    cashierId: actor.id,
    fallbackType: method.key,
    methods,
  });
}

// POST /orders/:id/pay-multi — bir nechta usul bilan birdaniga (masalan 20 000 naqd + 8 620 Click)
function payMulti(id: string, body: any, actor: MockUser): PayResult {
  const order = findEntity(id);
  if (order.status === OrderStatus.Closed) throw bad(ORDER_ALREADY_CLOSED_MESSAGE);
  const methods = paymentMethods();
  // Bir xil usul bir necha marta kelsa — bitta to'lovga qo'shiladi
  const byKey = new Map<string, { method: PaymentMethod; amount: number }>();
  for (const p of Array.isArray(body.payments) ? body.payments : []) {
    const method = activeMethodOf(methods, p?.type);
    if (!method) throw bad(PAYMENT_TYPE_INVALID_MESSAGE);
    const amount = Number(p.amount);
    if (!Number.isInteger(amount) || amount <= 0) throw bad(PAYMENT_AMOUNT_INVALID_MESSAGE);
    const cur = byKey.get(method.key);
    if (cur) cur.amount += amount;
    else byKey.set(method.key, { method, amount });
  }
  const chosen = [...byKey.values()];
  const debtor = chosen.some((c) => c.method.kind === 'debt') ? debtorOf(body.debtor) : null;
  assertExcise(order);

  const previousTotal = orderTotalsOf(order).total;
  const draft = withPercents(order, body.discountPercent, body.serviceFeePercent);
  const total = orderTotalsOf(draft).total;
  const prior = orderPayments(order.id);
  const priorPaid = sumPayments(prior);
  const remaining = remainingAmount(total, priorPaid);
  const sum = chosen.reduce((s, c) => s + c.amount, 0);
  if (sum > remaining) throw bad(PAYMENT_EXCEEDS_MESSAGE);
  if (chosen.length === 0) {
    if (remaining > 0) throw bad(PAYMENT_AMOUNT_INVALID_MESSAGE);
    assertSettle(order, priorPaid, total, previousTotal);
  }
  const entries: PaymentEntry[] = chosen.map((c) => ({
    type: c.method.key,
    amount: c.amount,
    debtor: c.method.kind === 'debt' ? debtor : null,
  }));
  const fallbackType =
    entries[entries.length - 1]?.type ??
    prior[prior.length - 1]?.type ??
    methods.find((m) => m.kind === 'cash' && m.active)?.key ??
    'naqd';
  return finishPayment(order, draft, { entries, prior, cashierId: actor.id, fallbackType, methods });
}

// =============================================================================================
// Hisobotlar
// =============================================================================================

function periodStart(period: string): number {
  const now = new Date();
  if (period === 'week') return now.getTime() - 7 * 864e5;
  if (period === 'month') return now.getTime() - 30 * 864e5;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** Davr bo'yicha to'lovlar (vozvrat qilingan cheklar hisobga olinmaydi) */
function paidInPeriod(start: number): MockPayment[] {
  const refundedIds = new Set(orders.filter((o) => o.refunded).map((o) => o.id));
  return payments.filter((p) => Date.parse(p.createdAt) >= start && !refundedIds.has(p.orderId));
}

/** Yopilgan, vozvrat qilinmagan buyurtmalar (yopilgan vaqti oralig'ida) */
const closedOrdersIn = (r: { startMs: number; endMs: number }) =>
  orders.filter((o) => o.status === OrderStatus.Closed && !o.refunded && inRange(o.closedAt, r));

// ---- Hisobot xabarlari (server reports.service.ts bilan bir xil) ----
const SHARE_PERCENT_MESSAGE = 'Ofitsiant ulushi foizi 0 dan 100 gacha bo‘lishi kerak';
const WAITER_REQUIRED_MESSAGE = 'Ofitsiant tanlanmagan';
const DEBT_STATUS_MESSAGE = 'Qarz holati noto‘g‘ri (open, repaid yoki all)';
const DEBT_NOT_FOUND_MESSAGE = 'To‘lov topilmadi';
const DEBT_NOT_DEBT_MESSAGE = 'Bu to‘lov qarz emas';
const DEBT_ALREADY_REPAID_MESSAGE = 'Bu qarz allaqachon qaytarilgan';
const DEBT_REFUNDED_MESSAGE = 'Bu chek qaytarilgan (vozvrat) — qarz bekor qilingan';
/** Otkazlar / qarzlar ro'yxati chegarasi (soni va summasi baribir butun davr bo'yicha) */
const REPORT_LIST_LIMIT = 500;

/** Foiz 2 xonagacha; miqdor 3 xonagacha (hisobotda ko'rsatish uchun) */
const round2 = (n: number) => Math.round(n * 100) / 100;
const roundQty3 = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0);

/** To'lov usuli nomi va toifasi: sozlamadagi ro'yxat -> standart ro'yxat -> kalitning o'zi */
function methodInfo(methods: PaymentMethod[], key: string | null | undefined): { key: string; label: string; kind: PaymentMethodKind } {
  const k = String(key ?? '');
  const found = methods.find((m) => m.key === k) ?? DEFAULT_PAYMENT_METHODS.find((m) => m.key === k);
  if (found) return { key: k, label: found.label, kind: found.kind };
  return { key: k, label: k || '—', kind: 'other' };
}

/**
 * Bitta xodim cheklari yig'indisi (B20 + B21): stolga cheklarda — zalda yeyilgan taomlar (xizmat bazasi)
 * "Buyurtmalar summasi"; olib ketish/yetkazish va stoldagi saboy qatorlari — "Olib ketish va yetkazish";
 * haqiqatda undirilgan xizmat haqi.
 */
function accumulateShares(list: MockOrder[]) {
  const acc = { ordersCount: 0, dineInSales: 0, takeawaySales: 0, serviceAmount: 0 };
  for (const o of list) {
    const t = orderTotalsOf(o);
    acc.ordersCount += 1;
    if (orderTypeOf(o) === OrderType.DineIn) {
      acc.dineInSales += t.serviceBase;
      acc.takeawaySales += t.subtotal - t.serviceBase;
    } else {
      acc.takeawaySales += t.subtotal;
    }
    acc.serviceAmount += t.serviceAmount;
  }
  return acc;
}

/** Ofitsiant ulushi: round(stolga buyurtmalar summasi × foiz / 100) */
const shareOf = (dineInSales: number, percent: number) => roundSum((dineInSales * percent) / 100);

/**
 * GET /reports/waiter-shares — har bir buyurtmani olgan xodim (kassir ham) bo'yicha, chekning hozirgi
 * ofitsianti bo'yicha. Qatorlar — savdo summasi bo'yicha kamayish tartibida.
 */
function waiterShares(range: LocalRange, sharePercent: number): WaiterShareReport {
  const percent = round2(clampPercent(sharePercent));
  const byWaiter = new Map<string, MockOrder[]>();
  for (const o of closedOrdersIn(range)) {
    const arr = byWaiter.get(o.waiterId) ?? [];
    arr.push(o);
    byWaiter.set(o.waiterId, arr);
  }
  const rows: WaiterShareRow[] = [...byWaiter.entries()].map(([waiterId, list]) => {
    const acc = accumulateShares(list);
    const person = users.find((u) => u.id === waiterId);
    return {
      waiterId,
      waiterName: person?.name ?? 'Noma’lum xodim',
      role: person?.role ?? '',
      ...acc,
      shareAmount: shareOf(acc.dineInSales, percent),
    };
  });
  rows.sort(
    (a, b) =>
      b.dineInSales + b.takeawaySales - (a.dineInSales + a.takeawaySales) ||
      a.waiterName.localeCompare(b.waiterName, 'uz'),
  );
  // Jami qator — ustunlar yig'indisi (ulush ham qatorlar yig'indisi: jadvaldagi raqamlar bilan aynan mos)
  const totals = rows.reduce(
    (t, r) => ({
      ordersCount: t.ordersCount + r.ordersCount,
      dineInSales: t.dineInSales + r.dineInSales,
      takeawaySales: t.takeawaySales + r.takeawaySales,
      serviceAmount: t.serviceAmount + r.serviceAmount,
      shareAmount: t.shareAmount + r.shareAmount,
    }),
    { ordersCount: 0, dineInSales: 0, takeawaySales: 0, serviceAmount: 0, shareAmount: 0 },
  );
  return { from: range.from, to: range.to, sharePercent: percent, totals, rows };
}

/** Qarz ("Qarzga" toifali) to'lov usullari kalitlari: sozlamadagi + standart 'qarz' */
function debtKeys(methods: PaymentMethod[]): string[] {
  const keys = new Set(methods.filter((m) => m.kind === 'debt').map((m) => m.key));
  for (const m of DEFAULT_PAYMENT_METHODS) if (m.kind === 'debt') keys.add(m.key);
  return [...keys];
}

/** Qarz qatori (B34) */
function debtRow(p: MockPayment): DebtRow {
  const o = orders.find((x) => x.id === p.orderId);
  return {
    paymentId: p.id,
    orderId: p.orderId,
    orderName: o ? orderDisplayName(toDto(o)) : null,
    queueNumber: o?.queueNumber ?? null,
    createdAt: p.createdAt,
    amount: roundSum(p.amount),
    debtorName: p.debtorName ?? null,
    debtorPhone: p.debtorPhone ?? null,
    repaidAt: p.debtRepaidAt ?? null,
    repaidType: p.debtRepaidType ?? null,
    repaidByName: userName(p.debtRepaidBy),
  };
}

type DebtStatus = 'open' | 'repaid' | 'all';

/**
 * GET /reports/debts — qarzga yozilgan to'lovlar. open — qaytarilmagan (vozvrat qilingan chekning qarzi —
 * bekor, kirmaydi); repaid — qaytarilgan; all — ikkalasi. from/to — qarz yozilgan kun; q — ism yoki
 * telefon raqamlari. Tartib: ochiq qarzlar birinchi, keyin eng yangilari.
 */
function debtsReport(status: DebtStatus, range: LocalRange | null, q: string) {
  const keys = debtKeys(paymentMethods());
  const search = q.trim();
  const digits = search.replace(/\D/g, '');
  const needle = search.toLowerCase();
  const rows = payments
    .filter((p) => {
      if (!keys.includes(p.type)) return false;
      const refunded = !!orders.find((o) => o.id === p.orderId)?.refunded;
      if (status === 'open' && (p.debtRepaidAt || refunded)) return false;
      if (status === 'repaid' && !p.debtRepaidAt) return false;
      if (status === 'all' && !p.debtRepaidAt && refunded) return false;
      if (range && !inRange(p.createdAt, range)) return false;
      if (search) {
        const byName = (p.debtorName ?? '').toLowerCase().includes(needle);
        const byPhone = digits.length >= 3 && (p.debtorPhone ?? '').includes(digits);
        if (!byName && !byPhone) return false;
      }
      return true;
    })
    .sort((a, b) => Number(!!a.debtRepaidAt) - Number(!!b.debtRepaidAt) || Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, REPORT_LIST_LIMIT)
    .map(debtRow);
  const open = rows.filter((r) => !r.repaidAt);
  return {
    status,
    rows,
    items: rows,
    count: rows.length,
    total: rows.reduce((s, r) => s + r.amount, 0),
    openCount: open.length,
    openTotal: open.reduce((s, r) => s + r.amount, 0),
    repaidTotal: rows.filter((r) => !!r.repaidAt).reduce((s, r) => s + r.amount, 0),
  };
}

/**
 * Kun bo'yicha kassa holati (B33/B34): to'lov usullari bo'yicha tushum (faol usullar doim, nofaol/eski
 * kalitlar — summasi bo'lsa), kirim/chiqim, qarzga yozilgan, qaytarilgan qarzlar, naqd vozvrat va
 * kassada bo'lishi kerak bo'lgan naqd.
 */
function cashSummary(day: LocalRange): CashSummary {
  const methods = paymentMethods();
  const kindOf = (key: string | null | undefined) => methodInfo(methods, key).kind;
  const amountByKey = new Map<string, number>();
  for (const p of payments) {
    if (inRange(p.createdAt, day)) amountByKey.set(p.type, (amountByKey.get(p.type) ?? 0) + roundSum(p.amount));
  }
  const byMethod: CashSummary['byMethod'] = [];
  for (const m of methods) {
    const amount = amountByKey.get(m.key) ?? 0;
    if (m.active || amount > 0) byMethod.push({ key: m.key, label: m.label, kind: m.kind, amount });
    amountByKey.delete(m.key);
  }
  for (const [key, amount] of amountByKey) {
    if (amount === 0) continue;
    const info = methodInfo(methods, key);
    byMethod.push({ key, label: info.label, kind: info.kind, amount });
  }
  let kirim = 0;
  let chiqim = 0;
  for (const e of expenses) {
    if (!inRange(e.createdAt, day)) continue;
    if (e.kind === 'kirim') kirim += roundSum(e.amount);
    else chiqim += roundSum(e.amount);
  }
  const debtCreated = byMethod.filter((m) => m.kind === 'debt').reduce((s, m) => s + m.amount, 0);
  // Shu kuni qaytarilgan qarzlar — qaysi usul bilan
  const repaidByKey = new Map<string, number>();
  for (const p of payments) {
    if (!p.debtRepaidAt || !inRange(p.debtRepaidAt, day)) continue;
    const key = p.debtRepaidType ?? '';
    repaidByKey.set(key, (repaidByKey.get(key) ?? 0) + roundSum(p.amount));
  }
  const debtRepaid = [...repaidByKey.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([key, amount]) => {
      const info = methodInfo(methods, key);
      return { key: info.key, label: info.label, amount };
    });
  // Naqd vozvrat: shu kuni vozvrat qilingan cheklarning naqd to'lovlari + naqd bilan qaytarilgan qarzlari
  let refundsCash = 0;
  for (const o of orders) {
    if (!o.refunded || !inRange(o.refundedAt, day)) continue;
    for (const p of payments) {
      if (p.orderId !== o.id) continue;
      const kind = kindOf(p.type);
      if (kind === 'cash' || (kind === 'debt' && p.debtRepaidType && kindOf(p.debtRepaidType) === 'cash')) {
        refundsCash += roundSum(p.amount);
      }
    }
  }
  const cashSales = byMethod.filter((m) => m.kind === 'cash').reduce((s, m) => s + m.amount, 0);
  const cashRepaid = [...repaidByKey.entries()]
    .filter(([key]) => kindOf(key) === 'cash')
    .reduce((s, [, amount]) => s + amount, 0);
  return {
    date: day.from,
    byMethod,
    kirim,
    chiqim,
    debtCreated,
    debtRepaid,
    refundsCash,
    expectedCash: cashSales + kirim - chiqim + cashRepaid - refundsCash,
  };
}

// =============================================================================================
// Menyu (taom rasmi — B13; stop list — B29)
// =============================================================================================

const ITEM_NOT_FOUND_MESSAGE = 'Taom topilmadi';
const IMAGE_MAX_CHARS = 1_500_000;
const IMAGE_TOO_BIG_MESSAGE = 'Rasm hajmi juda katta (1 MB gacha)';
const IMAGE_FORMAT_MESSAGE = 'Rasm formati noto‘g‘ri';
const AVAILABILITY_MESSAGE = 'Taom holati noto‘g‘ri (available: true yoki false)';
const OWN_IMAGE_URL_RE = /\/menu\/items\/[^/?#]+\/image(?:[?#]|$)/;

/** Baytlarning haqiqiy rasm turi (JPEG/PNG/WEBP); noma'lum — null */
function sniffImageMime(base64: string): string | null {
  let bytes: number[];
  try {
    bytes = Array.from(atob(base64.slice(0, 24)), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png';
  const ascii = String.fromCharCode(...bytes);
  if (ascii.slice(0, 4) === 'RIFF' && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Yuklangan rasm: faqat 'data:image/(jpeg|png|webp);base64,…' (1 500 000 belgigacha) — server kabi */
function normalizeUploadedImage(value: string): string {
  const s = String(value).trim();
  const m = /^data:image\/(jpeg|png|webp);base64,/i.exec(s);
  if (!m) throw bad(IMAGE_FORMAT_MESSAGE);
  if (s.length > IMAGE_MAX_CHARS) throw bad(IMAGE_TOO_BIG_MESSAGE);
  const body = s.slice(m[0].length);
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw bad(IMAGE_FORMAT_MESSAGE);
  const mime = sniffImageMime(body);
  if (!mime) throw bad(IMAGE_FORMAT_MESSAGE);
  return `data:${mime};base64,${body}`;
}

/** So'rovdagi rasm -> o'zgarish: undefined — o'zgarmaydi; null — o'chiriladi; satr — yangi rasm */
function imageChange(image: string | null | undefined): string | null | undefined {
  if (image === undefined) return undefined;
  if (image === null || image.trim() === '') return null;
  if (!/^data:/i.test(image.trim()) && OWN_IMAGE_URL_RE.test(image)) return undefined;
  return normalizeUploadedImage(image);
}

/** Taom -> API (rasmning o'zi YO'Q; imageUrl — demo'da data URL'ning o'zi, assetUrl uni o'zgartirmaydi) */
function toMenuItem(m: MockMenuItem): MenuItem {
  return {
    id: m.id,
    name: m.name,
    price: Number(m.price),
    categoryId: m.categoryId,
    stationId: m.stationId ?? null,
    imageUrl: m.image || null,
    ingredients: m.ingredients ?? null,
    available: !!m.available,
    exciseRequired: !!m.exciseRequired,
    unit: m.unit ?? MenuUnit.Piece,
    favorite: !!m.favorite,
  };
}

/** Taom maydonlari tekshiruvi (MenuItemDto / MenuItemPatchDto) */
function validateMenuItemDto(b: any, create: boolean): string | null {
  if (create || b.name !== undefined) {
    if (typeof b.name !== 'string') return 'name must be a string';
  }
  if (create || b.price !== undefined) {
    if (!isNum(b.price)) return 'price must be a number conforming to the specified constraints';
    if (b.price < 0) return 'price must not be less than 0';
  }
  if (create || b.categoryId !== undefined) {
    if (!isUuid(b.categoryId)) return 'categoryId must be a UUID';
  }
  if (b.image != null && typeof b.image !== 'string') return 'image must be a string';
  for (const k of ['ingredients', 'stationId']) {
    if (b[k] != null && typeof b[k] !== 'string') return `${k} must be a string`;
  }
  for (const k of ['available', 'exciseRequired', 'favorite']) {
    if (b[k] != null && typeof b[k] !== 'boolean') return `${k} must be a boolean value`;
  }
  if (b.unit != null && !Object.values(MenuUnit).includes(b.unit)) return 'unit must be one of the following values: dona, kg';
  return null;
}

const emitMenuChanged = (payload: { itemId: string; available: boolean; deleted?: boolean }) =>
  emit(SOCKET_EVENTS.MENU_CHANGED, payload);

// =============================================================================================
// Printerlar (B17 navbati, B26 holati) — demo'da printer yo'q
// =============================================================================================

const PRINT_JOB_FILTERS = ['open', 'pending', 'expired', 'printed', 'cancelled'];

/** Bo'lim printerlari holati: printeri sozlangan bo'limlar; bittasi demo uchun "javob bermayapti" */
function printerStatus(): PrinterStatus[] {
  const now = Date.now();
  return [...stations]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .filter((s) => String(s.printerHost ?? '').trim())
    .map((s) => {
      const offline = s.name === DEMO_OFFLINE_STATION;
      return {
        stationId: s.id,
        stationName: s.name,
        host: String(s.printerHost).trim(),
        port: Number(s.printerPort) || 9100,
        online: !offline,
        lastCheckAt: new Date(now).toISOString(),
        lastOkAt: new Date(offline ? now - 25 * 60_000 : now).toISOString(),
        pendingJobs: 0,
      };
    });
}

// =============================================================================================
// Asosiy router
// =============================================================================================

export function mockRequest<T>(method: string, fullPath: string, body?: any, token?: string | null): Promise<T> {
  ensureSeeded();
  try {
    return route(method, fullPath, body ?? {}, token) as Promise<T>;
  } catch (e) {
    // Servis qoidalari xatoni tashlaydi (server exception'lari kabi) — rad etilgan javobga aylanadi
    return Promise.reject(e);
  }
}

function route(method: string, fullPath: string, body: any, token?: string | null): Promise<unknown> {
  const [path, query] = fullPath.split('?');
  const params = new URLSearchParams(query || '');
  const period = params.get('period') || 'day';
  const seg = path.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }); // masalan ['orders','<id>','pay']

  // ---- Auth: ochiq marshrutlar ----
  if (path === '/auth/login' && method === 'POST') {
    if (loginBlocked()) return fail(TOO_MANY_ATTEMPTS_MESSAGE, 429);
    // Login katta-kichik harfga sezgir emas; faqat faol va paroli bor xodim
    const name = String(body?.login ?? '').trim().toLowerCase();
    const u = name
      ? users.find((x) => x.active && !!x.password && (x.login ?? '').toLowerCase() === name && x.password === body?.password)
      : undefined;
    if (!u) {
      recordLoginFailure();
      return fail('Login yoki parol noto‘g‘ri', 401);
    }
    recordLoginSuccess();
    return ok({ token: tokenFor(u), user: sessionUser(u) });
  }
  if (path === '/auth/login-pin' && method === 'POST') {
    if (loginBlocked()) return fail(TOO_MANY_ATTEMPTS_MESSAGE, 429);
    const code = String(body?.pin ?? '').trim();
    const u = code.length >= 4 ? users.find((x) => x.active && x.pin === code) : undefined;
    // Direktor/SuperAdmin PIN bilan kira olmaydi — login+parol bilan (bu ham noto'g'ri urinish)
    if (!u || isFullAccessRole(u.role)) {
      recordLoginFailure();
      return fail(u ? 'Direktor login va parol bilan kiradi (PIN emas)' : 'PIN noto‘g‘ri', 401);
    }
    recordLoginSuccess();
    return ok({ token: tokenFor(u), user: sessionUser(u) });
  }

  // Qolgan barcha marshrutlar — tizimga kirgan, faol xodim (real JwtStrategy kabi)
  const actor = actorOf(token);
  if (!actor) return fail('Sessiya yaroqsiz — qayta kiring', 401);
  const isManager = MANAGER_ROLES.includes(actor.role);

  if (path === '/auth/me' && method === 'GET') return ok(sessionUser(actor));
  if (path === '/auth/change-password' && method === 'POST') {
    const current = body?.currentPassword;
    const next = body?.newPassword;
    if (typeof current !== 'string') return fail('Joriy parolni kiriting');
    if (typeof next !== 'string') return fail('Yangi parolni kiriting');
    if (next.length < 4) return fail('Yangi parol kamida 4 ta belgidan iborat bo‘lishi kerak');
    if (next.length > 64) return fail('Yangi parol 64 ta belgidan oshmasligi kerak');
    if (loginBlocked()) return fail(TOO_MANY_ATTEMPTS_MESSAGE, 429);
    if (!actor.password) return fail('Bu foydalanuvchida parol yo‘q');
    if (current !== actor.password) {
      // Joriy parolni tanlab topishga urinish ham cheklanadi (server kabi)
      recordLoginFailure();
      return fail('Joriy parol noto‘g‘ri');
    }
    recordLoginSuccess();
    if (next === current) return fail('Yangi parol joriy paroldan farq qilishi kerak');
    actor.password = next;
    actor.mustChangePassword = false;
    return ok({ ok: true, user: sessionUser(actor) });
  }

  if (seg[0] === 'settings') return settingsRoute(method, path, seg, body, actor);
  if (seg[0] === 'tables') return tablesRoute(method, path, seg, body, actor);
  if (seg[0] === 'menu') return menuRoute(method, path, seg, body, actor);
  if (seg[0] === 'orders') return ordersRoute(method, path, seg, params, body, actor);
  if (seg[0] === 'reports') return reportsRoute(path, seg, params, period, actor);
  if (seg[0] === 'printing') return printingRoute(method, path, seg, params, actor);
  if (seg[0] === 'expenses') return expensesRoute(method, path, seg, params, body, actor);
  if (seg[0] === 'debts') return debtsRoute(method, seg, body, actor);

  // Terminallar (demo)
  if (path === '/terminals' && method === 'GET') return ok([...terminals]);
  if (path === '/terminals' && method === 'POST') {
    const tr = { id: uid(), name: body.name, hall: body.hall ?? null, note: body.note ?? null };
    terminals.push(tr); return ok(tr);
  }
  if (seg[0] === 'terminals' && seg[1] && method === 'PATCH') {
    const tr = terminals.find((x) => x.id === seg[1]); if (tr) Object.assign(tr, body); return ok(tr);
  }
  if (seg[0] === 'terminals' && seg[1] && method === 'DELETE') {
    const i = terminals.findIndex((x) => x.id === seg[1]); if (i >= 0) terminals.splice(i, 1); return ok({ ok: true });
  }

  // Bo'limlar (sexlar)
  if (path === '/stations' && method === 'GET') return ok([...stations].sort((a, b) => a.sortOrder - b.sortOrder));
  if (path === '/stations' && method === 'POST') {
    const st: MockStation = { id: uid(), name: body.name, printerHost: body.printerHost ?? '', printerPort: body.printerPort ?? 9100, printerWidth: body.printerWidth ?? 48, sortOrder: body.sortOrder ?? stations.length + 1 };
    stations.push(st); return ok(st);
  }
  // Bo'lim printerini sinash — demo'da printer yo'q: IP kiritilgan bo'lsa muvaffaqiyatli deb olinadi,
  // IP bo'sh bo'lsa real server kabi "sozlanmagan"
  if (seg[0] === 'stations' && seg[1] && seg[2] === 'test-print' && method === 'POST') {
    if (!isManager) return fail(FORBIDDEN, 403);
    const st = stations.find((x) => x.id === seg[1]);
    if (!st) return ok({ stationId: seg[1], station: '', host: '', ok: false, message: 'Bo‘lim topilmadi' });
    const host = String(st.printerHost ?? '').trim();
    if (!host) {
      return ok({ stationId: st.id, station: st.name, host: '', ok: false, message: 'Bo‘lim printeri sozlanmagan — printer IP manzilini kiriting' });
    }
    return ok({ stationId: st.id, station: st.name, host, ok: true, message: 'Demo: sinov cheki (printer yo‘q)' });
  }
  if (seg[0] === 'stations' && seg[1] && method === 'PATCH') {
    const st = stations.find((x) => x.id === seg[1]); if (st) Object.assign(st, body); return ok(st);
  }
  if (seg[0] === 'stations' && seg[1] && method === 'DELETE') {
    const i = stations.findIndex((x) => x.id === seg[1]); if (i >= 0) stations.splice(i, 1); return ok({ ok: true });
  }

  // Sklad (ombor) — 0.3.3
  if (seg[0] === 'inventory') return inventoryRoute(method, path, seg, params, body, actor);

  // ---- Xodimlar ----
  if (path === '/users/waiters' && method === 'GET') {
    // Buyurtma qabul qiladigan faol xodimlar: ofitsiantlar va 'waiter' ruxsati bor boshqa xodimlar
    // (kassir ham) — direktor/superadmin emas (server findWaiters bilan bir xil)
    return ok(
      users
        .filter(
          (x) =>
            x.active &&
            (x.role === UserRole.Waiter ||
              (!isFullAccessRole(x.role) && Array.isArray(x.permissions) && x.permissions.includes('waiter'))),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((x) => ({ id: x.id, name: x.name, role: x.role, login: x.login, active: x.active })),
    );
  }
  // Tartib server bilan bir xil: rol guard (403) -> DTO tekshiruvi (400) -> xizmat qoidalari
  if (seg[0] === 'users' && !isManager) return fail(FORBIDDEN, 403);
  if (path === '/users' && method === 'GET') {
    return ok([...users].sort((a, b) => a.name.localeCompare(b.name)).map(staffRow));
  }
  if (path === '/users' && method === 'POST') {
    const dtoError = validateUserDto(body ?? {}, true);
    if (dtoError) return fail(dtoError);
    const role = body.role as UserRole;
    const pin = isGiven(trimmed(body.pin)) ? String(trimmed(body.pin)) : null;
    const login = isGiven(trimmed(body.login)) ? String(trimmed(body.login)) : null;
    const password = isGiven(body.password) ? String(body.password) : null;
    // 1) Ruxsat (403): ierarxiya; login/parolni faqat Direktor/SuperAdmin beradi
    if (!hierarchyAllows(actor, null, role)) return fail(FORBIDDEN, 403);
    if ((login || password) && !isFullAccessRole(actor.role)) return fail(FORBIDDEN, 403);
    // 2) Yangi xodim tizimga kira olishi shart (400)
    if (isFullAccessRole(role)) {
      if (!login || !password) return fail(CREDENTIALS_REQUIRED_MESSAGE);
    } else {
      if (login && !password) return fail('Login uchun parol ham kiriting');
      if (password && !login) return fail('Parol uchun login ham kiriting');
      if (!pin && !login) return fail('PIN kiriting (4–10 ta raqam)');
    }
    // 3) Unikallik
    if (pin && users.some((x) => x.pin === pin)) return fail(PIN_TAKEN_ON_CREATE);
    if (login && loginTaken(login)) return fail('Bu login band');
    // Ruxsatlar berilmagan (yoki bo'sh) — rol bo'yicha standart ruxsatlar (server kabi)
    // Lavozimga taqiqlangan ruxsatlar (ofitsiantga kassa/hisobot...) saqlanmaydi (server kabi)
    let permissions = capabilitiesForRole(role, normalizePermissions(body.permissions));
    if (permissions.length === 0 && !isFullAccessRole(role)) permissions = defaultCapabilitiesForRole(role);
    const created: MockUser = {
      id: uid(), name: String(trimmed(body.name)), role, login, pin, active: true,
      permissions,
      password,
      // Parolni boshqa odam (direktor) qo'ydi — xodim birinchi kirishda o'zinikiga almashtiradi
      mustChangePassword: !!password,
    };
    users.push(created);
    return ok(staffRow(created));
  }
  if (seg[0] === 'users' && seg[1] && method === 'PATCH') {
    const dtoError = validateUserDto(body ?? {}, false);
    if (dtoError) return fail(dtoError);
    const target = users.find((x) => x.id === seg[1]);
    if (!target) return fail('Xodim topilmadi', 404);
    const actorFull = isFullAccessRole(actor.role);
    const isSelf = target.id === actor.id;

    // Nima o'zgaryapti? (UI o'zgarmagan maydonlarni ham yuboradi — faqat haqiqiy o'zgarish hisoblanadi)
    const nextRole: UserRole = body.role ?? target.role;
    const roleChanged = body.role !== undefined && body.role !== target.role;
    const deactivating = body.active === false && target.active;
    const currentPermissions = normalizePermissions(target.permissions);
    const requestedPermissions = body.permissions !== undefined ? normalizePermissions(body.permissions) : null;
    // Lavozimga taqiqlangan ruxsatlar saqlanmaydi; faqat shundaylari bo'lsa — rolning standart ruxsatlari (server kabi)
    const basePermissions = requestedPermissions ?? currentPermissions;
    let nextPermissions = capabilitiesForRole(nextRole, basePermissions);
    if (nextPermissions.length === 0 && basePermissions.length > 0 && !isFullAccessRole(nextRole)) {
      nextPermissions = defaultCapabilitiesForRole(nextRole);
    }
    const permissionsChanged = !samePermissions(nextPermissions, currentPermissions);
    const effectivePermissionsChanged = !samePermissions(nextPermissions, capabilitiesForRole(target.role, currentPermissions));
    const currentLogin = target.login ?? null;
    const loginGiven = body.login !== undefined;
    const nextLogin = loginGiven ? (isGiven(trimmed(body.login)) ? String(trimmed(body.login)) : null) : currentLogin;
    const loginChanged = loginGiven && nextLogin !== currentLogin;
    const newPassword = isGiven(body.password) ? String(body.password) : null;
    const newPin = isGiven(trimmed(body.pin)) ? String(trimmed(body.pin)) : null;
    const pinChanged = newPin !== null && newPin !== target.pin;

    // 1) Ruxsat (403)
    if (!hierarchyAllows(actor, target, nextRole)) return fail(FORBIDDEN, 403);
    if ((loginChanged || newPassword) && !actorFull) return fail(FORBIDDEN, 403);
    // Administrator o'ziga rol/ruxsat bera olmaydi
    if (isSelf && !actorFull && (roleChanged || effectivePermissionsChanged)) return fail(FORBIDDEN, 403);

    // 2) Kamida bitta faol direktor qoladi; o'zini bloklab bo'lmaydi
    if (
      target.role === UserRole.Director && target.active &&
      (deactivating || (roleChanged && nextRole !== UserRole.Director)) &&
      isLastActiveDirector()
    ) {
      return fail(LAST_DIRECTOR_MESSAGE);
    }
    if (isSelf && deactivating) return fail('O‘zingizni bloklay olmaysiz');

    // 3) Login va parol izchilligi
    let nextPassword = target.password;
    let nextMustChange = !!target.mustChangePassword;
    if (loginChanged && nextLogin === null) {
      // Login olib tashlansa — parol bilan kirish ham yopiladi
      nextPassword = null;
      nextMustChange = false;
    }
    if (newPassword) {
      if (!nextLogin) return fail('Parol uchun login ham kiriting');
      if (isSelf && target.password && newPassword === target.password) {
        return fail('Yangi parol joriy paroldan farq qilishi kerak');
      }
      nextPassword = newPassword;
      // Boshqa xodimga qo'yilgan parol vaqtinchalik; o'zi qo'ysa — almashtirish shart emas
      nextMustChange = !isSelf;
    } else if (loginChanged && nextLogin && !nextPassword) {
      return fail('Login uchun parol ham kiriting');
    }
    if (isFullAccessRole(nextRole) && (roleChanged || loginChanged) && (!nextLogin || !nextPassword)) {
      return fail(CREDENTIALS_REQUIRED_MESSAGE);
    }

    // 4) Unikallik
    if (pinChanged && users.some((x) => x.pin === newPin && x.id !== target.id)) return fail(PIN_TAKEN_ON_UPDATE);
    if (loginChanged && nextLogin && loginTaken(nextLogin, target.id)) return fail('Bu login band');

    // 5) Saqlash
    if (body.name !== undefined) target.name = String(trimmed(body.name));
    target.role = nextRole;
    if (body.active !== undefined) target.active = body.active;
    if (permissionsChanged) target.permissions = nextPermissions;
    if (pinChanged) target.pin = newPin;
    if (loginChanged) target.login = nextLogin;
    target.password = nextPassword;
    target.mustChangePassword = nextMustChange;
    return ok(staffRow(target));
  }
  if (seg[0] === 'users' && seg[1] && method === 'DELETE') {
    const target = users.find((x) => x.id === seg[1]);
    // Allaqachon yo'q — natija baribir bir xil (takroriy bosish xato bermaydi)
    if (!target) return ok({ ok: true });
    if (!hierarchyAllows(actor, target, target.role)) return fail(FORBIDDEN, 403);
    if (target.role === UserRole.Director && target.active && isLastActiveDirector()) return fail(LAST_DIRECTOR_MESSAGE);
    if (target.id === actor.id) return fail('O‘zingizni o‘chira olmaysiz');
    users.splice(users.indexOf(target), 1);
    return ok({ ok: true });
  }

  // Customers (CRM)
  if (path === '/customers' && method === 'GET') {
    return ok([...customers].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
  }
  if (path === '/customers' && method === 'POST') {
    const c: MockCustomer = { id: uid(), name: body.name, phone: body.phone ?? '', note: body.note?.trim() || null, createdAt: new Date().toISOString() };
    customers.unshift(c);
    return ok(c);
  }
  if (seg[0] === 'customers' && seg[1] && method === 'PATCH') {
    const c = customers.find((x) => x.id === seg[1]);
    if (c) {
      if (body.name !== undefined) c.name = body.name;
      if (body.phone !== undefined) c.phone = body.phone;
      if (body.note !== undefined) c.note = body.note?.trim() || null;
    }
    return ok(c ?? null);
  }
  if (seg[0] === 'customers' && seg[1] && method === 'DELETE') {
    const i = customers.findIndex((x) => x.id === seg[1]);
    if (i >= 0) customers.splice(i, 1);
    return ok({ ok: true });
  }

  return fail(`Mock: yo‘l topilmadi (${method} ${path})`, 404);
}

// ---- Sozlamalar ----
const PERCENT_MESSAGE = 'Xizmat haqi foizi 0 dan 100 gacha bo‘lishi kerak';
const SHARE_MESSAGE = 'Ofitsiant ulushi foizi 0 dan 100 gacha bo‘lishi kerak';
const HALL_ORDER_MESSAGE = 'Zallar tartibi noto‘g‘ri';
const DELIVERY_FEE_DEFAULT_MESSAGE = 'Yetkazish narxi 0 dan 1 000 000 gacha bo‘lishi kerak';

function settingsRoute(method: string, path: string, seg: string[], body: any, actor: MockUser): Promise<unknown> {
  // POS sozlamalari — tizimga kirgan ISTALGAN xodim o'qiydi
  if (path === '/settings/pos' && method === 'GET') return ok(toPosSettings());
  // Qolgan sozlamalar — faqat Direktor va SuperAdmin
  if (!isFullAccessRole(actor.role)) throw forbidden();
  if (path === '/settings' && method === 'GET') return ok(settingsView());
  if (path === '/settings' && method === 'PATCH') {
    for (const k of ['restaurantName', 'telegramToken', 'telegramChatId', 'dailyReportTime']) {
      if (body[k] != null && typeof body[k] !== 'string') throw bad(`${k} must be a string`);
    }
    const pct = (v: unknown) => v == null || (isNum(v) && v >= 0 && v <= 100);
    if (!pct(body.serviceDineInPercent)) throw bad(PERCENT_MESSAGE);
    if (!pct(body.waiterSharePercent)) throw bad(SHARE_MESSAGE);
    if (body.hallOrder != null && (!Array.isArray(body.hallOrder) || body.hallOrder.some((h: unknown) => typeof h !== 'string'))) {
      throw bad(HALL_ORDER_MESSAGE);
    }
    if (body.deliveryFeeDefault != null && !(isInt(body.deliveryFeeDefault) && body.deliveryFeeDefault >= 0 && body.deliveryFeeDefault <= DELIVERY_FEE_MAX)) {
      throw bad(DELIVERY_FEE_DEFAULT_MESSAGE);
    }
    if (body.telegramBackup != null && typeof body.telegramBackup !== 'boolean') {
      throw bad('Zaxira nusxa sozlamasi noto‘g‘ri (true yoki false)');
    }
    if (body.paymentMethods != null) {
      if (!Array.isArray(body.paymentMethods)) throw bad('To‘lov turlari ro‘yxati noto‘g‘ri');
      const problem = validatePaymentMethods(body.paymentMethods);
      if (problem) throw bad(problem);
    }
    // Faqat ma'lum maydonlar (server ValidationPipe whitelist kabi)
    for (const k of ['restaurantName', 'telegramToken', 'telegramChatId', 'dailyReportTime'] as const) {
      if (body[k] !== undefined) settings[k] = body[k] == null ? '' : String(body[k]);
    }
    if (typeof body.telegramBackup === 'boolean') settings.telegramBackup = body.telegramBackup;
    if (body.serviceDineInPercent !== undefined) settings.serviceDineInPercent = percent2(body.serviceDineInPercent);
    if (body.waiterSharePercent !== undefined) settings.waiterSharePercent = percent2(body.waiterSharePercent);
    if (body.hallOrder !== undefined) settings.hallOrder = normalizeHallList(body.hallOrder);
    if (body.deliveryFeeDefault !== undefined) settings.deliveryFeeDefault = normalizeFee(body.deliveryFeeDefault);
    if (body.paymentMethods !== undefined) {
      settings.paymentMethods = body.paymentMethods === null ? null : normalizePaymentMethods(body.paymentMethods);
    }
    return ok(settingsView());
  }
  if (seg[1] === 'telegram-detect' && method === 'POST') {
    // Server kabi: aniqlangan ID ro'yxatga QO'SHILADI (avvalgilar o'chmaydi)
    const chatId = '123456789';
    const list = settings.telegramChatId.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean);
    if (!list.includes(chatId)) settings.telegramChatId = [...list, chatId].join(', ');
    return ok({ chatId });
  }
  if (seg[1] === 'telegram-backup' && method === 'POST') {
    // Demo: fayl yuborilmaydi — natija server bilan bir xil shaklda
    if (!settings.telegramToken.trim() || !settings.telegramChatId.trim()) {
      return ok({ ok: false, message: 'Telegram sozlanmagan — bot token va chat id kiriting' });
    }
    settings.telegramBackupAt = nowIso();
    return ok({ ok: true, message: 'Zaxira nusxa Telegram’ga yuborildi (demo)', sizeBytes: 0, sentAt: settings.telegramBackupAt });
  }
  if ((seg[1] === 'telegram-test' || seg[1] === 'telegram-report') && method === 'POST') return ok({ ok: true });
  return fail(`Mock: yo‘l topilmadi (${method} ${path})`, 404);
}

// ---- Stollar va zallar (B12, B24) ----
const HALL_NAME_MESSAGE = 'Zal nomini kiriting';
const HALL_LIST_MESSAGE = 'Zallar ro‘yxati noto‘g‘ri';
const RANGE_MESSAGE = 'Stol raqamlari oralig‘i noto‘g‘ri';
const HALL_PERCENT_MESSAGE = 'Foiz 0 dan 100 gacha bo‘lishi kerak';
const BULK_MAX = 200;

function tablesRoute(method: string, path: string, seg: string[], body: any, actor: MockUser): Promise<unknown> {
  // Stollar ro'yxati: zallar sozlamadagi tartibda, har zal ichida stol raqami bo'yicha
  if (path === '/tables' && method === 'GET') {
    const cmp = hallComparator(settings.hallOrder);
    return ok([...tables].sort((a, b) => cmp(a.hall, b.hall) || a.number - b.number));
  }
  // Boshqaruv — faqat administrator / direktor / superadmin
  if (!isAdminRole(actor)) throw forbidden();

  if (path === '/tables/hall-order' && method === 'PUT') {
    if (!Array.isArray(body.halls) || body.halls.some((h: unknown) => typeof h !== 'string')) throw bad(HALL_LIST_MESSAGE);
    settings.hallOrder = normalizeHallList(body.halls);
    return ok({ ok: true, hallOrder: normalizeHallList(settings.hallOrder) });
  }
  if (path === '/tables/hall-service' && method === 'PUT') {
    if (typeof body.hall !== 'string') throw bad(HALL_NAME_MESSAGE);
    const hall = body.hall.trim();
    if (!hall) throw bad(HALL_NAME_MESSAGE);
    const percent = body.percent;
    if (percent !== null && !(isNum(percent) && percent >= 0 && percent <= 100)) throw bad(HALL_PERCENT_MESSAGE);
    return ok({ ok: true, hallServicePercent: setHallServicePercent(hall, percent) });
  }
  if (path === '/tables/hall/rename' && method === 'POST') {
    if (typeof body.from !== 'string') throw bad(HALL_NAME_MESSAGE);
    if (typeof body.to !== 'string') throw bad('Yangi zal nomini kiriting');
    const from: string = body.from;
    const to = body.to.trim();
    if (!to) throw bad('Yangi zal nomini kiriting');
    if (to === from) return ok({ ok: true, updated: 0 });
    const halls = [...new Set(tables.map((t) => t.hall))];
    if (halls.some((h) => h !== from && h.trim().toLowerCase() === to.toLowerCase())) throw bad('Bunday zal allaqachon bor');
    let updated = 0;
    for (const t of tables) {
      if (t.hall === from) {
        t.hall = to;
        updated++;
      }
    }
    // Zallar tartibidagi nom va alohida xizmat haqi foizi kaliti ham ko'chadi
    const list = normalizeHallList(settings.hallOrder);
    if (list.includes(from)) settings.hallOrder = list.map((h) => (h === from ? to : h));
    const map = normalizeHallServiceMap(settings.hallServicePercent);
    if (Object.prototype.hasOwnProperty.call(map, from)) {
      const value = map[from];
      delete map[from];
      map[to] = value;
      settings.hallServicePercent = map;
    }
    return ok({ ok: true, updated });
  }
  if (path === '/tables/hall/delete' && method === 'POST') {
    if (typeof body.hall !== 'string') throw bad(HALL_NAME_MESSAGE);
    const hall: string = body.hall;
    const ids = new Set(tables.filter((t) => t.hall === hall).map((t) => t.id));
    if (ids.size > 0) {
      if (orders.some((o) => o.tableId && ids.has(o.tableId) && o.status !== OrderStatus.Closed)) {
        throw bad('Bu zalda ochiq buyurtma bor — avval yoping');
      }
      tables = tables.filter((t) => !ids.has(t.id));
    }
    settings.hallOrder = normalizeHallList(settings.hallOrder).filter((h) => h !== hall);
    const map = normalizeHallServiceMap(settings.hallServicePercent);
    delete map[hall];
    settings.hallServicePercent = map;
    return ok({ ok: true, deleted: ids.size });
  }
  if (path === '/tables/bulk' && method === 'POST') {
    if (typeof body.hall !== 'string') throw bad(HALL_NAME_MESSAGE);
    if (!(isInt(body.from) && body.from >= 1) || !(isInt(body.to) && body.to >= 1)) throw bad(RANGE_MESSAGE);
    if (body.capacity != null && !(isInt(body.capacity) && body.capacity >= 1)) throw bad('capacity must not be less than 1');
    if (body.servicePercent != null && !(isNum(body.servicePercent) && body.servicePercent >= 0 && body.servicePercent <= 100)) {
      throw bad(HALL_PERCENT_MESSAGE);
    }
    const hall = body.hall.trim();
    if (!hall) throw bad(HALL_NAME_MESSAGE);
    if (body.from > body.to) throw bad(RANGE_MESSAGE);
    if (body.to - body.from + 1 > BULK_MAX) throw bad(`Bir martada ko‘pi bilan ${BULK_MAX} ta stol qo‘shiladi`);
    const existing = new Set(tables.filter((t) => t.hall === hall).map((t) => t.number));
    let created = 0;
    for (let n = body.from; n <= body.to; n++) {
      if (existing.has(n)) continue;
      tables.push({ id: uid(), number: n, hall, capacity: body.capacity ?? 4, status: TableStatus.Free });
      created++;
    }
    if (body.servicePercent != null) setHallServicePercent(hall, body.servicePercent);
    return ok({ ok: true, created });
  }
  if (path === '/tables' && method === 'POST') {
    if (!(isInt(body.number) && body.number >= 1)) throw bad('number must not be less than 1');
    if (typeof body.hall !== 'string') throw bad('hall must be a string');
    if (body.capacity != null && !(isInt(body.capacity) && body.capacity >= 1)) throw bad('capacity must not be less than 1');
    const t: MockTable = { id: uid(), number: body.number, hall: body.hall, capacity: body.capacity || 4, status: TableStatus.Free };
    tables.push(t);
    return ok(t);
  }
  if (seg[1] && !seg[2] && method === 'PATCH') {
    if (body.number != null && !(isInt(body.number) && body.number >= 1)) throw bad('number must not be less than 1');
    if (body.hall != null && typeof body.hall !== 'string') throw bad('hall must be a string');
    if (body.capacity != null && !(isInt(body.capacity) && body.capacity >= 1)) throw bad('capacity must not be less than 1');
    const t = tables.find((x) => x.id === seg[1]);
    if (t) {
      if (body.number !== undefined) t.number = body.number;
      if (body.hall !== undefined) t.hall = body.hall;
      if (body.capacity !== undefined) t.capacity = body.capacity;
    }
    return ok(t ?? null);
  }
  if (seg[1] && !seg[2] && method === 'DELETE') {
    // Stolni o'chirish — ochiq buyurtmasi bo'lsa mumkin emas
    if (orders.some((o) => o.tableId === seg[1] && o.status !== OrderStatus.Closed)) throw bad('Stolda ochiq buyurtma bor');
    tables = tables.filter((t) => t.id !== seg[1]);
    return ok({ ok: true });
  }
  return fail(`Mock: yo‘l topilmadi (${method} ${path})`, 404);
}

// ---- Menyu (B13, B14, B29) ----
function menuRoute(method: string, path: string, seg: string[], body: any, actor: MockUser): Promise<unknown> {
  if (path === '/menu/categories' && method === 'GET') {
    return ok([...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
  }
  // Ofitsiant/kassa: BARCHA taomlar `available` belgisi bilan (stop list); rasm — imageUrl
  if (path === '/menu/items' && method === 'GET') return ok(menu.map(toMenuItem));

  // Stop list (B29): kassir bir bosishda taomni "tugadi" deb belgilaydi yoki qaytaradi
  if (seg[1] === 'items' && seg[2] && seg[3] === 'availability' && method === 'PATCH') {
    if (typeof body.available !== 'boolean') throw bad(AVAILABILITY_MESSAGE);
    if (!canManageKassa(actor)) throw forbidden();
    const m = menu.find((x) => x.id === seg[2]);
    if (!m) throw notFound(ITEM_NOT_FOUND_MESSAGE);
    m.available = body.available;
    emitMenuChanged({ itemId: m.id, available: m.available });
    return ok(toMenuItem(m));
  }

  // Boshqaruv — faqat administrator / direktor / superadmin
  if (!isAdminRole(actor)) throw forbidden();
  if (path === '/menu/all-items' && method === 'GET') return ok(menu.map(toMenuItem));
  if (path === '/menu/categories' && method === 'POST') {
    if (typeof body.name !== 'string') throw bad('name must be a string');
    if (body.sortOrder != null && !isNum(body.sortOrder)) throw bad('sortOrder must be a number conforming to the specified constraints');
    const c: MockCategory = { id: uid(), name: body.name, sortOrder: body.sortOrder ?? categories.reduce((m, x) => Math.max(m, x.sortOrder), 0) + 1 };
    categories.push(c);
    return ok(c);
  }
  // Kategoriyalar tartibi: {ids: [...]} — ro'yxatdagilar sortOrder = 1, 2, 3...
  if (path === '/menu/categories/order' && method === 'PUT') {
    if (!Array.isArray(body.ids) || body.ids.some((id: unknown) => !isUuid(id))) throw bad('Kategoriyalar ro‘yxati noto‘g‘ri');
    const ids = [...new Set<string>(body.ids)];
    ids.forEach((id, i) => {
      const c = categories.find((x) => x.id === id);
      if (c) c.sortOrder = i + 1;
    });
    return ok({ ok: true });
  }
  if (seg[1] === 'categories' && seg[2] && method === 'PATCH') {
    const c = categories.find((x) => x.id === seg[2]);
    if (c) {
      if (body.name != null) c.name = String(body.name);
      if (body.sortOrder != null) c.sortOrder = Number(body.sortOrder);
    }
    return ok(c ?? null);
  }
  if (seg[1] === 'categories' && seg[2] && method === 'DELETE') {
    categories = categories.filter((x) => x.id !== seg[2]);
    return ok({ ok: true });
  }
  if (path === '/menu/items' && method === 'POST') {
    const dtoError = validateMenuItemDto(body, true);
    if (dtoError) throw bad(dtoError);
    const img = imageChange(body.image) ?? null;
    const m: MockMenuItem = {
      id: uid(),
      name: body.name,
      price: body.price,
      categoryId: body.categoryId,
      stationId: body.stationId ?? null,
      available: body.available ?? true,
      exciseRequired: !!body.exciseRequired,
      image: img,
      imageVersion: img ? 1 : 0,
      unit: body.unit ?? MenuUnit.Piece,
      favorite: !!body.favorite,
      ingredients: body.ingredients ?? null,
    };
    menu.push(m);
    emitMenuChanged({ itemId: m.id, available: m.available });
    return ok(toMenuItem(m));
  }
  if (seg[1] === 'items' && seg[2] && !seg[3] && method === 'PATCH') {
    const dtoError = validateMenuItemDto(body, false);
    if (dtoError) throw bad(dtoError);
    const m = menu.find((x) => x.id === seg[2]);
    if (!m) throw notFound(ITEM_NOT_FOUND_MESSAGE);
    let changed = false;
    // null faqat bo'lim va tarkib uchun (qolganlari NOT NULL — null kelsa e'tiborsiz)
    for (const key of ['name', 'price', 'categoryId', 'ingredients', 'available', 'exciseRequired', 'unit', 'stationId', 'favorite'] as const) {
      const value = body[key];
      if (value === undefined) continue;
      if (value === null && key !== 'stationId' && key !== 'ingredients') continue;
      (m as any)[key] = value;
      changed = true;
    }
    // Rasm: yangi data URL — almashtiriladi, '' / null — o'chiriladi; har o'zgarishda versiya +1
    const img = imageChange(body.image);
    if (img !== undefined && (img !== null || m.image)) {
      m.image = img;
      m.imageVersion += 1;
      changed = true;
    }
    if (changed) emitMenuChanged({ itemId: m.id, available: m.available });
    return ok(toMenuItem(m));
  }
  if (seg[1] === 'items' && seg[2] && !seg[3] && method === 'DELETE') {
    const existed = menu.some((x) => x.id === seg[2]);
    menu = menu.filter((x) => x.id !== seg[2]);
    if (existed) emitMenuChanged({ itemId: seg[2], available: false, deleted: true });
    return ok({ ok: true });
  }
  return fail(`Mock: yo‘l topilmadi (${method} ${path})`, 404);
}

// =============================================================================================
// Sklad (ombor) marshrutlari — /inventory/* (server inventory controller va servislari, 0.3.3)
// =============================================================================================

/** Sklad ma'lumotlarini o'qish (har qanday GET /inventory/*): 'inventory' yoki 'menu' ruxsati, yoki administrator / direktor */
const canReadInventory = (u: MockUser) => can(u, 'inventory') || can(u, 'menu') || isAdminRole(u);
/** Sklad amallari: 'inventory' ruxsati yoki administrator / direktor (alohida "skladchi" ham to'liq ishlaydi) */
const canWriteInventory = (u: MockUser) => can(u, 'inventory') || isAdminRole(u);
/** Taom retseptini saqlash: 'menu' yoki 'inventory' ruxsati, yoki administrator / direktor */
const canEditRecipes = (u: MockUser) => can(u, 'menu') || can(u, 'inventory') || isAdminRole(u);

/** Nom: chetidagi bo'shliqlarsiz, ichidagi ketma-ket bo'shliqlar bitta (server cleanName) */
const cleanName = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
/** Nom kaliti — katta-kichik harf va bo'shliqlar farqi hisobga olinmaydi: "Baraka" = " baraka " */
const nameKey = (v: unknown) => cleanName(v).toLowerCase();
/** Ixtiyoriy matn (izoh, telefon): chetidagi bo'shliqlarsiz; bo'sh yoki matn emas — null */
const optionalText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** JSON'dagi son; satr, NaN va Infinity — noto'g'ri (NaN) */
const finiteOrNaN = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/** Musbat miqdor (3 xona) — aks holda 400 */
function positiveQty(v: unknown, message: string): number {
  const q = roundStockQty(finiteOrNaN(v));
  if (!(q > 0)) throw bad(message);
  return q;
}
/** 0 yoki musbat miqdor (qoldiq, minimal qoldiq, sanalgan qoldiq) — aks holda 400 */
function nonNegativeQty(v: unknown, message: string): number {
  const n = finiteOrNaN(v);
  if (!(n >= 0)) throw bad(message);
  return roundStockQty(n);
}
/** Narx / tannarx: 0 yoki musbat (4 xona) — aks holda 400 */
function nonNegativeCost(v: unknown): number {
  const n = finiteOrNaN(v);
  if (!(n >= 0)) throw bad(STOCK_PRICE_INVALID_MESSAGE);
  return roundStockCost(n);
}
/** DTO tur tekshiruvi (server dto.ts): berilgan (null emas) maydon matn bo'lishi shart */
function assertText(b: any, key: string, message = STOCK_TEXT_INVALID_MESSAGE): void {
  if (b[key] != null && typeof b[key] !== 'string') throw bad(message);
}

const findProduct = (id: unknown) => (typeof id === 'string' && id ? products.find((p) => p.id === id) : undefined);
function productOr404(id: unknown): MockProduct {
  const p = findProduct(id);
  if (!p) throw notFound(PRODUCT_NOT_FOUND_MESSAGE);
  return p;
}
const productNameTaken = (name: string, exceptId?: string) =>
  products.some((p) => p.id !== exceptId && nameKey(p.name) === nameKey(name));
/** Mahsulot ishlatilgan taomlar soni (menyuda bor taomlar; o'chirilgan taomning qolib ketgan qatori hisobga olinmaydi) */
function recipeCountOf(productId: string): number {
  const dishes = new Set(recipeItems.filter((r) => r.productId === productId).map((r) => r.menuItemId));
  return [...dishes].filter((id) => menu.some((m) => m.id === id)).length;
}
/** Harakatlari bormi ('initial'dan boshqa harakat yoki kirim/vozvrat) — bor bo'lsa o'lchov birligi o'zgarmaydi */
const hasHistoryOf = (productId: string) =>
  movements.some((m) => m.productId === productId && m.type !== 'initial') || purchases.some((x) => x.productId === productId);

function productView(p: MockProduct): Product {
  return {
    id: p.id,
    name: p.name,
    unit: p.unit,
    stock: roundStockQty(p.stock),
    minStock: roundStockQty(p.minStock),
    avgCost: roundStockCost(p.avgCost),
    recipeCount: recipeCountOf(p.id),
    hasHistory: hasHistoryOf(p.id),
  };
}

/** Omborda yetarli bo'lishi shart (chiqim, vozvrat, ishlab chiqarish) */
function assertEnoughStock(p: MockProduct, qty: number): void {
  const available = roundStockQty(p.stock);
  if (qty - available > QTY_EPS) throw bad(stockNotEnoughMessage(p.name, available, p.unit));
}

function movementView(m: MockMovement): StockMovement {
  return {
    id: m.id,
    productId: m.productId,
    productName: m.productName,
    unit: m.unit,
    type: m.type,
    quantity: m.quantity,
    balanceAfter: m.balanceAfter,
    unitCost: m.unitCost,
    reference: m.reference ?? null,
    referenceLabel: m.referenceLabel ?? null,
    note: m.note ?? null,
    userName: m.userName ?? null,
    createdAt: m.createdAt,
  };
}

function purchaseView(x: MockPurchase): Purchase {
  return {
    id: x.id,
    productId: x.productId,
    productName: x.productName,
    unit: x.unit,
    supplier: x.supplier,
    supplierId: x.supplierId,
    quantity: x.quantity,
    unitPrice: x.unitPrice,
    total: x.total,
    note: x.note,
    createdAt: x.createdAt,
  };
}

const supplierPaymentView = (x: MockSupplierPayment): SupplierPayment => ({
  id: x.id,
  supplierId: x.supplierId,
  supplierName: x.supplier,
  amount: x.amount,
  note: x.note,
  userName: x.userName,
  createdAt: x.createdAt,
});

/**
 * Ta'minotchi balansi: olingan = kirimlar summasi (vozvrat — manfiy qator), to'langan = to'lovlar,
 * qarz = farq (butun so'm). purchasesCount va lastPurchaseAt — faqat kirimlar (vozvratlarsiz).
 */
function supplierView(s: MockSupplier): Supplier {
  let purchased = 0;
  let purchasesCount = 0;
  let lastPurchaseAt: string | null = null;
  for (const x of purchases) {
    if (x.supplierId !== s.id) continue;
    purchased += x.total;
    if (x.quantity <= 0) continue;
    purchasesCount += 1;
    if (!lastPurchaseAt || Date.parse(x.createdAt) > Date.parse(lastPurchaseAt)) lastPurchaseAt = x.createdAt;
  }
  const paid = roundSum(supplierPayments.filter((x) => x.supplierId === s.id).reduce((sum, x) => sum + x.amount, 0));
  purchased = roundSum(purchased);
  return { id: s.id, name: s.name, phone: s.phone, note: s.note, purchased, paid, debt: purchased - paid, purchasesCount, lastPurchaseAt };
}

/** Ta'minotchilar balansi bilan: qarzi kattasi birinchi, keyin nomi bo'yicha */
const supplierList = () =>
  suppliers.map(supplierView).sort((a, b) => b.debt - a.debt || a.name.localeCompare(b.name, 'uz'));

/** Eng yangisi birinchi; bir vaqtdagilar — yozilish tartibining teskarisi (server ORDER BY created_at, rowid DESC) */
const newestFirst = <T extends { createdAt: string }>(rows: T[]): T[] =>
  [...rows].reverse().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

/** ?from=&to= — mahalliy 'YYYY-MM-DD' yoki sana+vaqt (chegaralar kiradi); noto'g'ri sana — 400 (server applyDateRange) */
function dateRangeOf(params: URLSearchParams): { from: number | null; to: number | null } {
  const raw = (k: string) => {
    const v = params.get(k);
    return v != null && v.trim() ? v.trim() : undefined;
  };
  const fromRaw = raw('from');
  const toRaw = raw('to');
  const from = fromRaw ? localBound(fromRaw, false) : null;
  const to = toRaw ? localBound(toRaw, true) : null;
  if ((fromRaw && from === null) || (toRaw && to === null)) throw bad(STOCK_DATE_INVALID_MESSAGE);
  return { from, to };
}
const inDateRange = (iso: string, r: { from: number | null; to: number | null }) => {
  const t = toSecond(Date.parse(iso));
  return (r.from === null || t >= r.from) && (r.to === null || t <= r.to);
};

/** GET /inventory/movements — jurnal: mahsulot, tur (vergul bilan bir nechta), sana; sahifalab, eng yangisi birinchi */
function listMovements(params: URLSearchParams): PaginatedMovements {
  const str = (k: string) => {
    const v = params.get(k);
    return v != null && v.trim() ? v.trim() : undefined;
  };
  const page = positiveInt(str('page'), 1, 1_000_000);
  const limit = positiveInt(str('limit'), 50, 100);
  const productId = str('productId');
  const types = (str('type') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const range = dateRangeOf(params);
  const list = newestFirst(
    movements.filter(
      (m) => (!productId || m.productId === productId) && (!types.length || types.includes(m.type)) && inDateRange(m.createdAt, range),
    ),
  );
  return {
    items: list.slice((page - 1) * limit, page * limit).map(movementView),
    total: list.length,
    page,
    limit,
    hasMore: page * limit < list.length,
  };
}

/** GET /inventory/purchases — kirim va vozvratlar: mahsulot, ta'minotchi, sana; eng yangisi birinchi (200 ta, 500 gacha) */
function listPurchases(params: URLSearchParams): Purchase[] {
  const str = (k: string) => {
    const v = params.get(k);
    return v != null && v.trim() ? v.trim() : undefined;
  };
  const productId = str('productId');
  const supplierId = str('supplierId');
  const limit = positiveInt(str('limit'), 200, 500);
  const range = dateRangeOf(params);
  return newestFirst(
    purchases.filter(
      (x) => (!productId || x.productId === productId) && (!supplierId || x.supplierId === supplierId) && inDateRange(x.createdAt, range),
    ),
  )
    .slice(0, limit)
    .map(purchaseView);
}

/** Taom retsepti (mahsulot nomi va birligi bilan) */
function recipeView(menuItemId: string): RecipeItem[] {
  return recipeItems
    .filter((r) => r.menuItemId === menuItemId)
    .map((r) => {
      const p = findProduct(r.productId);
      return { id: r.id, menuItemId: r.menuItemId, productId: r.productId, amount: r.amount, productName: p?.name, productUnit: p?.unit };
    });
}

/**
 * Ta'minotchini aniqlash (kirim, vozvrat, to'lov): supplierId (bo'lishi shart — aks holda 404) YOKI nom —
 * mavjudi katta-kichik harf / bo'shliqlarsiz topiladi, yo'q bo'lsa yaratiladi. Ikkalasi bo'sh — ta'minotchisiz
 * (required bo'lsa — 400). Barcha boshqa tekshiruvlardan KEYIN chaqiriladi (tranzaksiya kabi: xato bo'lsa
 * yangi ta'minotchi yaratilib qolmaydi).
 */
function resolveSupplier(b: any, required: boolean): MockSupplier | null {
  const supplierId = typeof b.supplierId === 'string' ? b.supplierId.trim() : '';
  if (supplierId) {
    const found = suppliers.find((s) => s.id === supplierId);
    if (!found) throw notFound(SUPPLIER_NOT_FOUND_MESSAGE);
    return found;
  }
  const name = cleanName(b.supplier);
  if (!name) {
    if (required) throw bad(SUPPLIER_NAME_REQUIRED_MESSAGE);
    return null;
  }
  const existing = suppliers.find((s) => nameKey(s.name) === nameKey(name));
  if (existing) return existing;
  const created: MockSupplier = { id: uid(), name, phone: null, note: null, createdAt: nowIso() };
  suppliers.push(created);
  return created;
}

/** Kirim (bitta tranzaksiya): kirim qatori, o'rtacha tannarx (nextAvgCost), 'purchase' harakati kirim narxida */
function recordPurchase(
  p: MockProduct,
  supplier: MockSupplier | null,
  quantity: number,
  unitPrice: number,
  note: string | null,
  ctx: MoveCtx,
): MockPurchase {
  const at = ctx.at ?? nowIso();
  const name = supplier?.name ?? '';
  const row: MockPurchase = {
    id: uid(), productId: p.id, productName: p.name, unit: p.unit, supplier: name, supplierId: supplier?.id ?? null,
    quantity, unitPrice, total: Math.round(quantity * unitPrice), note, createdAt: at,
  };
  purchases.push(row);
  p.avgCost = nextAvgCost(p.stock, p.avgCost, quantity, unitPrice);
  applyMovement(p, 'purchase', { delta: quantity }, unitPrice, {
    ...ctx, at, reference: row.id, referenceLabel: name ? `Kirim: ${name}` : 'Kirim', note,
  });
  return row;
}

/** Ta'minotchiga vozvrat: MANFIY kirim qatori (qarz kamayadi) va 'return' harakati; o'rtacha tannarx o'zgarmaydi */
function recordReturn(
  p: MockProduct,
  supplier: MockSupplier | null,
  quantity: number,
  unitPrice: number,
  note: string | null,
  ctx: MoveCtx,
): MockPurchase {
  const at = ctx.at ?? nowIso();
  const name = supplier?.name ?? '';
  const row: MockPurchase = {
    id: uid(), productId: p.id, productName: p.name, unit: p.unit, supplier: name, supplierId: supplier?.id ?? null,
    quantity: -quantity, unitPrice, total: 0 - Math.round(quantity * unitPrice),
    note: `↩️ Vozvrat${note ? ` · ${note}` : ''}`, createdAt: at,
  };
  purchases.push(row);
  applyMovement(p, 'return', { delta: -quantity }, unitPrice, {
    ...ctx, at, reference: row.id, referenceLabel: name ? `Vozvrat: ${name}` : 'Vozvrat', note,
  });
  return row;
}

/** Ta'minotchiga to'lov (qarzni kamaytiradi); kim kiritgani saqlanadi */
function recordSupplierPayment(s: MockSupplier, amount: number, note: string | null, ctx: MoveCtx): MockSupplierPayment {
  const row: MockSupplierPayment = {
    id: uid(), supplierId: s.id, supplier: s.name, amount, note, userName: ctx.userName, createdAt: ctx.at ?? nowIso(),
  };
  supplierPayments.push(row);
  return row;
}

function inventoryRoute(method: string, path: string, seg: string[], params: URLSearchParams, rawBody: any, actor: MockUser): Promise<unknown> {
  const sub = seg[1];
  const id = seg[2];
  const tail = seg[3];
  const notRoute = () => fail(`Mock: yo‘l topilmadi (${method} ${path})`, 404);
  // Tana — JSON orqali kelgandek (server kabi): NaN/Infinity -> null, undefined maydonlar yo'q
  const b: any = clone(rawBody) ?? {};
  const by = (extra: Partial<MoveCtx> = {}): MoveCtx => ({ userId: actor.id, userName: actor.name, ...extra });

  // ---- O'qish: 'inventory' / 'menu' ruxsati yoki administrator / direktor ----
  if (method === 'GET') {
    if (!canReadInventory(actor)) throw forbidden();
    if (seg.length === 2) {
      if (sub === 'products') return ok([...products].sort((x, y) => x.name.localeCompare(y.name, 'uz')).map(productView));
      if (sub === 'movements') return ok(listMovements(params));
      if (sub === 'purchases') return ok(listPurchases(params));
      if (sub === 'suppliers') return ok(supplierList());
      // To'lovlar: eng yangisi birinchi, ixtiyoriy ta'minotchi bo'yicha; limit ≤ 500 (standart 200)
      if (sub === 'supplier-payments') {
        const supplierId = params.get('supplierId')?.trim();
        const limit = positiveInt(params.get('limit')?.trim(), 200, 500);
        return ok(
          newestFirst(supplierPayments.filter((x) => !supplierId || x.supplierId === supplierId))
            .slice(0, limit)
            .map(supplierPaymentView),
        );
      }
      // Eski (0.3.3 gacha) ko'rinish — /suppliers bilan bir xil raqamlar
      if (sub === 'supplier-balances') {
        return ok(supplierList().map((s) => ({ supplier: s.name, purchased: s.purchased, paid: s.paid, debt: s.debt, count: s.purchasesCount })));
      }
    }
    if (sub === 'recipe' && id && !tail) return ok(recipeView(id));
    return notRoute();
  }

  // ---- Taom retsepti: 'menu' yoki 'inventory' ruxsati, yoki administrator / direktor ----
  // To'liq almashtiriladi: 0 / bo'sh qatorlar tashlab ketiladi, bir mahsulot ikki marta — qo'shiladi,
  // yo'q mahsulot — 404 (eski retsept o'zgarmaydi)
  if (sub === 'recipe' && id && !tail && method === 'PUT') {
    if (!Array.isArray(b.items)) throw bad('items must be an array'); // server SetRecipeDto (IsArray)
    if (!canEditRecipes(actor)) throw forbidden();
    const lines = new Map<string, number>();
    for (const it of b.items) {
      const amount = roundStockQty(it?.amount);
      if (!it?.productId || !(amount > 0)) continue;
      const pid = String(it.productId);
      lines.set(pid, roundStockQty((lines.get(pid) ?? 0) + amount));
    }
    if ([...lines.keys()].some((pid) => !findProduct(pid))) throw notFound(PRODUCT_NOT_FOUND_MESSAGE);
    recipeItems = recipeItems.filter((r) => r.menuItemId !== id);
    for (const [productId, amount] of lines) recipeItems.push({ id: uid(), menuItemId: id, productId, amount });
    return ok(recipeView(id));
  }

  // ---- Ta'minotchiga to'lovni o'chirish (pul yozuvi) — faqat administrator / direktor ----
  if (sub === 'supplier-payments' && id && !tail && method === 'DELETE') {
    if (!isAdminRole(actor)) throw forbidden();
    if (!supplierPayments.some((x) => x.id === id)) throw notFound(SUPPLIER_PAYMENT_NOT_FOUND_MESSAGE);
    supplierPayments = supplierPayments.filter((x) => x.id !== id);
    return ok({ ok: true });
  }

  // ---- Qolgan yozish amallari: 'inventory' ruxsati yoki administrator / direktor ----
  if (!canWriteInventory(actor)) throw forbidden();

  // Mahsulot qo'shish: boshlang'ich qoldiq > 0 bo'lsa — 'initial' harakati
  if (sub === 'products' && !id && method === 'POST') {
    assertText(b, 'name', PRODUCT_NAME_REQUIRED_MESSAGE);
    const name = cleanName(b.name);
    if (!name) throw bad(PRODUCT_NAME_REQUIRED_MESSAGE);
    if (!PRODUCT_UNITS.includes(b.unit)) throw bad(PRODUCT_UNIT_INVALID_MESSAGE);
    const stock = b.stock != null ? nonNegativeQty(b.stock, STOCK_QTY_INVALID_MESSAGE) : 0;
    const minStock = b.minStock != null ? nonNegativeQty(b.minStock, STOCK_QTY_INVALID_MESSAGE) : 0;
    const avgCost = b.unitCost != null ? nonNegativeCost(b.unitCost) : 0;
    if (productNameTaken(name)) throw bad(PRODUCT_NAME_TAKEN_MESSAGE);
    const p: MockProduct = { id: uid(), name, unit: b.unit, stock: 0, minStock, avgCost };
    products.push(p);
    // Server kabi: yangi mahsulotning boshlang'ich qoldig'i izohsiz (izoh — faqat jurnal boshlanishidagi qoldiqda)
    if (stock > 0) applyMovement(p, 'initial', { delta: stock }, avgCost, by());
    return ok(productView(p));
  }

  // Mahsulotni tahrirlash: nom, birlik, minimal qoldiq. `stock` qabul qilinmaydi — faqat harakatlar orqali
  if (sub === 'products' && id && !tail && method === 'PATCH') {
    assertText(b, 'name', PRODUCT_NAME_REQUIRED_MESSAGE);
    if (b.unit != null && !PRODUCT_UNITS.includes(b.unit)) throw bad(PRODUCT_UNIT_INVALID_MESSAGE);
    if (b.minStock != null && !isNum(b.minStock)) throw bad(STOCK_QTY_INVALID_MESSAGE);
    const p = productOr404(id);
    let name: string | undefined;
    if (b.name != null) {
      name = cleanName(b.name);
      if (!name) throw bad(PRODUCT_NAME_REQUIRED_MESSAGE);
      if (productNameTaken(name, p.id)) throw bad(PRODUCT_NAME_TAKEN_MESSAGE);
    }
    const minStock = b.minStock != null ? nonNegativeQty(b.minStock, STOCK_QTY_INVALID_MESSAGE) : undefined;
    // Birlik — faqat harakatlari yo'q va qoldig'i 0 mahsulotda (eski miqdorlar boshqa birlikda qolmasin)
    const unitChanged = b.unit != null && b.unit !== p.unit;
    if (unitChanged && (hasHistoryOf(p.id) || roundStockQty(p.stock) !== 0)) throw bad(STOCK_UNIT_LOCKED_MESSAGE);
    if (name !== undefined) p.name = name;
    if (unitChanged) p.unit = b.unit;
    if (minStock !== undefined) p.minStock = minStock;
    return ok(productView(p));
  }

  // O'chirish: retseptlarda ishlatilgan bo'lsa — yo'q. Harakatlar va kirimlar qoladi (nom nusxasi bilan)
  if (sub === 'products' && id && !tail && method === 'DELETE') {
    const p = findProduct(id);
    if (!p) return ok({ ok: true });
    const used = recipeCountOf(p.id);
    if (used > 0) throw bad(productInRecipesMessage(used));
    products = products.filter((x) => x.id !== p.id);
    // O'chirilgan taomlardan qolib ketgan retsept qatorlari
    recipeItems = recipeItems.filter((r) => r.productId !== p.id);
    return ok({ ok: true });
  }

  // Chiqim (hisobdan chiqarish) yoki qo'lda tuzatish
  if (sub === 'products' && id && tail === 'adjust' && !seg[4] && method === 'POST') {
    if (b.delta != null && !isNum(b.delta)) throw bad(STOCK_QTY_INVALID_MESSAGE);
    if (b.type != null && b.type !== 'writeoff' && b.type !== 'adjust') throw bad(ADJUST_TYPE_INVALID_MESSAGE);
    assertText(b, 'note');
    const delta = roundStockQty(finiteOrNaN(b.delta));
    if (delta === 0) throw bad(STOCK_QTY_INVALID_MESSAGE);
    const type: StockMovementType = b.type ?? (delta > 0 ? 'adjust' : 'writeoff');
    if (type === 'writeoff' && delta > 0) throw bad(STOCK_QTY_INVALID_MESSAGE);
    const p = productOr404(id);
    // Chiqim — qoldiq yetarli bo'lsa; tuzatish (adjust) qoldiqni tekshirmaydi
    if (type === 'writeoff') assertEnoughStock(p, -delta);
    applyMovement(p, type, { delta }, p.avgCost, by({ note: optionalText(b.note) }));
    return ok(productView(p));
  }

  // Inventarizatsiya: sanalgan haqiqiy qoldiq (mutlaq), bitta partiya; farq 0 — harakat yo'q. Takror
  // yuborilsa — hech narsa o'zgarmaydi; bir mahsulot ikki marta kelsa — oxirgi qiymat olinadi
  if (sub === 'count' && !id && method === 'POST') {
    if (b.items != null && !Array.isArray(b.items)) throw bad(COUNT_ITEMS_REQUIRED_MESSAGE);
    assertText(b, 'note');
    const items: any[] = Array.isArray(b.items) ? b.items : [];
    if (items.length === 0) throw bad(COUNT_ITEMS_REQUIRED_MESSAGE);
    const actual = new Map<string, number>();
    for (const raw of items) {
      const item = raw && typeof raw === 'object' ? raw : {};
      const value = nonNegativeQty(item.actual, COUNT_VALUE_INVALID_MESSAGE);
      if (typeof item.productId !== 'string' || !item.productId) throw notFound(PRODUCT_NOT_FOUND_MESSAGE);
      actual.set(item.productId, value);
    }
    const lines = [...actual].map(([productId, value]) => ({ p: productOr404(productId), value }));
    const ctx = by({ reference: uid(), referenceLabel: COUNT_LABEL, note: optionalText(b.note), at: nowIso() });
    const made: MockMovement[] = [];
    for (const { p, value } of lines) {
      if (roundStockQty(value - roundStockQty(p.stock)) === 0) continue;
      made.push(applyMovement(p, 'count', { absolute: value }, p.avgCost, ctx));
    }
    return ok({ changed: made.length, movements: made.map(movementView) });
  }

  // Ishlab chiqarish: ketgan mahsulotlar (−, o'z tannarxida) -> tayyor mahsulot (+, yig'ilgan tannarxda)
  if (sub === 'production' && !id && method === 'POST') {
    if (b.outputProductId != null && typeof b.outputProductId !== 'string') throw bad(PRODUCTION_OUTPUT_REQUIRED_MESSAGE);
    if (b.outputQty != null && !isNum(b.outputQty)) throw bad(PRODUCTION_OUTPUT_REQUIRED_MESSAGE);
    if (b.inputs != null && !Array.isArray(b.inputs)) throw bad(PRODUCTION_INPUTS_REQUIRED_MESSAGE);
    assertText(b, 'note');
    const outputId = typeof b.outputProductId === 'string' ? b.outputProductId : '';
    const outputQty = roundStockQty(finiteOrNaN(b.outputQty));
    if (!outputId || !(outputQty > 0)) throw bad(PRODUCTION_OUTPUT_REQUIRED_MESSAGE);
    // Ketgan mahsulotlar: miqdori 0 qator (formadagi bo'sh qator) tashlab ketiladi, manfiy yoki son
    // emas — 400; bir mahsulot ikki marta kelsa — qo'shiladi
    const need = new Map<string, number>();
    for (const raw of Array.isArray(b.inputs) ? b.inputs : []) {
      const line = raw && typeof raw === 'object' ? raw : {};
      const q = nonNegativeQty(line.quantity, STOCK_QTY_POSITIVE_MESSAGE);
      if (q === 0) continue;
      if (typeof line.productId !== 'string' || !line.productId) throw notFound(PRODUCT_NOT_FOUND_MESSAGE);
      need.set(line.productId, roundStockQty((need.get(line.productId) ?? 0) + q));
    }
    if (need.size === 0) throw bad(PRODUCTION_INPUTS_REQUIRED_MESSAGE);
    if (need.has(outputId)) throw bad(PRODUCTION_SELF_MESSAGE);
    const output = findProduct(outputId);
    if (!output) throw bad(PRODUCTION_OUTPUT_REQUIRED_MESSAGE);
    const inputs = [...need].map(([pid, q]) => ({ p: productOr404(pid), q }));
    for (const { p, q } of inputs) assertEnoughStock(p, q);
    const unitCost = roundStockCost(inputs.reduce((sum, { p, q }) => sum + q * p.avgCost, 0) / outputQty);
    const ctx = by({ reference: uid(), referenceLabel: PRODUCTION_LABEL, note: optionalText(b.note), at: nowIso() });
    const made = inputs.map(({ p, q }) => applyMovement(p, 'production_out', { delta: -q }, p.avgCost, ctx));
    output.avgCost = nextAvgCost(output.stock, output.avgCost, outputQty, unitCost);
    made.push(applyMovement(output, 'production_in', { delta: outputQty }, unitCost, ctx));
    return ok({ movements: made.map(movementView) });
  }

  // Kirim (ta'minotchidan)
  if (sub === 'purchases' && !id && method === 'POST') {
    assertText(b, 'productId', 'productId must be a string');
    assertText(b, 'supplierId', 'supplierId must be a string');
    assertText(b, 'supplier', SUPPLIER_NAME_REQUIRED_MESSAGE);
    assertText(b, 'note');
    if (b.quantity != null && !isNum(b.quantity)) throw bad(STOCK_QTY_POSITIVE_MESSAGE);
    if (b.unitPrice != null && !isNum(b.unitPrice)) throw bad(STOCK_PRICE_INVALID_MESSAGE);
    const quantity = positiveQty(b.quantity, STOCK_QTY_POSITIVE_MESSAGE);
    const unitPrice = nonNegativeCost(b.unitPrice);
    const p = productOr404(b.productId);
    const supplier = resolveSupplier(b, false);
    return ok(purchaseView(recordPurchase(p, supplier, quantity, unitPrice, optionalText(b.note), by())));
  }

  // Ta'minotchiga vozvrat: narx berilmasa (yoki ≤ 0) — o'rtacha tannarx
  if (sub === 'returns' && !id && method === 'POST') {
    assertText(b, 'productId', 'productId must be a string');
    assertText(b, 'supplierId', 'supplierId must be a string');
    assertText(b, 'supplier', SUPPLIER_NAME_REQUIRED_MESSAGE);
    assertText(b, 'note');
    if (b.quantity != null && !isNum(b.quantity)) throw bad(STOCK_QTY_POSITIVE_MESSAGE);
    if (b.unitPrice != null && !isNum(b.unitPrice)) throw bad(STOCK_PRICE_INVALID_MESSAGE);
    const quantity = positiveQty(b.quantity, STOCK_QTY_POSITIVE_MESSAGE);
    const p = productOr404(b.productId);
    assertEnoughStock(p, quantity);
    const supplier = resolveSupplier(b, false);
    const price = isNum(b.unitPrice) && b.unitPrice > 0 ? roundStockCost(b.unitPrice) : roundStockCost(p.avgCost);
    return ok(purchaseView(recordReturn(p, supplier, quantity, price, optionalText(b.note), by())));
  }

  // Ta'minotchilar
  if (sub === 'suppliers' && !id && method === 'POST') {
    assertText(b, 'name', SUPPLIER_NAME_REQUIRED_MESSAGE);
    assertText(b, 'phone');
    assertText(b, 'note');
    const name = cleanName(b.name);
    if (!name) throw bad(SUPPLIER_NAME_REQUIRED_MESSAGE);
    if (suppliers.some((s) => nameKey(s.name) === nameKey(name))) throw bad(SUPPLIER_NAME_TAKEN_MESSAGE);
    const s: MockSupplier = { id: uid(), name, phone: optionalText(b.phone), note: optionalText(b.note), createdAt: nowIso() };
    suppliers.push(s);
    return ok(supplierView(s));
  }
  if (sub === 'suppliers' && id && !tail && method === 'PATCH') {
    assertText(b, 'name', SUPPLIER_NAME_REQUIRED_MESSAGE);
    assertText(b, 'phone');
    assertText(b, 'note');
    const s = suppliers.find((x) => x.id === id);
    if (!s) throw notFound(SUPPLIER_NOT_FOUND_MESSAGE);
    let name: string | undefined;
    if (b.name != null) {
      name = cleanName(b.name);
      if (!name) throw bad(SUPPLIER_NAME_REQUIRED_MESSAGE);
      if (suppliers.some((x) => x.id !== s.id && nameKey(x.name) === nameKey(name))) throw bad(SUPPLIER_NAME_TAKEN_MESSAGE);
    }
    if (name !== undefined && name !== s.name) {
      const newName = name;
      s.name = newName;
      // Nom nusxasi kirim/to'lov qatorlarida va jurnaldagi kirim/vozvrat yorliqlarida ham yangilanadi
      const own = new Set<string>();
      purchases.forEach((x) => {
        if (x.supplierId !== s.id) return;
        x.supplier = newName;
        own.add(x.id);
      });
      supplierPayments.forEach((x) => {
        if (x.supplierId === s.id) x.supplier = newName;
      });
      movements.forEach((m) => {
        if ((m.type === 'purchase' || m.type === 'return') && m.reference && own.has(m.reference)) {
          m.referenceLabel = m.type === 'purchase' ? `Kirim: ${newName}` : `Vozvrat: ${newName}`;
        }
      });
    }
    if (b.phone !== undefined) s.phone = optionalText(b.phone);
    if (b.note !== undefined) s.note = optionalText(b.note);
    return ok(supplierView(s));
  }
  if (sub === 'suppliers' && id && !tail && method === 'DELETE') {
    const s = suppliers.find((x) => x.id === id);
    if (!s) return ok({ ok: true });
    if (purchases.some((x) => x.supplierId === s.id) || supplierPayments.some((x) => x.supplierId === s.id)) {
      throw bad(SUPPLIER_IN_USE_MESSAGE);
    }
    suppliers = suppliers.filter((x) => x.id !== s.id);
    return ok({ ok: true });
  }

  // Ta'minotchiga to'lov (ta'minotchi majburiy: ro'yxatdan yoki nomi bilan)
  if (sub === 'supplier-payments' && !id && method === 'POST') {
    assertText(b, 'supplierId', 'supplierId must be a string');
    assertText(b, 'supplier', SUPPLIER_NAME_REQUIRED_MESSAGE);
    assertText(b, 'note');
    if (b.amount != null && !isNum(b.amount)) throw bad(SUPPLIER_PAYMENT_AMOUNT_MESSAGE);
    const amount = roundSum(finiteOrNaN(b.amount));
    if (!(amount > 0)) throw bad(SUPPLIER_PAYMENT_AMOUNT_MESSAGE);
    const s = resolveSupplier(b, true)!;
    return ok(supplierPaymentView(recordSupplierPayment(s, amount, optionalText(b.note), by())));
  }

  return notRoute();
}

// ---- Buyurtmalar ----
function ordersRoute(method: string, path: string, seg: string[], params: URLSearchParams, body: any, actor: MockUser): Promise<unknown> {
  const id = seg[1];
  const action = seg[2];
  /** Buyurtma bilan ishlash ruxsati (ofitsiant yoki kassir) — DTO tekshiruvidan KEYIN (server kabi) */
  const assertOperate = () => {
    if (!canOperateOrders(actor)) throw forbidden();
  };
  /** Kassa amallari — faqat kassir / administrator / direktor (server bilan bir xil xabar) */
  const assertManage = (message: string) => {
    if (!canManageOrders(actor)) throw forbidden(message);
  };

  if (path === '/orders' && method === 'GET') return ok(findActive(params.get('type')));
  if (path === '/orders' && method === 'POST') return ok(createOrder(body, actor));
  // Statik GET marshrutlar ':id' dan OLDIN
  if (path === '/orders/history' && method === 'GET') return ok(history(params, actor));
  if (path === '/orders/delivery-lookup' && method === 'GET') return ok(deliveryLookup(params.get('phone')));
  if (path === '/orders/print-receipt' && method === 'POST') {
    emit(SOCKET_EVENTS.PRINT_RECEIPT, { receipt: body });
    return ok({ ok: true });
  }
  if (!id) return fail(`Mock: yo‘l topilmadi (${method} ${path})`, 404);

  if (!action && method === 'GET') return ok(toDto(findEntity(id), { withPayments: true }));
  if (action === 'receipt' && method === 'GET') {
    if (!canViewAllHistory(actor)) throw forbidden();
    return ok(receiptOf(id));
  }
  if (action === 'payments' && !seg[3] && method === 'GET') {
    const methods = paymentMethods();
    return ok(orderPayments(id).map((p) => paymentView(p, methods)));
  }
  if (action === 'status' && method === 'PATCH') {
    if (!(SETTABLE_ORDER_STATUSES as string[]).includes(body.status)) throw bad('Noto‘g‘ri buyurtma holati');
    const o = findEntity(id);
    if (!canChangeOrderStatus(o.status, body.status)) throw bad('Yopilgan buyurtma holatini o‘zgartirib bo‘lmaydi');
    o.status = body.status;
    if (body.status === OrderStatus.Ready) o.items.forEach((it) => (it.status = OrderItemStatus.Ready));
    const dto = toDto(o);
    emitUpdated(dto);
    return ok(dto);
  }
  if (action === 'delivery' && method === 'PATCH') {
    if (body.phone != null && typeof body.phone !== 'string') throw bad(PHONE_INVALID_MESSAGE);
    if (body.address != null) {
      if (typeof body.address !== 'string') throw bad(ADDRESS_REQUIRED_MESSAGE);
      if (body.address.length > ADDRESS_MAX_LENGTH) throw bad(ADDRESS_TOO_LONG_MESSAGE);
    }
    if (body.note != null && typeof body.note !== 'string') throw bad('note must be a string');
    if (body.deliveryFee != null && !(isInt(body.deliveryFee) && body.deliveryFee >= 0 && body.deliveryFee <= DELIVERY_FEE_MAX)) {
      throw bad(DELIVERY_FEE_INVALID_MESSAGE);
    }
    assertOperate();
    return ok(updateDelivery(id, body));
  }
  if (action === 'items' && seg[3] && seg[4] === 'price' && method === 'PATCH') {
    if (!(isNum(body.price) && body.price >= 0 && body.price <= PRICE_MAX)) throw bad(PRICE_INVALID_MESSAGE);
    if (body.reason != null) {
      if (typeof body.reason !== 'string') throw bad('reason must be a string');
      if (body.reason.length > VOID_REASON_MAX_LENGTH) throw bad(VOID_REASON_TOO_LONG_MESSAGE);
    }
    if (!canVoid(actor)) throw forbidden(PRICE_FORBIDDEN_MESSAGE);
    return ok(setItemPrice(id, seg[3], body));
  }
  if (method !== 'POST' && !(action === 'payments' && seg[3] && method === 'DELETE')) {
    return fail(`Mock: yo‘l topilmadi (${method} ${path})`, 404);
  }

  switch (action) {
    case 'request-bill': {
      // Schot so'raldi — stol "hisob kutilmoqda" (faqat stolga buyurtmada)
      assertManage(BILL_FORBIDDEN_MESSAGE);
      const o = findEntity(id);
      const table = tableOf(o);
      if (table && table.status !== TableStatus.Free) table.status = TableStatus.AwaitingBill;
      const dto = toDto(o);
      emitUpdated(dto);
      return ok(dto);
    }
    case 'bill-check': {
      // Schot chiqarishdan oldin ruxsat (terminal printeri bo'lsa ham) — holat o'zgarmaydi
      assertManage(BILL_FORBIDDEN_MESSAGE);
      const o = findEntity(id);
      if (o.status === OrderStatus.Closed) throw bad(ORDER_CLOSED_MESSAGE);
      return ok({ ok: true });
    }
    case 'bill-printed': {
      // Schot mijozga berildi ("chek berildi", B23) — yangi taom qo'shilsa tozalanadi
      assertOperate();
      assertManage(BILL_FORBIDDEN_MESSAGE);
      const o = findEntity(id);
      if (o.status === OrderStatus.Closed) throw bad(ORDER_CLOSED_MESSAGE);
      o.billPrintedAt = nowIso();
      const dto = toDto(o);
      emitUpdated(dto);
      return ok(dto);
    }
    case 'note': {
      if (body.note != null && typeof body.note !== 'string') throw bad('note must be a string');
      const o = findEntity(id);
      o.note = body.note?.trim() || null;
      const dto = toDto(o);
      emitUpdated(dto);
      return ok(dto);
    }
    case 'customer': {
      if (body.customerId != null && !isUuid(body.customerId)) throw bad('customerId must be a UUID');
      const o = findEntity(id);
      const c = body.customerId ? customers.find((x) => x.id === body.customerId) : null;
      o.customerId = c?.id ?? null;
      o.customerName = c?.name ?? null;
      const dto = toDto(o);
      emitUpdated(dto);
      return ok(dto);
    }
    case 'remove-items': {
      if (body.items != null) {
        const problem = validateLineQty(body.items, 'Olib tashlanadigan taomlar ro‘yxati noto‘g‘ri', VOID_QTY_INVALID_MESSAGE);
        if (problem) throw bad(problem);
      }
      if (body.itemIds != null) {
        if (!Array.isArray(body.itemIds)) throw bad('Olib tashlanadigan taomlar ro‘yxati noto‘g‘ri');
        if (body.itemIds.some((x: unknown) => !isUuid(x))) throw bad('Taom qatori identifikatori noto‘g‘ri');
      }
      if (body.reason != null) {
        if (typeof body.reason !== 'string') throw bad('reason must be a string');
        if (body.reason.length > VOID_REASON_MAX_LENGTH) throw bad(VOID_REASON_TOO_LONG_MESSAGE);
      }
      if (!canVoid(actor)) throw forbidden(VOID_FORBIDDEN_MESSAGE);
      return ok(removeItems(id, body, actor));
    }
    case 'cancel': {
      if (body.reason != null) {
        if (typeof body.reason !== 'string') throw bad('reason must be a string');
        if (body.reason.length > VOID_REASON_MAX_LENGTH) throw bad(VOID_REASON_TOO_LONG_MESSAGE);
      }
      if (!canVoid(actor)) throw forbidden(VOID_FORBIDDEN_MESSAGE);
      return ok(cancelOrder(findEntity(id), cleanReason(body.reason), actor));
    }
    case 'split': {
      const problem = validateLineQty(body.items, SPLIT_QTY_INVALID_MESSAGE, SPLIT_QTY_INVALID_MESSAGE);
      if (problem) throw bad(problem);
      if (isGiven(body.targetOrderId) && !isUuid(body.targetOrderId)) throw bad(ORDER_NOT_FOUND_MESSAGE);
      assertManage(SPLIT_FORBIDDEN_MESSAGE);
      return ok(splitOrder(id, body));
    }
    case 'change-type': {
      if (!(ORDER_TYPES as unknown[]).includes(body.type)) throw bad(ORDER_TYPE_INVALID_MESSAGE);
      if (body.type === OrderType.DineIn && isGiven(body.tableId) && !isUuid(body.tableId)) throw bad(TABLE_REQUIRED_MESSAGE);
      if (isGiven(body.checkNo) && !(isInt(body.checkNo) && body.checkNo >= 1 && body.checkNo <= MAX_CHECK_NO)) {
        throw bad(CHECK_NO_INVALID_MESSAGE);
      }
      if (body.phone != null && body.type !== OrderType.DineIn && typeof body.phone !== 'string') throw bad(PHONE_INVALID_MESSAGE);
      if (body.address != null && body.type === OrderType.Delivery) {
        if (typeof body.address !== 'string') throw bad(ADDRESS_REQUIRED_MESSAGE);
        if (body.address.length > ADDRESS_MAX_LENGTH) throw bad(ADDRESS_TOO_LONG_MESSAGE);
      }
      assertManage(CHANGE_TYPE_FORBIDDEN_MESSAGE);
      return ok(changeType(id, body));
    }
    case 'move-table': {
      if (!isUuid(body.tableId)) throw bad('Yangi stol tanlanmagan');
      assertManage(MOVE_TABLE_FORBIDDEN_MESSAGE);
      return ok(moveTable(id, body.tableId));
    }
    case 'change-waiter': {
      if (!isUuid(body.waiterId)) throw bad('Ofitsiant tanlanmagan');
      if (!canChangeWaiter(actor)) throw forbidden(WAITER_CHANGE_FORBIDDEN_MESSAGE);
      const o = findEntity(id);
      const w = users.find((x) => x.id === body.waiterId);
      if (!w) throw notFound('Ofitsiant topilmadi');
      o.waiterId = w.id;
      const dto = toDto(o);
      emitUpdated(dto);
      return ok(dto);
    }
    case 'print-bill': {
      // Hisob (schot) chekini printerli terminalga (kassa) yuborish — relay
      assertManage(BILL_FORBIDDEN_MESSAGE);
      const dto = toDto(findEntity(id));
      emit(SOCKET_EVENTS.PRINT_BILL, { order: dto });
      return ok(dto);
    }
    case 'excise': {
      const o = findEntity(id);
      (Array.isArray(body.codes) ? body.codes : []).forEach((c: any) => {
        const it = o.items.find((x) => x.id === c?.orderItemId);
        if (it && typeof c.code === 'string') it.exciseCode = c.code;
      });
      return ok(toDto(o, { withPayments: true }));
    }
    case 'refund': {
      if (body.reason != null && typeof body.reason !== 'string') throw bad('Vozvrat sababi matn bo‘lishi kerak');
      if (body.returnStock != null && typeof body.returnStock !== 'boolean') throw bad('Skladga qaytarish belgisi noto‘g‘ri');
      if (!can(actor, 'refund')) throw forbidden('Vozvrat qilish ruxsati yo‘q');
      const o = findEntity(id);
      if (o.status !== OrderStatus.Closed) throw bad('Faqat to‘langan (yopilgan) chek qaytariladi');
      if (o.refunded) throw bad('Bu chek allaqachon qaytarilgan');
      o.refunded = true;
      o.refundReason = String(body.reason ?? '').trim() || null;
      o.refundedAt = nowIso();
      o.refundedBy = actor.id;
      // Mahsulotlar skladga qaytarilsin (ixtiyoriy; odatda ovqat qaytmaydi): sotuv harakatlari teskarisiga
      if (body.returnStock === true) writeRefundMovements(o, actor);
      return ok(toDto(o));
    }
    case 'pay': {
      if (typeof body.type !== 'string' || body.type.length > 32) throw bad(PAYMENT_TYPE_INVALID_MESSAGE);
      if (body.amount != null && !(isNum(body.amount) && body.amount >= 0)) throw bad(PAYMENT_AMOUNT_INVALID_MESSAGE);
      const problem = validatePercents(body) ?? validateDebtorDto(body.debtor);
      if (problem) throw bad(problem);
      if (!can(actor, 'cashier')) throw forbidden();
      return ok(pay(id, body, actor));
    }
    case 'pay-multi': {
      if (!Array.isArray(body.payments)) throw bad(PAYMENT_AMOUNT_INVALID_MESSAGE);
      for (const p of body.payments) {
        if (!p || typeof p !== 'object') throw bad('nested property payments must be either object or array');
        if (typeof p.type !== 'string' || p.type.length > 32) throw bad(PAYMENT_TYPE_INVALID_MESSAGE);
        if (!isNum(p.amount)) throw bad(PAYMENT_AMOUNT_INVALID_MESSAGE);
      }
      const problem = validatePercents(body) ?? validateDebtorDto(body.debtor);
      if (problem) throw bad(problem);
      if (!can(actor, 'cashier')) throw forbidden();
      return ok(payMulti(id, body, actor));
    }
    case 'payments': {
      // DELETE /orders/:id/payments/:paymentId — qisman to'lovni bekor qilish (chek yopilmagan bo'lsa)
      if (method !== 'DELETE' || !seg[3]) return fail(`Mock: yo‘l topilmadi (${method} ${path})`, 404);
      if (!can(actor, 'cashier')) throw forbidden();
      const o = findEntity(id);
      if (o.status === OrderStatus.Closed) throw bad('Yopilgan chek to‘lovini o‘chirib bo‘lmaydi');
      payments = payments.filter((p) => !(p.id === seg[3] && p.orderId === o.id));
      const dto = toDto(o);
      emitUpdated(dto);
      return ok(dto);
    }
    default:
      return fail(`Mock: yo‘l topilmadi (${method} ${path})`, 404);
  }
}

// ---- Hisobotlar ----
function reportsRoute(path: string, seg: string[], params: URLSearchParams, period: string, actor: MockUser): Promise<unknown> {
  const sub = seg[1];
  const str = (k: string) => {
    const v = params.get(k);
    if (v == null) return undefined;
    const s = v.trim();
    return s ? s : undefined;
  };
  // O'z ko'rsatkichi (ofitsiant ekrani) — istalgan xodim, faqat o'zi olgan cheklar
  if (sub === 'my-share') {
    const range = resolveDay(params.get('date'));
    const percent = round2(clampPercent(settings.waiterSharePercent));
    const acc = accumulateShares(closedOrdersIn(range).filter((o) => o.waiterId === actor.id));
    const out: MyShare = {
      from: range.from,
      to: range.to,
      ordersCount: acc.ordersCount,
      dineInSales: acc.dineInSales,
      takeawaySales: acc.takeawaySales,
      shareAmount: shareOf(acc.dineInSales, percent),
      sharePercent: percent,
    };
    return ok(out);
  }
  // Ofitsiantlar hisoboti (B20): ?from=&to= &sharePercent= (berilmasa — sozlamadagi ulush)
  if (sub === 'waiter-shares') {
    if (!canSeeShares(actor)) throw forbidden();
    const range = resolveRange(params.get('from'), params.get('to'));
    const raw = str('sharePercent');
    let percent: number;
    if (raw === undefined) percent = clampPercent(settings.waiterSharePercent);
    else {
      percent = Number(raw.replace(',', '.'));
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw bad(SHARE_PERCENT_MESSAGE);
    }
    return ok(waiterShares(range, percent));
  }
  // Shu xodim sotgan taomlar ("Taom" oynasi)
  if (sub === 'waiter-items') {
    if (!canSeeShares(actor)) throw forbidden();
    const waiterId = str('waiterId');
    if (!waiterId) throw bad(WAITER_REQUIRED_MESSAGE);
    const range = resolveRange(params.get('from'), params.get('to'));
    const map = new Map<string, TopItem & { unit: MenuUnit | null }>();
    for (const o of closedOrdersIn(range)) {
      if (o.waiterId !== waiterId) continue;
      for (const it of o.items) {
        const c = map.get(it.menuItemName) ?? { name: it.menuItemName, unit: null, quantity: 0, sum: 0 };
        c.quantity += Number(it.quantity);
        c.sum += lineSum(it.price, it.quantity);
        if (it.unit === MenuUnit.Weight) c.unit = MenuUnit.Weight;
        else if (!c.unit) c.unit = MenuUnit.Piece;
        map.set(it.menuItemName, c);
      }
    }
    return ok(
      [...map.values()]
        .map((r) => ({ ...r, quantity: roundQty3(r.quantity) }))
        .sort((a, b) => b.sum - a.sum || a.name.localeCompare(b.name)),
    );
  }
  // Kassa holati (B33)
  if (sub === 'cash-summary') {
    if (!canSeeCash(actor)) throw forbidden();
    return ok(cashSummary(resolveDay(params.get('date'))));
  }
  // Qarzlar (B30/B34): ?status=open|repaid|all (standart: all) &from=&to= &q=
  if (sub === 'debts') {
    if (!canSeeCash(actor)) throw forbidden();
    const status = (str('status') ?? 'all').toLowerCase();
    if (status !== 'open' && status !== 'repaid' && status !== 'all') throw bad(DEBT_STATUS_MESSAGE);
    const hasDates = str('from') !== undefined || str('to') !== undefined;
    const range = hasDates ? resolveRange(params.get('from'), params.get('to')) : null;
    return ok(debtsReport(status, range, str('q') ?? ''));
  }
  // Otkazlar (B19): ?from=&to= yoki ?orderId= (bitta chekning otkazlari, sanadan qat'i nazar)
  if (sub === 'voids') {
    if (!canSeeVoids(actor)) throw forbidden();
    const range = resolveRange(params.get('from'), params.get('to'));
    const rawOrderId = str('orderId');
    const orderId = rawOrderId && rawOrderId.length <= 64 ? rawOrderId : undefined;
    const all = voidLogs
      .filter((v) => (orderId ? v.orderId === orderId : inRange(v.createdAt, range)))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
    const report: VoidReport = {
      from: range.from,
      to: range.to,
      count: all.length,
      total: all.reduce((s, v) => s + roundSum(v.sum), 0),
      items: all.slice(0, REPORT_LIST_LIMIT),
    };
    return ok(report);
  }

  // Eski hisobotlar — direktor, administrator, kassir (server @Roles)
  if (!REPORT_ROLES.includes(actor.role)) throw forbidden();
  if (sub === 'daily') {
    const days = Math.min(60, Math.max(1, Number(params.get('days')) || 7));
    const today = paidInPeriod(periodStart('day'));
    const totalRev = sumPayments(today) || 600000;
    const now = new Date();
    const out: { date: string; revenue: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      // Bugun — haqiqiy; qolgan kunlar demo uchun bugungi tushum atrofida
      const factor = i === 0 ? 1 : 0.4 + Math.random() * 0.9;
      out.push({ date: businessDateOf(d), revenue: i === 0 ? sumPayments(today) : Math.round(totalRev * factor) });
    }
    return ok(out);
  }
  const start = periodStart(period);
  const paid = paidInPeriod(start);
  if (sub === 'summary') {
    const methods = paymentMethods();
    const methodPos = new Map(methods.map((m, i) => [m.key, i] as const));
    const byType = new Map<string, number>();
    const orderIds = new Set<string>();
    let revenue = 0;
    for (const p of paid) {
      revenue += roundSum(p.amount);
      orderIds.add(p.orderId);
      byType.set(p.type, (byType.get(p.type) ?? 0) + roundSum(p.amount));
    }
    // To'lov turlari — usul kaliti, nomi va toifasi bilan (B30), sozlamadagi tartibda
    const paymentBreakdown = [...byType.entries()]
      .map(([type, amount]) => {
        const info = methodInfo(methods, type);
        return { type, amount, label: info.label, kind: info.kind };
      })
      .sort((a, b) => (methodPos.get(a.type) ?? 999) - (methodPos.get(b.type) ?? 999) || b.amount - a.amount);
    // Buyurtma turlari bo'yicha: tushum — davrdagi to'lovlar; soni — shu to'lovlari bor YOPILGAN cheklar
    const acc = new Map<OrderType, { count: Set<string>; amount: number }>();
    for (const p of paid) {
      const o = orders.find((x) => x.id === p.orderId);
      const t = orderTypeOf(o ?? null);
      const cur = acc.get(t) ?? { count: new Set<string>(), amount: 0 };
      cur.amount += roundSum(p.amount);
      if (o && o.status === OrderStatus.Closed) cur.count.add(o.id);
      acc.set(t, cur);
    }
    return ok({
      period,
      revenue,
      ordersCount: orderIds.size,
      avgCheck: orderIds.size ? Math.round(revenue / orderIds.size) : 0,
      paymentBreakdown,
      byOrderType: ORDER_TYPES.map((type) => ({
        type,
        count: acc.get(type)?.count.size ?? 0,
        amount: acc.get(type)?.amount ?? 0,
      })),
    });
  }
  if (sub === 'refunds') {
    const list = orders
      .filter((o) => o.refunded && o.refundedAt && Date.parse(o.refundedAt) >= start)
      .sort((a, b) => (b.refundedAt ?? '').localeCompare(a.refundedAt ?? ''))
      .map((o) => ({
        id: o.id,
        // Qaytarilgan summa — chek summasi (chegirma/xizmat/yetkazish bilan), server kabi
        total: orderTotalsOf(o).total,
        reason: o.refundReason || '',
        refundedAt: o.refundedAt,
        products: o.items.map((it) => ({ name: it.menuItemName, quantity: roundQty3(it.quantity), unit: it.unit })),
      }));
    return ok({ count: list.length, total: list.reduce((s, r) => s + r.total, 0), items: list });
  }
  const closed = orders.filter((o) => o.status === OrderStatus.Closed && !o.refunded && Date.parse(o.closedAt ?? '') >= start);
  if (sub === 'top-items') {
    const map = new Map<string, TopItem>();
    closed.forEach((o) => o.items.forEach((it) => {
      const c = map.get(it.menuItemName) ?? { name: it.menuItemName, quantity: 0, sum: 0 };
      c.quantity += Number(it.quantity);
      c.sum += lineSum(it.price, it.quantity);
      map.set(it.menuItemName, c);
    }));
    return ok(
      [...map.values()]
        .map((r) => ({ ...r, quantity: roundQty3(r.quantity) }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10),
    );
  }
  if (sub === 'waiters') {
    // Xodim bo'yicha (o'chirilgan xodimning cheklari kirmaydi — server INNER JOIN kabi)
    const map = new Map<string, { waiterId: string; waiterName: string; ordersCount: number; revenue: number }>();
    closed.forEach((o) => {
      const name = userName(o.waiterId);
      if (name === null) return;
      const c = map.get(o.waiterId) ?? { waiterId: o.waiterId, waiterName: name, ordersCount: 0, revenue: 0 };
      c.ordersCount += 1;
      c.revenue += sumPayments(orderPayments(o.id));
      map.set(o.waiterId, c);
    });
    return ok([...map.values()].sort((a, b) => b.revenue - a.revenue));
  }
  return fail(`Mock: yo‘l topilmadi (GET ${path})`, 404);
}

// ---- Printerlar: chek navbati (B17) va holat (B26) ----
function printingRoute(method: string, path: string, seg: string[], params: URLSearchParams, actor: MockUser): Promise<unknown> {
  // Holat — tizimga kirgan har bir xodim (holat qatori)
  if (path === '/printing/status' && method === 'GET') return ok(printerStatus());
  if (!canManageKassa(actor)) throw forbidden();
  if (path === '/printing/jobs' && method === 'GET') {
    const filter = (params.get('status') ?? 'open').trim() || 'open';
    if (!PRINT_JOB_FILTERS.includes(filter)) throw bad('Chek holati noto‘g‘ri');
    return ok([]); // demo'da bo'lim cheklari chop etilmaydi — navbat doim bo'sh
  }
  if (path === '/printing/retry-all' && method === 'POST') return ok({ ok: true, pending: 0 });
  if (seg[1] === 'jobs' && seg[2] && (seg[3] === 'retry' || seg[3] === 'cancel') && method === 'POST') {
    if (!isUuid(seg[2])) throw notFound('Chek topilmadi');
    return ok(seg[3] === 'retry' ? { ok: true, pending: 0, message: 'Demo: printer yo‘q' } : { ok: true, pending: 0 });
  }
  return fail(`Mock: yo‘l topilmadi (${method} ${path})`, 404);
}

// ---- Kassa harakatlari: kirim / chiqim (B33) — server expenses.controller bilan bir xil ----
const EXPENSE_AMOUNT_MESSAGE = 'Summa noto‘g‘ri (butun so‘m, 1 dan 1 000 000 000 gacha)';
const EXPENSE_KIND_MESSAGE = 'Turi noto‘g‘ri (kirim yoki chiqim)';
const EXPENSE_NOTE_MESSAGE = 'Izoh juda uzun (300 belgigacha)';
const EXPENSE_NOT_FOUND_MESSAGE = 'Yozuv topilmadi';
const CASH_KINDS: CashKind[] = ['kirim', 'chiqim'];

/** Ro'yxat qatori (summa — butun so'm) */
const expenseView = (e: MockExpense) => ({
  id: e.id,
  amount: roundSum(e.amount),
  kind: e.kind === 'kirim' ? 'kirim' : 'chiqim',
  note: e.note ?? null,
  cashierId: e.cashierId,
  cashierName: e.cashierName ?? null,
  createdAt: e.createdAt,
});

function expensesRoute(method: string, path: string, seg: string[], params: URLSearchParams, body: any, actor: MockUser): Promise<unknown> {
  // Kassir kiritadi, administrator va direktor ham ko'radi
  if (!EXPENSE_ROLES.includes(actor.role)) throw forbidden();
  if (path === '/expenses' && method === 'GET') {
    // ?from=&to= (mahalliy sanalar) yoki eski ?date= (berilmasa — bugun); ?kind=kirim|chiqim.
    // total — eski mijozlar bilan moslik: kind=kirim bo'lsa kirim, aks holda CHIQIM (rasxod) yig'indisi
    const kindRaw = (params.get('kind') ?? '').trim() || undefined;
    if (kindRaw !== undefined && !CASH_KINDS.includes(kindRaw as CashKind)) throw bad(EXPENSE_KIND_MESSAGE);
    const range =
      paramGiven(params.get('from')) || paramGiven(params.get('to'))
        ? resolveRange(params.get('from'), params.get('to'))
        : resolveDay(params.get('date'));
    const items = expenses
      .filter((e) => inRange(e.createdAt, range) && (!kindRaw || e.kind === kindRaw))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map(expenseView);
    const kirim = items.filter((r) => r.kind === 'kirim').reduce((s, r) => s + r.amount, 0);
    const chiqim = items.filter((r) => r.kind === 'chiqim').reduce((s, r) => s + r.amount, 0);
    return ok({ from: range.from, to: range.to, items, total: kindRaw === 'kirim' ? kirim : chiqim, kirim, chiqim });
  }
  if (path === '/expenses' && method === 'POST') {
    if (!(isInt(body.amount) && body.amount >= 1 && body.amount <= 1_000_000_000)) throw bad(EXPENSE_AMOUNT_MESSAGE);
    if (body.note != null && (typeof body.note !== 'string' || body.note.length > 300)) throw bad(EXPENSE_NOTE_MESSAGE);
    if (body.kind != null && !CASH_KINDS.includes(body.kind)) throw bad(EXPENSE_KIND_MESSAGE);
    const e: MockExpense = {
      id: uid(),
      amount: body.amount,
      note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
      kind: body.kind === 'kirim' ? 'kirim' : 'chiqim',
      cashierId: actor.id,
      cashierName: actor.name,
      createdAt: nowIso(),
    };
    expenses.push(e);
    return ok(expenseView(e));
  }
  // Xato kiritilgan yozuvni o'chirish — faqat direktor (kassa hisobiga ta'sir qiladi)
  if (seg[1] && !seg[2] && method === 'DELETE') {
    if (!isFullAccessRole(actor.role)) throw forbidden();
    if (!expenses.some((e) => e.id === seg[1])) throw notFound(EXPENSE_NOT_FOUND_MESSAGE);
    expenses = expenses.filter((e) => e.id !== seg[1]);
    return ok({ ok: true });
  }
  return fail(`Mock: yo‘l topilmadi (${method} ${path})`, 404);
}

// ---- Qarz qaytarish (B34): POST /debts/:paymentId/repay {type} ----
function debtsRoute(method: string, seg: string[], body: any, actor: MockUser): Promise<unknown> {
  if (!(seg[1] && seg[2] === 'repay' && !seg[3] && method === 'POST')) {
    return fail(`Mock: yo‘l topilmadi (${method} /${seg.join('/')})`, 404);
  }
  // So'rov tekshiruvi -> ruxsat (kassir yoki administrator / direktor) -> qoidalar (server tartibi)
  if (body.type != null && (typeof body.type !== 'string' || body.type.length > 32)) throw bad(PAYMENT_TYPE_INVALID_MESSAGE);
  if (!(can(actor, 'cashier') || isAdminRole(actor))) throw forbidden();
  const methods = paymentMethods();
  // Qaytarish usuli — FAOL va qarz bo'lmagan usul (naqd, karta, Click…)
  const key = typeof body.type === 'string' ? body.type.trim() : '';
  const repayMethod = methods.find((m) => m.key === key);
  if (!repayMethod || !repayMethod.active || repayMethod.kind === 'debt') throw bad(PAYMENT_TYPE_INVALID_MESSAGE);
  const p = payments.find((x) => x.id === seg[1]);
  if (!p) throw notFound(DEBT_NOT_FOUND_MESSAGE);
  if (!debtKeys(methods).includes(p.type)) throw bad(DEBT_NOT_DEBT_MESSAGE);
  if (p.debtRepaidAt) throw bad(DEBT_ALREADY_REPAID_MESSAGE);
  if (orders.find((o) => o.id === p.orderId)?.refunded) throw bad(DEBT_REFUNDED_MESSAGE);
  p.debtRepaidAt = nowIso();
  p.debtRepaidBy = actor.id;
  p.debtRepaidType = repayMethod.key;
  return ok(debtRow(p));
}
