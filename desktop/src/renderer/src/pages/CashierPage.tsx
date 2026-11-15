import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Order,
  OrderStatus,
  OrderType,
  Receipt,
  ReportSummary,
  SOCKET_EVENTS,
  hasCapability,
  orderDisplayName,
  orderTypeOf,
  roundSum,
} from '@hardweb-pos/shared';
import type { MenuItem, SplitOrderResult } from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { formatSum } from '../components/ui';
import { ReceiptPreview } from '../components/ReceiptPreview';
import { Dashboard } from '../components/Dashboard';
import { PrintFailedToasts, usePrintFailedToasts } from '../components/PrintFailedToasts';
import PaymentModal, { type PayResult } from '../components/PaymentModal';
import SplitCheckModal from '../components/SplitCheckModal';
import OrderModeTabs, { type OrderModeValue } from '../components/OrderModeTabs';
import DeliveryInfoModal, { type DeliveryInfo } from '../components/DeliveryInfoModal';
import { CashierOrderCard } from '../components/cashier/CashierOrderCard';
import { CashMovementsModal } from '../components/cashier/CashMovementsModal';
import { DebtsModal } from '../components/cashier/DebtsModal';
import { StopListModal } from '../components/cashier/StopListModal';
import { orderTitle, todayKey } from '../components/cashier/orderType';
import { readLocal, useMediaQuery, useNow, writeLocal } from '../components/cashier/hooks';
import {
  AlertIcon,
  CashFlowIcon,
  ChartIcon,
  CheckIcon,
  DebtIcon,
  PlusIcon,
  ReceiptIcon,
  StopIcon,
  TablesIcon,
} from '../components/cashier/icons';
import { ReceiptsTab } from './admin/ReceiptsTab';
import { BackButton } from '../components/BackButton';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { sortHalls, usePosSettings } from '../lib/posSettings';
import { useI18n } from '../state/i18n';
import { useAuth } from '../state/auth';
import { useAppNav } from '../state/appNav';

/** To'langan, lekin chek hali chiqarilmagan hisob (shu qurilmada saqlanadi) */
interface UnprintedEntry {
  order: Order;
  receipt: Receipt;
  at: number; // qachon to'langan (ms)
}

/** Kartochka to'ri elementi: ochiq hisob yoki "chek chiqmadi" */
interface Bill {
  key: string;
  order: Order;
  receipt?: Receipt;
  unprinted: boolean;
}

const MODE_KEY = 'cashier.mode';
const UNPRINTED_KEY = 'cashier.unprinted.v1';
const MAX_UNPRINTED = 30;
const UNPRINTED_TTL_MS = 24 * 60 * 60 * 1000;
const MODES: OrderModeValue[] = ['all', OrderType.DineIn, OrderType.Takeaway, OrderType.Delivery];

const EMPTY_TEXT: Record<string, string> = {
  all: 'Ochiq hisob yo‘q',
  [OrderType.DineIn]: 'Stollarda ochiq hisob yo‘q',
  [OrderType.Takeaway]: 'Olib ketish buyurtmalari yo‘q',
  [OrderType.Delivery]: 'Yetkazib berish buyurtmalari yo‘q',
};

function loadMode(): OrderModeValue {
  const v = readLocal(MODE_KEY);
  return (MODES as string[]).includes(v ?? '') ? (v as OrderModeValue) : 'all';
}

