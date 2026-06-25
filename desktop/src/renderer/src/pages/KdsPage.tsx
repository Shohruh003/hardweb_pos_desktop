import { useEffect, useState } from 'react';
import {
  Order,
  OrderStatus,
  SOCKET_EVENTS,
} from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';

// Oshxona ekrani (KDS) — yangi buyurtmalar real-time keladi (TZ 5.2)
export function KdsPage() {
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    api.get<Order[]>('/orders').then(setOrders).catch(() => {});

    const socket = getSocket();

    const onCreated = (p: { order: Order }) =>
      setOrders((prev) => [...prev, p.order]);

    const onUpdated = (p: { order: Order }) =>
      setOrders((prev) =>
        prev
          .map((o) => (o.id === p.order.id ? p.order : o))
          // Yopilgan buyurtma KDS dan ketadi
          .filter((o) => o.status !== OrderStatus.Closed),
      );

    socket.on(SOCKET_EVENTS.ORDER_CREATED, onCreated);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, onUpdated);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, onCreated);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, onUpdated);
    };
  }, []);

  async function advance(order: Order) {
    // qabul qilindi -> tayyorlanmoqda -> tayyor
    const next =
      order.status === OrderStatus.Accepted
        ? OrderStatus.Cooking
        : OrderStatus.Ready;
    await api.patch(`/orders/${order.id}/status`, { status: next });
  }

  const active = orders
    .filter((o) => o.status !== OrderStatus.Closed)
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt)); // eng eskisi oldinda

  return (
    <AppShell title="Oshxona ekrani (KDS)">
      <div className="h-full overflow-auto p-6">
        {active.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted">
            Hozircha yangi buyurtma yo‘q
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {active.map((order) => (
              <div
                key={order.id}
                className={`bg-surface border-2 rounded-2xl p-4 flex flex-col animate-pop-in lift ${
                  order.status === OrderStatus.Accepted
                    ? 'border-info/50'
                    : 'border-warning/60'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="text-lg font-bold">
                    Stol №{order.tableNumber ?? '—'}
                  </div>
                  <StatusBadge status={order.status} />
                </div>

                <ul className="space-y-1.5 mb-4 flex-1">
                  {order.items.map((it) => (
                    <li key={it.id} className="flex justify-between text-sm">
                      <span>
                        <span className="font-semibold text-primary">
                          {it.quantity}×
                        </span>{' '}
                        {it.menuItemName}
                        {it.note && (
                          <span className="text-warning"> ({it.note})</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                {order.status !== OrderStatus.Ready && (
                  <button
                    onClick={() => advance(order)}
                    className={`w-full py-4 rounded-xl font-extrabold text-xl flex items-center justify-center gap-2 lift active:scale-[0.98] hover:brightness-110 ${
                      order.status === OrderStatus.Accepted
                        ? 'bg-warning text-black'
                        : 'bg-success text-white'
                    }`}
                  >
                    {order.status === OrderStatus.Accepted ? (
                      <>🔥 Boshlash</>
                    ) : (
                      <>✅ Tayyor</>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
