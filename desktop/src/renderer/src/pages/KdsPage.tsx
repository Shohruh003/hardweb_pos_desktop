import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MenuUnit,
  Order,
  OrderStatus,
  OrderType,
  OrderVoidedPayload,
  SOCKET_EVENTS,
  orderDisplayName,
  orderTypeOf,
} from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { StatusBadge, formatTime, minutesSince } from '../components/ui';
import { OrderHistory } from '../components/OrderHistory';
import { BackButton } from '../components/BackButton';
import { formatQty } from '../components/numeric';
import { ORDER_TYPE_ICON, ORDER_TYPE_TONE, checkNoOf, formatKg } from '../components/waiter/orderUi';
import { noteTime } from '../components/waiter/cart';
import { IconBag, IconBan, IconClose } from '../components/waiter/icons';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useI18n } from '../state/i18n';

/** "Tayyor" bosilgandan keyin qaytarish imkoni (ms) */
const UNDO_MS = 7000;
/** Xato xabari shuncha vaqt ko'rinadi (ms) */
const ERROR_MS = 8000;
/** Shuncha daqiqadan keyin vaqt qizil bo'ladi (kechikish) */
const LATE_MINUTES = 15;
/** Otkaz xabari ekranda shuncha turadi (ms) */
const VOID_BANNER_MS = 20_000;
/** Bir vaqtda ko'pi bilan nechta otkaz xabari */
const VOID_BANNER_MAX = 3;

interface VoidBanner {
  key: number;
  text: string;
  by: string | null;
}

/** Otkaz xabari matni: "OTKAZ — Stol 5: 1 × BULYON, 0,5 kg BALIQ (Mijoz voz kechdi)" */
function voidText(p: OrderVoidedPayload): string {
  const what = p.wholeOrder
    ? 'butun hisob bekor qilindi'
    : (p.items ?? [])
        .map((it) =>
          it.unit === MenuUnit.Weight
            ? `${formatKg(it.quantity)} kg ${String(it.name ?? '').toUpperCase()}`
            : `${formatQty(it.quantity)} × ${String(it.name ?? '').toUpperCase()}`,
        )
        .join(', ');
  return `OTKAZ — ${p.orderName || 'Buyurtma'}: ${what || 'taom bekor qilindi'}${p.reason ? ` (${p.reason})` : ''}`;
}

// Socket yukidagi buyurtma to'liqmi (kartochka chizish uchun taomlar ro'yxati shart)
function isOrder(o: unknown): o is Order {
  const v = o as Order | null;
  return !!v && typeof v.id === 'string' && Array.isArray(v.items);
}

/**
 * Yangilangan buyurtmani eskisi bilan birlashtirish: ba'zi javob/hodisalarda (masalan holat o'zgarishi)
 * zal va ofitsiant ismi kelmaydi — ular kartochkadan yo'qolib qolmasin.
 */
function mergeOrder(prev: Order, next: Order): Order {
  return {
    ...prev,
    ...next,
    hall: next.hall ?? prev.hall,
    waiterName: next.waiterName ?? prev.waiterName,
    tableNumber: next.tableNumber ?? prev.tableNumber,
  };
}

/** Oshxona sarlavhasidagi tur nomi (katta harf): OLIB KETISH / YETKAZISH */
const KDS_TYPE_LABEL: Record<OrderType, string> = {
  [OrderType.DineIn]: 'STOL',
  [OrderType.Takeaway]: 'OLIB KETISH',
  [OrderType.Delivery]: 'YETKAZISH',
};

