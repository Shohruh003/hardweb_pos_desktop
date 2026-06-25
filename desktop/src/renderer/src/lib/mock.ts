// Mock (soxta) rejim — prezentatsiya uchun. Serversiz, in-memory ma'lumotlar bilan
// barcha ekranlar ishlaydi; real-time (KDS/navbat) ham simulyatsiya qilinadi.
// VITE_MOCK=1 bo'lganda api.ts va socket.ts shu yerga yo'naltiriladi.
import {
  OrderStatus,
  OrderItemStatus,
  PaymentType,
  SOCKET_EVENTS,
  TableStatus,
  UserRole,
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
const menu = [
  { id: uid(), name: 'Osh', price: 35000, categoryId: categories[0].id, available: true, exciseRequired: false, image: null },
  { id: uid(), name: 'Lag‘mon', price: 32000, categoryId: categories[0].id, available: true, exciseRequired: false, image: null },
  { id: uid(), name: 'Shashlik', price: 28000, categoryId: categories[0].id, available: true, exciseRequired: false, image: null },
  { id: uid(), name: 'Achchiq-chuchuk', price: 18000, categoryId: categories[1].id, available: true, exciseRequired: false, image: null },
  { id: uid(), name: 'Sezar', price: 30000, categoryId: categories[1].id, available: true, exciseRequired: false, image: null },
  { id: uid(), name: 'Choy', price: 8000, categoryId: categories[2].id, available: true, exciseRequired: false, image: null },
  { id: uid(), name: 'Coca-Cola', price: 12000, categoryId: categories[2].id, available: true, exciseRequired: false, image: null },
  { id: uid(), name: 'Pivo (0.5)', price: 22000, categoryId: categories[2].id, available: true, exciseRequired: true, image: null },
];
const tables = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: uid(), number: n, hall: 'Asosiy zal', capacity: 4, status: TableStatus.Free })),
  ...[7, 8, 9, 10].map((n) => ({ id: uid(), number: n, hall: 'VIP zal', capacity: 6, status: TableStatus.Free })),
];
const users = [
  { id: uid(), name: 'Aziz Karimov', role: UserRole.Waiter, login: 'ofitsiant', active: true },
  { id: uid(), name: 'Sardor To‘rayev', role: UserRole.Waiter, login: 'ofitsiant2', active: true },
  { id: uid(), name: 'Jasur Rahimov', role: UserRole.Waiter, login: 'ofitsiant3', active: true },
  { id: uid(), name: 'Bekzod (oshpaz)', role: UserRole.Cook, login: 'oshpaz', active: true },
  { id: uid(), name: 'Dilnoza (kassir)', role: UserRole.Cashier, login: 'kassir', active: true },
  { id: uid(), name: 'Admin', role: UserRole.Admin, login: 'admin', active: true },
  { id: uid(), name: 'Direktor', role: UserRole.Director, login: 'direktor', active: true },
];
const waiter = users[0];
const cashier = users.find((u) => u.role === UserRole.Cashier)!;

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
  price: number; quantity: number; note: string | null; status: OrderItemStatus;
  exciseRequired: boolean; exciseCode: string | null;
}
interface MockOrder {
  id: string; tableId: string; tableNumber: number; waiterId: string; waiterName: string;
  status: OrderStatus; openedAt: string; closedAt: string | null;
  queueNumber: number | null; items: MockItem[]; total: number;
}
const orders: MockOrder[] = [];
const payments: { id: string; orderId: string; amount: number; type: PaymentType; cashierId: string; createdAt: string }[] = [];
let fiscalCounter = 0;

function makeItem(orderId: string, menuItemId: string, quantity: number, note?: string): MockItem {
  const mi = menu.find((m) => m.id === menuItemId)!;
  return {
    id: uid(), orderId, menuItemId, menuItemName: mi.name, price: mi.price,
    quantity, note: note ?? null, status: OrderItemStatus.Pending,
    exciseRequired: mi.exciseRequired, exciseCode: null,
  };
}
function total(items: MockItem[]) {
  return items.reduce((s, it) => s + it.price * it.quantity, 0);
}

