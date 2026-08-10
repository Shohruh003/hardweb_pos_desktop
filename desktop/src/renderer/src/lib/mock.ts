// Mock (soxta) rejim — prezentatsiya uchun. Serversiz, in-memory ma'lumotlar bilan
// barcha ekranlar ishlaydi; real-time (KDS/navbat) ham simulyatsiya qilinadi.
// VITE_MOCK=1 bo'lganda api.ts va socket.ts shu yerga yo'naltiriladi.
import {
  MenuUnit,
  OrderStatus,
  OrderItemStatus,
  PaymentType,
  ProductUnit,
  SOCKET_EVENTS,
  TableStatus,
  UserRole,
  isFullAccessRole,
} from '@hardweb-pos/shared';

const uid = () => crypto.randomUUID();

// ---- Soxta socket (event bus) ----
type Listener = (payload: any) => void;
const listeners: Record<string, Set<Listener>> = {};
function emit(ev: string, payload: any) {
  (listeners[ev] || new Set<Listener>()).forEach((cb) => cb(payload));
}
export const mockSocket = {
  connected: true,
  on(ev: string, cb: Listener) {
    if (!listeners[ev]) listeners[ev] = new Set();
    listeners[ev].add(cb);
    return mockSocket;
  },
  off(ev: string, cb: Listener) {
    listeners[ev]?.delete(cb);
  },
  emit() {},
};

// ---- Boshlang'ich ma'lumotlar ----
const categories = [
  { id: uid(), name: 'Issiq taomlar', sortOrder: 1 },
  { id: uid(), name: 'Salatlar', sortOrder: 2 },
  { id: uid(), name: 'Ichimliklar', sortOrder: 3 },
];
// Bo'limlar (sexlar) — chekни printerlarga yo'naltirish uchun
const stations: any[] = [
  { id: uid(), name: 'Oshxona', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 1 },
  { id: uid(), name: 'Bar', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 2 },
  { id: uid(), name: 'Somsaxona', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 3 },
  { id: uid(), name: 'Novvoyxona', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 4 },
];
const stId = (n: string) => stations.find((s) => s.name === n)?.id ?? null;

const menu: any[] = [
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
const tables = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: uid(), number: n, hall: 'Asosiy zal', capacity: 4, status: TableStatus.Free })),
  ...[7, 8, 9, 10].map((n) => ({ id: uid(), number: n, hall: 'VIP zal', capacity: 6, status: TableStatus.Free })),
];

// ---- Sklad (ombor): mahsulotlar + retseptlar ----
const products: any[] = [
  { id: uid(), name: 'Guruch', unit: ProductUnit.Kg, stock: 50, minStock: 10 },
  { id: uid(), name: 'Go‘sht (mol)', unit: ProductUnit.Kg, stock: 30, minStock: 8 },
  { id: uid(), name: 'Sabzi', unit: ProductUnit.Kg, stock: 25, minStock: 5 },
  { id: uid(), name: 'Piyoz', unit: ProductUnit.Kg, stock: 20, minStock: 5 },
  { id: uid(), name: 'Yog‘', unit: ProductUnit.Litr, stock: 15, minStock: 3 },
  { id: uid(), name: 'Un', unit: ProductUnit.Kg, stock: 40, minStock: 10 },
];
const prodId = (name: string) => products.find((p) => p.name === name)!.id;
// recipe_items: { id, menuItemId, productId, amount } — 1 birlik taomga
const recipeItems: any[] = [];
function addRecipe(menuIdx: number, lines: [string, number][]) {
  const mid = menu[menuIdx]?.id;
  if (!mid) return;
  lines.forEach(([pname, amount]) =>
    recipeItems.push({ id: uid(), menuItemId: mid, productId: prodId(pname), amount }),
  );
}
// menu: 0 Osh, 1 Lag'mon, 3 Qovurilgan go'sht (kg)
addRecipe(0, [['Guruch', 0.2], ['Go‘sht (mol)', 0.15], ['Sabzi', 0.1], ['Yog‘', 0.05]]);
addRecipe(1, [['Un', 0.15], ['Go‘sht (mol)', 0.1], ['Sabzi', 0.1]]);
addRecipe(3, [['Go‘sht (mol)', 1], ['Yog‘', 0.05], ['Piyoz', 0.1]]);

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