// "Chek chiqmadi" ro'yxati shu qurilmada saqlanadi — kassir ofitsiant ekraniga o'tib (yangi
// buyurtma) qaytganda yoki dastur qayta ochilganda ham chop etilmagan cheklar yo'qolmaydi.
function loadUnprinted(): UnprintedEntry[] {
  try {
    const raw = readLocal(UNPRINTED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    const min = Date.now() - UNPRINTED_TTL_MS;
    return list
      .filter(
        (u): u is UnprintedEntry =>
          !!u && typeof u === 'object' && !!u.order?.id && !!u.receipt?.orderId && typeof u.at === 'number' && u.at >= min,
      )
      .slice(0, MAX_UNPRINTED);
  } catch {
    return [];
  }
}

/**
 * Yangi ro'yxatda o'zgarmagan buyurtmalar uchun eski obyektni qaytaradi — memo kartochkalar
 * faqat haqiqatan o'zgarganda qayta chiziladi (socket har o'zgarishda butun ro'yxatni yuklaydi).
 */
function reuseUnchanged(prev: Order[], next: Order[]): Order[] {
  if (prev.length === 0) return next;
  const byId = new Map(prev.map((o) => [o.id, o] as const));
  let identical = prev.length === next.length;
  const out = next.map((o, i) => {
    const old = byId.get(o.id);
    if (old && JSON.stringify(old) === JSON.stringify(o)) {
      if (prev[i] !== old) identical = false;
      return old;
    }
    identical = false;
    return o;
  });
  return identical ? prev : out;
}

// Kassa moduli (TZ 5.3): ochiq hisoblar (stolga — har bir hisob alohida kartochka, bitta stolning
// hisoblari yonma-yon; olib ketish; yetkazib berish), to'lov, chek, hisobni bo'lish, kirim/chiqim va
// kassa holati, qarzlar, stop list, cheklar tarixi, hisobot. To'lov oynasi — PaymentModal (ofitsiant
// ekrani ham ishlatadi). "Stollar" — POS ekrani (kassir ofitsiantlar o'rniga ham ishlaydi).
// Barcha summalar shared/money bilan — server, chek va demo bilan aynan bir xil, butun so'mda.
export function CashierPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const nav = useAppNav();
  const pos = usePosSettings();
  const canHistory = hasCapability(user, 'history');
  // Tushum/statistikani ko'rish ruxsati (direktor bera oladi)
  const canRevenue = hasCapability(user, 'revenue') || hasCapability(user, 'reports');
  // POS ekrani (stollar, yangi buyurtma, hisobni o'zgartirish) — 'waiter' ruxsati bilan
  const canPos = hasCapability(user, 'waiter');
  // Hisobni bo'lish — ofitsiant yoki kassir (server ham shunday tekshiradi)
  const canSplit = canPos || hasCapability(user, 'cashier');
  const narrow = useMediaQuery('(max-width: 639px)');
  const now = useNow(30_000);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [payOrder, setPayOrder] = useState<Order | null>(null);
  const [splitOrder, setSplitOrder] = useState<Order | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [unprinted, setUnprinted] = useState<UnprintedEntry[]>(loadUnprinted);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [expensesTotal, setExpensesTotal] = useState(0);
  const [showCash, setShowCash] = useState(false);
  const [showDebts, setShowDebts] = useState(false);
  const [showStop, setShowStop] = useState(false);
  const [stopCount, setStopCount] = useState(0);
  const [mode, setMode] = useState<OrderModeValue>(loadMode);
  const [hallFilter, setHallFilter] = useState('');
  const [deliveryEdit, setDeliveryEdit] = useState<Order | null>(null);
  const [toast, setToast] = useState('');
  // Bo'lim printeriga chek chiqmadi (server "print:failed") — kassa hammasini ko'radi
  const printFails = usePrintFailedToasts({ max: 6 });

  const ordersRef = useRef<Order[]>([]);
  const payOrderRef = useRef<Order | null>(null);
  payOrderRef.current = payOrder;
  const canRevenueRef = useRef(canRevenue);
  canRevenueRef.current = canRevenue;
  const reqSeq = useRef(0);
  const refreshTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => writeLocal(MODE_KEY, mode), [mode]);
  useEffect(() => {
    writeLocal(UNPRINTED_KEY, unprinted.length ? JSON.stringify(unprinted) : null);
  }, [unprinted]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const showToast = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(''), 4000);
  }, []);

  const refreshOrders = useCallback(async () => {
    const seq = ++reqSeq.current;
    try {
      const list = await api.get<Order[]>('/orders');
      if (seq !== reqSeq.current) return; // kechikkan (eskirgan) javob
      const next = reuseUnchanged(ordersRef.current, Array.isArray(list) ? list : []);
      ordersRef.current = next;
      setOrders(next);
      setOrdersLoaded(true);
      setLoadError('');
      // Ochiq to'lov oynasi eng yangi holat bilan (ofitsiant taom qo'shgan/olib tashlagan bo'lishi mumkin)
      setPayOrder((cur) => (cur ? next.find((o) => o.id === cur.id) ?? cur : cur));
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setLoadError((e as Error)?.message || 'Buyurtmalar yuklanmadi');
      setOrdersLoaded(true);
    }
  }, []);

  // Bugungi tushum / sof tushum (faqat tushumni ko'rish ruxsati bo'lsa). Sof tushum = tushum − chiqim
  // (kirim — tushum emas, hisobga olinmaydi).
  const refreshStats = useCallback(() => {
    if (!canRevenueRef.current) return;
    api.get<ReportSummary>('/reports/summary?period=day').then(setSummary).catch(() => {});
    const d = todayKey();
    api
      .get<{ total?: number; items?: { amount?: number; kind?: string }[] }>(`/expenses?from=${d}&to=${d}&date=${d}&kind=chiqim`)
      .then((res) => {
        // Eski server turini bilmaydi — barcha yozuvlar chiqim; yangi server — faqat chiqim qaytaradi
        const items = Array.isArray(res?.items) ? res.items : null;
        const total = items
          ? items.filter((x) => x?.kind !== 'kirim').reduce((s, x) => s + roundSum(x?.amount), 0)
          : roundSum(res?.total);
        setExpensesTotal(total);
      })
      .catch(() => {});
  }, []);

  // Stop list: nechta taom tugagan (sarlavhadagi tugmada qizil son)
  const refreshStopCount = useCallback(() => {
    api
      .get<MenuItem[]>('/menu/items')
      .then((list) => setStopCount(Array.isArray(list) ? list.filter((it) => it.available === false).length : 0))
      .catch(() => {});
  }, []);

  // Socket hodisalari ketma-ket kelsa (bir buyurtma — bir nechta hodisa) bitta yangilash
  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      void refreshOrders();
      refreshStats();
    }, 200);
  }, [refreshOrders, refreshStats]);

  useEffect(() => {
    void refreshOrders();
    refreshStats();
    refreshStopCount();
    const socket = getSocket();
    let menuTimer: number | undefined;
    // Kassa printeri ishlari (zakas cheki, relay schot / to'lov cheki) bu yerda EMAS — ular
    // components/PrintRelayHost.tsx'da (App darajasida, kassir qaysi ekranda bo'lmasin ishlaydi).
    // Bu yerda qayta qo'shilsa — har chek ikki marta chiqadi.
    const onChange = () => scheduleRefresh();
    // Menyu o'zgardi (stop list) — tugagan taomlar soni
    const onMenu = () => {
      window.clearTimeout(menuTimer);
      menuTimer = window.setTimeout(refreshStopCount, 400);
    };
    const onConnect = () => {
      scheduleRefresh();
      refreshStopCount();
    };
    socket.on(SOCKET_EVENTS.ORDER_CREATED, onChange);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, onChange);
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, onChange);
    socket.on(SOCKET_EVENTS.MENU_CHANGED, onMenu);
    // Aloqa uzilib qayta ulanganda — o'tkazib yuborilgan o'zgarishlarni olamiz
    socket.on('connect', onConnect);
    return () => {
      window.clearTimeout(refreshTimer.current);
      window.clearTimeout(menuTimer);
      socket.off(SOCKET_EVENTS.ORDER_CREATED, onChange);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, onChange);
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, onChange);
      socket.off(SOCKET_EVENTS.MENU_CHANGED, onMenu);
      socket.off('connect', onConnect);
    };
  }, [refreshOrders, refreshStats, refreshStopCount, scheduleRefresh]);

  // ---- Ro'yxat: tur bo'yicha filtr, sanoq, tartib ----
  const active = useMemo(() => orders.filter((o) => o.status !== OrderStatus.Closed), [orders]);

  const counts = useMemo(() => {
    const c: Partial<Record<OrderModeValue, number>> = {
      all: active.length,
      [OrderType.DineIn]: 0,
      [OrderType.Takeaway]: 0,
      [OrderType.Delivery]: 0,
    };
    for (const o of active) {
      const ty = orderTypeOf(o);
      c[ty] = (c[ty] ?? 0) + 1;
    }
    return c;
  }, [active]);

  // Stolga hisoblar zallari (sozlamadagi tartibda)
  const halls = useMemo(
    () =>
      sortHalls(
        active.filter((o) => orderTypeOf(o) === OrderType.DineIn && o.hall).map((o) => o.hall as string),
        pos.hallOrder,
      ),
    [active, pos.hallOrder],
  );
  // Tanlangan zalda hisob qolmasa (filtr paneli yashiriladi) — hammasi ko'rsatiladi
  const activeHall = mode === OrderType.DineIn && hallFilter && halls.includes(hallFilter) ? hallFilter : '';

  // Stol -> shu stoldagi ochiq hisoblar (bo'lish manzili, to'lov oynasidagi "butun stol")
  const checksByTable = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of active) {
      if (orderTypeOf(o) !== OrderType.DineIn || !o.tableId) continue;
      const arr = m.get(o.tableId);
      if (arr) arr.push(o);
      else m.set(o.tableId, [o]);
    }
    return m;
  }, [active]);
  const siblingsOf = useCallback(
    (o: Order | null): Order[] | undefined =>
      o && o.tableId && orderTypeOf(o) === OrderType.DineIn ? (checksByTable.get(o.tableId) ?? []).filter((x) => x.id !== o.id) : undefined,
    [checksByTable],
  );

  const bills = useMemo(() => {
    const hallRank = new Map(halls.map((h, i) => [h, i] as const));
    const list: Bill[] = [
      ...unprinted.map((u) => ({ key: `u-${u.order.id}`, order: u.order, receipt: u.receipt, unprinted: true })),
      ...active.map((o) => ({ key: o.id, order: o, unprinted: false })),
    ].filter((b) => {
      const ty = orderTypeOf(b.order);
      if (mode !== 'all' && ty !== mode) return false;
      if (activeHall && (ty !== OrderType.DineIn || b.order.hall !== activeHall)) return false;
      return true;
    });
    // Tartib: chop etilmagan cheklar -> tayyor olib ketish/yetkazish -> qolgan olib ketish/yetkazish
    // (vaqt / kunlik raqam bo'yicha) -> stollar (zal tartibi, stol raqami, hisob raqami — bitta
    // stolning hisoblari yonma-yon)
    const rank = (b: Bill) => {
      if (b.unprinted) return 0;
      if (orderTypeOf(b.order) !== OrderType.DineIn) return b.order.status === OrderStatus.Ready ? 1 : 2;
      return 3;
    };
    return list.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (b.receipt?.createdAt ?? '').localeCompare(a.receipt?.createdAt ?? '');
      if (ra === 3) {
        const ha = hallRank.get(a.order.hall ?? '') ?? Number.MAX_SAFE_INTEGER;
        const hb = hallRank.get(b.order.hall ?? '') ?? Number.MAX_SAFE_INTEGER;
        if (ha !== hb) return ha - hb;
        const tn = (a.order.tableNumber ?? 0) - (b.order.tableNumber ?? 0);
        if (tn !== 0) return tn;
        // Bitta stoldagi hisoblar: Hisob 1, Hisob 2…
        return (a.order.checkNo ?? 1) - (b.order.checkNo ?? 1);
      }
      // Olib ketish / yetkazish: ENG YANGISI birinchi (0.3.2) — ochilgan vaqt bo'yicha, keyin raqam
      const byTime = String(b.order.openedAt).localeCompare(String(a.order.openedAt));
      if (byTime !== 0) return byTime;
      return (b.order.queueNumber ?? 0) - (a.order.queueNumber ?? 0);
    });
  }, [unprinted, active, mode, activeHall, halls]);

  const removeUnprinted = useCallback((orderId: string) => {
    setUnprinted((prev) => prev.filter((u) => u.order.id !== orderId));
  }, []);

  // Kartochka bosildi: chop etilmagan bo'lsa chek oynasi, aks holda to'lov
  const openBill = useCallback((o: Order, rc?: Receipt) => {
    if (rc) setReceipt(rc);
    else setPayOrder(o);
  }, []);
  const editDelivery = useCallback((o: Order) => setDeliveryEdit(o), []);
  // "O‘zgartirish" — POS ekranida shu hisob (stol + hisob / olib ketish / yetkazish) ochiladi
  const navRef = useRef(nav);
  navRef.current = nav;
  const editOnPos = useCallback((o: Order) => navRef.current.open('waiter', { waiterTarget: { orderId: o.id } }), []);
  const openSplit = useCallback((o: Order) => setSplitOrder(o), []);

  // To'lov natijasi: to'liq — chek "chek chiqmadi" ro'yxatiga (chop etilguncha), ro'yxat yangilanadi
  const handlePaid = useCallback(
    (res: PayResult) => {
      if (res?.fullyPaid && res.receipt) {
        const rc = res.receipt;
        const base = payOrderRef.current;
        const fresh = res.order;
        const order: Order | null =
          base && fresh
            ? {
                ...base,
                ...fresh,
                hall: fresh.hall ?? base.hall,
                waiterName: fresh.waiterName ?? base.waiterName,
                tableNumber: fresh.tableNumber ?? base.tableNumber,
              }
            : fresh ?? base;
        if (order) {
          setUnprinted((prev) =>
            [{ order, receipt: rc, at: Date.now() }, ...prev.filter((u) => u.order.id !== order.id)].slice(0, MAX_UNPRINTED),
          );
        }
      }
      scheduleRefresh();
    },
    [scheduleRefresh],
  );

  const closePayment = useCallback(() => setPayOrder(null), []);
  const receiptPrinted = useCallback((rc: Receipt) => removeUnprinted(rc.orderId), [removeUnprinted]);

  // Hisob bo'lindi (kartochkadan): ikkala hisob yangilanadi
  const splitDone = useCallback(
    (r: SplitOrderResult) => {
      setSplitOrder(null);
      showToast(`✓ Hisob bo‘lindi: ${orderDisplayName(r.target)} — ${formatSum(roundSum(r.target.total ?? 0))}`);
      scheduleRefresh();
    },
    [showToast, scheduleRefresh],
  );

  async function saveDelivery(o: Order, info: DeliveryInfo) {
    // Xato bo'lsa — DeliveryInfoModal ochiq qoladi va xabarni ko'rsatadi
    await api.patch(`/orders/${o.id}/delivery`, {
      phone: info.phone,
      address: info.address,
      note: info.note,
      deliveryFee: info.deliveryFee,
    });
    setDeliveryEdit(null);
    scheduleRefresh();
  }

  function newOrder() {
    const waiterMode = mode === OrderType.Takeaway || mode === OrderType.Delivery ? mode : OrderType.Takeaway;
    nav.open('waiter', { waiterMode });
  }

  // Bo'lim printeri xabarlari pastda (yuqoridagi "Yangi buyurtma" tugmasini to'smaydi); to'lov yoki
  // chek oynasi ochiq bo'lsa — vaqtincha yashiriladi (summani to'smasin), oyna yopilgach yana chiqadi
  const anyModal = !!payOrder || !!receipt || !!splitOrder || showCash || showDebts || showStop || !!deliveryEdit;
  const printToasts = (
    <PrintFailedToasts
      toasts={printFails.toasts}
      onDismiss={printFails.dismiss}
      onClearAll={printFails.clear}
      placement="bottom"
      hidden={anyModal}
    />
  );

  // Cheklar tarixi — alohida sahifa (filtrlar + infinite scroll, ReceiptsTab qayta ishlatiladi)
  if (historyOpen) {
    return (
      <AppShell title="Cheklar tarixi">
        {printToasts}
        <div className="h-full flex flex-col p-3 sm:p-6 overflow-hidden">
          <div className="flex items-center justify-between gap-2 mb-4 shrink-0">
            <div className="text-xl font-bold flex items-center gap-2">
              <ReceiptIcon className="w-6 h-6 text-primary" /> Cheklar tarixi
            </div>
            <button
              onClick={() => setHistoryOpen(false)}
              className="shrink-0 flex items-center gap-1.5 px-4 h-11 rounded-lg border border-border hover:border-primary hover:bg-surface-hover font-semibold"
            >
              <span className="text-lg leading-none">←</span> Orqaga
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <ReceiptsTab />
          </div>
        </div>
      </AppShell>
    );
  }

  if (dashboardOpen && canRevenue) {
    return (
      <AppShell title="Hisobot">
        {printToasts}
        <Dashboard onBack={() => setDashboardOpen(false)} />
      </AppShell>
    );
  }

  const net = (summary?.revenue ?? 0) - expensesTotal;

  return (
    <AppShell title={t('title.cashier')}>
      {printToasts}
      <div className="h-full flex flex-col">
        {/* 1-qator: buyurtma turlari (sanoq bilan) + stollar (POS) + yangi buyurtma */}
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 pt-3 pb-2">
          <div className="flex-1 min-w-0 overflow-x-auto">
            <OrderModeTabs
              value={mode}
              onChange={(v) => {
                setMode(v);
                setHallFilter('');
              }}
              counts={counts}
              withAll
              compact={narrow}
            />
          </div>
          {canPos && (
            <button
              type="button"
              data-testid="cashier-open-tables"
              onClick={() => nav.open('waiter')}
              aria-label="Stollar"
              title="Stollar — POS ekrani (taom qo‘shish, hisobni o‘zgartirish)"
              className="shrink-0 h-12 sm:h-14 px-3.5 sm:px-5 rounded-xl bg-surface border-2 border-primary/60 text-text hover:bg-primary/10 font-extrabold text-base sm:text-lg flex items-center gap-2 active:scale-[0.97] transition-transform"
            >
              <TablesIcon className="w-6 h-6 text-primary" />
              <span className="hidden sm:inline whitespace-nowrap">Stollar</span>
            </button>
          )}
          {canPos && (
            <button
              type="button"
              data-testid="cashier-new-order"
              onClick={newOrder}
              aria-label="Yangi buyurtma"
              title="Yangi buyurtma (olib ketish / yetkazib berish)"
              className="shrink-0 h-12 sm:h-14 px-3.5 sm:px-5 rounded-xl bg-primary-hover text-white font-extrabold text-base sm:text-lg flex items-center gap-2 shadow-lg shadow-primary/25 hover:brightness-110 active:scale-[0.97] transition-transform"
            >
              <PlusIcon className="w-6 h-6" />
              <span className="hidden sm:inline whitespace-nowrap">Yangi buyurtma</span>
            </button>
          )}
        </div>

        {/* 2-qator: tushum ko'rsatkichlari (ruxsatga bog'liq), kassa amallari, tarix, orqaga */}
        <div className="flex items-center gap-2 px-3 sm:px-5 pb-3 border-b border-border overflow-x-auto">
          {canRevenue && (
            <>
              <SummaryStat label="Bugungi tushum" value={formatSum(summary?.revenue ?? 0)} accent />
              <SummaryStat label="Sof tushum" value={formatSum(net)} />
              <ToolButton icon={<ChartIcon className="w-5 h-5 text-primary" />} label="Hisobot" onClick={() => setDashboardOpen(true)} testId="cashier-report" />
            </>
          )}
          <ToolButton
            icon={<CashFlowIcon className="w-5 h-5 text-primary" />}
            label="Kirim / Chiqim"
            onClick={() => setShowCash(true)}
            testId="cashier-cash"
          />
          <ToolButton icon={<DebtIcon className="w-5 h-5 text-danger" />} label="Qarzlar" onClick={() => setShowDebts(true)} testId="cashier-debts" />
          <ToolButton
            icon={<StopIcon className="w-5 h-5 text-danger" />}
            label="Stop list"
            onClick={() => setShowStop(true)}
            testId="cashier-stoplist"
            badge={stopCount > 0 ? stopCount : undefined}
          />
          {canHistory && (
            <ToolButton
              icon={<ReceiptIcon className="w-5 h-5 text-primary" />}
              label="Cheklar tarixi"
              onClick={() => setHistoryOpen(true)}
              testId="cashier-history"
            />
          )}
          <BackButton className="ml-auto" />
        </div>

        {/* Ochiq hisoblar — kartochka to'ri (bosilsa to'lov oynasi ochiladi) */}
        <div className="flex-1 overflow-auto p-3 sm:p-5">
          {loadError && (
            <div
              role="alert"
              className="mb-3 flex items-center gap-2 rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-sm font-semibold text-danger"
            >
              <AlertIcon className="w-5 h-5 shrink-0" />
              <span className="flex-1">Hisoblar yangilanmadi: {loadError}</span>
              <button
                onClick={() => void refreshOrders()}
                className="h-9 px-3 rounded-lg border border-danger/50 hover:bg-danger/10 font-bold"
              >
                Qayta urinish
              </button>
            </div>
          )}

          {/* Zal bo'yicha filtr (faqat "Stolga" rejimida) */}
          {mode === OrderType.DineIn && halls.length > 1 && (
            <div className="flex gap-2 flex-wrap mb-3">
              {['', ...halls].map((h) => (
                <button
                  key={h || '__all'}
                  onClick={() => setHallFilter(h)}
                  className={`h-11 px-4 rounded-xl text-sm font-bold border-2 transition-colors ${
                    activeHall === h ? 'bg-primary-hover text-white border-primary-hover' : 'bg-surface border-border text-text hover:border-primary'
                  }`}
                >
                  {h || t('common.all')}
                </button>
              ))}
            </div>
          )}

          {!ordersLoaded ? (
            <div className="flex flex-col items-center justify-center text-muted py-24 gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <div>{t('common.loading')}</div>
            </div>
          ) : bills.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-muted py-20 gap-4 text-center">
              <div className="w-20 h-20 rounded-full bg-surface border border-border flex items-center justify-center">
                <ReceiptIcon className="w-10 h-10 text-muted" />
              </div>
              <div className="text-lg font-semibold text-text">{EMPTY_TEXT[mode] ?? t('cashier.noBills')}</div>
              {canPos && (
                <div className="flex flex-wrap justify-center gap-2">
                  {mode !== OrderType.DineIn && (
                    <button
                      type="button"
                      onClick={newOrder}
                      className="h-14 px-6 rounded-xl bg-primary-hover text-white font-extrabold text-lg flex items-center gap-2 shadow-lg active:scale-[0.97] transition-transform"
                    >
                      <PlusIcon className="w-6 h-6" /> Yangi buyurtma
                    </button>
                  )}
                  {mode === OrderType.DineIn && (
                    <button
                      type="button"
                      onClick={() => nav.open('waiter')}
                      className="h-14 px-6 rounded-xl bg-surface border-2 border-primary/60 text-text font-extrabold text-lg flex items-center gap-2 active:scale-[0.97] transition-transform"
                    >
                      <TablesIcon className="w-6 h-6 text-primary" /> Stollar
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            // Telefonda kartochkalar o'z balandligida; kattaroq ekranda qatordagi kartochkalar bir xil (summalar bir chiziqda)
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 sm:gap-3 items-start sm:items-stretch">
              {bills.map((b) => (
                <CashierOrderCard
                  key={b.key}
                  order={b.order}
                  unprinted={b.unprinted}
                  receipt={b.receipt}
                  now={now}
                  onOpen={openBill}
                  onEditDelivery={editDelivery}
                  onEdit={canPos ? editOnPos : undefined}
                  onSplit={canSplit ? openSplit : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Qisqa xabar (masalan hisob bo'lingandan keyin) — ishni to'xtatmaydi */}
      {toast && (
        <div
          role="status"
          className="fixed z-40 left-1/2 -translate-x-1/2 top-[calc(4.5rem+var(--printbanner-h,0px))] max-w-[92vw] rounded-2xl bg-success text-black px-4 py-3 font-extrabold shadow-2xl flex items-center gap-2 animate-pop-in"
        >
          <CheckIcon className="w-5 h-5 shrink-0" />
          <span className="truncate">{toast}</span>
        </div>
      )}

      {showCash && <CashMovementsModal onClose={() => setShowCash(false)} onChanged={refreshStats} />}
      {showDebts && <DebtsModal onClose={() => setShowDebts(false)} onChanged={refreshStats} />}
      {showStop && <StopListModal onClose={() => setShowStop(false)} onChanged={setStopCount} />}

      {payOrder && (
        <PaymentModal
          key={payOrder.id}
          order={payOrder}
          siblings={siblingsOf(payOrder)}
          onClose={closePayment}
          onPaid={handlePaid}
          onChanged={scheduleRefresh}
          onReceiptPrinted={receiptPrinted}
        />
      )}

      {splitOrder && (
        <SplitCheckModal
          order={splitOrder}
          siblings={siblingsOf(splitOrder)}
          onClose={() => setSplitOrder(null)}
          onDone={splitDone}
        />
      )}

      {receipt && (
        <ReceiptPreview
          receipt={receipt}
          afterPayment
          onPrinted={() => removeUnprinted(receipt.orderId)}
          onClose={() => setReceipt(null)}
        />
      )}

      {deliveryEdit && (
        <DeliveryInfoModal
          title={`${orderTitle(deliveryEdit)} — mijoz ma‘lumotlari`}
          initial={{
            phone: deliveryEdit.phone ?? '',
            address: deliveryEdit.address ?? '',
            note: deliveryEdit.note ?? '',
            deliveryFee: deliveryEdit.deliveryFee ?? 0,
          }}
          onSave={(info) => saveDelivery(deliveryEdit, info)}
          onClose={() => setDeliveryEdit(null)}
        />
      )}
    </AppShell>
  );
}

function SummaryStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`shrink-0 rounded-xl border px-3.5 py-1.5 whitespace-nowrap ${
        accent ? 'bg-primary/10 border-primary/30' : 'bg-surface border-border'
      }`}
    >
      <div className="text-[11px] text-muted font-semibold">{label}</div>
      <div className={`font-extrabold leading-tight tabular-nums ${accent ? 'text-primary text-lg' : 'text-base text-text'}`}>{value}</div>
    </div>
  );
}

/** Kassa sarlavhasidagi amal tugmasi: belgi + nom (+ qizil son) */
function ToolButton({
  icon,
  label,
  onClick,
  testId,
  badge,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  testId: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="relative shrink-0 h-12 px-3.5 rounded-xl bg-surface border border-border hover:border-primary hover:bg-surface-hover text-sm font-bold text-text whitespace-nowrap flex items-center gap-2 active:scale-[0.97] transition-transform"
    >
      {icon}
      {label}
      {typeof badge === 'number' && (
        <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-danger text-white text-xs font-black flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
}