// Oshxona ekrani (KDS) — TZ 5.2. Faqat yangi va tayyorlanayotgan buyurtmalar;
// tayyor bo'lganlar ekrandan chiqadi (qaytarish imkoni bilan). Tarix alohida tabda.
// Kartochka sarlavhasi: olib ketish/yetkazish — katta "#12 OLIB KETISH", stol — "Stol 5" (+ zal).
export function KdsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [view, setView] = useState<'board' | 'history'>('board');
  const [history, setHistory] = useState<Order[]>([]);
  const [now, setNow] = useState(Date.now());
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  // Holatni o'zgartirish xatosi (masalan buyurtma kassada yopilgan) — jim qolmaymiz
  const [error, setError] = useState<string | null>(null);
  // So'rov ketayotgan kartochkalar — ikki marta bosilmasin (ref — bir zumda ikki bosishdan ham himoya)
  const busyRef = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const { t } = useI18n();
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ordersRef = useRef<Order[]>(orders);
  ordersRef.current = orders;
  // Otkaz xabarlari (qizil, ~20 s) — oshpaz bekor qilingan taomni tayyorlamasin
  const [voids, setVoids] = useState<VoidBanner[]>([]);
  const voidSeq = useRef(0);

  const reload = useCallback(() => {
    api
      .get<Order[]>('/orders')
      .then((list) => setOrders(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  const loadHistory = useCallback(() => {
    api
      .get<{ items: Order[] }>('/orders/history?limit=50')
      .then((r) => setHistory(r.items ?? []))
      .catch(() => {});
  }, []);

  const clearUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndo(null);
  }, []);

  const showError = useCallback((message: string) => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setError(message);
    errorTimer.current = setTimeout(() => setError(null), ERROR_MS);
  }, []);

  useEffect(() => {
    reload();
    const socket = getSocket();
    const onCreated = (p: { order?: Order }) => {
      const o = p?.order;
      if (!isOrder(o)) return reload();
      setOrders((prev) => [...prev.filter((x) => x.id !== o.id), o]);
    };
    // Yangilangan buyurtma ro'yxatda bo'lmasa ham qo'shiladi (masalan ekran uzilib qolganda yaratilgan)
    const onUpdated = (p: { order?: Order }) => {
      const o = p?.order;
      if (!isOrder(o)) return reload();
      if (o.status === OrderStatus.Closed) {
        setOrders((prev) => prev.filter((x) => x.id !== o.id));
        setUndo((u) => (u && u.id === o.id ? null : u));
        return;
      }
      setOrders((prev) =>
        prev.some((x) => x.id === o.id) ? prev.map((x) => (x.id === o.id ? mergeOrder(x, o) : x)) : [...prev, o],
      );
    };
    // Yopilgan (to'langan) yoki bekor qilingan buyurtma — ekrandan va "qaytarish"dan olinadi
    const onClosed = (p: { order?: Order }) => {
      const id = p?.order?.id;
      if (!id) return reload();
      setOrders((prev) => prev.filter((x) => x.id !== id));
      setUndo((u) => (u && u.id === id ? null : u));
    };
    // Aloqa tiklanganda — uzilish paytida o'tkazib yuborilgan buyurtmalarni olamiz
    const onConnect = () => reload();
    // Otkaz: qizil xabar (~20 s) va ro'yxat yangilanadi (bekor qilingan taom kartochkadan tushadi)
    const voidTimers: number[] = [];
    const onVoided = (p: OrderVoidedPayload) => {
      if (!p) return;
      const key = ++voidSeq.current;
      setVoids((prev) => [...prev, { key, text: voidText(p), by: p.userName ?? null }].slice(-VOID_BANNER_MAX));
      voidTimers.push(window.setTimeout(() => setVoids((prev) => prev.filter((v) => v.key !== key)), VOID_BANNER_MS));
      reload();
    };
    socket.on(SOCKET_EVENTS.ORDER_CREATED, onCreated);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, onUpdated);
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, onClosed);
    socket.on(SOCKET_EVENTS.ORDER_VOIDED, onVoided);
    socket.on('connect', onConnect);
    const tick = setInterval(() => setNow(Date.now()), 20000);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, onCreated);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, onUpdated);
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, onClosed);
      socket.off(SOCKET_EVENTS.ORDER_VOIDED, onVoided);
      socket.off('connect', onConnect);
      voidTimers.forEach((t) => window.clearTimeout(t));
      clearInterval(tick);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, [reload]);

  useEffect(() => {
    if (view === 'history') loadHistory();
  }, [view, orders, loadHistory]);

  /** Holatni o'zgartirish. Xato bo'lsa — xabar ko'rsatiladi va ro'yxat serverdan yangilanadi. */
  async function setStatus(order: Order, status: OrderStatus): Promise<boolean> {
    try {
      const updated = await api.patch<Order>(`/orders/${order.id}/status`, { status });
      // Socket hodisasini kutmasdan ekranni yangilaymiz (socket uzilgan bo'lsa ham to'g'ri ko'rinadi)
      if (isOrder(updated) && updated.id === order.id) {
        setOrders((prev) => prev.map((x) => (x.id === updated.id ? mergeOrder(x, updated) : x)));
      }
      return true;
    } catch (e) {
      showError(`${orderDisplayName(order)}: ${(e as Error)?.message || 'holat o‘zgarmadi'}`);
      reload();
      return false;
    }
  }

  async function advance(order: Order) {
    if (busyRef.current.has(order.id)) return;
    const next = order.status === OrderStatus.Accepted ? OrderStatus.Cooking : OrderStatus.Ready;
    busyRef.current.add(order.id);
    setBusyIds(Array.from(busyRef.current));
    try {
      const ok = await setStatus(order, next);
      if (ok && next === OrderStatus.Ready) {
        setUndo({ id: order.id, name: orderDisplayName(order) });
        if (undoTimer.current) clearTimeout(undoTimer.current);
        undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
      }
    } finally {
      busyRef.current.delete(order.id);
      setBusyIds(Array.from(busyRef.current));
    }
  }

  async function revert() {
    if (!undo) return;
    const target = undo;
    clearUndo();
    // Kassada yopilgan (to'langan) buyurtmani qaytarib bo'lmaydi — server ham rad etadi
    const current = ordersRef.current.find((o) => o.id === target.id);
    if (!current || current.status === OrderStatus.Closed) {
      showError(`${target.name}: buyurtma allaqachon yopilgan — qaytarib bo‘lmaydi`);
      reload();
      return;
    }
    await setStatus(current, OrderStatus.Cooking);
  }

  const visible = useMemo(
    () =>
      orders
        .filter((o) => o.status === OrderStatus.Accepted || o.status === OrderStatus.Cooking)
        .sort((a, b) => a.openedAt.localeCompare(b.openedAt)),
    [orders],
  );

  return (
    <AppShell title={t('title.kds')}>
      <div className="h-full flex flex-col">
        {/* Tablar */}
        <div className="flex gap-2 px-3 sm:px-6 pt-3 sm:pt-4 items-center">
          <Tab active={view === 'board'} onClick={() => setView('board')}>
            {t('kds.active')}
            {visible.length > 0 && (
              <span className="ml-2 min-w-[24px] h-6 px-1.5 rounded-full bg-primary-hover text-white text-xs font-extrabold inline-flex items-center justify-center">
                {visible.length}
              </span>
            )}
          </Tab>
          <Tab active={view === 'history'} onClick={() => setView('history')}>
            {t('kds.history')}
          </Tab>
          <BackButton className="ml-auto" />
        </div>

        {view === 'board' ? (
          <div className="flex-1 overflow-auto p-3 sm:p-6 pb-24">
            {visible.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted">{t('kds.noNew')}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {visible.map((order, idx) => (
                  <KdsCard
                    key={order.id}
                    order={order}
                    position={idx + 1}
                    now={now}
                    busy={busyIds.includes(order.id)}
                    onAdvance={advance}
                    startLabel={t('kds.startCooking')}
                    readyLabel={t('kds.ready')}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-3 sm:p-6">
            <div className="max-w-3xl mx-auto bg-surface border border-border rounded-2xl p-4">
              <OrderHistory
                orders={history}
                onRevert={async (o) => {
                  // OrderHistory "qaytarish"ni faqat "Tayyor" holatda ko'rsatadi; ro'yxat eskirgan
                  // bo'lsa (kassada yopilgan) server rad etadi — xabar ko'rsatib, tarixni yangilaymiz
                  if (o.status !== OrderStatus.Ready) {
                    showError(`${orderDisplayName(o)}: faqat tayyor buyurtmani qaytarish mumkin`);
                  } else {
                    await setStatus(o, OrderStatus.Cooking);
                  }
                  loadHistory();
                }}
              />
            </div>
          </div>
        )}
      </div>

      {voids.length > 0 && (
        <div className="fixed top-16 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[72] space-y-2 sm:w-[min(720px,calc(100vw-24px))]">
          {voids.map((v) => (
            <div
              key={v.key}
              role="alert"
              data-testid="kds-void-banner"
              className="flex items-start gap-3 rounded-2xl bg-danger text-white px-4 py-3 shadow-2xl animate-pop-in"
            >
              <IconBan className="w-8 h-8 shrink-0 mt-0.5" strokeWidth={2.6} />
              <div className="flex-1 min-w-0">
                <div className="text-xl font-black leading-tight break-words">{v.text}</div>
                {v.by && <div className="text-sm font-bold opacity-90 mt-0.5">Kim: {v.by}</div>}
              </div>
              <button
                onClick={() => setVoids((prev) => prev.filter((x) => x.key !== v.key))}
                aria-label="Yopish"
                className="shrink-0 w-11 h-11 -my-1 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center"
              >
                <IconClose className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="fixed top-16 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[70] animate-pop-in">
          <div className="flex items-start gap-3 bg-surface border-2 border-danger rounded-2xl px-4 py-3 shadow-2xl sm:max-w-[560px]">
            <span className="text-xl leading-none mt-0.5">⚠️</span>
            <span className="flex-1 font-semibold text-text">{error}</span>
            <button
              onClick={() => setError(null)}
              aria-label="Yopish"
              className="shrink-0 w-9 h-9 -my-1 rounded-lg text-muted hover:text-text hover:bg-bg flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {undo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-pop-in w-[calc(100%-24px)] sm:w-auto">
          <div className="flex items-center gap-4 bg-surface border border-success/50 rounded-2xl px-5 py-3 shadow-2xl">
            <span className="font-semibold flex-1">{undo.name} — tayyor deb belgilandi ✅</span>
            <button
              onClick={revert}
              className="shrink-0 px-4 py-2.5 rounded-lg bg-warning text-black font-bold active:scale-95 hover:brightness-110"
            >
              ↩ Qaytarish
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}

/** Bitta buyurtma kartochkasi (oshxona) */
function KdsCard({
  order,
  position,
  now,
  busy,
  onAdvance,
  startLabel,
  readyLabel,
}: {
  order: Order;
  position: number;
  now: number;
  busy: boolean;
  onAdvance: (o: Order) => void;
  startLabel: string;
  readyLabel: string;
}) {
  const type = orderTypeOf(order);
  const dineIn = type === OrderType.DineIn;
  const Icon = ORDER_TYPE_ICON[type];
  const tone = ORDER_TYPE_TONE[type];
  const mins = minutesSince(order.openedAt, now);
  const accepted = order.status === OrderStatus.Accepted;
  // Izohlardagi eng erta vaqt ("⏰ 15:00 ga tayyor") — kartochka tepasida katta nishon
  const readyAt =
    [order.note, ...order.items.map((it) => it.note)]
      .map((n) => noteTime(n))
      .filter((t): t is string => !!t)
      .sort()[0] ?? null;
  return (
    <div
      data-testid={`kds-card-${dineIn ? `stol-${order.tableNumber ?? ''}` : order.queueNumber ?? ''}`}
      data-check={dineIn ? checkNoOf(order) : undefined}
      className={`bg-surface border-2 rounded-2xl p-4 flex flex-col animate-pop-in ${
        accepted ? 'border-info/50' : 'border-warning/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 shrink-0 rounded-lg bg-bg text-muted font-bold flex items-center justify-center text-sm">
            {position}
          </span>
          {dineIn ? (
            <div className="min-w-0">
              <div className="text-xl font-extrabold leading-tight">{orderDisplayName(order)}</div>
              {(order.hall || order.queueNumber) && (
                <div className="text-xs text-muted font-semibold truncate">
                  {order.hall}
                  {order.hall && order.queueNumber ? ' · ' : ''}
                  {order.queueNumber ? `№${order.queueNumber}` : ''}
                </div>
              )}
            </div>
          ) : (
            // Olib ketish / yetkazish — katta raqam va tur (oshxona uzoqdan ko'rsin)
            <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
              <span className="text-3xl font-black leading-none tabular-nums">#{order.queueNumber ?? '?'}</span>
              <span className={`inline-flex items-center gap-1 text-sm font-extrabold tracking-wide ${tone.text}`}>
                <Icon className="w-4 h-4" strokeWidth={2.4} />
                {KDS_TYPE_LABEL[type]}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge status={order.status} />
          {readyAt && (
            <span className="rounded-md bg-warning text-black text-sm font-black px-2 py-0.5" title="Shu vaqtga tayyor bo‘lsin">
              ⏰ {readyAt}
            </span>
          )}
        </div>
      </div>
      <div className="text-sm text-muted mb-3 flex items-center gap-2">
        🕐 {formatTime(order.openedAt)}
        <span className={mins >= LATE_MINUTES ? 'text-danger font-semibold' : ''}>· {mins} daqiqa oldin</span>
      </div>

      {order.note && (
        <div className="mb-3 rounded-lg bg-warning/10 border border-warning/40 px-3 py-2 text-sm font-semibold text-text">
          📝 {order.note}
        </div>
      )}

      <ul className="space-y-1.5 mb-4 flex-1">
        {order.items.map((it) => (
          <li key={it.id} className="text-[15px] leading-snug">
            <span className="font-extrabold text-primary">
              {it.unit === MenuUnit.Weight ? `${formatKg(it.quantity)} kg` : `${formatQty(it.quantity)}×`}
            </span>{' '}
            <span className="font-semibold">{it.menuItemName}</span>
            {/* Saboy — stoldagi mehmon o'zi bilan olib ketadi (qadoqlansin) */}
            {it.takeaway && (
              <span className="ml-1.5 inline-flex items-center gap-1 align-middle rounded-md bg-warning text-black px-1.5 py-0.5 text-xs font-black">
                <IconBag className="w-3.5 h-3.5" strokeWidth={2.6} /> Saboy
              </span>
            )}
            {/* Taom izohi — oshpaz o'tkazib yubormasin */}
            {it.note && (
              <span className="block mt-0.5 rounded-md border border-warning/50 bg-warning/10 px-2 py-0.5 text-sm font-bold text-warning">
                » {it.note}
              </span>
            )}
          </li>
        ))}
      </ul>

      <button
        onClick={() => onAdvance(order)}
        disabled={busy}
        className={`w-full py-4 rounded-xl font-extrabold text-xl flex items-center justify-center gap-2 active:scale-[0.98] hover:brightness-110 transition-transform disabled:opacity-60 disabled:cursor-wait ${
          accepted ? 'bg-warning text-black' : 'bg-success text-black'
        }`}
      >
        {busy ? '…' : accepted ? <>🔥 {startLabel}</> : <>✅ {readyLabel}</>}
      </button>
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 font-semibold rounded-t-lg inline-flex items-center ${
        active ? 'bg-surface text-primary border-b-2 border-primary' : 'text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}