// Kirimlar (ta'minot) tarixi
const purchases: any[] = [];

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
const A_CAPS = ['history', 'reports', 'menu', 'inventory', 'stations', 'tables', 'staff', 'devices', 'terminals', 'settings', 'refund', 'cashier', 'revenue'];
// Real seed bilan bir xil xodimlar (ism, PIN, ruxsatlar)
const users: any[] = [
  { id: uid(), name: 'Aziz Karimov', role: UserRole.Waiter, login: 'ofitsiant', pin: '1111', active: true, permissions: ['waiter'] },
  { id: uid(), name: 'Kamola Yusupova', role: UserRole.Waiter, login: 'kamola', pin: '2222', active: true, permissions: ['waiter'] },
  { id: uid(), name: 'Jasur Rahimov', role: UserRole.Waiter, login: 'jasur', pin: '3333', active: true, permissions: ['waiter'] },
  { id: uid(), name: 'Nodira Salimova', role: UserRole.Waiter, login: 'nodira', pin: '4444', active: true, permissions: ['waiter'] },
  { id: uid(), name: 'Bekzod Toshev', role: UserRole.Cook, login: 'oshpaz', pin: '5555', active: true, permissions: ['kitchen'] },
  { id: uid(), name: 'Dilnoza Ergasheva', role: UserRole.Cashier, login: 'kassir', pin: '1234', active: true, permissions: ['cashier', 'history', 'revenue'] },
  { id: uid(), name: 'Malika Nazarova', role: UserRole.Cashier, login: 'kassir2', pin: '4321', active: true, permissions: ['cashier'] },
  { id: uid(), name: 'Sardor Admin', role: UserRole.Admin, login: 'admin', pin: '9999', active: true, permissions: A_CAPS },
  { id: uid(), name: 'Direktor', role: UserRole.Director, login: 'direktor', pin: '0000', active: true, permissions: [] },
  { id: uid(), name: 'Super Admin (vendor)', role: UserRole.SuperAdmin, login: 'superadmin', pin: '7777', active: true, permissions: [] },
];
const waiter = users[0];
const cashier = users.find((u) => u.role === UserRole.Cashier)!;

// Demo uchun: sozlamalar, terminallar, rasxodlar (in-memory)
const settings = {
  id: 'main',
  restaurantName: 'DasturXon',
  telegramToken: '',
  telegramChatId: '',
  dailyReportTime: '23:59',
};
const terminals: any[] = [
  { id: uid(), name: 'Kassa 1', hall: 'Asosiy zal', note: null },
  { id: uid(), name: 'Ofitsiant terminali', hall: 'VIP zal', note: null },
];
const expenses: any[] = [];

// Rollar registri (admin CRUD qiladi). Har rol qaysi panelga kirishini belgilaydi.
const roles: { key: string; label: string; description: string; panel: string; builtin: boolean }[] = [
  { key: UserRole.Waiter, label: 'Ofitsiant', description: 'Buyurtma qabul qilish', panel: 'ofitsiant', builtin: true },
  { key: UserRole.Cook, label: 'Oshpaz', description: 'Oshxona ekrani (KDS)', panel: 'oshpaz', builtin: true },
  { key: UserRole.Cashier, label: 'Kassir', description: 'To‘lov va chek', panel: 'kassir', builtin: true },
  { key: UserRole.Admin, label: 'Administrator', description: 'Tizimni boshqarish', panel: 'administrator', builtin: true },
  { key: UserRole.Director, label: 'Direktor', description: 'Hisobotlar', panel: 'direktor', builtin: true },
];

interface MockItem {
  id: string; orderId: string; menuItemId: string; menuItemName: string;
  price: number; quantity: number; unit: MenuUnit; note: string | null; status: OrderItemStatus;
  exciseRequired: boolean; exciseCode: string | null;
  stationId: string | null; stationName: string | null;
}
interface MockOrder {
  id: string; tableId: string; tableNumber: number; hall: string | null; waiterId: string; waiterName: string;
  status: OrderStatus; openedAt: string; closedAt: string | null;
  queueNumber: number | null; items: MockItem[]; total: number;
  refunded?: boolean; refundReason?: string | null; refundedAt?: string | null;
}
const hallOf = (tableId: string): string | null => tables.find((t) => t.id === tableId)?.hall ?? null;
const orders: MockOrder[] = [];
const payments: { id: string; orderId: string; amount: number; type: PaymentType; cashierId: string; createdAt: string }[] = [];
let fiscalCounter = 0;

