import { useEffect, useMemo, useState } from 'react';
import {
  Category,
  MenuItem,
  Table,
  TableStatus,
} from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { Button, formatSum } from '../components/ui';
import { api } from '../lib/api';

interface CartItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  note?: string;
}

// Ofitsiant ekrani: stol tanlash -> menyudan taom qo'shish -> buyurtmani yuborish (TZ 5.1)
export function WaiterPage() {
  const [tables, setTables] = useState<Table[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');

  async function loadTables() {
    const t = await api.get<Table[]>('/tables');
    setTables(t);
  }

  useEffect(() => {
    loadTables().catch(() => {});
    api.get<Category[]>('/menu/categories').then((c) => {
      setCategories(c);
      setActiveCat(c[0]?.id ?? null);
    });
    api.get<MenuItem[]>('/menu/items').then(setMenu);
  }, []);

  const shownItems = useMemo(
    () => menu.filter((m) => m.categoryId === activeCat),
    [menu, activeCat],
  );

  const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);

  function addToCart(item: MenuItem) {
    setCart((prev) => {
      const found = prev.find((c) => c.menuItemId === item.id);
      if (found) {
        return prev.map((c) =>
          c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c,
        );
      }
      return [
        ...prev,
        { menuItemId: item.id, name: item.name, price: Number(item.price), quantity: 1 },
      ];
    });
  }

  function changeQty(id: string, delta: number) {
    setCart((prev) =>
      prev
        .map((c) =>
          c.menuItemId === id ? { ...c, quantity: c.quantity + delta } : c,
        )
        .filter((c) => c.quantity > 0),
    );
  }

  async function sendOrder() {
    if (!selectedTable || cart.length === 0) return;
    setSending(true);
    try {
      await api.post('/orders', {
        tableId: selectedTable.id,
        items: cart.map((c) => ({
          menuItemId: c.menuItemId,
          quantity: c.quantity,
          note: c.note,
        })),
      });
      setCart([]);
      setSelectedTable(null);
      await loadTables();
      setToast('Buyurtma oshxonaga yuborildi ✓');
      setTimeout(() => setToast(''), 2500);
    } catch (e) {
      setToast((e as Error).message);
      setTimeout(() => setToast(''), 3000);
    } finally {
      setSending(false);
    }
  }

  // 1-bosqich: stol tanlash
  if (!selectedTable) {
    return (
      <AppShell title="Ofitsiant — stollar">
        <div className="h-full overflow-auto p-6">
          {toast && (
            <div className="mb-4 px-4 py-2 rounded-lg bg-success/15 text-success font-semibold">
              {toast}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {tables.map((t) => {
              const busy = t.status !== TableStatus.Free;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedTable(t)}
                  className={`aspect-square rounded-xl border flex flex-col items-center justify-center transition-colors ${
                    busy
                      ? 'bg-warning/10 border-warning/40 hover:bg-warning/20'
                      : 'bg-surface border-border hover:bg-surface-hover'
                  }`}
                >
                  <span className="text-2xl font-bold">№{t.number}</span>
                  <span className="text-xs text-muted mt-1">{t.hall}</span>
                  <span
                    className={`text-xs mt-1 font-semibold ${
                      busy ? 'text-warning' : 'text-success'
                    }`}
                  >
                    {busy ? 'Band' : 'Bo‘sh'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </AppShell>
    );
  }

  // 2-bosqich: menyudan buyurtma yig'ish
  return (
    <AppShell title={`Ofitsiant — Stol №${selectedTable.number}`}>
      <div className="h-full flex">
        {/* Menyu */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex gap-2 p-4 border-b border-border overflow-x-auto">
            <Button variant="ghost" onClick={() => setSelectedTable(null)}>
              ← Stollar
            </Button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCat(c.id)}
                className={`px-4 py-2 rounded-lg font-semibold whitespace-nowrap ${
                  activeCat === c.id
                    ? 'bg-primary text-white'
                    : 'bg-surface text-muted hover:text-text'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {shownItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => addToCart(item)}
                  className="bg-surface border border-border rounded-xl p-4 text-left hover:bg-surface-hover transition-colors"
                >
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-primary font-bold mt-2">
                    {formatSum(Number(item.price))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Buyurtma savati */}
        <aside className="w-[360px] bg-surface border-l border-border flex flex-col">
          <div className="px-5 py-4 border-b border-border font-bold text-lg">
            Buyurtma
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-2">
            {cart.length === 0 ? (
              <div className="text-muted text-sm text-center mt-8">
                Taom tanlang
              </div>
            ) : (
              cart.map((c) => (
                <div
                  key={c.menuItemId}
                  className="flex items-center justify-between bg-bg rounded-lg p-2.5"
                >
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{c.name}</div>
                    <div className="text-xs text-muted">
                      {formatSum(c.price)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <button
                      onClick={() => changeQty(c.menuItemId, -1)}
                      className="w-7 h-7 rounded bg-surface border border-border font-bold"
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-semibold">
                      {c.quantity}
                    </span>
                    <button
                      onClick={() => changeQty(c.menuItemId, 1)}
                      className="w-7 h-7 rounded bg-surface border border-border font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-4 border-t border-border">
            <div className="flex justify-between mb-3">
              <span className="text-muted">Jami</span>
              <span className="font-bold text-lg">{formatSum(total)}</span>
            </div>
            <Button
              className="w-full"
              disabled={cart.length === 0 || sending}
              onClick={sendOrder}
            >
              {sending ? 'Yuborilmoqda...' : 'Oshxonaga yuborish'}
            </Button>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
