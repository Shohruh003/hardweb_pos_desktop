import { useCallback, useEffect, useRef, useState } from 'react';
import { Order, OrderStatus, SOCKET_EVENTS } from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { StatusBadge, formatTime, minutesSince } from '../components/ui';
import { OrderHistory } from '../components/OrderHistory';
import { BackButton } from '../components/BackButton';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useI18n } from '../state/i18n';

/** "Tayyor" bosilgandan keyin qaytarish imkoni (ms) */
const UNDO_MS = 7000;
/** Xato xabari shuncha vaqt ko'rinadi (ms) */
const ERROR_MS = 8000;

// Socket yukidagi buyurtma to'liqmi (kartochka chizish uchun taomlar ro'yxati shart)
function isOrder(o: unknown): o is Order {
  const v = o as Order | null;
  return !!v && typeof v.id === 'string' && Array.isArray(v.items);
}

// Oshxona ekrani (KDS) — TZ 5.2. Faqat yangi va tayyorlanayotgan buyurtmalar;
// tayyor bo'lganlar ekrandan chiqadi (qaytarish imkoni bilan). Tarix alohida tabda.
export function KdsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [view, setView] = useState<'board' | 'history'>('board');
  const [history, setHistory] = useState<Order[]>([]);
  const [now, setNow] = useState(Date.now());
  const [undo, setUndo] = useState<{ id: string; table?: number } | null>(null);
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

  const reload = useCallback(() => {
    api.get<Order[]>('/orders').then(setOrders).catch(() => {});
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
      setOrders((prev) => (prev.some((x) => x.id === o.id) ? prev.map((x) => (x.id === o.id ? o : x)) : [...prev, o]));
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
    socket.on(SOCKET_EVENTS.ORDER_CREATED, onCreated);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, onUpdated);
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, onClosed);
    socket.on('connect', onConnect);
    const tick = setInterval(() => setNow(Date.now()), 20000);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, onCreated);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, onUpdated);
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, onClosed);
      socket.off('connect', onConnect);
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
        setOrders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      }
      return true;
    } catch (e) {
      showError(`Stol №${order.tableNumber ?? '—'}: ${(e as Error)?.message || 'holat o‘zgarmadi'}`);
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
        setUndo({ id: order.id, table: order.tableNumber });
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
      showError(`Stol №${target.table ?? '—'}: buyurtma allaqachon yopilgan — qaytarib bo‘lmaydi`);
      reload();
      return;
    }
    await setStatus(current, OrderStatus.Cooking);
  }

  const visible = orders
    .filter((o) => o.status === OrderStatus.Accepted || o.status === OrderStatus.Cooking)
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));

  return (
    <AppShell title={t('title.kds')}>
      <div className="h-full flex flex-col">
        {/* Tablar */}
        <div className="flex gap-2 px-3 sm:px-6 pt-3 sm:pt-4 items-center">
          <Tab active={view === 'board'} onClick={() => setView('board')}>
            {t('kds.active')}
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
                {visible.map((order, idx) => {
                  const mins = minutesSince(order.openedAt, now);
                  const busy = busyIds.includes(order.id);
                  return (
                    <div
                      key={order.id}
                      className={`bg-surface border-2 rounded-2xl p-4 flex flex-col animate-pop-in lift ${
                        order.status === OrderStatus.Accepted ? 'border-info/50' : 'border-warning/60'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-lg bg-bg text-muted font-bold flex items-center justify-center text-sm">
                            {idx + 1}
                          </span>
                          <span className="text-lg font-bold">Stol №{order.tableNumber ?? '—'}</span>
                        </div>
                        <StatusBadge status={order.status} />
                      </div>
                      <div className="text-sm text-muted mb-3 flex items-center gap-2">
                        🕐 {formatTime(order.openedAt)}
                        <span className={mins >= 15 ? 'text-danger font-semibold' : ''}>· {mins} daqiqa oldin</span>
                      </div>

                      <ul className="space-y-1.5 mb-4 flex-1">
                        {order.items.map((it) => (
                          <li key={it.id} className="flex justify-between text-sm">
                            <span>
                              <span className="font-semibold text-primary">{it.quantity}×</span> {it.menuItemName}
                              {it.note && <span className="text-warning"> ({it.note})</span>}
                            </span>
                          </li>
                        ))}
                      </ul>

                      <button
                        onClick={() => advance(order)}
                        disabled={busy}
                        className={`w-full py-4 rounded-xl font-extrabold text-xl flex items-center justify-center gap-2 lift active:scale-[0.98] hover:brightness-110 disabled:opacity-60 disabled:cursor-wait ${
                          order.status === OrderStatus.Accepted ? 'bg-warning text-black' : 'bg-success text-white'
                        }`}
                      >
                        {busy ? (
                          '…'
                        ) : order.status === OrderStatus.Accepted ? (
                          <>🔥 {t('kds.startCooking')}</>
                        ) : (
                          <>✅ {t('kds.ready')}</>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-3xl mx-auto bg-surface border border-border rounded-2xl p-4">
              <OrderHistory
                orders={history}
                onRevert={async (o) => {
                  // OrderHistory "qaytarish"ni faqat "Tayyor" holatda ko'rsatadi; ro'yxat eskirgan
                  // bo'lsa (kassada yopilgan) server rad etadi — xabar ko'rsatib, tarixni yangilaymiz
                  if (o.status !== OrderStatus.Ready) {
                    showError(`Stol №${o.tableNumber ?? '—'}: faqat tayyor buyurtmani qaytarish mumkin`);
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-pop-in">
          <div className="flex items-center gap-4 bg-surface border border-success/50 rounded-2xl px-5 py-3 shadow-2xl">
            <span className="font-semibold">Stol №{undo.table ?? '—'} — tayyor deb belgilandi ✅</span>
            <button
              onClick={revert}
              className="px-4 py-2 rounded-lg bg-warning text-black font-bold active:scale-95 hover:brightness-110"
            >
              ↩ Qaytarish
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 font-semibold rounded-t-lg ${
        active ? 'bg-surface text-primary border-b-2 border-primary' : 'text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}
