import { useEffect, useMemo, useState } from 'react';
import {
  Category,
  MenuItem,
  Table,
  TableStatus,
  User,
} from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { Button, formatSum } from '../components/ui';
import { MenuTile } from '../components/MenuTile';
import { FeedbackModal, FeedbackVariant } from '../components/FeedbackModal';
import { api } from '../lib/api';
import { enqueue } from '../lib/offlineQueue';
import { useConnectivity } from '../state/connectivity';

interface Feedback {
  variant: FeedbackVariant;
  title: string;
  subtitle?: string;
}

interface CartItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  note?: string;
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const msg = (e as Error)?.message?.toLowerCase() ?? '';
  return msg.includes('fetch') || msg.includes('network') || !navigator.onLine;
}

// Ofitsiant ekrani (TZ 5.1): ofitsiant tanlash -> zal -> stol -> menyudan buyurtma
export function WaiterPage() {
  const { online } = useConnectivity();
  const [waiters, setWaiters] = useState<User[]>([]);
  const [selectedWaiter, setSelectedWaiter] = useState<User | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [selectedHall, setSelectedHall] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function loadTables() {
    setTables(await api.get<Table[]>('/tables'));
  }

  useEffect(() => {
    api.get<User[]>('/users/waiters').then(setWaiters).catch(() => {});
    loadTables().catch(() => {});
    api.get<Category[]>('/menu/categories').then((c) => {
      setCategories(c);
      setActiveCat(c[0]?.id ?? null);
    });
    api.get<MenuItem[]>('/menu/items').then(setMenu);
  }, []);

  const halls = useMemo(
    () => Array.from(new Set(tables.map((t) => t.hall))),
    [tables],
  );
  const shownItems = useMemo(
    () => menu.filter((m) => m.categoryId === activeCat),
    [menu, activeCat],
  );
  const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);

  function pickWaiter(w: User) {
    setSelectedWaiter(w);
    setSelectedHall(halls[0] ?? null);
  }

  function addToCart(item: MenuItem) {
    setCart((prev) => {
      const found = prev.find((c) => c.menuItemId === item.id);
      if (found) return prev.map((c) => (c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c));
      return [...prev, { menuItemId: item.id, name: item.name, price: Number(item.price), quantity: 1 }];
    });
  }
  function changeQty(id: string, delta: number) {
    setCart((prev) =>
      prev.map((c) => (c.menuItemId === id ? { ...c, quantity: c.quantity + delta } : c)).filter((c) => c.quantity > 0),
    );
  }

  function finishSend(fb: Feedback) {
    setCart([]);
    setSelectedTable(null);
    setFeedback(fb);
  }

  async function sendOrder() {
    if (!selectedTable || !selectedWaiter || cart.length === 0) return;
    const tableNo = selectedTable.number;
    const items = cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity, note: c.note }));

    if (!online) {
      enqueue({ tableId: selectedTable.id, tableNumber: selectedTable.number, waiterId: selectedWaiter.id, items });
      finishSend({ variant: 'info', title: 'Oflayn saqlandi', subtitle: 'Ulanish tiklanganda avtomatik yuboriladi' });
      return;
    }
    setSending(true);
    try {
      await api.post('/orders', { tableId: selectedTable.id, waiterId: selectedWaiter.id, items });
      await loadTables();
      finishSend({ variant: 'success', title: 'Buyurtma yuborildi!', subtitle: `Stol №${tableNo} — oshxonaga uzatildi` });
    } catch (e) {
      if (isNetworkError(e)) {
        enqueue({ tableId: selectedTable.id, tableNumber: selectedTable.number, waiterId: selectedWaiter.id, items });
        finishSend({ variant: 'info', title: 'Aloqa yo‘q', subtitle: 'Oflayn saqlandi, keyin yuboriladi' });
      } else {
        setFeedback({ variant: 'warning', title: 'Xatolik', subtitle: (e as Error).message });
      }
    } finally {
      setSending(false);
    }
  }

  // Barcha bosqichlarda ko'rinadigan feedback modali
  const feedbackModal = feedback && (
    <FeedbackModal
      variant={feedback.variant}
      title={feedback.title}
      subtitle={feedback.subtitle}
      onClose={() => setFeedback(null)}
    />
  );

  // 1-qadam: ofitsiant o'zini tanlaydi
  if (!selectedWaiter) {
    return (
      <AppShell title="Ofitsiant — kim ish boshlaydi?">
        <div className="h-full overflow-auto p-6">
          <div className="text-muted mb-4">Ro‘yxatdan o‘zingizni tanlang:</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {waiters.map((w) => (
              <button
                key={w.id}
                onClick={() => pickWaiter(w)}
                className="bg-surface border border-border rounded-2xl p-5 text-center hover:border-primary lift animate-card-in"
              >
                <div className="w-12 h-12 rounded-full bg-primary/20 text-primary font-bold text-xl flex items-center justify-center mx-auto mb-2">
                  {w.name.charAt(0)}
                </div>
                <div className="font-semibold">{w.name}</div>
              </button>
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  // 2-qadam: zal va stol tanlash
  if (!selectedTable) {
    const hallTables = tables.filter((t) => t.hall === selectedHall);
    return (
      <AppShell title={`Ofitsiant — ${selectedWaiter.name}`}>
        {feedbackModal}
        <div className="h-full overflow-auto p-6">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Button variant="ghost" onClick={() => setSelectedWaiter(null)}>← Ofitsiant</Button>
            <span className="text-muted ml-2">Zal:</span>
            {halls.map((h) => (
              <button
                key={h}
                onClick={() => setSelectedHall(h)}
                className={`px-4 py-2 rounded-lg font-semibold ${
                  selectedHall === h ? 'bg-primary text-white' : 'bg-surface text-muted hover:text-text'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {hallTables.map((t) => {
              const busy = t.status !== TableStatus.Free;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedTable(t)}
                  className={`aspect-square rounded-2xl border flex flex-col items-center justify-center lift animate-card-in ${
                    busy ? 'bg-warning/10 border-warning/40 hover:bg-warning/20' : 'bg-surface border-border hover:bg-surface-hover'
                  }`}
                >
                  <span className="text-2xl font-bold">№{t.number}</span>
                  <span className="text-xs text-muted mt-1">{t.capacity} kishi</span>
                  <span className={`text-xs mt-1 font-semibold ${busy ? 'text-warning' : 'text-success'}`}>
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

  // 3-qadam: menyudan buyurtma yig'ish
  return (
    <AppShell title={`${selectedWaiter.name} — Stol №${selectedTable.number}`}>
      {feedbackModal}
      <div className="h-full flex">
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex gap-2 p-4 border-b border-border overflow-x-auto">
            <Button variant="ghost" onClick={() => setSelectedTable(null)}>← Stollar</Button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCat(c.id)}
                className={`px-4 py-2 rounded-lg font-semibold whitespace-nowrap ${
                  activeCat === c.id ? 'bg-primary text-white' : 'bg-surface text-muted hover:text-text'
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
                  className="group bg-surface border border-border rounded-2xl p-2.5 text-left lift hover:border-primary animate-card-in"
                >
                  <MenuTile name={item.name} image={item.image} />
                  <div className="font-semibold mt-2 px-1">{item.name}</div>
                  <div className="text-primary font-bold px-1 pb-1">
                    {formatSum(Number(item.price))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside className="w-[360px] bg-surface border-l border-border flex flex-col">
          <div className="px-5 py-4 border-b border-border font-bold text-lg">Buyurtma</div>
          <div className="flex-1 overflow-auto p-4 space-y-2">
            {cart.length === 0 ? (
              <div className="text-muted text-sm text-center mt-8">Taom tanlang</div>
            ) : (
              cart.map((c) => (
                <div key={c.menuItemId} className="flex items-center justify-between bg-bg rounded-xl p-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{c.name}</div>
                    <div className="text-xs text-muted">{formatSum(c.price)}</div>
                  </div>
                  <div className="flex items-center gap-2.5 ml-2">
                    <button
                      onClick={() => changeQty(c.menuItemId, -1)}
                      className="w-12 h-12 rounded-xl bg-surface border border-border text-3xl font-bold leading-none flex items-center justify-center active:scale-90 hover:border-danger hover:text-danger transition-all"
                    >
                      −
                    </button>
                    <span className="w-9 text-center text-2xl font-extrabold">{c.quantity}</span>
                    <button
                      onClick={() => changeQty(c.menuItemId, 1)}
                      className="w-12 h-12 rounded-xl bg-primary text-white text-3xl font-bold leading-none flex items-center justify-center active:scale-90 hover:brightness-110 transition-all"
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
            <Button className="w-full" disabled={cart.length === 0 || sending} onClick={sendOrder}>
              {sending ? 'Yuborilmoqda...' : 'Oshxonaga yuborish'}
            </Button>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
