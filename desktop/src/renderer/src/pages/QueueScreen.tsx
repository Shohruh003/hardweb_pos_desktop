import { useEffect, useState } from 'react';
import { Order, OrderStatus, SOCKET_EVENTS } from '@hardweb-pos/shared';
import { api, MOCK } from '../lib/api';
import { getSocket } from '../lib/socket';
import { DemoSwitcher } from '../components/DemoSwitcher';

// Navbat ekrani — mijozlar uchun TV tablo (TZ 7-bo'lim).
// "Tayyorlanmoqda" va "Tayyor" ustunlari, real vaqtda yangilanadi.
export function QueueScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [now, setNow] = useState(new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }));

  useEffect(() => {
    api.get<Order[]>('/orders').then(setOrders).catch(() => {});
    const socket = getSocket();
    const upsert = (p: { order: Order }) =>
      setOrders((prev) => {
        const rest = prev.filter((o) => o.id !== p.order.id);
        return p.order.status === OrderStatus.Closed ? rest : [...rest, p.order];
      });
    socket.on(SOCKET_EVENTS.ORDER_CREATED, upsert);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, upsert);
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, upsert);
    const t = setInterval(
      () => setNow(new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })),
      1000,
    );
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, upsert);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, upsert);
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, upsert);
      clearInterval(t);
    };
  }, []);

  const cooking = orders
    .filter((o) => o.status === OrderStatus.Accepted || o.status === OrderStatus.Cooking)
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const ready = orders.filter((o) => o.status === OrderStatus.Ready);

  return (
    <div className="h-full flex flex-col bg-bg text-text">
      <header className="flex items-center justify-between px-8 py-4 border-b border-border">
        <div className="text-primary font-extrabold text-2xl">HardWeb Restoran</div>
        <div className="flex items-center gap-4">
          {MOCK && <DemoSwitcher />}
          <div className="text-2xl text-muted">{now}</div>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-2 min-h-0">
        <Column title="Tayyorlanmoqda" color="warning" orders={cooking} pulse={false} />
        <div className="border-l border-border">
          <Column title="Tayyor — olib keting" color="success" orders={ready} pulse />
        </div>
      </div>
    </div>
  );
}

function Column({
  title,
  color,
  orders,
  pulse,
}: {
  title: string;
  color: 'warning' | 'success';
  orders: Order[];
  pulse: boolean;
}) {
  const dot = color === 'success' ? 'bg-success' : 'bg-warning';
  const text = color === 'success' ? 'text-success' : 'text-warning';
  return (
    <div className="h-full overflow-auto p-8">
      <h2 className={`flex items-center gap-3 text-3xl font-bold mb-6 ${text}`}>
        <span className={`w-4 h-4 rounded-full ${dot}`} />
        {title}
      </h2>
      {orders.length === 0 ? (
        <div className="text-muted text-xl">Hozircha buyurtma yo‘q</div>
      ) : (
        <div className="grid grid-cols-3 xl:grid-cols-4 gap-4">
          {orders.map((o) => (
            <div
              key={o.id}
              className={`bg-surface border-2 rounded-2xl py-6 text-center ${
                color === 'success' ? 'border-success' : 'border-border'
              } ${pulse ? 'animate-pulse' : ''}`}
            >
              <div className="text-muted text-sm">Stol</div>
              <div className="text-5xl font-extrabold leading-none mt-1">
                {o.queueNumber ?? o.tableNumber ?? '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
