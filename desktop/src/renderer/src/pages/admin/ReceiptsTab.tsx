import { useEffect, useState } from 'react';
import { Order } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { OrderHistory } from '../../components/OrderHistory';
import { api } from '../../lib/api';

// Cheklar / buyurtmalar tarixi (TZ — universal admin). Mijoz shikoyat qilsa:
// nima yegan, qachon, qancha, qanday to'lagan — hammasi shu yerda.
export function ReceiptsTab() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [q, setQ] = useState('');

  async function load() {
    setOrders(await api.get<Order[]>('/orders/history'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  const query = q.trim().toLowerCase();
  const filtered = query
    ? orders.filter(
        (o) =>
          String(o.tableNumber ?? '').includes(query) ||
          (o.waiterName ?? '').toLowerCase().includes(query) ||
          o.items.some((i) => (i.menuItemName ?? '').toLowerCase().includes(query)),
      )
    : orders;

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-4 max-w-3xl">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Stol, ofitsiant yoki taom bo‘yicha qidirish..."
          className="flex-1 px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <Button variant="ghost" onClick={() => load()}>Yangilash</Button>
      </div>
      <div className="text-sm text-muted mb-2">{filtered.length} ta buyurtma</div>
      <div className="bg-surface border border-border rounded-2xl p-4">
        <OrderHistory orders={filtered} />
      </div>
    </div>
  );
}
