import { useEffect, useMemo, useState } from 'react';
import { Order, OrderStatus, OrderType, SOCKET_EVENTS, orderTypeOf } from '@hardweb-pos/shared';
import { api, MOCK } from '../lib/api';
import { getSocket } from '../lib/socket';
import { DemoSwitcher } from '../components/DemoSwitcher';
import { ORDER_TYPE_ICON, ORDER_TYPE_TONE, checkNoOf } from '../components/waiter/orderUi';
import { usePosSettings } from '../lib/posSettings';

// Socket yukidagi buyurtma to'liqmi
function isOrder(o: unknown): o is Order {
  const v = o as Order | null;
  return !!v && typeof v.id === 'string' && typeof v.status === 'string';
}

const clock = () => new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });

// Tablo tartibi: olib ketish/yetkazish — raqam bo'yicha, stol — ochilgan vaqt bo'yicha (eng eskisi oldin)
function byQueue(a: Order, b: Order): number {
  const qa = a.queueNumber ?? Number.MAX_SAFE_INTEGER;
  const qb = b.queueNumber ?? Number.MAX_SAFE_INTEGER;
  return qa - qb || a.openedAt.localeCompare(b.openedAt);
}

// Navbat ekrani — mijozlar uchun TV tablo (TZ 7-bo'lim).
// "Tayyorlanmoqda" va "Tayyor — olib keting" ustunlari, real vaqtda yangilanadi. Olib ketish va
// yetkazish buyurtmalari katta raqam bilan (#12), stol buyurtmalari — "Stol 5".
export function QueueScreen() {
  const pos = usePosSettings();
  const [orders, setOrders] = useState<Order[]>([]);
  const [now, setNow] = useState(clock);

  useEffect(() => {
    const reload = () =>
      api
        .get<Order[]>('/orders')
        .then((list) => setOrders(Array.isArray(list) ? list : []))
        .catch(() => {});
    reload();
    const socket = getSocket();
    const upsert = (p: { order?: Order }) => {
      const o = p?.order;
      if (!isOrder(o)) return reload();
      setOrders((prev) => {
        const rest = prev.filter((x) => x.id !== o.id);
        return o.status === OrderStatus.Closed ? rest : [...rest, o];
      });
    };
    // Yopilgan (to'langan) yoki bekor qilingan buyurtma — har doim tablodan olinadi
    // (bekor qilinganda holat "yopildi" bo'lmaydi — shuning uchun holatga qaramaymiz)
    const remove = (p: { order?: Order }) => {
      const id = p?.order?.id;
      if (!id) return reload();
      setOrders((prev) => prev.filter((x) => x.id !== id));
    };
    socket.on(SOCKET_EVENTS.ORDER_CREATED, upsert);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, upsert);
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, remove);
    socket.on('connect', reload);
    const t = setInterval(() => setNow(clock()), 15_000);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, upsert);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, upsert);
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, remove);
      socket.off('connect', reload);
      clearInterval(t);
    };
  }, []);

  const cooking = useMemo(
    () =>
      orders
        .filter((o) => o.status === OrderStatus.Accepted || o.status === OrderStatus.Cooking)
        .sort((a, b) => a.openedAt.localeCompare(b.openedAt)),
    [orders],
  );
  const ready = useMemo(() => orders.filter((o) => o.status === OrderStatus.Ready).sort(byQueue), [orders]);

  return (
    <div className="h-full flex flex-col bg-bg text-text">
      <header className="flex items-center justify-between px-8 py-4 border-b border-border">
        <div className="text-primary font-extrabold text-2xl truncate">{pos.restaurantName || 'DasturXon'}</div>
        <div className="flex items-center gap-4">
          {MOCK && <DemoSwitcher />}
          <div className="text-2xl text-muted tabular-nums">{now}</div>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-2 min-h-0">
        <Column title="Tayyorlanmoqda" color="warning" orders={cooking} />
        <div className="border-l border-border">
          <Column title="Tayyor — olib keting" color="success" orders={ready} />
        </div>
      </div>
    </div>
  );
}

function Column({ title, color, orders }: { title: string; color: 'warning' | 'success'; orders: Order[] }) {
  const ready = color === 'success';
  return (
    <div className="h-full overflow-auto p-8">
      <h2 className={`flex items-center gap-3 text-3xl font-bold mb-6 ${ready ? 'text-success' : 'text-warning'}`}>
        <span className={`w-4 h-4 rounded-full ${ready ? 'bg-success animate-pulse' : 'bg-warning'}`} />
        {title}
      </h2>
      {orders.length === 0 ? (
        <div className="text-muted text-xl">Hozircha buyurtma yo‘q</div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {orders.map((o) => (
            <QueueCard key={o.id} order={o} ready={ready} />
          ))}
        </div>
      )}
    </div>
  );
}

function QueueCard({ order, ready }: { order: Order; ready: boolean }) {
  const type = orderTypeOf(order);
  const dineIn = type === OrderType.DineIn;
  const Icon = ORDER_TYPE_ICON[type];
  // Bitta stolda bir nechta hisob — "Hisob 2" (orderDisplayName bilan bir xil)
  const check = dineIn ? checkNoOf(order) : 1;
  return (
    <div
      data-testid={`queue-card-${dineIn ? `stol-${order.tableNumber ?? ''}` : order.queueNumber ?? ''}`}
      data-check={dineIn ? check : undefined}
      className={`bg-surface border-2 rounded-2xl py-5 px-3 text-center animate-pop-in ${
        ready ? 'border-success shadow-[0_0_30px_-8px_rgb(var(--c-success)/0.7)]' : 'border-border'
      }`}
    >
      <div className={`flex items-center justify-center gap-1.5 text-sm font-bold ${ORDER_TYPE_TONE[type].text}`}>
        <Icon className="w-4 h-4" />
        {dineIn ? 'Stol' : type === OrderType.Takeaway ? 'Olib ketish' : 'Yetkazish'}
      </div>
      <div className={`font-black leading-none mt-2 tabular-nums ${ready ? 'text-6xl text-success' : 'text-5xl'}`}>
        {dineIn ? order.tableNumber ?? '—' : `#${order.queueNumber ?? '?'}`}
      </div>
      {dineIn && check > 1 && <div className="mt-2 text-lg font-extrabold text-text">Hisob {check}</div>}
    </div>
  );
}
