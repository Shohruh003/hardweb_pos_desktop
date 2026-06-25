import { useEffect, useMemo, useState } from 'react';
import { Order, OrderStatus } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Select } from '../../components/Select';
import { OrderHistory } from '../../components/OrderHistory';
import { api } from '../../lib/api';

function localDay(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const STATUS_OPTIONS = [
  { value: '', label: 'Barcha holatlar' },
  { value: OrderStatus.Accepted, label: 'Qabul qilindi' },
  { value: OrderStatus.Cooking, label: 'Tayyorlanmoqda' },
  { value: OrderStatus.Ready, label: 'Tayyor' },
  { value: OrderStatus.Closed, label: 'Yopilgan' },
];

// Cheklar / buyurtmalar tarixi — sana, zal, stol, holat va matn bo'yicha filtr
export function ReceiptsTab() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [q, setQ] = useState('');
  const [date, setDate] = useState('');
  const [hall, setHall] = useState('');
  const [table, setTable] = useState('');
  const [status, setStatus] = useState('');

  async function load() {
    setOrders(await api.get<Order[]>('/orders/history'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  const halls = useMemo(
    () => Array.from(new Set(orders.map((o) => o.hall).filter(Boolean))) as string[],
    [orders],
  );
  const tableNos = useMemo(
    () => Array.from(new Set(orders.map((o) => o.tableNumber).filter((n) => n != null))).sort((a, b) => (a as number) - (b as number)) as number[],
    [orders],
  );

  const query = q.trim().toLowerCase();
  const filtered = orders.filter((o) => {
    if (date && localDay(o.openedAt) !== date) return false;
    if (hall && o.hall !== hall) return false;
    if (table && String(o.tableNumber) !== table) return false;
    if (status && o.status !== status) return false;
    if (query) {
      const hay = `${o.tableNumber} ${o.waiterName ?? ''} ${o.items.map((i) => i.menuItemName).join(' ')}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  function clear() {
    setQ(''); setDate(''); setHall(''); setTable(''); setStatus('');
  }

  const hallOptions = [{ value: '', label: 'Barcha zallar' }, ...halls.map((h) => ({ value: h, label: h }))];
  const tableOptions = [{ value: '', label: 'Barcha stollar' }, ...tableNos.map((n) => ({ value: String(n), label: `Stol №${n}` }))];
  const active = q || date || hall || table || status;

  return (
    <div className="w-full">
      {/* Filtrlar */}
      <div className="bg-surface border border-border rounded-2xl p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Taom / ofitsiant qidirish..."
            className="px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary [color-scheme:dark]" />
          <Select value={hall} onChange={setHall} options={hallOptions} />
          <Select value={table} onChange={setTable} options={tableOptions} />
          <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        </div>
        <div className="flex items-center justify-between mt-3">
          <div className="text-sm text-muted">{filtered.length} ta buyurtma topildi</div>
          <div className="flex gap-2">
            {active && <Button variant="ghost" onClick={clear}>Filtrni tozalash</Button>}
            <Button variant="ghost" onClick={() => load()}>Yangilash</Button>
          </div>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-2xl p-4">
        <OrderHistory orders={filtered} />
      </div>
    </div>
  );
}