// Prezentatsiya uchun bir nechta tayyor ma'lumot: 2 ta faol + 2 ta yopilgan (hisobot uchun)
function seed() {
  // Faol buyurtmalar (KDS va kassada ko'rinadi)
  const o1: MockOrder = {
    id: uid(), tableId: tables[0].id, tableNumber: tables[0].number, waiterId: waiter.id, waiterName: waiter.name,
    status: OrderStatus.Cooking, openedAt: new Date().toISOString(), closedAt: null, queueNumber: null, items: [], total: 0,
  };
  o1.items = [makeItem(o1.id, menu[0].id, 2), makeItem(o1.id, menu[5].id, 2)];
  o1.total = total(o1.items);
  tables[0].status = TableStatus.Busy;

  const o2: MockOrder = {
    id: uid(), tableId: tables[6].id, tableNumber: tables[6].number, waiterId: waiter.id, waiterName: waiter.name,
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
      id: uid(), tableId: tables[i + 1].id, tableNumber: tables[i + 1].number, waiterId: waiter.id, waiterName: waiter.name,
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
    const m = { id: uid(), name: body.name, price: body.price, categoryId: body.categoryId, available: true, exciseRequired: !!body.exciseRequired, image: body.image ?? null };
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
    const wid = new URLSearchParams(query || '').get('waiterId');
    let list = orders.slice();
    if (wid) list = list.filter((o) => o.waiterId === wid);
    const enriched = list
      .map((o) => ({
        ...o,
        hall: tables.find((t) => t.id === o.tableId)?.hall ?? null,
        paymentType: payments.find((p) => p.orderId === o.id)?.type,
      }))
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    return ok(enriched);
  }
  if (seg[0] === 'orders' && seg[1] && !seg[2] && method === 'GET') {
    return ok(orders.find((o) => o.id === seg[1]));
  }
  if (path === '/orders' && method === 'POST') {
    const table = tables.find((t) => t.id === body.tableId)!;
    const w = users.find((u) => u.id === body.waiterId) || waiter;
    const id = uid();
    const order: MockOrder = {
      id, tableId: body.tableId, tableNumber: table.number, waiterId: w.id, waiterName: w.name,
      status: OrderStatus.Accepted, openedAt: new Date().toISOString(), closedAt: null, queueNumber: null,
      items: body.items.map((i: any) => makeItem(id, i.menuItemId, i.quantity, i.note)), total: 0,
    };
    order.total = total(order.items);
    table.status = TableStatus.Busy;
    orders.push(order);
    emit(SOCKET_EVENTS.ORDER_CREATED, { order });
    return ok(order);
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
    const table = tables.find((t) => t.id === o.tableId); if (table) table.status = TableStatus.Free;
    payments.push({ id: uid(), orderId: o.id, amount: grand, type: body.type, cashierId: cashier.id, createdAt: new Date().toISOString() });
    fiscalCounter++;
    const fiscalNumber = String(fiscalCounter).padStart(10, '0');
    const fiscalQr = `https://ofd.soliq.uz/check?fn=${fiscalNumber}&sum=${grand}&t=${Date.now()}`;
    emit(SOCKET_EVENTS.ORDER_CLOSED, { order: o });
    const receipt = {
      orderId: o.id, tableNumber: o.tableNumber, waiterName: o.waiterName, cashierName: cashier.name,
      lines: o.items.map((it) => ({ name: it.menuItemName, quantity: it.quantity, price: it.price, sum: it.price * it.quantity })),
      subtotal, discountPercent: body.discountPercent || 0, discountAmount,
      serviceFeePercent: body.serviceFeePercent || 0, serviceFeeAmount, total: grand,
      paymentType: body.type, createdAt: new Date().toISOString(),
      fiscalQrPlaceholder: false, fiscalNumber, fiscalQr,
    };
    return ok({ order: o, receipt });
  }

  // Reports
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
