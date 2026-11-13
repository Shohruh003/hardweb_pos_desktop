// Mock (soxta) rejim — prezentatsiya (DEMO o'rnatuvchisi, Netlify) uchun. Serversiz, in-memory
// ma'lumotlar bilan barcha ekranlar ishlaydi; real-time (KDS/navbat) ham simulyatsiya qilinadi.
// Bu modul FAQAT VITE_MOCK=1 bo'lganda api.ts tomonidan dinamik yuklanadi — real buildda
// bajarilmaydi. Ma'lumotlar birinchi so'rovda yaratiladi (lazy seed).
// Qoidalar va xato matnlari real server bilan bir xil saqlanadi (demo real xatolarni yashirmasin).
import {
  ALL_CAPABILITY_KEYS,
  MenuUnit,
  OrderStatus,
  OrderItemStatus,
  PaymentType,
  ProductUnit,
  SETTABLE_ORDER_STATUSES,
  SOCKET_EVENTS,
  TableStatus,
  UserRole,
  calcOrderTotals,
  canChangeOrderStatus,
  clampPercent,
  hasCapability,
  isFullAccessRole,
  lineSum,
  remainingAmount,
  roundSum,
  sumPayments,
} from '@hardweb-pos/shared';
import type { User } from '@hardweb-pos/shared';
import { mockEmit as emit } from './socket';

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

// ---- Turlar ----
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
  id: string; orderId: string; menuItemId: string; menuItemName: string;
  price: number; quantity: number; unit: MenuUnit; note: string | null; status: OrderItemStatus;
  exciseRequired: boolean; exciseCode: string | null;
  stationId: string | null; stationName: string | null;
}
interface MockOrder {
  id: string; tableId: string; tableNumber: number; hall: string | null; waiterId: string; waiterName: string;
  status: OrderStatus; openedAt: string; closedAt: string | null;
  queueNumber: number | null; items: MockItem[];
  subtotal: number; total: number; // DTO: total = subtotal = Σ lineSum (yakuniy summa faqat to'lov javobida)
  note?: string | null;
  discountPercent?: number; servicePercent?: number;
  customerId?: string | null; customerName?: string | null;
  refunded?: boolean; refundReason?: string | null; refundedAt?: string | null;
}
interface MockCustomer { id: string; name: string; phone: string; note: string | null; createdAt: string }
interface MockPayment { id: string; orderId: string; amount: number; type: PaymentType; cashierId: string; createdAt: string }
interface MockTable { id: string; number: number; hall: string; capacity: number; status: TableStatus }
interface MockRole { key: string; label: string; description: string; panel: string; builtin: boolean }

// ---- Xotiradagi "baza" (ensureSeeded() birinchi so'rovda to'ldiradi) ----
let seeded = false;
let categories: { id: string; name: string; sortOrder: number }[] = [];
// Bo'limlar (sexlar) — chekni printerlarga yo'naltirish uchun
let stations: any[] = [];
let menu: any[] = [];
let tables: MockTable[] = [];
let products: any[] = [];
// recipe_items: { id, menuItemId, productId, amount } — 1 birlik taomga
let recipeItems: any[] = [];
// Kirimlar (ta'minot) tarixi
let purchases: any[] = [];
let supplierPayments: { id: string; supplier: string; amount: number; note: string | null; createdAt: string }[] = [];
let users: MockUser[] = [];
let settings = {
  id: 'main',
  restaurantName: 'DasturXon',
  telegramToken: '',
  telegramChatId: '',
  dailyReportTime: '23:59',
};
let terminals: any[] = [];
let expenses: any[] = [];
// Rollar registri (admin CRUD qiladi). Har rol qaysi panelga kirishini belgilaydi.
let roles: MockRole[] = [];
let orders: MockOrder[] = [];
let customers: MockCustomer[] = [];
let payments: MockPayment[] = [];
let fiscalCounter = 0;

const A_CAPS = ['history', 'reports', 'menu', 'inventory', 'stations', 'tables', 'staff', 'devices', 'terminals', 'settings', 'refund', 'cashier', 'revenue'];

