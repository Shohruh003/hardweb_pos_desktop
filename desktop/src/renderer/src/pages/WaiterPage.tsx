import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Category,
  Customer,
  MenuItem,
  MenuUnit,
  ORDER_TYPES,
  ORDER_TYPE_LABELS,
  Order,
  OrderItem,
  OrderType,
  PrintFailedPayload,
  SOCKET_EVENTS,
  SplitOrderResult,
  Table,
  TableStatus,
  calcOrderTotals,
  hallServicePercentFor,
  hasCapability,
  orderDisplayName,
  orderTypeOf,
} from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { FeedbackModal, FeedbackVariant } from '../components/FeedbackModal';
import { MyOrdersView } from '../components/MyOrdersView';
import { WaiterMobileNav, WaiterProfileView } from '../components/WaiterMobileNav';
import { BackButton } from '../components/BackButton';
import { PrintFailedToasts, usePrintFailedToasts } from '../components/PrintFailedToasts';
import { PendingOrdersModal, usePendingOrders } from '../components/PendingOrdersModal';
import DeliveryInfoModal, { DeliveryInfo } from '../components/DeliveryInfoModal';
import PaymentModal, { PayResult } from '../components/PaymentModal';
import OrderActionsBar from '../components/OrderActionsBar';
import VoidModal from '../components/VoidModal';
import { canEditPrice, canVoid as canVoidFor } from '../components/orderActions/perms';
import { HallSections, TableGrid, TableLegend } from '../components/waiter/TableGrid';
import { HomeTab, WaiterTabs, hallTab, parseTab, tabHall, tabMode } from '../components/waiter/WaiterTabs';
import { OrderCardsGrid } from '../components/waiter/OrderCards';
import { CategoryChips, CategoryDrawerList, CategoryRail, FAV_CAT } from '../components/waiter/CategoryRail';
import { MenuGrid } from '../components/waiter/MenuGrid';
import { OrderPanel } from '../components/waiter/OrderPanel';
import { LineEditModal, LineEditValue } from '../components/waiter/LineEditModal';
import { SentLineSheet, SentPriceModal } from '../components/waiter/SentLineActions';
import { CustomerPickModal, OrderNoteModal } from '../components/waiter/OrderActionModals';
import {
  CartItem,
  QTY_MAX,
  cartSignature,
  isPlainLine,
  newLineKey,
  orderLines,
  queuedLines,
} from '../components/waiter/cart';
import { IconBack, IconCart, IconCash, IconClose, IconList, IconRefresh, IconSearch } from '../components/waiter/icons';
import { OrderTypeBadge, apiPhone, checkNoOf, dailyNumberLabel, phoneLabel } from '../components/waiter/orderUi';
import { formatSum } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { getSocket } from '../lib/socket';
import { PendingOrder, enqueue, newClientRequestId, pendingType } from '../lib/offlineQueue';
import { normalizeName } from '../lib/menuImages';
import { sortHalls, usePosSettings } from '../lib/posSettings';
import { useConnectivity } from '../state/connectivity';
import { useI18n } from '../state/i18n';
import { useAuth } from '../state/auth';
import { useConfirm } from '../state/confirm';
import { useAppNav } from '../state/appNav';

interface Feedback {
  variant: FeedbackVariant;
  title: string;
  subtitle?: string;
}

/** Shu sahifadan yaqinda yuborilgan buyurtma — "print:failed" xabari shunga tegishlimi? */
interface RecentSend {
  orderId?: string; // javob kelgach ma'lum bo'ladi
  tableNumber?: number; // stol buyurtmasi (javobdan oldin kelgan xabarni tanish uchun)
  at: number;
}

/**
 * Tuzuvchi (menyu + savat) nima uchun ochilgan:
 *  table — stol; checkNo — tanlangan hisob (Hisob-1, Hisob-2 …). Shu raqamli ochiq hisob bo'lsa —
 *          unga qo'shiladi, bo'lmasa Tasdiqlash shu raqam bilan YANGI hisob ochadi (B18);
 *  new   — yangi olib ketish / yetkazish buyurtmasi;
 *  order — mavjud olib ketish / yetkazish buyurtmasi (qo'shimcha, to'lov, tahrirlash).
 */
type Target =
  | { kind: 'table'; tableId: string; checkNo: number }
  | { kind: 'new'; type: OrderType }
  | { kind: 'order'; orderId: string; type: OrderType };

type Screen = 'home' | 'myorders' | 'profile' | 'history';

/** Savat qatorini tahrirlash oynasi: menyudan yangi qator (kg / 💬) yoki savatdagi qator */
type LineEdit =
  | { mode: 'add'; item: MenuItem; focusNote?: boolean }
  | { mode: 'edit'; line: CartItem; focusNote?: boolean };

/** Otkaz oynasi: tanlangan qatorlar yoki butun hisob */
interface VoidRequest {
  order: Order;
  itemIds?: string[];
  whole?: boolean;
}

/** Yuborish konteksti (bosilgan paytdagi holat nusxasi) */
interface SendCtx {
  type: OrderType;
  table: Table | null;
  /** qo'shimcha qilinadigan mavjud buyurtma (stolda — tanlangan hisob); yangi bo'lsa — null */
  order: Order | null;
  /** stol: yangi hisob raqami (order bo'lmasa) */
  checkNo: number | null;
  items: CartItem[];
  /** buyurtma kimning nomiga (kassir ofitsiant stolida yangi hisob ochsa — o'sha ofitsiant) */
  waiterId: string;
  /** B32: takroriy yuborishda server o'sha buyurtmani qaytaradi */
  requestId: string;
}

type SendOutcome = { status: 'sent'; order: Order | null } | { status: 'queued'; timeout?: boolean };

/** Bo'lim printeri natijasi shu vaqt ichida keladi (server navbatdan qayta urinadi) */
const PRINT_WATCH_MS = 3 * 60_000;
/** Socket hodisalari ketma-ket kelsa — bitta yangilash (ms) */
const REFRESH_DEBOUNCE_MS = 200;
/** Menyu shuncha vaqtdan eski bo'lsa, tuzuvchi ochilganda fonda yangilanadi (yangi rasm/taom) */
const MENU_STALE_MS = 2 * 60_000;
/** O'zimiz qo'shgan buyurtma eskiroq ro'yxat javobi bilan "yo'qolib" qolmasin (ms) */
const UPSERT_KEEP_MS = 15_000;
/** Bosh ekranning eslab qolingan bo'limi (zal / olib ketish / yetkazish) */
const TAB_KEY = 'waiter_tab';
// 0.3.0 wave-1 kalitlari (eski qurilmalarda saqlangan qiymatdan foydalanamiz)
const LEGACY_MODE_KEY = 'waiter_mode';
const LEGACY_HALL_KEY = 'waiter_hall';
// Eski POS'dan ko'chirilgan soxta zallar (endi haqiqiy rejimlar) — bo'sh bo'lsa zal sifatida ko'rsatilmaydi
const PSEUDO_HALLS = new Set(['olib ketish', 'yetkazib berish', 'yetkazish']);
const EMPTY_CHECKS: Order[] = [];

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage yopiq — keyingi safar standart qiymat */
  }
}

/** Qurilmada eslab qolingan bo'lim (yangi kalit, bo'lmasa — eski kalitlardan) */
function readStoredTab(): HomeTab | null {
  const tab = parseTab(readStored(TAB_KEY));
  if (tab) return tab;
  const mode = readStored(LEGACY_MODE_KEY);
  if (mode === OrderType.Takeaway || mode === OrderType.Delivery) return mode;
  const hall = readStored(LEGACY_HALL_KEY);
  return hall ? hallTab(hall) : null;
}

// Faqat POST /orders'ning o'zi tarmoq xatosi bilan tugaganda (api.ts: TypeError) yoki javob
// kelmaganda (timeout) buyurtma oflayn navbatga olinadi. Har so'rovda o'zgarmas clientRequestId
// bor (B32) — server takrorni taniydi, shuning uchun qayta yuborish ikkinchi buyurtma yaratmaydi.
function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError;
}
function isTimeout(e: unknown): boolean {
  return e instanceof ApiError && e.status === 0;
}
function errorText(e: unknown, fallback: string): string {
  return (e as Error)?.message || fallback;
}

/** Olib ketish/yetkazish: raqam bo'yicha (kunlik #1, #2 ...) */
function byQueueNumber(a: Order, b: Order): number {
  return (a.queueNumber ?? 1e9) - (b.queueNumber ?? 1e9) || a.openedAt.localeCompare(b.openedAt);
}

/** Yangilangan buyurtma: javobda zal/ofitsiant ismi bo'lmasa — eskisidagisi saqlanadi */
function mergeOrder(prev: Order, next: Order): Order {
  const sameTable = prev.tableId === next.tableId;
  return {
    ...prev,
    ...next,
    hall: next.hall ?? (sameTable ? prev.hall : next.hall),
    waiterName: next.waiterName ?? prev.waiterName,
    tableNumber: next.tableNumber ?? (sameTable ? prev.tableNumber : next.tableNumber),
  };
}

/** Yangi savat qatori (menyudagi taomdan) */
function newCartLine(item: MenuItem, quantity: number, takeaway: boolean, note?: string, price?: number): CartItem {
  const menuPrice = Number(item.price) || 0;
  return {
    key: newLineKey(item.id),
    menuItemId: item.id,
    name: item.name,
    price: price ?? menuPrice,
    menuPrice,
    quantity,
    unit: item.unit ?? MenuUnit.Piece,
    note: note || undefined,
    takeaway: takeaway || undefined,
  };
}