function makeItem(orderId: string, menuItemId: string, quantity: number, note?: string): MockItem {
  const mi = menu.find((m) => m.id === menuItemId)!;
  const st = mi.stationId ? stations.find((s) => s.id === mi.stationId) : null;
  return {
    id: uid(), orderId, menuItemId, menuItemName: mi.name, price: mi.price,
    quantity, unit: mi.unit ?? MenuUnit.Piece, note: note ?? null, status: OrderItemStatus.Pending,
    exciseRequired: mi.exciseRequired, exciseCode: null,
    stationId: mi.stationId ?? null, stationName: st?.name ?? null,
  };
}
function total(items: MockItem[]) {
  return items.reduce((s, it) => s + it.price * it.quantity, 0);
}

// Prezentatsiya uchun bir nechta tayyor ma'lumot: 2 ta faol + 2 ta yopilgan (hisobot uchun)
function seed() {
  // Faol buyurtmalar (KDS va kassada ko'rinadi)
  const o1: MockOrder = {
    id: uid(), tableId: tables[0].id, tableNumber: tables[0].number, hall: tables[0].hall, waiterId: waiter.id, waiterName: waiter.name,
    status: OrderStatus.Cooking, openedAt: new Date().toISOString(), closedAt: null, queueNumber: null, items: [], total: 0,
  };
  o1.items = [makeItem(o1.id, menu[0].id, 2), makeItem(o1.id, menu[5].id, 2)];
  o1.total = total(o1.items);
  tables[0].status = TableStatus.Busy;

  const o2: MockOrder = {
    id: uid(), tableId: tables[6].id, tableNumber: tables[6].number, hall: tables[6].hall, waiterId: waiter.id, waiterName: waiter.name,
    status: OrderStatus.Accepted, openedAt: new Date().toISOString(), closedAt: null, queueNumber: null, items: [], total: 0,
  };
  o2.items = [makeItem(o2.id, menu[2].id, 1), makeItem(o2.id, menu[4].id, 1)];
  o2.total = total(o2.items);
  tables[6].status = TableStatus.Busy;

  orders.push(o1, o2);

  // Yopilgan buyurtmalar — direktor hisobotini to'ldirish uchun
  const closedDefs = [
    { items: [[menu[0].id, 3], [menu[5].id, 3]], type: PaymentType.Cash },
    { items: [[menu[1].id, 2], [menu[6].id, 2]], type: PaymentType.Card },
    { items: [[menu[2].id, 2], [menu[4].id, 1]], type: PaymentType.QR },
  ];
  closedDefs.forEach((def, i) => {
    const o: MockOrder = {
      id: uid(), tableId: tables[i + 1].id, tableNumber: tables[i + 1].number, hall: tables[i + 1].hall, waiterId: waiter.id, waiterName: waiter.name,
      status: OrderStatus.Closed, openedAt: new Date().toISOString(), closedAt: new Date().toISOString(), queueNumber: null, items: [], total: 0,
    };
    o.items = def.items.map(([mid, q]) => makeItem(o.id, mid as string, q as number));
    o.total = total(o.items);
    orders.push(o);
    payments.push({ id: uid(), orderId: o.id, amount: o.total, type: def.type, cashierId: cashier.id, createdAt: new Date().toISOString() });
  });
}
seed();

const ok = (data: any) => Promise.resolve(data);
const fail = (message: string) => Promise.reject(new Error(message));