function ensureSeeded(): void {
  if (seeded) return;
  seeded = true;

  categories = [
    { id: uid(), name: 'Issiq taomlar', sortOrder: 1 },
    { id: uid(), name: 'Salatlar', sortOrder: 2 },
    { id: uid(), name: 'Ichimliklar', sortOrder: 3 },
  ];
  stations = [
    { id: uid(), name: 'Oshxona', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 1 },
    { id: uid(), name: 'Bar', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 2 },
    { id: uid(), name: 'Somsaxona', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 3 },
    { id: uid(), name: 'Novvoyxona', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 4 },
  ];
  const stId = (n: string) => stations.find((s) => s.name === n)?.id ?? null;

  menu = [
    { id: uid(), name: 'Osh', price: 35000, categoryId: categories[0].id, available: true, exciseRequired: false, image: null, unit: MenuUnit.Piece },
    { id: uid(), name: 'Lag‘mon', price: 32000, categoryId: categories[0].id, available: true, exciseRequired: false, image: null, unit: MenuUnit.Piece },
    { id: uid(), name: 'Shashlik', price: 28000, categoryId: categories[0].id, available: true, exciseRequired: false, image: null, unit: MenuUnit.Piece },
    { id: uid(), name: 'Qovurilgan go‘sht', price: 200000, categoryId: categories[0].id, available: true, exciseRequired: false, image: null, unit: MenuUnit.Weight },
    { id: uid(), name: 'Achchiq-chuchuk', price: 18000, categoryId: categories[1].id, available: true, exciseRequired: false, image: null, unit: MenuUnit.Piece },
    { id: uid(), name: 'Sezar', price: 30000, categoryId: categories[1].id, available: true, exciseRequired: false, image: null, unit: MenuUnit.Piece },
    { id: uid(), name: 'Choy', price: 8000, categoryId: categories[2].id, available: true, exciseRequired: false, image: null, unit: MenuUnit.Piece },
    { id: uid(), name: 'Coca-Cola', price: 12000, categoryId: categories[2].id, available: true, exciseRequired: false, image: null, unit: MenuUnit.Piece },
    { id: uid(), name: 'Pivo (0.5)', price: 22000, categoryId: categories[2].id, available: true, exciseRequired: true, image: null, unit: MenuUnit.Piece },
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

  // Sklad (ombor): mahsulotlar + retseptlar
  products = [
    { id: uid(), name: 'Guruch', unit: ProductUnit.Kg, stock: 50, minStock: 10 },
    { id: uid(), name: 'Go‘sht (mol)', unit: ProductUnit.Kg, stock: 30, minStock: 8 },
    { id: uid(), name: 'Sabzi', unit: ProductUnit.Kg, stock: 25, minStock: 5 },
    { id: uid(), name: 'Piyoz', unit: ProductUnit.Kg, stock: 20, minStock: 5 },
    { id: uid(), name: 'Yog‘', unit: ProductUnit.Litr, stock: 15, minStock: 3 },
    { id: uid(), name: 'Un', unit: ProductUnit.Kg, stock: 40, minStock: 10 },
  ];
  const prodId = (name: string) => products.find((p) => p.name === name)!.id;
  recipeItems = [];
  const addRecipe = (menuIdx: number, lines: [string, number][]) => {
    const mid = menu[menuIdx]?.id;
    if (!mid) return;
    lines.forEach(([pname, amount]) =>
      recipeItems.push({ id: uid(), menuItemId: mid, productId: prodId(pname), amount }),
    );
  };
  // menu: 0 Osh, 1 Lag'mon, 3 Qovurilgan go'sht (kg)
  addRecipe(0, [['Guruch', 0.2], ['Go‘sht (mol)', 0.15], ['Sabzi', 0.1], ['Yog‘', 0.05]]);
  addRecipe(1, [['Un', 0.15], ['Go‘sht (mol)', 0.1], ['Sabzi', 0.1]]);
  addRecipe(3, [['Go‘sht (mol)', 1], ['Yog‘', 0.05], ['Piyoz', 0.1]]);
  purchases = [];
  supplierPayments = [];

  // Real seed bilan bir xil xodimlar (ism, PIN, ruxsatlar); demo paroli hammada '1234'
  const u = (n: number, name: string, role: UserRole, login: string, pin: string, permissions: string[]): MockUser => ({
    id: demoUserId(n), name, role, login, pin, active: true, permissions, password: '1234', mustChangePassword: false,
  });
  users = [
    u(1, 'Aziz Karimov', UserRole.Waiter, 'ofitsiant', '1111', ['waiter']),
    u(2, 'Kamola Yusupova', UserRole.Waiter, 'kamola', '2222', ['waiter']),
    u(3, 'Jasur Rahimov', UserRole.Waiter, 'jasur', '3333', ['waiter']),
    u(4, 'Nodira Salimova', UserRole.Waiter, 'nodira', '4444', ['waiter']),
    u(5, 'Bekzod Toshev', UserRole.Cook, 'oshpaz', '5555', ['kitchen']),
    u(6, 'Dilnoza Ergasheva', UserRole.Cashier, 'kassir', '1234', ['cashier', 'history', 'revenue']),
    u(7, 'Malika Nazarova', UserRole.Cashier, 'kassir2', '4321', ['cashier']),
    u(8, 'Sardor Admin', UserRole.Admin, 'admin', '9999', [...A_CAPS]),
    u(9, 'Direktor', UserRole.Director, 'direktor', '0000', []),
    u(10, 'Super Admin (vendor)', UserRole.SuperAdmin, 'superadmin', '7777', []),
  ];

  // Demo uchun: sozlamalar, terminallar, rasxodlar (in-memory)
  settings = { id: 'main', restaurantName: 'DasturXon', telegramToken: '', telegramChatId: '', dailyReportTime: '23:59' };
  terminals = [
    { id: uid(), name: 'Kassa 1', hall: 'Asosiy zal', note: null },
    { id: uid(), name: 'Ofitsiant terminali', hall: 'VIP zal', note: null },
  ];
  expenses = [];
  roles = [
    { key: UserRole.Waiter, label: 'Ofitsiant', description: 'Buyurtma qabul qilish', panel: 'ofitsiant', builtin: true },
    { key: UserRole.Cook, label: 'Oshpaz', description: 'Oshxona ekrani (KDS)', panel: 'oshpaz', builtin: true },
    { key: UserRole.Cashier, label: 'Kassir', description: 'To‘lov va chek', panel: 'kassir', builtin: true },
    { key: UserRole.Admin, label: 'Administrator', description: 'Tizimni boshqarish', panel: 'administrator', builtin: true },
    { key: UserRole.Director, label: 'Direktor', description: 'Hisobotlar', panel: 'direktor', builtin: true },
  ];
  orders = [];
  customers = [
    { id: uid(), name: 'Aziz Karimov', phone: '+998 90 123 45 67', note: 'Doimiy mijoz', createdAt: new Date().toISOString() },
    { id: uid(), name: 'Dilnoza Yusupova', phone: '+998 91 234 56 78', note: null, createdAt: new Date().toISOString() },
  ];
  payments = [];
  fiscalCounter = 0;

  seedOrders();
}

// Prezentatsiya uchun bir nechta tayyor ma'lumot: 2 ta faol + 3 ta yopilgan (hisobot uchun)
function seedOrders(): void {
  const waiter = users[0];
  const cashier = users.find((x) => x.role === UserRole.Cashier)!;
  const newOrder = (table: MockTable, status: OrderStatus): MockOrder => ({
    id: uid(), tableId: table.id, tableNumber: table.number, hall: table.hall, waiterId: waiter.id, waiterName: waiter.name,
    status, openedAt: new Date().toISOString(), closedAt: null, queueNumber: null, items: [], subtotal: 0, total: 0,
  });

  // Faol buyurtmalar (KDS va kassada ko'rinadi)
  const o1 = newOrder(tables[0], OrderStatus.Cooking);
  o1.items = [makeItem(o1.id, menu[0].id, 2), makeItem(o1.id, menu[5].id, 2)];
  recalc(o1);
  tables[0].status = TableStatus.Busy;

  const o2 = newOrder(tables[6], OrderStatus.Accepted);
  o2.items = [makeItem(o2.id, menu[2].id, 1), makeItem(o2.id, menu[4].id, 1)];
  recalc(o2);
  tables[6].status = TableStatus.Busy;

  orders.push(o1, o2);

  // Yopilgan buyurtmalar — direktor hisobotini to'ldirish uchun
  const closedDefs: { items: [number, number][]; type: PaymentType }[] = [
    { items: [[0, 3], [5, 3]], type: PaymentType.Cash },
    { items: [[1, 2], [6, 2]], type: PaymentType.Card },
    { items: [[2, 2], [4, 1]], type: PaymentType.QR },
  ];
  closedDefs.forEach((def, i) => {
    const o = newOrder(tables[i + 1], OrderStatus.Closed);
    o.closedAt = new Date().toISOString();
    o.items = def.items.map(([mi, q]) => makeItem(o.id, menu[mi].id, q));
    recalc(o);
    orders.push(o);
    payments.push({ id: uid(), orderId: o.id, amount: o.total, type: def.type, cashierId: cashier.id, createdAt: new Date().toISOString() });
  });
}

// ---- Yordamchilar ----
type MockError = Error & { status: number };
const ok = (data: any) => Promise.resolve(data);
const fail = (message: string, status = 400) =>
  Promise.reject(Object.assign(new Error(message), { status }) as MockError);
const FORBIDDEN = 'Bu amal uchun ruxsat yo‘q';
const forbidden = () => fail(FORBIDDEN, 403);
const notFound = (message = 'Buyurtma topilmadi') => fail(message, 404);
const PAID_ORDER_MESSAGE = 'Bu hisobda to‘lov bor — avval to‘lovlarni o‘chiring';

// ---- Kirish urinishlarini cheklash — real server LoginThrottle bilan bir xil ----
// 60 soniya ichida 5 ta noto'g'ri urinish -> 60 soniya 429; muvaffaqiyatli kirish hisoblagichni
// nolga tushiradi. Demo bitta brauzerda ishlaydi, shuning uchun "IP" o'rniga bitta hisoblagich.
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

/**
 * Tarix qatoridagi to'lov turi (server mainPaymentType bilan bir xil): filtr qo'yilgan bo'lsa —
 * o'sha tur; aks holda eng ko'p summa to'langan tur; teng bo'lsa — birinchi to'lov turi.
 */
function mainPaymentType(pays: MockPayment[], preferred?: string | null): PaymentType {
  if (preferred && pays.some((p) => p.type === preferred)) return preferred as PaymentType;
  const byType = new Map<PaymentType, number>();
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
    permissions: isFullAccessRole(u.role) ? [...ALL_CAPABILITY_KEYS] : [...(u.permissions ?? [])],
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
    permissions: [...(u.permissions ?? [])],
    hasPassword: !!u.password,
    mustChangePassword: !!u.mustChangePassword,
  };
}