/** Joriy vaqt, daqiqaga yaxlitlangan — kartochkalar faqat daqiqa o'zgarganda qayta chiziladi */
function useMinuteNow(): number {
  const calc = () => Math.floor(Date.now() / 60_000) * 60_000;
  const [now, setNow] = useState(calc);
  useEffect(() => {
    const t = window.setInterval(() => setNow(calc()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** Tor ekran (telefon / planshet, < 1024 px) — ixcham tugmalar uchun */
function useIsNarrow(): boolean {
  const query = '(max-width: 1023px)';
  const [match, setMatch] = useState(() => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(query);
    } catch {
      return;
    }
    const on = () => setMatch(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return match;
}

// Ofitsiant va kassir (POS) ekrani — TZ 5.1 + 0.3.0:
//  yuqorida YAGONA qator (D1 + B23): [Barcha] | Zal | Tapchan | Stol | Olib ketish | Yetkazib berish;
//  stol -> hisoblar (Hisob-1, Hisob-2 …) -> menyu; olib ketish / yetkazish — ochiq buyurtmalar ro'yxati,
//  "+ Yangi buyurtma" -> menyu. Tasdiqlash: stol/olib ketish — darhol, yetkazish — telefon+manzil oynasidan keyin.
export function WaiterPage() {
  const { online } = useConnectivity();
  const { t } = useI18n();
  const { user } = useAuth();
  const confirm = useConfirm();
  const nav = useAppNav();
  const pos = usePosSettings();
  const pending = usePendingOrders();
  const now = useMinuteNow();
  const isNarrow = useIsNarrow();
  // Kirgan foydalanuvchi (ofitsiant yoki kassir)
  const me = user!;
  // Kassa ruxsati bor xodim (kassir/direktor) — to'lov oladi, "Barcha" bo'limidan boshlaydi
  const canPay = hasCapability(me, 'cashier');
  // Otkaz (yuborilgan taomni bekor qilish) — faqat kassir/administrator/direktor (B19)
  const canVoid = canVoidFor(me);
  const priceEditable = canEditPrice(me);

  // ---- Ma'lumotlar ----
  const [tables, setTables] = useState<Table[]>([]);
  const [tablesLoaded, setTablesLoaded] = useState(false);
  // Faol (ochiq) buyurtmalar — barcha turlar
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  // Hozirgi ro'yxat qaysi paytda boshlangan so'rovdan (eskirgan javobni tanish uchun)
  const [ordersStamp, setOrdersStamp] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuState, setMenuState] = useState<'loading' | 'ready' | 'error'>('loading');

  // ---- Navigatsiya ----
  // Kassadan berilgan rejim / nishon (bir marta o'qiladi)
  const [initialNav] = useState(() => ({ mode: nav.waiterMode, target: nav.waiterTarget }));
  const startMode = initialNav.mode;
  const [tab, setTab] = useState<HomeTab | null>(() => {
    if (startMode === OrderType.Takeaway || startMode === OrderType.Delivery) return startMode;
    // Kassir — "Barcha" (barcha zallar stollari); ofitsiant — qurilmada eslab qolingan bo'lim
    if (canPay) return 'all';
    return readStoredTab();
  });
  // Kassadagi "+ Yangi buyurtma" (olib ketish / yetkazish) — darhol yangi buyurtma tuzuvchisi
  const [target, setTarget] = useState<Target | null>(() =>
    startMode === OrderType.Takeaway || startMode === OrderType.Delivery ? { kind: 'new', type: startMode } : null,
  );
  const targetStamp = useRef(Date.now());
  const [screen, setScreen] = useState<Screen>('home');
  const [historyFromProfile, setHistoryFromProfile] = useState(false);
  // Kassadagi "✏️ O‘zgartirish" / stol nishoni — ma'lumot yuklangach ochiladi
  const pendingTarget = useRef(initialNav.target);
  // Har stolda oxirgi ishlatilgan hisob (qayta ochilganda shu tanlanadi)
  const lastCheck = useRef(new Map<string, number>());

  // ---- Tuzuvchi (menyu + savat) ----
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [menuSearch, setMenuSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  // Stol: "🥡 Olib ketish" rejimi — yangi qo'shiladigan taomlar saboy (xizmat haqisiz)
  const [takeawayMode, setTakeawayMode] = useState(false);
  const [cartOpen, setCartOpen] = useState(false); // telefon: buyurtma paneli (pastki sheet)
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // B32: oxirgi muvaffaqiyatsiz yuborishning id'si — aynan shu savat qayta yuborilsa o'sha id
  const lastRequest = useRef<{ sig: string; id: string } | null>(null);

  // ---- Oynalar ----
  const [lineEdit, setLineEdit] = useState<LineEdit | null>(null);
  const [orderNoteOpen, setOrderNoteOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [delivery, setDelivery] = useState<{ kind: 'create' } | { kind: 'edit'; order: Order } | null>(null);
  const [payOrder, setPayOrder] = useState<Order | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [sentSheet, setSentSheet] = useState<OrderItem | null>(null);
  const [priceItem, setPriceItem] = useState<OrderItem | null>(null);
  const [voidReq, setVoidReq] = useState<VoidRequest | null>(null);

  // Kassadan berilgan rejim va nishon bir marta ishlatiladi
  useEffect(() => {
    if (nav.waiterMode) nav.consumeWaiterMode();
    if (nav.waiterTarget) nav.consumeWaiterTarget();
    // faqat birinchi ochilishda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Bo'lim qurilmada eslab qolinadi
  useEffect(() => {
    if (tab) writeStored(TAB_KEY, tab);
  }, [tab]);

  // ================= Yuklash =================
  // O'zimiz yaratgan/yangilagan buyurtmalar (javobdan) — eskiroq ro'yxat javobi ularni yo'qotmasin
  const upserts = useRef(new Map<string, { order: Order; at: number }>());
  // O'zimiz yopgan (to'lov / bekor qilish / otkaz) buyurtmalar — "yopildi" xabari chiqmasin
  const handledClose = useRef(new Set<string>());

  const ordersSeq = useRef(0);
  const loadOrders = useCallback(async () => {
    const seq = ++ordersSeq.current;
    const startedAt = Date.now();
    try {
      const raw = await api.get<Order[]>('/orders');
      if (seq !== ordersSeq.current) return; // yangiroq so'rov bor
      let list = Array.isArray(raw) ? raw : [];
      const ids = new Set(list.map((o) => o.id));
      const extra: Order[] = [];
      upserts.current.forEach((u, id) => {
        if (Date.now() - u.at > UPSERT_KEEP_MS) upserts.current.delete(id);
        else if (u.at > startedAt && !ids.has(id)) extra.push(u.order);
      });
      if (extra.length) list = [...list, ...extra];
      setActiveOrders(list);
      setOrdersStamp(startedAt);
      setOrdersLoaded(true);
      setLoadError(false);
    } catch {
      if (seq === ordersSeq.current) setLoadError(true);
    }
  }, []);

  const tablesSeq = useRef(0);
  const loadTables = useCallback(async () => {
    const seq = ++tablesSeq.current;
    try {
      const raw = await api.get<Table[]>('/tables');
      if (seq !== tablesSeq.current) return;
      setTables(Array.isArray(raw) ? raw : []);
      setTablesLoaded(true);
    } catch {
      if (seq === tablesSeq.current) setLoadError(true);
    }
  }, []);

  // Menyu: bir vaqtda bitta so'rov; yuklanayotganda yangi so'rov kelsa (stop list) — tugagach yana bir marta
  const menuLoadedAt = useRef(0);
  const menuLoading = useRef(false);
  const menuReloadAgain = useRef(false);
  const loadMenu = useCallback(async () => {
    if (menuLoading.current) {
      menuReloadAgain.current = true;
      return;
    }
    menuLoading.current = true;
    try {
      const [cats, items] = await Promise.all([
        api.get<Category[]>('/menu/categories'),
        api.get<MenuItem[]>('/menu/items'),
      ]);
      setCategories(Array.isArray(cats) ? cats : []);
      setMenu(Array.isArray(items) ? items : []);
      menuLoadedAt.current = Date.now();
      setMenuState('ready');
    } catch {
      // Oldin yuklangan menyu bo'lsa — o'sha qoladi
      setMenuState((s) => (s === 'ready' ? s : 'error'));
    } finally {
      menuLoading.current = false;
      if (menuReloadAgain.current) {
        menuReloadAgain.current = false;
        void loadMenu();
      }
    }
  }, []);

  const refreshLists = useCallback(() => {
    void loadTables();
    void loadOrders();
  }, [loadTables, loadOrders]);

  useEffect(() => {
    refreshLists();
    void loadMenu();
  }, [refreshLists, loadMenu]);

  // Real-time: buyurtma hodisalari, qayta ulanish va oyna qayta ko'ringanda (telefon uyqudan
  // uyg'onganda) — ro'yxatlar yangilanadi. Ketma-ket hodisalar bitta so'rovga birlashtiriladi.
  // Stop list (menu:changed) — menyu qayta yuklanadi (tugagan taom xira bo'ladi).
  useEffect(() => {
    const socket = getSocket();
    let timer: number | undefined;
    let menuTimer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        refreshLists();
      }, REFRESH_DEBOUNCE_MS);
    };
    const scheduleMenu = () => {
      window.clearTimeout(menuTimer);
      menuTimer = window.setTimeout(() => void loadMenu(), 300);
    };
    const events: string[] = [SOCKET_EVENTS.ORDER_CREATED, SOCKET_EVENTS.ORDER_UPDATED, SOCKET_EVENTS.ORDER_CLOSED, 'connect'];
    events.forEach((ev) => socket.on(ev, schedule));
    socket.on(SOCKET_EVENTS.MENU_CHANGED, scheduleMenu);
    socket.on('connect', scheduleMenu);
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      events.forEach((ev) => socket.off(ev, schedule));
      socket.off(SOCKET_EVENTS.MENU_CHANGED, scheduleMenu);
      socket.off('connect', scheduleMenu);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer !== undefined) window.clearTimeout(timer);
      window.clearTimeout(menuTimer);
    };
  }, [refreshLists, loadMenu]);

  /** Javobdagi buyurtmani ro'yxatga darhol qo'yish (socket yangilanishini kutmasdan) */
  const upsertOrder = useCallback((o: Order | null | undefined) => {
    if (!o?.id) return;
    upserts.current.set(o.id, { order: o, at: Date.now() });
    setActiveOrders((prev) => {
      const i = prev.findIndex((x) => x.id === o.id);
      if (i < 0) return [...prev, o];
      const next = prev.slice();
      next[i] = mergeOrder(prev[i], o);
      return next;
    });
  }, []);
  /** Yopilgan/bekor qilingan buyurtmani ro'yxatdan olib tashlash */
  const dropOrder = useCallback((id: string) => {
    handledClose.current.add(id);
    upserts.current.delete(id);
    setActiveOrders((prev) => prev.filter((x) => x.id !== id));
  }, []);

  // Bo'lim (oshxona/bar...) cheklarini SERVER chop etadi — faqat yangi qo'shilgan taomlarni.
  // Chek chiqmasa server "print:failed" yuboradi — shu sahifadan yaqinda yuborilgan buyurtma
  // bo'lsa, ofitsiantga ekranni to'smaydigan ogohlantirish ko'rsatamiz.
  const recentSends = useRef<RecentSend[]>([]);
  function trackSend(tableNumber?: number): RecentSend {
    const at = Date.now();
    const entry: RecentSend = { tableNumber, at };
    recentSends.current = [...recentSends.current.filter((s) => at - s.at < PRINT_WATCH_MS), entry];
    return entry;
  }
  const printFails = usePrintFailedToasts({
    max: 3,
    autoDismissMs: 20_000,
    filter: (p: PrintFailedPayload) => {
      const at = Date.now();
      return recentSends.current.some((s) => {
        if (at - s.at > PRINT_WATCH_MS) return false;
        // Ikkala tomonda id bo'lsa — faqat id bo'yicha; aks holda (javob hali kelmagan) stol raqami bo'yicha
        if (s.orderId && p.orderId) return s.orderId === p.orderId;
        return s.tableNumber != null && p.tableNumber != null && p.tableNumber === s.tableNumber;
      });
    },
  });

  // ================= Hosila ma'lumotlar =================
  const halls = useMemo(() => sortHalls(tables.map((tb) => tb.hall), pos.hallOrder), [tables, pos.hallOrder]);

  // Stol -> ochiq hisoblar (checkNo bo'yicha): bitta stolda bir nechta hisob bo'lishi mumkin (B18)
  const checksByTable = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of activeOrders) {
      if (!o.tableId || orderTypeOf(o) !== OrderType.DineIn) continue;
      const list = m.get(o.tableId);
      if (list) list.push(o);
      else m.set(o.tableId, [o]);
    }
    m.forEach((list) => list.sort((a, b) => checkNoOf(a) - checkNoOf(b) || a.openedAt.localeCompare(b.openedAt)));
    return m;
  }, [activeOrders]);

  // Zal -> stollar (raqam bo'yicha) va zal -> band stollar soni
  const tablesByHall = useMemo(() => {
    const m = new Map<string, Table[]>();
    for (const tb of tables) {
      const list = m.get(tb.hall);
      if (list) list.push(tb);
      else m.set(tb.hall, [tb]);
    }
    m.forEach((list) => list.sort((a, b) => a.number - b.number));
    return m;
  }, [tables]);
  const busyByHall = useMemo(() => {
    const m = new Map<string, number>();
    for (const tb of tables) {
      const busy = (checksByTable.get(tb.id)?.length ?? 0) > 0 || tb.status !== TableStatus.Free;
      if (busy) m.set(tb.hall, (m.get(tb.hall) ?? 0) + 1);
    }
    return m;
  }, [tables, checksByTable]);
  // Yuqori qatordagi zallar: "Olib ketish"/"Yetkazib berish" soxta zallari (band stoli bo'lmasa) yashiriladi —
  // aks holda haqiqiy "Olib ketish" rejimi tugmasi bilan ikkita bir xil tugma chiqardi
  const tabHalls = useMemo(
    () => halls.filter((h) => !PSEUDO_HALLS.has(normalizeName(h)) || (busyByHall.get(h) ?? 0) > 0),
    [halls, busyByHall],
  );
  const totalBusy = useMemo(() => tabHalls.reduce((n, h) => n + (busyByHall.get(h) ?? 0), 0), [tabHalls, busyByHall]);

  // Bo'lim tekshiruvi: o'chirilgan zal — birinchi zal; "Barcha" faqat 2+ zalda; stol yo'q — olib ketish
  useEffect(() => {
    if (!tablesLoaded) return;
    const firstHall = tabHalls[0];
    const fallback: HomeTab = firstHall ? hallTab(firstHall) : OrderType.Takeaway;
    if (!tab) {
      setTab(canPay && tabHalls.length > 1 ? 'all' : fallback);
      return;
    }
    if (tab === 'all') {
      if (tabHalls.length < 2) setTab(fallback);
      return;
    }
    const h = tabHall(tab);
    if (h !== null && !tabHalls.includes(h)) setTab(fallback);
  }, [tablesLoaded, tabHalls, tab, canPay]);

  const mode: OrderType = tabMode(tab);
  const selectedHall = tabHall(tab);

  const ordersByType = useMemo(() => {
    const res: Record<OrderType, Order[]> = {
      [OrderType.DineIn]: [],
      [OrderType.Takeaway]: [],
      [OrderType.Delivery]: [],
    };
    for (const o of activeOrders) res[orderTypeOf(o)].push(o);
    res[OrderType.Takeaway].sort(byQueueNumber);
    res[OrderType.Delivery].sort(byQueueNumber);
    return res;
  }, [activeOrders]);

  // Oflayn navbat: yangi olib ketish/yetkazish (raqamsiz), mavjud buyurtmaga qo'shimchalar, stollar
  const pendingNewByType = useMemo(() => {
    const res: Record<OrderType, PendingOrder[]> = {
      [OrderType.DineIn]: [],
      [OrderType.Takeaway]: [],
      [OrderType.Delivery]: [],
    };
    for (const p of pending) if (!p.orderId && pendingType(p) !== OrderType.DineIn) res[pendingType(p)].push(p);
    return res;
  }, [pending]);
  const queuedAppends = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pending) if (p.orderId) m.set(p.orderId, (m.get(p.orderId) ?? 0) + 1);
    return m;
  }, [pending]);
  const queuedTableIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of pending) if (pendingType(p) === OrderType.DineIn && p.tableId) s.add(p.tableId);
    return s;
  }, [pending]);

  // Rejim tugmalaridagi sonlar — ochiq buyurtmalar (+ navbatdagi yangi buyurtmalar)
  const takeawayCount = ordersByType[OrderType.Takeaway].length + pendingNewByType[OrderType.Takeaway].length;
  const deliveryCount = ordersByType[OrderType.Delivery].length + pendingNewByType[OrderType.Delivery].length;

  // "Mening buyurtmalarim" — shu xodimning ochiq buyurtmalari (stol — zal/stol/hisob tartibida, qolgani — raqam bo'yicha)
  const myOrders = useMemo(() => {
    const hallIdx = new Map(halls.map((h, i) => [h, i] as const));
    return activeOrders
      .filter((o) => o.waiterId === me.id)
      .sort((a, b) => {
        const ta = orderTypeOf(a);
        const tb = orderTypeOf(b);
        if (ta !== tb) return ORDER_TYPES.indexOf(ta) - ORDER_TYPES.indexOf(tb);
        if (ta === OrderType.DineIn) {
          return (
            (hallIdx.get(a.hall ?? '') ?? 999) - (hallIdx.get(b.hall ?? '') ?? 999) ||
            (a.tableNumber ?? 0) - (b.tableNumber ?? 0) ||
            checkNoOf(a) - checkNoOf(b)
          );
        }
        return byQueueNumber(a, b);
      });
  }, [activeOrders, me.id, halls]);

  // ---- Tuzuvchi: maqsad, mavjud buyurtma, tur ----
  const targetTable = useMemo(
    () => (target?.kind === 'table' ? tables.find((tb) => tb.id === target.tableId) ?? null : null),
    [target, tables],
  );
  const tableChecks = target?.kind === 'table' ? checksByTable.get(target.tableId) ?? EMPTY_CHECKS : EMPTY_CHECKS;
  const selectedCheck = target?.kind === 'table' ? target.checkNo : 1;
  const existingOrder = useMemo<Order | null>(() => {
    if (!target) return null;
    if (target.kind === 'table') return tableChecks.find((c) => checkNoOf(c) === target.checkNo) ?? null;
    if (target.kind === 'order') return activeOrders.find((o) => o.id === target.orderId) ?? null;
    return null;
  }, [target, tableChecks, activeOrders]);
  const composeType: OrderType = !target
    ? mode
    : target.kind === 'table'
      ? OrderType.DineIn
      : existingOrder
        ? orderTypeOf(existingOrder)
        : target.type;
  const dineIn = composeType === OrderType.DineIn;

  // Summalar (B5/B21/B28): mavjud buyurtma — uning foizlari; yangi stol hisobi — zal foizi (hallServicePercentFor);
  // saboy qatorlariga xizmat haqi olinmaydi; yetkazish — yetkazish narxi qo'shiladi
  const totals = useMemo(() => {
    const sent = (existingOrder?.items ?? []).map((it) => ({ price: it.price ?? 0, quantity: it.quantity, takeaway: it.takeaway }));
    const lines = [...sent, ...cart.map((c) => ({ price: c.price, quantity: c.quantity, takeaway: dineIn && !!c.takeaway }))];
    const service = existingOrder
      ? Number(existingOrder.servicePercent) || 0
      : dineIn
        ? hallServicePercentFor(pos, targetTable?.hall)
        : 0;
    const discount = existingOrder ? Number(existingOrder.discountPercent) || 0 : 0;
    const fee =
      composeType === OrderType.Delivery
        ? existingOrder
          ? Number(existingOrder.deliveryFee) || 0
          : pos.deliveryFeeDefault
        : 0;
    return calcOrderTotals(lines, discount, service, fee);
  }, [existingOrder, cart, dineIn, composeType, pos, targetTable?.hall]);

  const composerTitle = !target
    ? ''
    : dineIn
      ? `Stol ${targetTable?.number ?? existingOrder?.tableNumber ?? '?'}${targetTable?.hall ? ` · ${targetTable.hall}` : ''}`
      : existingOrder
        ? orderDisplayName(existingOrder)
        : `Yangi buyurtma — ${ORDER_TYPE_LABELS[composeType]}`;

  // ---- Menyu ----
  const itemsByCat = useMemo(() => {
    const m = new Map<string, MenuItem[]>();
    for (const it of menu) {
      const list = m.get(it.categoryId);
      if (list) list.push(it);
      else m.set(it.categoryId, [it]);
    }
    return m;
  }, [menu]);
  // Bo'sh kategoriyalar ofitsiantga ko'rsatilmaydi
  const visibleCats = useMemo(() => categories.filter((c) => itemsByCat.has(c.id)), [categories, itemsByCat]);
  const hasFavorites = useMemo(() => menu.some((m) => m.favorite), [menu]);
  const soldOutIds = useMemo(() => new Set(menu.filter((m) => m.available === false).map((m) => m.id)), [menu]);
  useEffect(() => {
    const valid = activeCat === FAV_CAT ? hasFavorites : visibleCats.some((c) => c.id === activeCat);
    if (!valid) setActiveCat(visibleCats[0]?.id ?? (hasFavorites ? FAV_CAT : null));
  }, [visibleCats, hasFavorites, activeCat]);

  const searchQ = normalizeName(menuSearch);
  const shownItems = useMemo(() => {
    // Qidiruv bo'lsa — barcha kategoriyalar bo'yicha nom/ingredient (apostrof farqi hisobga olinmaydi)
    if (searchQ) {
      return menu.filter((m) => normalizeName(m.name).includes(searchQ) || normalizeName(m.ingredients).includes(searchQ));
    }
    if (activeCat === FAV_CAT) return menu.filter((m) => m.favorite);
    return activeCat ? itemsByCat.get(activeCat) ?? [] : [];
  }, [menu, itemsByCat, activeCat, searchQ]);

  // Plitkadagi son — shu taomning savatdagi barcha qatorlari yig'indisi (izohli + izohsiz)
  const qtyById = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of cart) m[c.menuItemId] = Math.round(((m[c.menuItemId] ?? 0) + c.quantity) * 1000) / 1000;
    return m;
  }, [cart]);

  // Barqaror callback'lar uchun joriy holat (memo plitkalar har bosishda qayta chizilmasin)
  const live = useRef({ cart, target, existingOrder, takeawayMode, dineIn });
  live.current = { cart, target, existingOrder, takeawayMode, dineIn };

  // ================= Navigatsiya =================
  const resetComposer = useCallback(() => {
    setCart([]);
    setCartOpen(false);
    setMenuSearch('');
    setLineEdit(null);
    setTakeawayMode(false);
    setSentSheet(null);
    setPriceItem(null);
    lastRequest.current = null;
  }, []);
  const closeComposer = useCallback(() => {
    setTarget(null);
    resetComposer();
  }, [resetComposer]);

  const openTarget = useCallback(
    (tg: Target) => {
      resetComposer();
      targetStamp.current = Date.now();
      setTarget(tg);
      setScreen('home');
      // Ochilgan buyurtmaning eng so'nggi holati + (eskirgan bo'lsa) menyu
      void loadOrders();
      if (Date.now() - menuLoadedAt.current > MENU_STALE_MS) void loadMenu();
    },
    [resetComposer, loadOrders, loadMenu],
  );

  // Stol ochilganda qaysi hisob tanlanadi: shu stolda oxirgi ishlatilgani (hali ochiq bo'lsa),
  // aks holda eng kichik raqamli ochiq hisob; bo'sh stol — Hisob-1
  const checksRef = useRef(checksByTable);
  checksRef.current = checksByTable;
  const defaultCheckFor = useCallback((tableId: string): number => {
    const checks = checksRef.current.get(tableId) ?? [];
    const last = lastCheck.current.get(tableId);
    if (last && checks.some((c) => checkNoOf(c) === last)) return last;
    return checks.length ? checkNoOf(checks[0]) : 1;
  }, []);
  const openTable = useCallback(
    (tbl: Table) => openTarget({ kind: 'table', tableId: tbl.id, checkNo: defaultCheckFor(tbl.id) }),
    [openTarget, defaultCheckFor],
  );
  const openNew = useCallback(
    (type: OrderType) => {
      if (type !== OrderType.DineIn) setTab(type);
      openTarget({ kind: 'new', type });
    },
    [openTarget],
  );
  const openNewInMode = useCallback(() => openNew(mode), [openNew, mode]);
  const openOrder = useCallback(
    (o: Order) => {
      const type = orderTypeOf(o);
      if (type === OrderType.DineIn && o.tableId) {
        openTarget({ kind: 'table', tableId: o.tableId, checkNo: checkNoOf(o) });
        return;
      }
      if (type !== OrderType.DineIn) setTab(type);
      openTarget({ kind: 'order', orderId: o.id, type });
    },
    [openTarget],
  );

  // Kassadan kelgan nishon ("✏️ O‘zgartirish" — buyurtma; stol) — stollar va buyurtmalar yuklangach
  useEffect(() => {
    const wt = pendingTarget.current;
    if (!wt || !tablesLoaded || !ordersLoaded) return;
    pendingTarget.current = null;
    if (wt.orderId) {
      const o = activeOrders.find((x) => x.id === wt.orderId);
      if (o) openOrder(o);
      else setFeedback({ variant: 'info', title: 'Buyurtma topilmadi', subtitle: 'U yopilgan yoki bekor qilingan bo‘lishi mumkin' });
      return;
    }
    if (wt.tableId) {
      const tbl = tables.find((x) => x.id === wt.tableId);
      if (tbl) openTable(tbl);
    }
  }, [tablesLoaded, ordersLoaded, activeOrders, tables, openOrder, openTable]);

  /** Yuborilmagan o'zgarish bo'lsa — chiqishdan oldin so'raymiz */
  const confirmLeave = useCallback(async (): Promise<boolean> => {
    const c = live.current.cart;
    if (c.length === 0) return true;
    return confirm({
      title: 'Yuborilmagan taomlar',
      message: `Savatda ${c.length} ta yuborilmagan taom bor. Chiqsangiz, ular o‘chadi.`,
      confirmText: 'Ha, chiqish',
      cancelText: 'Qolish',
      danger: true,
    });
  }, [confirm]);

  const leaveComposer = useCallback(async () => {
    if (await confirmLeave()) closeComposer();
  }, [confirmLeave, closeComposer]);

  const selectTab = useCallback((next: HomeTab) => {
    setTab(next);
    setScreen('home');
  }, []);

  // Stol hisobini tanlash (Hisob-1 | Hisob-2 …): savat saqlanadi — yangi taomlar tanlangan hisobga ketadi
  const selectCheck = useCallback((n: number) => {
    setTarget((tg) => (tg?.kind === 'table' ? { ...tg, checkNo: n } : tg));
    setSentSheet(null);
  }, []);

  // Pastki navigatsiya (telefon)
  const goScreen = useCallback(
    async (s: Screen) => {
      if (live.current.target) {
        if (!(await confirmLeave())) return;
        closeComposer();
      }
      setHistoryFromProfile(false);
      setScreen(s);
    },
    [confirmLeave, closeComposer],
  );
  const goHome = useCallback(() => void goScreen('home'), [goScreen]);
  const goMyOrders = useCallback(() => void goScreen('myorders'), [goScreen]);
  const goProfile = useCallback(() => void goScreen('profile'), [goScreen]);
  // Tarix — Profil ichidan (orqaga — Profilga) yoki kompyuterdagi tugmadan
  const goHistory = useCallback(() => {
    setHistoryFromProfile(true);
    setScreen('history');
  }, []);
  const openHistory = useCallback(() => {
    setHistoryFromProfile(false);
    setScreen('history');
  }, []);
  const openPendingList = useCallback(() => setPendingOpen(true), []);

  // Stol o'chirilgan bo'lsa — tuzuvchi yopiladi
  useEffect(() => {
    if (target?.kind === 'table' && tablesLoaded && !targetTable) closeComposer();
  }, [target, tablesLoaded, targetTable, closeComposer]);

  // Ochiq olib ketish/yetkazish buyurtmasi boshqa joyda (kassada) yopilsa yoki bekor qilinsa —
  // tuzuvchi yopiladi. Faqat tuzuvchi ochilgandan KEYIN boshlangan so'rov javobiga ishonamiz.
  useEffect(() => {
    if (!target || target.kind !== 'order' || !ordersLoaded) return;
    if (ordersStamp < targetStamp.current) return;
    if (activeOrders.some((o) => o.id === target.orderId)) return;
    if (handledClose.current.has(target.orderId) || payOrder?.id === target.orderId) return;
    closeComposer();
    setFeedback({
      variant: 'info',
      title: 'Buyurtma yopildi',
      subtitle: `${ORDER_TYPE_LABELS[target.type]} buyurtmasi kassada yopilgan yoki bekor qilingan`,
    });
  }, [target, activeOrders, ordersLoaded, ordersStamp, payOrder, closeComposer]);

  // Stoldagi tanlangan hisob boshqa joyda (kassada) yopilsa — xabar (tab endi "yangi" hisob bo'ladi)
  const watched = useRef<{ key: string; order: Order | null }>({ key: '', order: null });
  useEffect(() => {
    const key = target?.kind === 'table' ? `${target.tableId}:${target.checkNo}` : '';
    const prev = watched.current;
    watched.current = { key, order: existingOrder };
    if (!key || prev.key !== key || !prev.order || existingOrder) return;
    if (ordersStamp < targetStamp.current) return;
    const gone = prev.order;
    if (handledClose.current.has(gone.id) || payOrder?.id === gone.id) return;
    setFeedback({
      variant: 'info',
      title: `${orderDisplayName(gone)} yopildi`,
      subtitle: 'Hisob kassada to‘langan yoki bekor qilingan. Yangi taom yuborsangiz — yangi hisob ochiladi.',
    });
  }, [target, existingOrder, ordersStamp, payOrder]);

  // ================= Savat =================
  // Taom plitkasi bosildi: shu saboy rejimidagi izohsiz, narxi o'zgarmagan qator bo'lsa — o'sha ko'payadi
  // (izohli/saboy/narxi o'zgargan qatorlar hech qachon qo'shilib ketmaydi). Kg taom — og'irlik oynasi.
  const addToCart = useCallback((item: MenuItem) => {
    if (item.available === false) return; // stop list
    const unit = item.unit ?? MenuUnit.Piece;
    if (unit === MenuUnit.Weight) {
      setLineEdit({ mode: 'add', item });
      return;
    }
    const tk = live.current.dineIn && live.current.takeawayMode;
    setCart((prev) => {
      const found = prev.find((c) => isPlainLine(c, item.id, tk));
      if (found) return prev.map((c) => (c.key === found.key ? { ...c, quantity: Math.min(QTY_MAX, c.quantity + 1) } : c));
      return [...prev, newCartLine(item, 1, tk)];
    });
  }, []);
  // Plitkadagi "💬" — izoh (va miqdor) bilan YANGI qator
  const addWithNote = useCallback((item: MenuItem) => {
    if (item.available === false) return;
    setLineEdit({ mode: 'add', item, focusNote: true });
  }, []);
  const changeQty = useCallback((key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.key === key ? { ...c, quantity: Math.min(QTY_MAX, c.quantity + delta) } : c))
        .filter((c) => c.quantity > 0),
    );
  }, []);
  const removeLine = useCallback((key: string) => setCart((prev) => prev.filter((c) => c.key !== key)), []);
  const toggleLineTakeaway = useCallback((key: string) => {
    setCart((prev) => prev.map((c) => (c.key === key ? { ...c, takeaway: c.takeaway ? undefined : true } : c)));
  }, []);
  const editLine = useCallback((line: CartItem, focusNote?: boolean) => setLineEdit({ mode: 'edit', line, focusNote }), []);
  // Kategoriya tanlansa — qidiruv tozalanadi (aks holda qidiruv natijasi ko'rinib turaverardi)
  const selectCategory = useCallback((id: string) => {
    setMenuSearch('');
    setActiveCat(id);
  }, []);

  /**
   * Tahrirlash oynasi natijasi. Izoh yangi bo'lib, "faqat N tasiga" (N < miqdor) tanlansa — qator bo'linadi:
   * N tasi yangi izoh bilan, qolgani avvalgi holicha ("5 somsadan 2 tasi — mehmon kelganda").
   */
  function saveLineEdit(v: LineEditValue) {
    const le = lineEdit;
    if (!le) return;
    const note = v.note.trim();
    if (le.mode === 'add') {
      const item = le.item;
      const tk = dineIn && takeawayMode;
      const kg = (item.unit ?? MenuUnit.Piece) === MenuUnit.Weight;
      const priceChanged = Math.round(v.price) !== Math.round(Number(item.price) || 0);
      setCart((prev) => {
        let next = prev;
        const addPlain = (qty: number) => {
          // Izohsiz, narxi o'zgarmagan dona — mavjud oddiy qatorga qo'shiladi
          const found = !kg && !priceChanged ? next.find((c) => isPlainLine(c, item.id, tk)) : undefined;
          if (found) next = next.map((c) => (c.key === found.key ? { ...c, quantity: Math.min(QTY_MAX, c.quantity + qty) } : c));
          else next = [...next, newCartLine(item, qty, tk, undefined, v.price)];
        };
        if (!note) {
          addPlain(v.quantity);
          return next;
        }
        if (!kg && v.count < v.quantity) addPlain(v.quantity - v.count);
        next = [...next, newCartLine(item, kg ? v.quantity : Math.min(v.count, v.quantity), tk, note, v.price)];
        return next;
      });
    } else {
      const key = le.line.key;
      setCart((prev) => {
        const line = prev.find((c) => c.key === key);
        if (!line) return prev;
        const noteChanged = note !== (line.note ?? '').trim();
        const split = noteChanged && !!note && line.unit !== MenuUnit.Weight && v.count > 0 && v.count < v.quantity;
        if (!split) return prev.map((c) => (c.key === key ? { ...c, quantity: v.quantity, price: v.price, note: note || undefined } : c));
        const idx = prev.indexOf(line);
        const rest: CartItem = { ...line, quantity: v.quantity - v.count, price: v.price };
        const noted: CartItem = { ...line, key: newLineKey(line.menuItemId), quantity: v.count, price: v.price, note };
        return [...prev.slice(0, idx), rest, noted, ...prev.slice(idx + 1)];
      });
    }
    setLineEdit(null);
  }

  // ================= Yuborish =================
  function finishSend(fb: Feedback) {
    closeComposer();
    setFeedback(fb);
  }

  /** Bosilgan paytdagi holatdan yuborish konteksti. Yuborib bo'lmasa — sababini ko'rsatib null qaytaradi */
  function currentCtx(): SendCtx | null {
    if (!target) return null;
    let ctx: Omit<SendCtx, 'requestId'>;
    if (dineIn) {
      if (!targetTable || target.kind !== 'table') return null;
      // Kassir ofitsiantning band stolida yangi hisob ochsa — hisob o'sha ofitsiant nomiga (B23)
      const owner = !existingOrder && canPay && tableChecks.length > 0 ? tableChecks[0].waiterId : me.id;
      ctx = {
        type: OrderType.DineIn,
        table: targetTable,
        order: existingOrder,
        checkNo: existingOrder ? null : target.checkNo,
        items: cart,
        waiterId: owner || me.id,
      };
    } else {
      if (target.kind === 'order' && !existingOrder) {
        setFeedback({ variant: 'warning', title: 'Buyurtma topilmadi', subtitle: 'U kassada yopilgan yoki bekor qilingan bo‘lishi mumkin' });
        return null;
      }
      ctx = { type: composeType, table: null, order: existingOrder, checkNo: null, items: cart, waiterId: me.id };
    }
    // B32: aynan shu savat (shu manzilga) qayta yuborilsa — o'sha id (server ikkinchi marta yaratmaydi)
    const sig = cartSignature(
      `${ctx.type}:${ctx.table?.id ?? ''}:${ctx.order?.id ?? ''}:${ctx.checkNo ?? ''}`,
      ctx.items,
    );
    const prev = lastRequest.current;
    const requestId = prev && prev.sig === sig ? prev.id : newClientRequestId();
    lastRequest.current = { sig, id: requestId };
    return { ...ctx, requestId };
  }

  /** Xabarlardagi nom: "Stol 5" / "Stol 5 · Hisob 2" / "Olib ketish #12" / "Olib ketish" (yangi) */
  function ctxName(ctx: SendCtx, created?: Order | null): string {
    if (created?.id) return orderDisplayName(created);
    if (ctx.order) return orderDisplayName(ctx.order);
    if (ctx.type === OrderType.DineIn) {
      const n = ctx.checkNo ?? 1;
      return `Stol ${ctx.table?.number ?? '?'}${n > 1 ? ` · Hisob ${n}` : ''}`;
    }
    return ORDER_TYPE_LABELS[ctx.type];
  }

  /** POST /orders tanasi (shartnoma B2 / B18 / B21 / B28 / B31 / B32) */
  function requestBody(ctx: SendCtx, info?: DeliveryInfo): Record<string, unknown> {
    const isDineIn = ctx.type === OrderType.DineIn;
    const body: Record<string, unknown> = {
      type: ctx.type,
      waiterId: ctx.waiterId,
      items: orderLines(ctx.items, isDineIn),
      clientRequestId: ctx.requestId,
    };
    if (isDineIn) {
      body.tableId = ctx.table?.id;
      // Tanlangan ochiq hisobga aniq qo'shiladi; bo'sh tab — shu raqamli yangi hisob
      if (ctx.order) body.orderId = ctx.order.id;
      else body.checkNo = ctx.checkNo ?? 1;
    } else if (ctx.order) {
      body.orderId = ctx.order.id;
    } else if (info) {
      body.phone = apiPhone(info.phone);
      if (ctx.type === OrderType.Delivery) {
        body.address = info.address;
        body.deliveryFee = info.deliveryFee;
      }
      if (info.note) body.note = info.note;
    }
    return body;
  }

  /**
   * Savatdagi taomlarni yuborish (yangi buyurtma/hisob yoki mavjudiga qo'shimcha).
   * Aloqa yo'q (socket uzilgan), POST tarmoq xatosi bilan tugasa yoki server javob bermasa — oflayn
   * navbatga olinadi (o'sha clientRequestId bilan: server qabul qilib ulgurgan bo'lsa ham ikki marta
   * tushmaydi). Boshqa xato (400 va h.k.) — yuqoriga uzatiladi. Bo'lim cheklarini server chop etadi.
   */
  async function postOrder(ctx: SendCtx, info?: DeliveryInfo): Promise<SendOutcome> {
    const isDineIn = ctx.type === OrderType.DineIn;
    const queue = () =>
      enqueue({
        clientRequestId: ctx.requestId,
        type: ctx.type,
        tableId: isDineIn ? ctx.table?.id : undefined,
        tableNumber: ctx.table?.number,
        orderId: ctx.order?.id,
        // Mavjud hisobga — orderId (raqam faqat ko'rsatish uchun); yangi hisob — shu raqam bilan ochiladi
        checkNo: isDineIn ? (ctx.order ? checkNoOf(ctx.order) : ctx.checkNo ?? 1) : undefined,
        queueNumber: ctx.order?.queueNumber ?? undefined,
        phone: info ? apiPhone(info.phone) ?? undefined : undefined,
        address: info?.address,
        deliveryFee: info && ctx.type === OrderType.Delivery ? info.deliveryFee : undefined,
        note: info?.note || undefined,
        waiterId: ctx.waiterId,
        items: queuedLines(ctx.items, isDineIn),
      });
    if (!online) {
      queue();
      return { status: 'queued' };
    }
    const track = trackSend(isDineIn ? ctx.table?.number : undefined);
    try {
      const created = await api.post<Order>('/orders', requestBody(ctx, info));
      if (created?.id) {
        track.orderId = created.id;
        upsertOrder(created);
      }
      return { status: 'sent', order: created ?? null };
    } catch (e) {
      if (isNetworkError(e)) {
        queue();
        return { status: 'queued' };
      }
      if (isTimeout(e)) {
        queue();
        return { status: 'queued', timeout: true };
      }
      throw e;
    }
  }

  /** Muvaffaqiyatli yuborishdan keyingi xabar va ro'yxatga qaytish */
  function afterSend(ctx: SendCtx, res: SendOutcome, info?: DeliveryInfo) {
    lastRequest.current = null;
    refreshLists();
    if (res.status === 'queued') {
      finishSend(
        res.timeout
          ? {
              variant: 'info',
              title: 'Server javob bermadi',
              subtitle: `${ctxName(ctx)}: navbatga olindi — avtomatik qayta yuboriladi (ikki marta tushmaydi)`,
            }
          : online
            ? { variant: 'info', title: 'Aloqa yo‘q', subtitle: 'Oflayn saqlandi, keyin yuboriladi' }
            : { variant: 'info', title: 'Oflayn saqlandi', subtitle: 'Ulanish tiklanganda avtomatik yuboriladi' },
      );
      return;
    }
    const o = res.order;
    const name = ctxName(ctx, o);
    if (ctx.type === OrderType.DineIn) {
      if (ctx.table && o) lastCheck.current.set(ctx.table.id, checkNoOf(o));
      const daily = dailyNumberLabel(o);
      finishSend(
        ctx.order
          ? { variant: 'success', title: `${name} — qo‘shimcha yuborildi`, subtitle: 'Yangi taomlar bo‘limlarga uzatildi' }
          : { variant: 'success', title: 'Buyurtma yuborildi!', subtitle: `${name}${daily ? ` · ${daily}` : ''} — bo‘limlarga uzatildi` },
      );
    } else if (ctx.order) {
      finishSend({ variant: 'success', title: `${name} — qo‘shimcha yuborildi`, subtitle: 'Yangi taomlar bo‘limlarga uzatildi' });
    } else {
      // Yangi olib ketish / yetkazish — raqam (server bergan) katta qilib aytiladi
      finishSend({
        variant: 'success',
        title: `${o && o.queueNumber != null ? name : ORDER_TYPE_LABELS[ctx.type]} qabul qilindi`,
        subtitle: info ? `${phoneLabel(info.phone)} · ${info.address}` : 'Bo‘limlarga uzatildi',
      });
    }
  }

  function sendError(e: unknown) {
    refreshLists();
    setFeedback({ variant: 'warning', title: 'Yuborilmadi', subtitle: errorText(e, 'Buyurtma yuborilmadi') });
  }

  async function submit() {
    if (sending || !target || cart.length === 0) return;
    // Stop list: tugagan taom savatda qolgan bo'lsa — server ham rad etadi, oldindan aytamiz
    const sold = cart.find((c) => soldOutIds.has(c.menuItemId));
    if (sold) {
      setFeedback({ variant: 'warning', title: `«${sold.name}» tugagan`, subtitle: 'Uni savatdan olib tashlang (stop list)' });
      return;
    }
    // Yangi yetkazish — avval telefon, manzil va yetkazish narxi
    if (composeType === OrderType.Delivery && !existingOrder) {
      setDelivery({ kind: 'create' });
      return;
    }
    const ctx = currentCtx();
    if (!ctx) return;
    setSending(true);
    try {
      const res = await postOrder(ctx);
      afterSend(ctx, res);
    } catch (e) {
      sendError(e);
    } finally {
      setSending(false);
    }
  }

  // Yetkazish oynasi: yangi buyurtma (telefon+manzil+narx+izoh bilan yaratish) yoki mavjudini tahrirlash.
  // Xato bo'lsa — throw: oyna xatoni o'zida ko'rsatadi va yopilmaydi.
  async function saveDelivery(info: DeliveryInfo) {
    if (delivery?.kind === 'edit') {
      const order = delivery.order;
      const updated = await api.patch<Order>(`/orders/${order.id}/delivery`, {
        phone: apiPhone(info.phone),
        address: info.address,
        note: info.note,
        deliveryFee: info.deliveryFee,
      });
      upsertOrder(updated);
      setDelivery(null);
      setFeedback({ variant: 'success', title: 'Yetkazish ma‘lumoti saqlandi', subtitle: `${phoneLabel(info.phone)} · ${info.address}` });
      return;
    }
    const ctx = currentCtx();
    if (!ctx || ctx.items.length === 0) {
      setDelivery(null);
      return;
    }
    setSending(true);
    try {
      const res = await postOrder(ctx, info);
      setDelivery(null);
      afterSend(ctx, res, info);
    } finally {
      setSending(false);
    }
  }

  // ================= Buyurtma amallari =================
  /**
   * Amallar qatori (Turi / Stol / Ofitsiant / Chek / Otkaz) natijasi: ro'yxat yangilanadi, tuzuvchi
   * yangilangan buyurtmaga o'tadi (stol o'zgarsa — yangi stol va hisob; turi o'zgarsa — o'sha ro'yxat).
   * null — butun hisob bekor qilindi.
   */
  const onOrderChanged = useCallback(
    (o: Order | null, previousId?: string) => {
      refreshLists();
      if (!o) {
        if (previousId) dropOrder(previousId);
        const tg = live.current.target;
        if (tg?.kind === 'table') {
          // Stolda boshqa hisob qolsa — o'sha tanlanadi, aks holda ro'yxatga qaytamiz
          const rest = (checksRef.current.get(tg.tableId) ?? []).filter((c) => c.id !== previousId);
          if (rest.length) setTarget({ ...tg, checkNo: checkNoOf(rest[0]) });
          else closeComposer();
        } else {
          closeComposer();
        }
        return;
      }
      upsertOrder(o);
      const type = orderTypeOf(o);
      if (type === OrderType.DineIn && o.tableId) {
        lastCheck.current.set(o.tableId, checkNoOf(o));
        setTarget({ kind: 'table', tableId: o.tableId, checkNo: checkNoOf(o) });
        // Boshqa zalga ko'chdi — ortga qaytganda o'sha zal ko'rinsin ("Barcha" o'zgarmaydi)
        const hall = o.hall;
        setTab((cur) => {
          const h = tabHall(cur);
          return h !== null && hall && h !== hall ? hallTab(hall) : cur;
        });
      } else {
        // Turi o'zgardi (olib ketish / yetkazish) — ortga qaytganda o'sha ro'yxat
        if (type !== OrderType.DineIn) setTab(type);
        setTarget({ kind: 'order', orderId: o.id, type });
        targetStamp.current = Date.now();
      }
    },
    [refreshLists, dropOrder, upsertOrder, closeComposer],
  );

  // Hisob bo'lindi: ikkala hisob yangilanadi va yangi (ko'chgan) hisob tanlanadi
  const onSplit = useCallback(
    (r: SplitOrderResult) => {
      upsertOrder(r.source);
      upsertOrder(r.target);
      refreshLists();
      if (r.target?.tableId) {
        lastCheck.current.set(r.target.tableId, checkNoOf(r.target));
        setTarget({ kind: 'table', tableId: r.target.tableId, checkNo: checkNoOf(r.target) });
      }
      setFeedback({
        variant: 'success',
        title: 'Hisob bo‘lindi',
        subtitle: `${orderDisplayName(r.target)} — ajratilgan taomlar alohida hisobda`,
      });
    },
    [upsertOrder, refreshLists],
  );

  async function saveOrderNote(note: string) {
    const order = existingOrder;
    if (!order) return;
    try {
      const updated = await api.post<Order>(`/orders/${order.id}/note`, { note });
      upsertOrder(updated);
      setOrderNoteOpen(false);
      setFeedback({ variant: 'success', title: 'Izoh saqlandi', subtitle: note || 'Izoh olib tashlandi' });
    } catch (e) {
      setOrderNoteOpen(false);
      setFeedback({ variant: 'warning', title: 'Xatolik', subtitle: errorText(e, 'Izoh saqlanmadi') });
    }
  }

  async function openCustomer() {
    try {
      setCustomers(await api.get<Customer[]>('/customers'));
    } catch {
      setCustomers([]);
    }
    setCustomerOpen(true);
  }
  async function pickCustomer(customerId: string | null) {
    const order = existingOrder;
    if (!order) return;
    try {
      const updated = await api.post<Order>(`/orders/${order.id}/customer`, { customerId: customerId ?? undefined });
      upsertOrder(updated);
      setCustomerOpen(false);
      setFeedback({ variant: 'success', title: 'Mijoz biriktirildi', subtitle: updated?.customerName ?? 'Olib tashlandi' });
    } catch (e) {
      setCustomerOpen(false);
      setFeedback({ variant: 'warning', title: 'Xatolik', subtitle: errorText(e, 'Mijoz saqlanmadi') });
    }
  }

  // Otkaz natijasi: qisman — hisob yangilanadi; butun hisob — ro'yxatdan olinadi
  function voidDone(o: Order | null) {
    const req = voidReq;
    setVoidReq(null);
    if (!req) return;
    const name = orderDisplayName(req.order);
    onOrderChanged(o, req.order.id);
    setFeedback({
      variant: 'success',
      title: o ? 'Otkaz qilindi' : 'Hisob bekor qilindi',
      subtitle: `${name} — oshxonaga OTKAZ cheki yuboriladi`,
    });
  }

  // To'lov (kassa ruxsati) — kartochkadan yoki ochiq buyurtmadan
  const paidIds = useRef(new Set<string>());
  const openPay = useCallback((o: Order) => {
    const st = live.current;
    if (st.existingOrder?.id === o.id && st.cart.length > 0) {
      setFeedback({
        variant: 'warning',
        title: 'Avval yangi taomlarni yuboring',
        subtitle: 'To‘lovdan oldin savatdagi taomlarni «Tasdiqlash» bilan yuboring',
      });
      return;
    }
    setPayOrder(o);
  }, []);
  const onPaid = useCallback(
    (r: PayResult) => {
      const id = r.order?.id;
      if (r.fullyPaid && id) {
        paidIds.current.add(id);
        handledClose.current.add(id);
      }
      refreshLists();
    },
    [refreshLists],
  );
  function closePay() {
    const o = payOrder;
    setPayOrder(null);
    if (!o || !paidIds.current.has(o.id)) return;
    // To'liq to'landi — ro'yxatdan olinadi; stolda boshqa hisob bo'lsa — o'sha tanlanadi, aks holda tuzuvchi yopiladi
    dropOrder(o.id);
    const tg = live.current.target;
    if (tg?.kind === 'order' && tg.orderId === o.id) closeComposer();
    else if (tg?.kind === 'table' && tg.tableId === o.tableId) {
      const rest = (checksRef.current.get(tg.tableId) ?? []).filter((c) => c.id !== o.id);
      if (rest.length) setTarget({ ...tg, checkNo: checkNoOf(rest[0]) });
      else closeComposer();
    }
  }

  // ================= Ko'rinish =================
  // Bo'lim printeriga chek chiqmadi (faqat shu sahifadan yuborilgan buyurtmalar) — ekranni to'smaydi
  const printToasts = <PrintFailedToasts toasts={printFails.toasts} onDismiss={printFails.dismiss} compact />;
  const lineEditItem = lineEdit?.mode === 'edit' ? lineEdit.line : null;
  const lineEditMenu = lineEdit?.mode === 'add' ? lineEdit.item : null;

  const modals = (
    <>
      {feedback && (
        <FeedbackModal variant={feedback.variant} title={feedback.title} subtitle={feedback.subtitle} onClose={() => setFeedback(null)} />
      )}
      {printToasts}
      {lineEditMenu && (
        <LineEditModal
          key={`add:${lineEditMenu.id}`}
          mode="add"
          name={lineEditMenu.name}
          unit={lineEditMenu.unit ?? MenuUnit.Piece}
          menuPrice={Number(lineEditMenu.price) || 0}
          initial={{
            quantity: (lineEditMenu.unit ?? MenuUnit.Piece) === MenuUnit.Weight ? 0 : 1,
            price: Number(lineEditMenu.price) || 0,
            note: '',
          }}
          canEditPrice={priceEditable}
          focusNote={lineEdit?.focusNote}
          onSave={saveLineEdit}
          onClose={() => setLineEdit(null)}
        />
      )}
      {lineEditItem && (
        <LineEditModal
          key={`edit:${lineEditItem.key}`}
          mode="edit"
          name={lineEditItem.name}
          unit={lineEditItem.unit}
          menuPrice={lineEditItem.menuPrice}
          initial={{ quantity: lineEditItem.quantity, price: lineEditItem.price, note: lineEditItem.note ?? '' }}
          canEditPrice={priceEditable}
          focusNote={lineEdit?.focusNote}
          onSave={saveLineEdit}
          onRemove={() => {
            removeLine(lineEditItem.key);
            setLineEdit(null);
          }}
          onClose={() => setLineEdit(null)}
        />
      )}
      {orderNoteOpen && existingOrder && (
        <OrderNoteModal initial={existingOrder.note ?? ''} onSave={saveOrderNote} onClose={() => setOrderNoteOpen(false)} />
      )}
      {customerOpen && existingOrder && (
        <CustomerPickModal
          customers={customers}
          currentName={existingOrder.customerName}
          onPick={(id) => void pickCustomer(id)}
          onClose={() => setCustomerOpen(false)}
        />
      )}
      {sentSheet && existingOrder && (
        <SentLineSheet
          order={existingOrder}
          item={sentSheet}
          canPrice={canVoid}
          onVoid={() => {
            setVoidReq({ order: existingOrder, itemIds: [sentSheet.id] });
            setSentSheet(null);
          }}
          onPrice={() => {
            setPriceItem(sentSheet);
            setSentSheet(null);
          }}
          onClose={() => setSentSheet(null)}
        />
      )}
      {priceItem && existingOrder && (
        <SentPriceModal
          order={existingOrder}
          item={priceItem}
          onClose={() => setPriceItem(null)}
          onDone={(o) => {
            setPriceItem(null);
            upsertOrder(o);
            refreshLists();
          }}
        />
      )}
      {voidReq && (
        <VoidModal
          order={voidReq.order}
          itemIds={voidReq.itemIds}
          wholeOrder={voidReq.whole}
          onClose={() => setVoidReq(null)}
          onDone={voidDone}
        />
      )}
      {delivery && (
        <DeliveryInfoModal
          title={delivery.kind === 'edit' ? `${orderDisplayName(delivery.order)} — yetkazish ma‘lumoti` : undefined}
          initial={
            delivery.kind === 'edit'
              ? {
                  phone: delivery.order.phone ?? '',
                  address: delivery.order.address ?? '',
                  note: delivery.order.note ?? '',
                  deliveryFee: delivery.order.deliveryFee ?? 0,
                }
              : undefined
          }
          onSave={saveDelivery}
          onClose={() => setDelivery(null)}
        />
      )}
      {payOrder && <PaymentModal order={payOrder} onClose={closePay} onPaid={onPaid} />}
      {pendingOpen && <PendingOrdersModal onClose={() => setPendingOpen(false)} />}
    </>
  );

  const mobileNav = (active: 'tables' | 'myorders' | 'profile') => (
    <WaiterMobileNav
      active={active}
      mode={mode}
      myOrdersCount={myOrders.length}
      onTables={goHome}
      onMyOrders={goMyOrders}
      onProfile={goProfile}
    />
  );

  // ---------- Buyurtmalar tarixi ----------
  if (screen === 'history') {
    return (
      <AppShell title={`Ofitsiant — ${me.name}`} hideMobileControls>
        {modals}
        <div className="h-full pb-16 md:pb-0">
          <MyOrdersView
            waiterId={me.id}
            waiterName={me.name}
            onBack={() => setScreen(historyFromProfile ? 'profile' : 'home')}
          />
        </div>
        {mobileNav('profile')}
      </AppShell>
    );
  }

  // ---------- Profil (telefon) ----------
  if (screen === 'profile') {
    return (
      <AppShell title="Profil" hideMobileControls>
        {modals}
        <WaiterProfileView onHistory={goHistory} />
        {mobileNav('profile')}
      </AppShell>
    );
  }

  // ---------- Mening buyurtmalarim (telefon) ----------
  if (screen === 'myorders') {
    return (
      <AppShell title="Mening buyurtmalarim" hideMobileControls>
        {modals}
        <div className="h-full overflow-auto p-3 sm:p-6 pb-24 md:pb-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs text-muted font-semibold">Ochiq buyurtmalar</div>
              <div className="font-extrabold text-xl">Mening buyurtmalarim</div>
            </div>
            <span className="text-sm font-bold text-muted">{myOrders.length} ta</span>
          </div>
          {myOrders.length === 0 ? (
            <div className="text-center text-muted mt-16 px-6">
              <div className="text-5xl mb-3">🍽️</div>
              <div className="font-semibold text-text">Faol buyurtmangiz yo‘q.</div>
              <div className="text-sm mt-1">Pastdagi birinchi tugmadan stol yoki yangi buyurtma oching.</div>
            </div>
          ) : (
            <OrderCardsGrid orders={myOrders} now={now} onOpen={openOrder} onPay={canPay ? openPay : undefined} showType />
          )}
        </div>
        {mobileNav('myorders')}
      </AppShell>
    );
  }

  // ---------- Bosh ekran: yagona qator (zallar | rejimlar) + stollar / buyurtmalar ro'yxati ----------
  if (!target) {
    const listOrders = mode === OrderType.DineIn ? [] : ordersByType[mode];
    const listPending = mode === OrderType.DineIn ? [] : pendingNewByType[mode];
    const firstLoad = mode === OrderType.DineIn ? !tablesLoaded || !ordersLoaded : !ordersLoaded;
    const hallList = selectedHall ? tablesByHall.get(selectedHall) ?? [] : [];
    const isAll = tab === 'all';
    const shownTableCount = isAll ? tabHalls.reduce((n, h) => n + (tablesByHall.get(h)?.length ?? 0), 0) : hallList.length;
    const shownBusy = isAll ? totalBusy : busyByHall.get(selectedHall ?? '') ?? 0;
    return (
      <AppShell title={`${canPay ? 'Kassir' : 'Ofitsiant'} — ${me.name}`} hideMobileControls>
        {modals}
        <div className="h-full flex flex-col">
          {/* Yagona qator: [Barcha] | zallar | Olib ketish | Yetkazib berish — o'ngda amallar */}
          <div className="shrink-0 px-3 sm:px-5 pt-3 sm:pt-4 pb-2 flex items-center gap-2 sm:gap-3">
            <div className="flex-1 min-w-0">
              <WaiterTabs
                halls={tabHalls}
                busyByHall={busyByHall}
                totalBusy={totalBusy}
                active={tab}
                takeawayCount={takeawayCount}
                deliveryCount={deliveryCount}
                compact={isNarrow}
                onSelect={selectTab}
              />
            </div>
            <div className="hidden md:flex items-center gap-2 shrink-0">
              {canPay && (
                // Kassir: bir bosishda kassaga (to'lovlar ro'yxati)
                <button
                  type="button"
                  onClick={() => nav.open('cashier')}
                  title="Kassa"
                  data-testid="open-cashier"
                  className="h-14 px-4 rounded-xl border-2 border-success bg-success/10 hover:bg-success/20 font-extrabold flex items-center gap-2 text-text"
                >
                  <IconCash className="w-6 h-6 text-success" />
                  <span className="hidden lg:inline">Kassa</span>
                </button>
              )}
              <button
                type="button"
                onClick={openHistory}
                title={t('waiter.myOrders')}
                aria-label={t('waiter.myOrders')}
                className="h-14 px-4 rounded-xl border border-border bg-surface hover:border-primary hover:bg-surface-hover font-bold flex items-center gap-2"
              >
                <IconList className="w-5 h-5 text-muted" />
                <span className="hidden 2xl:inline">{t('waiter.myOrders')}</span>
              </button>
              <BackButton className="h-14 rounded-xl px-4" />
            </div>
          </div>

          {/* Stolga: zal nomi, band/bo'sh soni va ranglar izohi */}
          {mode === OrderType.DineIn && shownTableCount > 0 && (
            <div className="shrink-0 px-3 sm:px-5 pb-1.5 flex items-center gap-3 min-w-0">
              <span className="text-sm font-bold text-muted truncate">
                {isAll ? 'Barcha zallar' : selectedHall} · {shownTableCount} ta stol
                {shownBusy > 0 && <span className="text-primary"> · {shownBusy} band</span>}
              </span>
              <div className="hidden lg:block ml-auto shrink-0">
                <TableLegend />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto px-3 sm:px-5 pt-2 pb-24 md:pb-6">
            {firstLoad ? (
              <LoadingOrError error={loadError} onRetry={refreshLists} />
            ) : mode === OrderType.DineIn ? (
              shownTableCount === 0 ? (
                <div className="text-center text-muted mt-16">
                  <div className="text-5xl mb-3">🪑</div>
                  <div className="font-semibold text-text">Stollar yo‘q</div>
                  <div className="text-sm mt-1">Boshqaruv → Stollar bo‘limida zal va stollar qo‘shing.</div>
                </div>
              ) : isAll ? (
                <HallSections
                  halls={tabHalls}
                  tablesByHall={tablesByHall}
                  busyByHall={busyByHall}
                  checksByTable={checksByTable}
                  queuedTableIds={queuedTableIds}
                  myId={me.id}
                  now={now}
                  onOpen={openTable}
                />
              ) : (
                <TableGrid
                  tables={hallList}
                  checksByTable={checksByTable}
                  queuedTableIds={queuedTableIds}
                  myId={me.id}
                  now={now}
                  onOpen={openTable}
                />
              )
            ) : (
              <>
                <OrderCardsGrid
                  orders={listOrders}
                  pending={listPending}
                  queuedAppends={queuedAppends}
                  now={now}
                  onNew={openNewInMode}
                  onOpen={openOrder}
                  onPay={canPay ? openPay : undefined}
                  onOpenPending={openPendingList}
                />
                {listOrders.length === 0 && listPending.length === 0 && (
                  <div className="text-center text-muted mt-10 px-6">
                    <div className="font-semibold text-text">
                      Hozircha ochiq {mode === OrderType.Takeaway ? 'olib ketish' : 'yetkazish'} buyurtmasi yo‘q
                    </div>
                    <div className="text-sm mt-1">«Yangi buyurtma»ni bosing — menyudan taom tanlab, «Tasdiqlash».</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {mobileNav('tables')}
      </AppShell>
    );
  }

  // ---------- Tuzuvchi: kategoriyalar + rasmli menyu + buyurtma paneli ----------
  const searching = !!searchQ;
  const panelCount = (existingOrder?.items.length ?? 0) + cart.length;
  const actionsBar = existingOrder ? (
    <OrderActionsBar
      order={existingOrder}
      siblings={dineIn ? tableChecks : undefined}
      compact
      blocked={cart.length > 0 ? 'Avval savatdagi yangi taomlarni «Tasdiqlash» bilan yuboring' : null}
      onChanged={(o) => {
        onOrderChanged(o, existingOrder.id);
        // Butun hisob bekor qilindi (otkaz) — panel yopiladi, shuning uchun xabar alohida
        if (!o) {
          setFeedback({
            variant: 'success',
            title: 'Hisob bekor qilindi',
            subtitle: `${orderDisplayName(existingOrder)} — oshxonaga OTKAZ cheki yuboriladi`,
          });
        }
      }}
      onSplit={onSplit}
    />
  ) : null;
  return (
    <AppShell
      title={`${me.name} — ${composerTitle}`}
      hideMobileControls
      mobileDrawerTitle="Kategoriyalar"
      mobileDrawer={(close) => (
        <CategoryDrawerList
          categories={visibleCats}
          active={activeCat}
          onSelect={selectCategory}
          showFavorites={hasFavorites}
          searching={searching}
          close={close}
        />
      )}
    >
      {modals}
      <div className="h-full flex flex-col">
        {/* Sarlavha: orqaga, qidiruv */}
        <div className="shrink-0 flex items-center gap-2 sm:gap-3 px-3 py-2.5 border-b border-border">
          <button
            type="button"
            onClick={() => void leaveComposer()}
            data-testid="composer-back"
            aria-label="Ortga"
            className="shrink-0 h-12 px-3 sm:px-4 rounded-xl border border-border bg-surface hover:border-primary hover:bg-surface-hover font-bold flex items-center gap-1.5"
          >
            <IconBack className="w-5 h-5" />
            <span className="hidden sm:inline">Ortga</span>
          </button>
          {/* Buyurtma nomi kompyuterda o'ng paneldagi sarlavhada; telefonda — pastdagi qatorda */}
          <div className="relative flex-1 min-w-0">
            <IconSearch className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              data-testid="menu-search"
              placeholder="Taom qidirish (nom yoki mahsulot)…"
              className="w-full h-12 pl-10 pr-12 rounded-xl bg-surface border border-border outline-none focus:border-primary text-base"
            />
            {menuSearch && (
              <button
                type="button"
                onClick={() => setMenuSearch('')}
                aria-label="Qidiruvni tozalash"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg text-muted hover:text-danger flex items-center justify-center"
              >
                <IconClose className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Telefon: buyurtma nomi + kategoriyalar */}
        <div className="md:hidden shrink-0 border-b border-border">
          <div className="px-3 pt-2 flex items-center gap-2 min-w-0">
            <OrderTypeBadge type={composeType} short solid />
            <span className="font-extrabold truncate">
              {composerTitle}
              {dineIn && <span className="text-primary"> · Hisob-{selectedCheck}</span>}
            </span>
          </div>
          <CategoryChips
            categories={visibleCats}
            active={activeCat}
            onSelect={selectCategory}
            showFavorites={hasFavorites}
            searching={searching}
          />
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Chap: kategoriyalar (kompyuter/monoblok) */}
          <aside className="hidden md:block w-44 xl:w-52 shrink-0 p-3 border-r border-border overflow-auto">
            <CategoryRail
              categories={visibleCats}
              active={activeCat}
              onSelect={selectCategory}
              showFavorites={hasFavorites}
              searching={searching}
            />
          </aside>

          {/* O'rta: taomlar */}
          <div className="flex-1 min-w-0 overflow-auto p-3 sm:p-4 pb-40 md:pb-4">
            {menu.length === 0 ? (
              menuState === 'error' ? (
                <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
                  <span className="font-semibold text-text">Menyu yuklanmadi</span>
                  <button
                    type="button"
                    onClick={() => void loadMenu()}
                    className="h-12 px-5 rounded-xl bg-primary-hover text-white font-bold flex items-center gap-2"
                  >
                    <IconRefresh className="w-5 h-5" /> Qayta urinish
                  </button>
                </div>
              ) : menuState === 'loading' ? (
                <LoadingOrError error={false} onRetry={loadMenu} text="Menyu yuklanmoqda…" />
              ) : (
                <div className="text-center text-muted py-16">Menyu bo‘sh — Boshqaruv → Menyu bo‘limida taom qo‘shing.</div>
              )
            ) : (
              <MenuGrid
                items={shownItems}
                qtyById={qtyById}
                onAdd={addToCart}
                onAddWithNote={addWithNote}
                emptyText={searching ? `«${menuSearch.trim()}» bo‘yicha taom topilmadi` : 'Bu kategoriyada taom yo‘q'}
              />
            )}
          </div>

          {/* Telefon: buyurtma panelini ochuvchi suzuvchi tugma (pastki navigatsiya ustida) */}
          {!cartOpen && panelCount > 0 && (
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              data-testid="open-cart"
              className="md:hidden fixed right-3 left-3 z-40 h-14 bg-primary-hover text-white rounded-2xl px-4 flex items-center gap-3 shadow-2xl shadow-primary/30 active:scale-[0.98] transition-transform"
              style={{ bottom: 'calc(68px + env(safe-area-inset-bottom))' }}
            >
              <IconCart className="w-6 h-6" />
              <span className="bg-white/25 rounded-full px-2.5 py-0.5 text-sm font-extrabold">{panelCount}</span>
              <span className="font-bold">{cart.length > 0 ? 'Buyurtma' : 'Hisob'}</span>
              <span className="ml-auto font-black text-lg tabular-nums">{formatSum(totals.total)}</span>
            </button>
          )}
          {/* Telefon: panel ochilganda orqa fon */}
          {cartOpen && <div className="md:hidden fixed inset-0 bg-black/50 z-30" onClick={() => setCartOpen(false)} />}

          <OrderPanel
            type={composeType}
            title={composerTitle}
            order={existingOrder}
            checks={dineIn ? tableChecks : undefined}
            selectedCheck={selectedCheck}
            onSelectCheck={dineIn ? selectCheck : undefined}
            cart={cart}
            totals={totals}
            sending={sending}
            canPay={canPay}
            canVoid={canVoid}
            takeawayMode={takeawayMode}
            onToggleTakeawayMode={dineIn ? () => setTakeawayMode((v) => !v) : undefined}
            soldOutIds={soldOutIds}
            open={cartOpen}
            onCloseSheet={() => setCartOpen(false)}
            onChangeQty={changeQty}
            onEditLine={editLine}
            onRemoveLine={removeLine}
            onToggleLineTakeaway={toggleLineTakeaway}
            onSentLine={(it) => setSentSheet(it)}
            onVoidLine={(it) => existingOrder && setVoidReq({ order: existingOrder, itemIds: [it.id] })}
            onSubmit={() => void submit()}
            onPay={() => existingOrder && openPay(existingOrder)}
            onEditDelivery={() => existingOrder && setDelivery({ kind: 'edit', order: existingOrder })}
            menu={
              existingOrder
                ? {
                    onNote: () => setOrderNoteOpen(true),
                    onCustomer: () => void openCustomer(),
                    onAnnul: canVoid ? () => setVoidReq({ order: existingOrder, whole: true }) : undefined,
                  }
                : null
            }
            actionsBar={actionsBar}
          />
        </div>
      </div>
      {mobileNav('tables')}
    </AppShell>
  );
}

/** Birinchi yuklanish: aylanma belgi yoki xato + "Qayta urinish" */
function LoadingOrError({ error, onRetry, text }: { error: boolean; onRetry: () => void; text?: string }) {
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
        <span className="font-semibold text-text">Server bilan aloqa yo‘q — ma'lumot yuklanmadi</span>
        <button
          type="button"
          onClick={onRetry}
          className="h-12 px-5 rounded-xl bg-primary-hover text-white font-bold flex items-center gap-2"
        >
          <IconRefresh className="w-5 h-5" /> Qayta urinish
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted">
      <span className="w-8 h-8 rounded-full border-[3px] border-primary border-t-transparent animate-spin" />
      <span className="text-sm font-semibold">{text ?? 'Yuklanmoqda…'}</span>
    </div>
  );
}