function periodStart(period: string): number {
  const now = new Date();
  if (period === 'week') return now.getTime() - 7 * 864e5;
  if (period === 'month') return now.getTime() - 30 * 864e5;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// ---- Asosiy router ----
export function mockRequest<T>(method: string, fullPath: string, body?: any): Promise<T> {
  const [path, query] = fullPath.split('?');
  const period = new URLSearchParams(query || '').get('period') || 'day';
  const seg = path.split('/').filter(Boolean); // masalan ['orders','<id>','pay']

  // Auth
  if (path === '/auth/login' && method === 'POST') {
    const u = users.find((x) => x.login === body.login);
    if (!u || body.password !== '1234') return fail('Login yoki parol noto‘g‘ri');
    return ok({ token: 'mock-token', user: u });
  }
  if (path === '/auth/login-pin' && method === 'POST') {
    const u = users.find((x) => x.pin === body.pin);
    if (!u) return fail('PIN noto‘g‘ri');
    // Direktor/SuperAdmin PIN bilan kira olmaydi — login+parol bilan
    if (isFullAccessRole(u.role)) return fail('Direktor login va parol bilan kiradi (PIN emas)');
    return ok({ token: 'mock-token', user: u });
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
    const e = { id: uid(), amount: Number(body.amount), note: body.note ?? null, cashierName: 'Kassir', createdAt: new Date().toISOString() };
    expenses.push(e); return ok(e);
  }

  // Tables
  if (path === '/tables' && method === 'GET') return ok([...tables]);
  if (path === '/tables' && method === 'POST') {
    const t = { id: uid(), number: body.number, hall: body.hall, capacity: body.capacity || 4, status: TableStatus.Free };
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
    const pid = new URLSearchParams(query || '').get('productId');
    const list = pid ? purchases.filter((p) => p.productId === pid) : purchases;
    return ok([...list].reverse());
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

  // Users
  // Rollar CRUD
  if (path === '/roles' && method === 'GET') return ok([...roles]);
  if (path === '/roles' && method === 'POST') {
    const r = { key: 'role-' + uid().slice(0, 6), label: body.label, description: body.description || '', panel: body.panel || 'ofitsiant', builtin: false };
    roles.push(r); return ok(r);
  }
  if (seg[0] === 'roles' && seg[1] && method === 'PATCH') {
    const r = roles.find((x) => x.key === seg[1]); if (r && !r.builtin) Object.assign(r, body); else if (r) r.description = body.description ?? r.description; return ok(r);
  }
  if (seg[0] === 'roles' && seg[1] && method === 'DELETE') {
    const i = roles.findIndex((x) => x.key === seg[1]); if (i >= 0 && !roles[i].builtin) roles.splice(i, 1); return ok({ ok: true });
  }

  if (path === '/users/waiters' && method === 'GET')
    return ok(users.filter((u) => u.role === UserRole.Waiter && u.active));
  if (path === '/users' && method === 'GET') return ok([...users]);
  if (path === '/users' && method === 'POST') {
    const u = { id: uid(), name: body.name, login: body.login, role: body.role, active: true };
    users.push(u); return ok(u);
  }
  if (seg[0] === 'users' && seg[1] && method === 'PATCH') {
    const u = users.find((x) => x.id === seg[1]); if (u) Object.assign(u, body); return ok(u);
  }
  if (seg[0] === 'users' && seg[1] && method === 'DELETE') {
    const i = users.findIndex((x) => x.id === seg[1]); if (i >= 0) users.splice(i, 1); return ok({ ok: true });
  }

  // Orders
  if (path === '/orders' && method === 'GET') return ok(orders.filter((o) => o.status !== OrderStatus.Closed));
  if (path === '/orders/history' && method === 'GET') {
    const q = new URLSearchParams(query || '');
    const wid = q.get('waiterId');
    const status = q.get('status');
    const paymentType = q.get('paymentType');
    const hall = q.get('hall');
    const search = q.get('search');
    const page = Math.max(1, Number(q.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 20));

    let list = orders
      .map((o) => ({
        ...o,
        hall: tables.find((t) => t.id === o.tableId)?.hall ?? null,
        paymentType: payments.find((p) => p.orderId === o.id)?.type,
      }))
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));

    if (wid) list = list.filter((o) => o.waiterId === wid);
    if (status) list = list.filter((o) => o.status === status);
    if (paymentType) list = list.filter((o) => o.paymentType === paymentType);
    if (hall) list = list.filter((o) => o.hall === hall);
    if (search) list = list.filter((o) => String(o.tableNumber ?? '').includes(search));

    const total = list.length;
    const items = list.slice((page - 1) * limit, page * limit);
    return ok({ items, total, page, limit, hasMore: page * limit < total });
  }
  if (seg[0] === 'orders' && seg[1] && !seg[2] && method === 'GET') {
    return ok(orders.find((o) => o.id === seg[1]));
  }
  if (path === '/orders' && method === 'POST') {
    // Ombor yetarliligini tekshiramiz (ortiqcha sotishni oldini olish)
    const shortage = stockShortage((body.items || []).map((i: any) => ({ menuItemId: i.menuItemId, quantity: i.quantity })));
    if (shortage) return fail(shortage);
    const table = tables.find((t) => t.id === body.tableId)!;
    const w = users.find((u) => u.id === body.waiterId) || waiter;
    const id = uid();
    const order: MockOrder = {
      id, tableId: body.tableId, tableNumber: table.number, hall: table.hall, waiterId: w.id, waiterName: w.name,
      status: OrderStatus.Accepted, openedAt: new Date().toISOString(), closedAt: null, queueNumber: null,
      items: body.items.map((i: any) => makeItem(id, i.menuItemId, i.quantity, i.note)), total: 0,
    };
    order.total = total(order.items);
    table.status = TableStatus.Busy;
    orders.push(order);
    emit(SOCKET_EVENTS.ORDER_CREATED, { order });
    return ok(order);
  }
  if (seg[0] === 'orders' && seg[2] === 'request-bill' && method === 'POST') {
    const o = orders.find((x) => x.id === seg[1]);
    if (o) {
      const table = tables.find((t) => t.id === o.tableId);
      if (table && table.status !== TableStatus.Free) table.status = TableStatus.AwaitingBill;
      emit(SOCKET_EVENTS.ORDER_UPDATED, { orderId: o.id, status: o.status, order: o });
    }
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'print-bill' && method === 'POST') {
    const o = orders.find((x) => x.id === seg[1]);
    if (o) emit(SOCKET_EVENTS.PRINT_BILL, { order: o });
    return ok(o);
  }
  if (path === '/orders/print-receipt' && method === 'POST') {
    emit(SOCKET_EVENTS.PRINT_RECEIPT, { receipt: body });
    return ok({ ok: true });
  }
  if (seg[0] === 'orders' && seg[2] === 'remove-items' && method === 'POST') {
    const o = orders.find((x) => x.id === seg[1]);
    if (!o) return fail('Buyurtma topilmadi');
    const ids: string[] = body?.itemIds ?? [];
    o.items = o.items.filter((it) => !ids.includes(it.id));
    if (o.items.length === 0) {
      // Hamma taom olib tashlandi — buyurtmani bekor qilamiz
      const i = orders.findIndex((x) => x.id === o.id);
      if (i >= 0) orders.splice(i, 1);
      const table = tables.find((t) => t.id === o.tableId);
      if (table) table.status = TableStatus.Free;
      emit(SOCKET_EVENTS.ORDER_CLOSED, { order: o });
      return ok(o);
    }
    o.total = total(o.items);
    emit(SOCKET_EVENTS.ORDER_UPDATED, { orderId: o.id, status: o.status, order: o });
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'cancel' && method === 'POST') {
    const i = orders.findIndex((x) => x.id === seg[1]);
    if (i < 0) return fail('Buyurtma topilmadi');
    const o = orders[i];
    orders.splice(i, 1);
    const table = tables.find((t) => t.id === o.tableId);
    if (table) table.status = TableStatus.Free;
    emit(SOCKET_EVENTS.ORDER_CLOSED, { order: o });
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'move-table' && method === 'POST') {
    const o = orders.find((x) => x.id === seg[1]);
    if (!o) return fail('Buyurtma topilmadi');
    const newTable = tables.find((t) => t.id === body.tableId);
    if (!newTable) return fail('Yangi stol topilmadi');
    if (o.tableId === newTable.id) return ok(o);
    const busyByOther = orders.find((x) => x.tableId === newTable.id && x.status !== OrderStatus.Closed);
    if (busyByOther) return fail('Bu stol band — avval uni bo‘shating');
    const oldTable = tables.find((t) => t.id === o.tableId);
    if (oldTable) oldTable.status = TableStatus.Free;
    o.tableId = newTable.id;
    o.tableNumber = newTable.number;
    o.hall = newTable.hall;
    newTable.status = TableStatus.Busy;
    emit(SOCKET_EVENTS.ORDER_UPDATED, { orderId: o.id, status: o.status, order: o });
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'change-waiter' && method === 'POST') {
    const o = orders.find((x) => x.id === seg[1]);
    if (!o) return fail('Buyurtma topilmadi');
    const w = users.find((u) => u.id === body.waiterId);
    if (!w) return fail('Ofitsiant topilmadi');
    o.waiterId = w.id;
    o.waiterName = w.name;
    emit(SOCKET_EVENTS.ORDER_UPDATED, { orderId: o.id, status: o.status, order: o });
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'status' && method === 'PATCH') {
    const o = orders.find((x) => x.id === seg[1]);
    if (o) {
      o.status = body.status;
      if (body.status === OrderStatus.Ready) o.items.forEach((it) => (it.status = OrderItemStatus.Ready));
      emit(SOCKET_EVENTS.ORDER_UPDATED, { orderId: o.id, status: o.status, order: o });
    }
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'refund' && method === 'POST') {
    const o = orders.find((x) => x.id === seg[1]);
    if (o) {
      o.refunded = true;
      o.refundReason = body?.reason ?? null;
      o.refundedAt = new Date().toISOString();
    }
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'excise' && method === 'POST') {
    const o = orders.find((x) => x.id === seg[1]);
    if (o) body.codes.forEach((c: any) => {
      const it = o.items.find((x) => x.id === c.orderItemId); if (it) it.exciseCode = c.code;
    });
    return ok(o);
  }
  if (seg[0] === 'orders' && seg[2] === 'pay' && method === 'POST') {
    const o = orders.find((x) => x.id === seg[1]);
    if (!o) return fail('Buyurtma topilmadi');
    const missing = o.items.filter((it) => it.exciseRequired && !it.exciseCode);
    if (missing.length) return fail(`Aksiz kodi skanerlanmagan: ${missing.map((m) => m.menuItemName).join(', ')}`);
    const subtotal = o.total;
    const discountAmount = Math.round((subtotal * (body.discountPercent || 0)) / 100);
    const serviceFeeAmount = Math.round((subtotal * (body.serviceFeePercent || 0)) / 100);
    const grand = subtotal - discountAmount + serviceFeeAmount;
    o.status = OrderStatus.Closed; o.closedAt = new Date().toISOString();
    // Sotildi — mahsulotlarni skladdan ayiramiz
    deductStock(o.items.map((it) => ({ menuItemId: it.menuItemId, quantity: it.quantity })));
    const table = tables.find((t) => t.id === o.tableId); if (table) table.status = TableStatus.Free;
    payments.push({ id: uid(), orderId: o.id, amount: grand, type: body.type, cashierId: cashier.id, createdAt: new Date().toISOString() });
    fiscalCounter++;
    const fiscalNumber = String(fiscalCounter).padStart(10, '0');
    const fiscalQr = `https://ofd.soliq.uz/check?fn=${fiscalNumber}&sum=${grand}&t=${Date.now()}`;
    emit(SOCKET_EVENTS.ORDER_CLOSED, { order: o });
    const receipt = {
      orderId: o.id, tableNumber: o.tableNumber, hall: o.hall ?? hallOf(o.tableId), waiterName: o.waiterName, cashierName: cashier.name,
      lines: o.items.map((it) => ({ name: it.menuItemName, quantity: it.quantity, price: it.price, sum: it.price * it.quantity, unit: it.unit ?? MenuUnit.Piece })),
      subtotal, discountPercent: body.discountPercent || 0, discountAmount,
      serviceFeePercent: body.serviceFeePercent || 0, serviceFeeAmount, total: grand,
      paymentType: body.type, createdAt: new Date().toISOString(),
      fiscalQrPlaceholder: false, fiscalNumber, fiscalQr,
    };
    return ok({ order: o, receipt });
  }

  // Reports
  if (path.startsWith('/reports/daily')) {
    const days = Math.min(60, Math.max(1, Number(new URLSearchParams(query || '').get('days')) || 7));
    const totalRev = payments.reduce((s, p) => s + p.amount, 0) || 600000;
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
    const paidInPeriod = payments.filter((p) => new Date(p.createdAt).getTime() >= start);
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
    const closed = orders.filter((o) => o.status === OrderStatus.Closed && new Date(o.closedAt!).getTime() >= start);
    if (path.startsWith('/reports/top-items')) {
      const map = new Map<string, { name: string; quantity: number; sum: number }>();
      closed.forEach((o) => o.items.forEach((it) => {
        const c = map.get(it.menuItemName) || { name: it.menuItemName, quantity: 0, sum: 0 };
        c.quantity += it.quantity; c.sum += it.price * it.quantity; map.set(it.menuItemName, c);
      }));
      return ok(Array.from(map.values()).sort((a, b) => b.quantity - a.quantity));
    }
    if (path.startsWith('/reports/waiters')) {
      const map = new Map<string, { waiterName: string; ordersCount: number; revenue: number }>();
      closed.forEach((o) => {
        const c = map.get(o.waiterName) || { waiterName: o.waiterName, ordersCount: 0, revenue: 0 };
        c.ordersCount += 1; c.revenue += o.total; map.set(o.waiterName, c);
      });
      return ok(Array.from(map.values()).sort((a, b) => b.revenue - a.revenue));
    }
  }

  return fail(`Mock: yo‘l topilmadi (${method} ${path})`);
}