// ---- Xodimlar: real UsersService / DTO qoidalari va matnlari bilan bir xil ----
const MANAGER_ROLES: string[] = [UserRole.Admin, UserRole.Director, UserRole.SuperAdmin];
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
/** Qiymat berilganmi: undefined, null va bo'sh satr — "berilmagan" (server isGiven) */
const isGiven = (v: unknown) => v !== undefined && v !== null && v !== '';
const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

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

function makeItem(orderId: string, menuItemId: string, quantity: number, note?: string): MockItem {
  const mi = menu.find((m) => m.id === menuItemId)!;
  const st = mi.stationId ? stations.find((s) => s.id === mi.stationId) : null;
  return {
    id: uid(), orderId, menuItemId, menuItemName: mi.name, price: Number(mi.price),
    quantity: Number(quantity), unit: mi.unit ?? MenuUnit.Piece, note: note ?? null, status: OrderItemStatus.Pending,
    exciseRequired: !!mi.exciseRequired, exciseCode: null,
    stationId: mi.stationId ?? null, stationName: st?.name ?? null,
  };
}

/** Buyurtma summasi — har qator butun so'mga yaxlitlanadi (shared/money) */
function recalc(o: MockOrder): void {
  const subtotal = o.items.reduce((s, it) => s + lineSum(it.price, it.quantity), 0);
  o.subtotal = subtotal;
  o.total = subtotal;
}
const orderPayments = (orderId: string) => payments.filter((p) => p.orderId === orderId);
const paymentRows = (orderId: string) =>
  orderPayments(orderId).map((p) => ({ id: p.id, type: p.type, amount: p.amount, createdAt: p.createdAt }));
const hallOf = (tableId: string): string | null => tables.find((t) => t.id === tableId)?.hall ?? null;
const findOrder = (id: string | undefined) => orders.find((x) => x.id === id);
// Real server emitOrderUpdated bilan bir xil yuk
const emitUpdated = (o: MockOrder | Record<string, any>) =>
  emit(SOCKET_EVENTS.ORDER_UPDATED, { orderId: o.id, status: o.status, order: o });

// Taom(lar) sotilganda mahsulotlarni skladdan ayirish
function deductStock(items: { menuItemId: string; quantity: number }[]) {
  items.forEach((it) => {
    recipeItems
      .filter((r) => r.menuItemId === it.menuItemId)
      .forEach((r) => {
        const p = products.find((x) => x.id === r.productId);
        if (p) p.stock = Number(p.stock) - Number(r.amount) * Number(it.quantity);
      });
  });
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
    if (needed > available + 1e-6) {
      const av = Math.max(0, Math.round(available * 1000) / 1000);
      return `Omborda yetarli emas: ${p.name} — mavjud ${av} ${p.unit}`;
    }
  }
  return null;
}

