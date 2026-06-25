import { useEffect, useRef, useState } from 'react';
import { Order, OrderStatus, SOCKET_EVENTS } from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { StatusBadge, formatTime, minutesSince } from '../components/ui';
import { OrderHistory } from '../components/OrderHistory';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';

// Oshxona ekrani (KDS) — TZ 5.2. Faqat yangi va tayyorlanayotgan buyurtmalar;
// tayyor bo'lganlar ekrandan chiqadi (qaytarish imkoni bilan). Tarix alohida tabda.
export function KdsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [view, setView] = useState<'board' | 'history'>('board');
  const [history, setHistory] = useState<Order[]>([]);
  const [now, setNow] = useState(Date.now());
  const [undo, setUndo] = useState<{ id: string; table?: number } | null>(null);
  const undoTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    api.get<Order[]>('/orders').then(setOrders).catch(() => {});
    const socket = getSocket();
    const onCreated = (p: { order: Order }) =>
      setOrders((prev) => [...prev.filter((o) => o.id !== p.order.id), p.order]);
    const onUpdated = (p: { order: Order }) =>
      setOrders((prev) =>
        prev.map((o) => (o.id === p.order.id ? p.order : o)).filter((o) => o.status !== OrderStatus.Closed),
      );
    const onClosed = (p: { order: Order }) =>
      setOrders((prev) => prev.filter((o) => o.id !== p.order.id));
    socket.on(SOCKET_EVENTS.ORDER_CREATED, onCreated);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, onUpdated);
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, onClosed);
    const tick = setInterval(() => setNow(Date.now()), 20000);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, onCreated);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, onUpdated);
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, onClosed);
      clearInterval(tick);
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  useEffect(() => {
    if (view === 'history') api.get<Order[]>('/orders/history').then(setHistory).catch(() => {});
  }, [view, orders]);

  async function advance(order: Order) {
    if (order.status === OrderStatus.Accepted) {
      await api.patch(`/orders/${order.id}/status`, { status: OrderStatus.Cooking });
    } else {
      await api.patch(`/orders/${order.id}/status`, { status: OrderStatus.Ready });
      setUndo({ id: order.id, table: order.tableNumber });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 7000);
    }
  }

  async function revert() {
    if (!undo) return;
    await api.patch(`/orders/${undo.id}/status`, { status: OrderStatus.Cooking });
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }

  const visible = orders
    .filter((o) => o.status === OrderStatus.Accepted || o.status === OrderStatus.Cooking)
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));

  return (
    <AppShell title="Oshxona ekrani (KDS)">
      <div className="h-full flex flex-col">
        {/* Tablar */}
        <div className="flex gap-2 px-6 pt-4">
          <Tab active={view === 'board'} onClick={() => setView('board')}>
            Faol buyurtmalar
          </Tab>
          <Tab active={view === 'history'} onClick={() => setView('history')}>
            Tarix
          </Tab>
        </div>

        {view === 'board' ? (
          <div className="flex-1 overflow-auto p-6 pb-24">
            {visible.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted">Hozircha yangi buyurtma yo‘q</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {visible.map((order, idx) => {
                  const mins = minutesSince(order.openedAt, now);
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
                        className={`w-full py-4 rounded-xl font-extrabold text-xl flex items-center justify-center gap-2 lift active:scale-[0.98] hover:brightness-110 ${
                          order.status === OrderStatus.Accepted ? 'bg-warning text-black' : 'bg-success text-white'
                        }`}
                      >
                        {order.status === OrderStatus.Accepted ? <>🔥 Boshlash</> : <>✅ Tayyor</>}
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
              <OrderHistory orders={history} />
            </div>
          </div>
        )}
      </div>

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
