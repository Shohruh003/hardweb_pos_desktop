import { useEffect, useMemo, useState } from 'react';
import { Category, MenuItem, Table, TableStatus } from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { Button, formatSum } from '../components/ui';
import { MenuTile } from '../components/MenuTile';
import { FeedbackModal, FeedbackVariant } from '../components/FeedbackModal';
import { MyOrdersView } from '../components/MyOrdersView';
import { BackButton } from '../components/BackButton';
import { api } from '../lib/api';
import { enqueue } from '../lib/offlineQueue';
import { useConnectivity } from '../state/connectivity';
import { useI18n } from '../state/i18n';
import { useAuth } from '../state/auth';

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
  const { t } = useI18n();
  const { user } = useAuth();
  // Kirgan foydalanuvchining o'zi ofitsiant (PIN bilan kirdi)
  const selectedWaiter = user!;
  const [tables, setTables] = useState<Table[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [selectedHall, setSelectedHall] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [menuSearch, setMenuSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  async function loadTables() {
    setTables(await api.get<Table[]>('/tables'));
  }

  useEffect(() => {
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
  // Zal tanlanmagan bo'lsa — birinchi zalni tanlaymiz
  useEffect(() => {
    if (!selectedHall && halls.length) setSelectedHall(halls[0]);
  }, [halls, selectedHall]);

  // Qidiruv bo'lsa — barcha kategoriyalar bo'yicha nom/ingredient qidiramiz
  const shownItems = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    if (q) {
      return menu.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.ingredients ?? '').toLowerCase().includes(q),
      );
    }
    return menu.filter((m) => m.categoryId === activeCat);
  }, [menu, activeCat, menuSearch]);
  const total = cart.reduce((s, c) => s + c.price * c.quantity, 0);

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
      const created = await api.post<any>('/orders', { tableId: selectedTable.id, waiterId: selectedWaiter.id, items });
      await loadTables();
      // Oshxona printerlariga chek chiqaramiz (sozlangan bo'lsa; xato bo'lsa ham buyurtma yuborildi)
      try {
        await window.hardweb?.printer?.printKitchen?.(created);
      } catch {
        /* oshxona printeri majburiy emas */
      }
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

  // "Mening buyurtmalarim" — alohida sahifa (filtrlar + infinite scroll)
  if (showHistory) {
    return (
      <AppShell title={`Ofitsiant — ${selectedWaiter.name}`}>
        {feedbackModal}
        <MyOrdersView
          waiterId={selectedWaiter.id}
          waiterName={selectedWaiter.name}
          onBack={() => setShowHistory(false)}
        />
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
            <span className="text-muted">Zal:</span>
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
            <Button variant="ghost" className="ml-auto" onClick={() => setShowHistory(true)}>
              🧾 {t('waiter.myOrders')}
            </Button>
            <BackButton />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {hallTables.map((tbl) => {
              const busy = tbl.status !== TableStatus.Free;
              return (
                <button
                  key={tbl.id}
                  onClick={() => setSelectedTable(tbl)}
                  className={`aspect-square rounded-2xl border flex flex-col items-center justify-center lift animate-card-in ${
                    busy ? 'bg-warning/10 border-warning/40 hover:bg-warning/20' : 'bg-surface border-border hover:bg-surface-hover'
                  }`}
                >
                  <span className="text-2xl font-bold">№{tbl.number}</span>
                  <span className="text-xs text-muted mt-1">{tbl.capacity} {t('waiter.people')}</span>
                  <span className={`text-xs mt-1 font-semibold ${busy ? 'text-warning' : 'text-success'}`}>
                    {busy ? t('waiter.busy') : t('waiter.free')}
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
      <div className="h-full flex flex-col md:flex-row">
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex flex-col gap-2 p-3 sm:p-4 border-b border-border">
            <div className="flex gap-2 items-center">
              <Button variant="ghost" onClick={() => setSelectedTable(null)}>← Stollar</Button>
              <div className="relative flex-1">
                <input
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                  placeholder="🔎 Taom qidirish (nom yoki mahsulot)..."
                  className="w-full pl-3 pr-8 py-2 rounded-lg bg-surface border border-border outline-none focus:border-primary"
                />
                {menuSearch && (
                  <button
                    onClick={() => setMenuSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-danger"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
            {!menuSearch && (
              <div className="flex gap-2 overflow-x-auto">
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
            )}
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

        <aside className="w-full md:w-[360px] shrink-0 bg-surface border-t md:border-t-0 md:border-l border-border flex flex-col max-h-[45vh] md:max-h-none">
          <div className="px-5 py-3 md:py-4 border-b border-border font-bold text-lg">{t('waiter.order')}</div>
          <div className="flex-1 overflow-auto p-4 space-y-2">
            {cart.length === 0 ? (
              <div className="text-muted text-sm text-center mt-8">{t('waiter.pickDish')}</div>
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
                      aria-label="Kamaytirish"
                      className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center active:scale-90 hover:border-danger hover:text-danger transition-all"
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <path d="M6 12h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    </button>
                    <span className="w-9 text-center text-2xl font-extrabold">{c.quantity}</span>
                    <button
                      onClick={() => changeQty(c.menuItemId, 1)}
                      aria-label="Ko'paytirish"
                      className="w-12 h-12 rounded-xl bg-primary text-white flex items-center justify-center active:scale-90 hover:brightness-110 transition-all"
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-4 border-t border-border">
            <div className="flex justify-between mb-3">
              <span className="text-muted">{t('common.total')}</span>
              <span className="font-bold text-lg">{formatSum(total)}</span>
            </div>
            <Button className="w-full" disabled={cart.length === 0 || sending} onClick={sendOrder}>
              {sending ? t('waiter.sending') : t('waiter.sendToKitchen')}
            </Button>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