function periodStart(period: string): number {
  const now = new Date();
  if (period === 'week') return now.getTime() - 7 * 864e5;
  if (period === 'month') return now.getTime() - 30 * 864e5;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// Buyurtmani o'chirish (annul) — stol bo'shaydi, ro'yxatlardan "yopildi" hodisasi bilan olinadi
function removeOrder(o: MockOrder): MockOrder {
  const i = orders.findIndex((x) => x.id === o.id);
  if (i >= 0) orders.splice(i, 1);
  const table = tables.find((t) => t.id === o.tableId);
  if (table) table.status = TableStatus.Free;
  emit(SOCKET_EVENTS.ORDER_CLOSED, { order: o });
  return o;
}

// ---- Asosiy router ----
export function mockRequest<T>(method: string, fullPath: string, body?: any, token?: string | null): Promise<T> {
  ensureSeeded();
  const [path, query] = fullPath.split('?');
  const params = new URLSearchParams(query || '');
  const period = params.get('period') || 'day';
  const seg = path.split('/').filter(Boolean); // masalan ['orders','<id>','pay']
  body = body ?? {}; // tanasiz so'rovlar (cancel, request-bill...) uchun

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

  // Settings (demo)
  if (path === '/settings' && method === 'GET') return ok({ ...settings });
  if (path === '/settings' && method === 'PATCH') {
    Object.assign(settings, body);
    return ok({ ...settings });
  }
  if (seg[0] === 'settings' && (seg[1] === 'telegram-test' || seg[1] === 'telegram-report' || seg[1] === 'telegram-detect')) {
    return ok({ ok: true, chatId: settings.telegramChatId || '123456789' });
  }

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

  // Rasxodlar (demo)
  if (path === '/expenses' && method === 'GET') {
    const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
    return ok({ items: [...expenses].reverse(), total });
  }
  if (path === '/expenses' && method === 'POST') {
    const e = { id: uid(), amount: roundSum(body.amount), note: body.note ?? null, cashierName: actor.name, createdAt: new Date().toISOString() };
    expenses.push(e); return ok(e);
  }

  // Tables
  if (path === '/tables' && method === 'GET') return ok([...tables]);
  if (path === '/tables' && method === 'POST') {
    const t: MockTable = { id: uid(), number: body.number, hall: body.hall, capacity: body.capacity || 4, status: TableStatus.Free };
    tables.push(t); return ok(t);
  }
  if (seg[0] === 'tables' && seg[1] && method === 'PATCH') {
    const t = tables.find((x) => x.id === seg[1]); if (t) Object.assign(t, body); return ok(t);
  }
  if (seg[0] === 'tables' && seg[1] && method === 'DELETE') {
    const i = tables.findIndex((x) => x.id === seg[1]); if (i >= 0) tables.splice(i, 1); return ok({ ok: true });
  }

  // Menu
  if (path === '/menu/categories' && method === 'GET') return ok([...categories]);
  if (path === '/menu/categories' && method === 'POST') {
    const c = { id: uid(), name: body.name, sortOrder: body.sortOrder || categories.length + 1 };
    categories.push(c); return ok(c);
  }
  if (path === '/menu/items' && method === 'GET') return ok(menu.filter((m) => m.available));
  if (path === '/menu/all-items' && method === 'GET') return ok([...menu]);
  if (path === '/menu/items' && method === 'POST') {
    const m = { id: uid(), name: body.name, price: body.price, categoryId: body.categoryId, available: true, exciseRequired: !!body.exciseRequired, image: body.image ?? null, unit: body.unit ?? MenuUnit.Piece, stationId: body.stationId ?? null, favorite: !!body.favorite };
    menu.push(m); return ok(m);
  }
  if (seg[0] === 'menu' && seg[1] === 'items' && seg[2] && method === 'PATCH') {
    const m = menu.find((x) => x.id === seg[2]); if (m) Object.assign(m, body); return ok(m);
  }
  if (seg[0] === 'menu' && seg[1] === 'items' && seg[2] && method === 'DELETE') {
    const i = menu.findIndex((x) => x.id === seg[2]); if (i >= 0) menu.splice(i, 1); return ok({ ok: true });
  }
  if (seg[0] === 'menu' && seg[1] === 'categories' && seg[2] && method === 'PATCH') {
    const c = categories.find((x) => x.id === seg[2]); if (c) Object.assign(c, body); return ok(c);
  }
  if (seg[0] === 'menu' && seg[1] === 'categories' && seg[2] && method === 'DELETE') {
    const i = categories.findIndex((x) => x.id === seg[2]); if (i >= 0) categories.splice(i, 1); return ok({ ok: true });
  }

  // Bo'limlar (sexlar)
  if (path === '/stations' && method === 'GET') return ok([...stations].sort((a, b) => a.sortOrder - b.sortOrder));
  if (path === '/stations' && method === 'POST') {
    const st = { id: uid(), name: body.name, printerHost: body.printerHost ?? '', printerPort: body.printerPort ?? 9100, printerWidth: body.printerWidth ?? 48, sortOrder: body.sortOrder ?? stations.length + 1 };
    stations.push(st); return ok(st);
  }
  // Bo'lim printerini sinash — demo'da printer yo'q: IP kiritilgan bo'lsa muvaffaqiyatli deb olinadi,
  // IP bo'sh bo'lsa real server kabi "sozlanmagan"
  if (seg[0] === 'stations' && seg[1] && seg[2] === 'test-print' && method === 'POST') {
    if (!isManager) return forbidden();
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

  // Sklad (ombor)
  if (path === '/inventory/products' && method === 'GET') return ok([...products]);
  if (path === '/inventory/products' && method === 'POST') {
    const p = { id: uid(), name: body.name, unit: body.unit ?? ProductUnit.Kg, stock: Number(body.stock) || 0, minStock: Number(body.minStock) || 0 };
    products.push(p); return ok(p);
  }
  if (seg[0] === 'inventory' && seg[1] === 'products' && seg[2] && seg[3] === 'adjust' && method === 'POST') {
    const p = products.find((x) => x.id === seg[2]);
    if (p) p.stock = Number(p.stock) + Number(body.delta || 0);
    return ok(p);
  }
  if (seg[0] === 'inventory' && seg[1] === 'products' && seg[2] && method === 'PATCH') {
    const p = products.find((x) => x.id === seg[2]); if (p) Object.assign(p, body); return ok(p);
  }
  if (seg[0] === 'inventory' && seg[1] === 'products' && seg[2] && method === 'DELETE') {
    const i = products.findIndex((x) => x.id === seg[2]); if (i >= 0) products.splice(i, 1);
    // Bog'liq retseptlarni ham o'chiramiz
    for (let k = recipeItems.length - 1; k >= 0; k--) if (recipeItems[k].productId === seg[2]) recipeItems.splice(k, 1);
    return ok({ ok: true });
  }
  if (path === '/inventory/purchases' && method === 'GET') {
    const pid = params.get('productId');
    const list = pid ? purchases.filter((p) => p.productId === pid) : purchases;
    return ok([...list].reverse());
  }
  if (path === '/inventory/supplier-balances' && method === 'GET') {
    const m = new Map<string, { supplier: string; purchased: number; paid: number; count: number }>();
    const g = (name: string) => {
      const key = (name || '').trim() || '—';
      let c = m.get(key);
      if (!c) { c = { supplier: key, purchased: 0, paid: 0, count: 0 }; m.set(key, c); }
      return c;
    };
    for (const p of purchases) { const c = g(p.supplier); c.purchased += Number(p.total); c.count += 1; }
    for (const pay of supplierPayments) { g(pay.supplier).paid += Number(pay.amount); }
    return ok([...m.values()].map((c) => ({ ...c, debt: c.purchased - c.paid })).sort((a, b) => b.debt - a.debt));
  }
  if (path === '/inventory/supplier-payments' && method === 'POST') {
    const pay = { id: uid(), supplier: (body.supplier || '').trim(), amount: Number(body.amount) || 0, note: body.note?.trim() || null, createdAt: new Date().toISOString() };
    supplierPayments.push(pay);
    return ok(pay);
  }
  if (path === '/inventory/purchases' && method === 'POST') {
    const p = products.find((x) => x.id === body.productId);
    if (!p) return fail('Mahsulot topilmadi');
    const quantity = Number(body.quantity) || 0;
    const unitPrice = Number(body.unitPrice) || 0;
    if (quantity <= 0) return fail('Miqdor 0 dan katta bo‘lishi kerak');
    const pur = {
      id: uid(), productId: p.id, productName: p.name, unit: p.unit,
      supplier: (body.supplier || '').trim(), quantity, unitPrice,
      total: Math.round(quantity * unitPrice * 100) / 100,
      note: body.note?.trim() || null, createdAt: new Date().toISOString(),
    };
    purchases.push(pur);
    p.stock = Number(p.stock) + quantity;
    return ok(pur);
  }
  if (path === '/inventory/returns' && method === 'POST') {
    const p = products.find((x) => x.id === body.productId);
    if (!p) return fail('Mahsulot topilmadi');
    const quantity = Number(body.quantity) || 0;
    const unitPrice = Number(body.unitPrice) || 0;
    if (quantity <= 0) return fail('Miqdor 0 dan katta bo‘lishi kerak');
    const ret = {
      id: uid(), productId: p.id, productName: p.name, unit: p.unit,
      supplier: (body.supplier || '').trim(), quantity: -quantity, unitPrice,
      total: -(Math.round(quantity * unitPrice * 100) / 100),
      note: '↩️ Vozvrat', createdAt: new Date().toISOString(),
    };
    purchases.push(ret);
    p.stock = Number(p.stock) - quantity;
    return ok(ret);
  }
  if (seg[0] === 'inventory' && seg[1] === 'recipe' && seg[2] && method === 'GET') {
    const rows = recipeItems.filter((r) => r.menuItemId === seg[2]).map((r) => {
      const p = products.find((x) => x.id === r.productId);
      return { ...r, productName: p?.name, productUnit: p?.unit };
    });
    return ok(rows);
  }
  if (seg[0] === 'inventory' && seg[1] === 'recipe' && seg[2] && method === 'PUT') {
    for (let k = recipeItems.length - 1; k >= 0; k--) if (recipeItems[k].menuItemId === seg[2]) recipeItems.splice(k, 1);
    (body.items || []).filter((i: any) => i.productId && Number(i.amount) > 0).forEach((i: any) =>
      recipeItems.push({ id: uid(), menuItemId: seg[2], productId: i.productId, amount: Number(i.amount) }),
    );
    return ok(recipeItems.filter((r) => r.menuItemId === seg[2]));
  }

  // Rollar CRUD (faqat demo registri)
  if (path === '/roles' && method === 'GET') return ok([...roles]);
  if (path === '/roles' && method === 'POST') {
    const r: MockRole = { key: 'role-' + uid().slice(0, 6), label: body.label, description: body.description || '', panel: body.panel || 'ofitsiant', builtin: false };
    roles.push(r); return ok(r);
  }
  if (seg[0] === 'roles' && seg[1] && method === 'PATCH') {
    const r = roles.find((x) => x.key === seg[1]); if (r && !r.builtin) Object.assign(r, body); else if (r) r.description = body.description ?? r.description; return ok(r);
  }
  if (seg[0] === 'roles' && seg[1] && method === 'DELETE') {
    const i = roles.findIndex((x) => x.key === seg[1]); if (i >= 0 && !roles[i].builtin) roles.splice(i, 1); return ok({ ok: true });
  }

  // ---- Xodimlar ----
  if (path === '/users/waiters' && method === 'GET') {
    return ok(
      users
        .filter((x) => x.role === UserRole.Waiter && x.active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((x) => ({ id: x.id, name: x.name, role: x.role, login: x.login, active: x.active })),
    );
  }
  // Tartib server bilan bir xil: rol guard (403) -> DTO tekshiruvi (400) -> xizmat qoidalari
  if (seg[0] === 'users' && !isManager) return forbidden();
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
    if (!hierarchyAllows(actor, null, role)) return forbidden();
    if ((login || password) && !isFullAccessRole(actor.role)) return forbidden();
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
    const created: MockUser = {
      id: uid(), name: String(trimmed(body.name)), role, login, pin, active: true,
      permissions: normalizePermissions(body.permissions),
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
    if (!target) return notFound('Xodim topilmadi');
    const actorFull = isFullAccessRole(actor.role);
    const isSelf = target.id === actor.id;

    // Nima o'zgaryapti? (UI o'zgarmagan maydonlarni ham yuboradi — faqat haqiqiy o'zgarish hisoblanadi)
    const nextRole: UserRole = body.role ?? target.role;
    const roleChanged = body.role !== undefined && body.role !== target.role;
    const deactivating = body.active === false && target.active;
    const currentPermissions = normalizePermissions(target.permissions);
    const nextPermissions = body.permissions !== undefined ? normalizePermissions(body.permissions) : null;
    const permissionsChanged = nextPermissions !== null && !samePermissions(nextPermissions, currentPermissions);
    const currentLogin = target.login ?? null;
    const loginGiven = body.login !== undefined;
    const nextLogin = loginGiven ? (isGiven(trimmed(body.login)) ? String(trimmed(body.login)) : null) : currentLogin;
    const loginChanged = loginGiven && nextLogin !== currentLogin;
    const newPassword = isGiven(body.password) ? String(body.password) : null;
    const newPin = isGiven(trimmed(body.pin)) ? String(trimmed(body.pin)) : null;
    const pinChanged = newPin !== null && newPin !== target.pin;

    // 1) Ruxsat (403)
    if (!hierarchyAllows(actor, target, nextRole)) return forbidden();
    if ((loginChanged || newPassword) && !actorFull) return forbidden();
    // Administrator o'ziga rol/ruxsat bera olmaydi
    if (isSelf && !actorFull && (roleChanged || permissionsChanged)) return forbidden();

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
    if (!hierarchyAllows(actor, target, target.role)) return forbidden();
    if (target.role === UserRole.Director && target.active && isLastActiveDirector()) return fail(LAST_DIRECTOR_MESSAGE);
    if (target.id === actor.id) return fail('O‘zingizni o‘chira olmaysiz');
    users.splice(users.indexOf(target), 1);
    return ok({ ok: true });
  }

  // Customers (CRM)
  if (path === '/customers' && method === 'GET') return ok([...customers]);
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
    return ok(c);
  }
  if (seg[0] === 'customers' && seg[1] && method === 'DELETE') {
    const i = customers.findIndex((x) => x.id === seg[1]);
    if (i >= 0) customers.splice(i, 1);
    return ok({ ok: true });
  }

  // ---- Buyurtmalar ----
  if (path === '/orders' && method === 'GET') return ok(orders.filter((o) => o.status !== OrderStatus.Closed));
  if (path === '/orders/history' && method === 'GET') {
    const wid = params.get('waiterId');
    const status = params.get('status');
    const paymentType = params.get('paymentType');
    const hall = params.get('hall');
    const search = params.get('search');
    const dateFrom = params.get('dateFrom');
    const dateTo = params.get('dateTo');
    const page = Math.max(1, Number(params.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.get('limit')) || 20));
    const time = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);

    let list = orders
      .map((o) => {
        const pays = orderPayments(o.id);
        return {
          ...o,
          hall: tables.find((t) => t.id === o.tableId)?.hall ?? o.hall ?? null,
          // Server kabi: to'lovi bor qatorda to'langan summa va asosiy to'lov turi
          ...(pays.length ? { paidAmount: sumPayments(pays), paymentType: mainPaymentType(pays, paymentType) } : {}),
        };
      })
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));

    if (wid) list = list.filter((o) => o.waiterId === wid);
    if (status) list = list.filter((o) => o.status === status);
    if (paymentType) list = list.filter((o) => orderPayments(o.id).some((p) => p.type === paymentType));
    if (hall) list = list.filter((o) => o.hall === hall);
    if (search) list = list.filter((o) => String(o.tableNumber ?? '').includes(search));
    if (dateFrom && !Number.isNaN(time(dateFrom))) list = list.filter((o) => time(o.openedAt) >= time(dateFrom));
    if (dateTo && !Number.isNaN(time(dateTo))) list = list.filter((o) => time(o.openedAt) <= time(dateTo));

    const total = list.length;
    const items = list.slice((page - 1) * limit, page * limit);
    return ok({ items, total, page, limit, hasMore: page * limit < total });
  }
  if (path === '/orders/print-receipt' && method === 'POST') {
    emit(SOCKET_EVENTS.PRINT_RECEIPT, { receipt: body });
    return ok({ ok: true });
  }
  if (seg[0] === 'orders' && seg[1] && !seg[2] && method === 'GET') {
    const o = findOrder(seg[1]);
    return o ? ok(o) : notFound();
  }
  if (path === '/orders' && method === 'POST') {
    const lines: { menuItemId: string; quantity: number; note?: string }[] = Array.isArray(body?.items) ? body.items : [];
    if (lines.length === 0) return fail('Buyurtma bo‘sh bo‘lishi mumkin emas');
    const table = tables.find((t) => t.id === body.tableId);
    if (!table) return notFound('Stol topilmadi');
    // Ombor yetarliligini tekshiramiz (ortiqcha sotishni oldini olish)
    const shortage = stockShortage(lines.map((i) => ({ menuItemId: i.menuItemId, quantity: Number(i.quantity) })));
    if (shortage) return fail(shortage);
    const unknown = lines.find((i) => !menu.some((m) => m.id === i.menuItemId));
    if (unknown) return fail(`Taom topilmadi: ${unknown.menuItemId}`);
    // Terminal tanlagan ofitsiant bo'lsa o'sha, aks holda kirgan foydalanuvchi (server kabi)
    const w = users.find((x) => x.id === body.waiterId) || actor;
    const cust = body.customerId ? customers.find((c) => c.id === body.customerId) : null;
    // Stolda ochiq buyurtma bo'lsa — yangi taomlarni o'shanga qo'shamiz (server kabi)
    const existing = orders.find((x) => x.tableId === body.tableId && x.status !== OrderStatus.Closed);
    if (existing) {
      existing.items.push(...lines.map((i) => makeItem(existing.id, i.menuItemId, i.quantity, i.note)));
      if (body.note !== undefined) existing.note = body.note?.trim() || null;
      if (cust) { existing.customerId = cust.id; existing.customerName = cust.name; }
      // Yangi taomlar tayyorlanishi kerak — buyurtma yana faollashadi
      if (existing.status === OrderStatus.Ready) existing.status = OrderStatus.Cooking;
      recalc(existing);
      emitUpdated(existing);
      return ok(existing);
    }
    const id = uid();
    const order: MockOrder = {
      id, tableId: table.id, tableNumber: table.number, hall: table.hall, waiterId: w.id, waiterName: w.name,
      status: OrderStatus.Accepted, openedAt: new Date().toISOString(), closedAt: null, queueNumber: null,
      note: body.note?.trim() || null,
      customerId: cust?.id ?? null, customerName: cust?.name ?? null,
      items: lines.map((i) => makeItem(id, i.menuItemId, i.quantity, i.note)), subtotal: 0, total: 0,
    };
    recalc(order);
    table.status = TableStatus.Busy;
    orders.push(order);
    emit(SOCKET_EVENTS.ORDER_CREATED, { order });
    return ok(order);
  }
  if (seg[0] === 'orders' && seg[2] === 'request-bill' && method === 'POST') {
    const o = findOrder(seg[1]);
    if (!o) return notFound();
    const table = tables.find((t) => t.id === o.tableId);
    if (table && table.status !== TableStatus.Free) table.status = TableStatus.AwaitingBill;
    emitUpdated(o);
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'note' && method === 'POST') {
    const o = findOrder(seg[1]);
    if (!o) return notFound();
    o.note = body.note?.trim() || null;
    emitUpdated(o);
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'customer' && method === 'POST') {
    const o = findOrder(seg[1]);
    if (!o) return notFound();
    const c = body.customerId ? customers.find((x) => x.id === body.customerId) : null;
    o.customerId = c?.id ?? null;
    o.customerName = c?.name ?? null;
    emitUpdated(o);
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'print-bill' && method === 'POST') {
    const o = findOrder(seg[1]);
    if (!o) return notFound();
    emit(SOCKET_EVENTS.PRINT_BILL, { order: { ...o, hall: o.hall ?? hallOf(o.tableId), waiterName: o.waiterName } });
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'remove-items' && method === 'POST') {
    const o = findOrder(seg[1]);
    if (!o) return notFound();
    if (o.status === OrderStatus.Closed) return fail('Yopilgan buyurtmani o‘zgartirib bo‘lmaydi');
    const ids = new Set<string>(Array.isArray(body?.itemIds) ? body.itemIds : []);
    const toRemove = o.items.filter((it) => ids.has(it.id));
    if (toRemove.length === 0) return ok(o);
    const remaining = o.items.filter((it) => !ids.has(it.id));
    const hasPayments = orderPayments(o.id).length > 0;
    if (remaining.length === 0) {
      // Hamma taom olib tashlandi — buyurtma bekor qilinadi (to'lov bo'lsa — mumkin emas)
      if (hasPayments) return fail(PAID_ORDER_MESSAGE);
      return ok(removeOrder(o));
    }
    // To'langan summadan kam qolmasligi kerak (aks holda hisobni yopib bo'lmaydi)
    const paid = sumPayments(orderPayments(o.id));
    if (calcOrderTotals(remaining, o.discountPercent, o.servicePercent).total < paid) {
      return fail('Qolgan summa to‘langan summadan kam bo‘lib qoladi');
    }
    o.items = remaining;
    recalc(o);
    emitUpdated(o);
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'cancel' && method === 'POST') {
    const o = findOrder(seg[1]);
    if (!o) return notFound();
    if (o.status === OrderStatus.Closed) return fail('To‘langan chekni bekor qilib bo‘lmaydi (vozvrat qiling)');
    if (orderPayments(o.id).length > 0) return fail(PAID_ORDER_MESSAGE);
    return ok(removeOrder(o));
  }
  if (seg[0] === 'orders' && seg[2] === 'move-table' && method === 'POST') {
    const o = findOrder(seg[1]);
    if (!o) return notFound();
    if (o.status === OrderStatus.Closed) return fail('Yopilgan buyurtmani ko‘chirib bo‘lmaydi');
    const newTable = tables.find((t) => t.id === body.tableId);
    if (o.tableId === body.tableId) return ok(o);
    if (!newTable) return notFound('Yangi stol topilmadi');
    const busyByOther = orders.find((x) => x.tableId === newTable.id && x.status !== OrderStatus.Closed);
    if (busyByOther) return fail('Bu stol band — avval uni bo‘shating');
    const oldTable = tables.find((t) => t.id === o.tableId);
    if (oldTable) oldTable.status = TableStatus.Free;
    o.tableId = newTable.id;
    o.tableNumber = newTable.number;
    o.hall = newTable.hall;
    newTable.status = TableStatus.Busy;
    emitUpdated(o);
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'change-waiter' && method === 'POST') {
    const o = findOrder(seg[1]);
    if (!o) return notFound();
    const w = users.find((x) => x.id === body.waiterId);
    if (!w) return notFound('Ofitsiant topilmadi');
    o.waiterId = w.id;
    o.waiterName = w.name;
    emitUpdated(o);
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'status' && method === 'PATCH') {
    const o = findOrder(seg[1]);
    if (!o) return notFound();
    const next = body?.status;
    // Faqat oshxona holatlari (yopish — faqat to'liq to'lov orqali)
    if (!(SETTABLE_ORDER_STATUSES as string[]).includes(next)) return fail('Noto‘g‘ri buyurtma holati');
    if (!canChangeOrderStatus(o.status, next)) return fail('Yopilgan buyurtma holatini o‘zgartirib bo‘lmaydi');
    o.status = next;
    if (next === OrderStatus.Ready) o.items.forEach((it) => (it.status = OrderItemStatus.Ready));
    emitUpdated(o);
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'refund' && method === 'POST') {
    if (!hasCapability(sessionUser(actor), 'refund')) return fail('Vozvrat qilish ruxsati yo‘q', 403);
    const o = findOrder(seg[1]);
    if (!o) return notFound();
    if (o.status !== OrderStatus.Closed) return fail('Faqat to‘langan (yopilgan) chek qaytariladi');
    if (o.refunded) return fail('Bu chek allaqachon qaytarilgan');
    o.refunded = true;
    o.refundReason = String(body?.reason ?? '').trim() || null;
    o.refundedAt = new Date().toISOString();
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'excise' && method === 'POST') {
    const o = findOrder(seg[1]);
    if (!o) return notFound();
    (body.codes || []).forEach((c: any) => {
      const it = o.items.find((x) => x.id === c.orderItemId); if (it) it.exciseCode = c.code;
    });
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'payments' && seg[3] && method === 'DELETE') {
    // Qisman to'lovni bekor qilish (chek yopilmagan bo'lsa) — faqat kassa ruxsati bilan
    if (!hasCapability(sessionUser(actor), 'cashier')) return forbidden();
    const o = findOrder(seg[1]);
    if (!o) return notFound();
    if (o.status === OrderStatus.Closed) return fail('Yopilgan chek to‘lovini o‘chirib bo‘lmaydi');
    const idx = payments.findIndex((p) => p.id === seg[3] && p.orderId === o.id);
    if (idx >= 0) payments.splice(idx, 1);
    const dto = { ...o, paidAmount: sumPayments(orderPayments(o.id)) };
    emitUpdated(dto);
    return ok(dto);
  }
  if (seg[0] === 'orders' && seg[2] === 'payments' && method === 'GET') {
    return ok(paymentRows(seg[1]));
  }
  if (seg[0] === 'orders' && seg[2] === 'pay' && method === 'POST') {
    // To'lov — faqat kassa ruxsati bor xodim
    if (!hasCapability(sessionUser(actor), 'cashier')) return forbidden();
    const o = findOrder(seg[1]);
    if (!o) return notFound();
    if (o.status === OrderStatus.Closed) return fail('Hisob allaqachon yopilgan');
    const missing = o.items.filter((it) => it.exciseRequired && !it.exciseCode);
    if (missing.length) return fail(`Aksiz kodi skanerlanmagan: ${missing.map((m) => m.menuItemName).join(', ')}`);
    if (body.discountPercent != null) o.discountPercent = clampPercent(body.discountPercent);
    if (body.serviceFeePercent != null) o.servicePercent = clampPercent(body.serviceFeePercent);
    // Summalar — shared/money (server bilan bir xil, butun so'm)
    const t = calcOrderTotals(o.items, o.discountPercent, o.servicePercent);
    const priorPaid = sumPayments(orderPayments(o.id));
    const remaining = remainingAmount(t.total, priorPaid);
    if (remaining <= 0) return fail('Hisob allaqachon to‘langan');
    const payAmount = body.amount != null ? Math.min(roundSum(body.amount), remaining) : remaining;
    if (payAmount <= 0) return fail('To‘lov summasi noto‘g‘ri');
    payments.push({ id: uid(), orderId: o.id, amount: payAmount, type: body.type, cashierId: actor.id, createdAt: new Date().toISOString() });
    const newPaid = priorPaid + payAmount;
    const fullyPaid = newPaid >= t.total;
    const allPayments = paymentRows(o.id);
    const dto = () => ({
      ...o, subtotal: t.subtotal, discountPercent: t.discountPercent, servicePercent: t.servicePercent,
      discountAmount: t.discountAmount, serviceAmount: t.serviceAmount, total: t.total, paidAmount: newPaid,
    });
    if (!fullyPaid) {
      // Qisman to'landi — buyurtma ochiq qoladi, chek chiqmaydi
      const partial = dto();
      emitUpdated(partial);
      return ok({ order: partial, fullyPaid: false, paidAmount: newPaid, total: t.total, payments: allPayments });
    }
    o.status = OrderStatus.Closed;
    o.closedAt = new Date().toISOString();
    deductStock(o.items.map((it) => ({ menuItemId: it.menuItemId, quantity: it.quantity })));
    const table = tables.find((x) => x.id === o.tableId);
    if (table) table.status = TableStatus.Free;
    fiscalCounter++;
    const fiscalNumber = String(fiscalCounter).padStart(10, '0');
    const fiscalQr = `https://ofd.soliq.uz/check?fn=${fiscalNumber}&sum=${t.total}&t=${Date.now()}`;
    const closed = dto();
    emit(SOCKET_EVENTS.ORDER_CLOSED, { order: closed });
    const receipt = {
      orderId: o.id, tableNumber: o.tableNumber, hall: o.hall ?? hallOf(o.tableId), waiterName: o.waiterName, cashierName: actor.name,
      lines: o.items.map((it) => ({ name: it.menuItemName, quantity: it.quantity, price: it.price, sum: lineSum(it.price, it.quantity), unit: it.unit ?? MenuUnit.Piece })),
      subtotal: t.subtotal, discountPercent: t.discountPercent, discountAmount: t.discountAmount,
      serviceFeePercent: t.servicePercent, serviceFeeAmount: t.serviceAmount, total: t.total,
      paymentType: body.type, payments: allPayments.map((p) => ({ type: p.type, amount: p.amount })),
      note: o.note ?? null, customerName: o.customerName ?? null, createdAt: new Date().toISOString(),
      fiscalQrPlaceholder: false, fiscalNumber, fiscalQr,
    };
    return ok({ order: closed, receipt, fullyPaid: true, paidAmount: newPaid, total: t.total, payments: allPayments });
  }

  // ---- Hisobotlar ----
  if (path.startsWith('/reports/daily')) {
    const days = Math.min(60, Math.max(1, Number(params.get('days')) || 7));
    const totalRev = sumPayments(payments) || 600000;
    const now = new Date();
    const out: { date: string; revenue: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      // Bugun — haqiqiy; qolgan kunlar demo uchun base atrofida
      const factor = i === 0 ? 1 : 0.4 + Math.random() * 0.9;
      out.push({ date: key, revenue: Math.round(totalRev * factor) });
    }
    return ok(out);
  }
  if (path.startsWith('/reports')) {
    const start = periodStart(period);
    // Vozvrat qilingan cheklar hisobotga kirmaydi (server kabi)
    const refundedIds = new Set(orders.filter((o) => o.refunded).map((o) => o.id));
    const paidInPeriod = payments.filter((p) => new Date(p.createdAt).getTime() >= start && !refundedIds.has(p.orderId));
    if (path.startsWith('/reports/summary')) {
      const byType: Record<string, number> = {};
      let revenue = 0; const orderIds = new Set<string>();
      paidInPeriod.forEach((p) => { revenue += p.amount; orderIds.add(p.orderId); byType[p.type] = (byType[p.type] || 0) + p.amount; });
      return ok({
        period, revenue, ordersCount: orderIds.size,
        avgCheck: orderIds.size ? Math.round(revenue / orderIds.size) : 0,
        paymentBreakdown: Object.entries(byType).map(([type, amount]) => ({ type, amount })),
      });
    }
    if (path.startsWith('/reports/refunds')) {
      const list = orders
        .filter((o) => o.refunded && o.refundedAt && new Date(o.refundedAt).getTime() >= start)
        .sort((a, b) => (b.refundedAt ?? '').localeCompare(a.refundedAt ?? ''))
        .map((o) => ({
          id: o.id,
          total: o.items.reduce((s, it) => s + lineSum(it.price, it.quantity), 0),
          reason: o.refundReason || '',
          refundedAt: o.refundedAt,
          products: o.items.map((it) => ({ name: it.menuItemName, quantity: it.quantity })),
        }));
      return ok({ count: list.length, total: list.reduce((s, r) => s + r.total, 0), items: list });
    }
    const closed = orders.filter((o) => o.status === OrderStatus.Closed && !o.refunded && new Date(o.closedAt!).getTime() >= start);
    if (path.startsWith('/reports/top-items')) {
      const map = new Map<string, { name: string; quantity: number; sum: number }>();
      closed.forEach((o) => o.items.forEach((it) => {
        const c = map.get(it.menuItemName) || { name: it.menuItemName, quantity: 0, sum: 0 };
        c.quantity += it.quantity; c.sum += lineSum(it.price, it.quantity); map.set(it.menuItemName, c);
      }));
      return ok(Array.from(map.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 10));
    }
    if (path.startsWith('/reports/waiters')) {
      const map = new Map<string, { waiterName: string; ordersCount: number; revenue: number }>();
      closed.forEach((o) => {
        const c = map.get(o.waiterName) || { waiterName: o.waiterName, ordersCount: 0, revenue: 0 };
        c.ordersCount += 1; c.revenue += sumPayments(orderPayments(o.id)); map.set(o.waiterName, c);
      });
      return ok(Array.from(map.values()).sort((a, b) => b.revenue - a.revenue));
    }
  }

  return fail(`Mock: yo‘l topilmadi (${method} ${path})`, 404);
}
