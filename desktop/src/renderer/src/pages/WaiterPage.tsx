import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Category,
  MenuItem,
  MenuUnit,
  Order,
  SOCKET_EVENTS,
  Station,
  Table,
  TableStatus,
  User,
} from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { Button, formatSum } from '../components/ui';
import { MenuTile } from '../components/MenuTile';
import { Modal } from '../components/Modal';
import { FeedbackModal, FeedbackVariant } from '../components/FeedbackModal';
import { MyOrdersView } from '../components/MyOrdersView';
import { BackButton } from '../components/BackButton';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { enqueue } from '../lib/offlineQueue';
import { useConnectivity } from '../state/connectivity';
import { useI18n } from '../state/i18n';
import { useAuth } from '../state/auth';
import { useConfirm } from '../state/confirm';

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
  unit: MenuUnit;
  note?: string;
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const msg = (e as Error)?.message?.toLowerCase() ?? '';
  return msg.includes('fetch') || msg.includes('network') || !navigator.onLine;
}

// Miqdorni birlik bilan ko'rsatish (dona -> "2", kg -> "1.5 kg")
function qtyLabel(quantity: number, unit: MenuUnit): string {
  if (unit === MenuUnit.Weight) return `${quantity} kg`;
  return String(quantity);
}

// Ofitsiant ekrani (TZ 5.1): ofitsiant tanlash -> zal -> stol -> menyudan buyurtma
export function WaiterPage() {
  const { online } = useConnectivity();
  const { t } = useI18n();
  const { user } = useAuth();
  const confirm = useConfirm();
  // Kirgan foydalanuvchining o'zi ofitsiant (PIN bilan kirdi)
  const selectedWaiter = user!;
  const [tables, setTables] = useState<Table[]>([]);
  // Faol (ochiq) buyurtmalar — stol kartochkasida narx + ofitsiantни ko'rsatish uchun
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  // Bo'limlar (sexlar) — chekни printerlarга yo'naltirish uchun
  const [stations, setStations] = useState<Station[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [selectedHall, setSelectedHall] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [menuSearch, setMenuSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  // Shu stolda oldin yuborilgan (ochiq) buyurtma — qayta kirilganda ko'rinadi
  const [existingOrder, setExistingOrder] = useState<Order | null>(null);
  // Yuborilgan buyurtmadan olib tashlash uchun belgilangan taomlar (id)
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false); // 3-nuqta menyu (annul/stol/ofitsiant)
  const [changeTableOpen, setChangeTableOpen] = useState(false);
  const [changeWaiterOpen, setChangeWaiterOpen] = useState(false);
  const [waiters, setWaiters] = useState<User[]>([]);
  const [sending, setSending] = useState(false);
  const [printingBill, setPrintingBill] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // Kiloda sotiladigan taomni tahrirlash (kg yoki so'm)
  const [editItem, setEditItem] = useState<CartItem | null>(null);
  const [editKg, setEditKg] = useState('');
  const [editSum, setEditSum] = useState('');

  async function loadTables() {
    setTables(await api.get<Table[]>('/tables'));
  }
  async function loadActive() {
    try {
      setActiveOrders(await api.get<Order[]>('/orders'));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadTables().catch(() => {});
    loadActive();
    api.get<Category[]>('/menu/categories').then((c) => {
      setCategories(c);
      setActiveCat(c[0]?.id ?? null);
    });
    api.get<MenuItem[]>('/menu/items').then(setMenu);
    api.get<Station[]>('/stations').then(setStations).catch(() => {});
  }, []);

  // Buyurtma taomlarini bo'lim (sex) printerlariga yo'naltirish.
  // Bo'lim printeri sozlanmagan bo'lsa — o'sha bo'lim chekи chiqmaydi.
  async function printToStations(order: Order) {
    const items = order.items || [];
    for (const st of stations) {
      if (!st.printerHost) continue;
      const sub = items.filter((it) => it.stationId === st.id);
      if (sub.length === 0) continue;
      try {
        await window.hardweb?.printer?.printStation?.(
          { ...order, items: sub },
          st.printerHost,
          st.printerPort,
          st.printerWidth,
          st.name,
        );
      } catch {
        /* bo'lim printeri majburiy emas */
      }
    }
  }

  // Stol holatlarini real-time yangilash (boshqa terminalда to'lov/zakaz bo'lса)
  const selectedTableRef = useRef<Table | null>(null);
  useEffect(() => {
    selectedTableRef.current = selectedTable;
  }, [selectedTable]);
  useEffect(() => {
    const socket = getSocket();
    const refresh = () => {
      loadTables().catch(() => {});
      api
        .get<Order[]>('/orders')
        .then((a) => {
          setActiveOrders(a);
          const tbl = selectedTableRef.current;
          if (tbl) setExistingOrder(a.find((o) => o.tableId === tbl.id) ?? null);
        })
        .catch(() => {});
    };
    socket.on(SOCKET_EVENTS.ORDER_CREATED, refresh);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, refresh);
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, refresh);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, refresh);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, refresh);
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, refresh);
    };
  }, []);

  const halls = useMemo(
    () => Array.from(new Set(tables.map((t) => t.hall))),
    [tables],
  );
  // Zal tanlanmagan bo'lsa — birinchi zalni tanlaymiz
  useEffect(() => {
    if (!selectedHall && halls.length) setSelectedHall(halls[0]);
  }, [halls, selectedHall]);

  // Stol tanlanganda: shu stoldagi ochiq buyurtmani yuklaymiz (F1)
  async function openTable(tbl: Table) {
    setSelectedTable(tbl);
    setCart([]);
    setExistingOrder(null);
    setRemoveIds([]);
    setMoreOpen(false);
    try {
      const active = await api.get<Order[]>('/orders');
      setExistingOrder(active.find((o) => o.tableId === tbl.id) ?? null);
    } catch {
      /* ochiq buyurtma bo'lmasligi mumkin */
    }
  }

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
    if (activeCat === '__fav__') return menu.filter((m) => m.favorite);
    return menu.filter((m) => m.categoryId === activeCat);
  }, [menu, activeCat, menuSearch]);
  const hasFavorites = useMemo(() => menu.some((m) => m.favorite), [menu]);

  const cartTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const existingTotal = existingOrder?.total ?? 0;
  // Olib tashlash uchun belgilangan taomlar summasi
  const removedSum = (existingOrder?.items ?? [])
    .filter((it) => removeIds.includes(it.id))
    .reduce((s, it) => s + Number(it.price) * it.quantity, 0);
  const grandTotal = existingTotal - removedSum + cartTotal;

  function toggleRemove(itemId: string) {
    setRemoveIds((prev) =>
      prev.includes(itemId) ? prev.filter((x) => x !== itemId) : [...prev, itemId],
    );
  }

  function addToCart(item: MenuItem) {
    const unit = item.unit ?? MenuUnit.Piece;
    // Kiloda sotiladigan taom — qo'shamiz (1 kg) va darhol tahrirlash oynasini ochamiz
    if (unit === MenuUnit.Weight) {
      const price = Number(item.price);
      const existing = cart.find((c) => c.menuItemId === item.id);
      const ci: CartItem = existing ?? {
        menuItemId: item.id,
        name: item.name,
        price,
        quantity: 1,
        unit,
      };
      if (!existing) setCart((prev) => [...prev, ci]);
      openEdit(ci);
      return;
    }
    setCart((prev) => {
      const found = prev.find((c) => c.menuItemId === item.id);
      if (found)
        return prev.map((c) =>
          c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c,
        );
      return [
        ...prev,
        { menuItemId: item.id, name: item.name, price: Number(item.price), quantity: 1, unit },
      ];
    });
  }

  function changeQty(id: string, delta: number) {
    setCart((prev) =>
      prev
        .map((c) => (c.menuItemId === id ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0),
    );
  }

  function removeItem(id: string) {
    setCart((prev) => prev.filter((c) => c.menuItemId !== id));
  }

  // --- Kilo taomni tahrirlash (kg <-> so'm) ---
  function openEdit(ci: CartItem) {
    setEditItem(ci);
    setEditKg(String(ci.quantity));
    setEditSum(String(Math.round(ci.quantity * ci.price)));
  }
  function onEditKg(v: string) {
    const clean = v.replace(/[^0-9.]/g, '');
    setEditKg(clean);
    const kg = Number(clean);
    setEditSum(kg > 0 ? String(Math.round(kg * (editItem?.price ?? 0))) : '');
  }
  function onEditSum(v: string) {
    const clean = v.replace(/[^0-9]/g, '');
    setEditSum(clean);
    const sum = Number(clean);
    const price = editItem?.price ?? 0;
    setEditKg(sum > 0 && price > 0 ? String(Math.round((sum / price) * 1000) / 1000) : '');
  }
  function saveEdit() {
    if (!editItem) return;
    const kg = Number(editKg);
    if (!(kg > 0)) {
      removeItem(editItem.menuItemId);
      setEditItem(null);
      return;
    }
    setCart((prev) =>
      prev.map((c) => (c.menuItemId === editItem.menuItemId ? { ...c, quantity: kg } : c)),
    );
    setEditItem(null);
  }

  function finishSend(fb: Feedback) {
    setCart([]);
    setSelectedTable(null);
    setExistingOrder(null);
    setRemoveIds([]);
    setMoreOpen(false);
    setFeedback(fb);
  }

  // Yuborilgan buyurtmadan belgilangan taomlarни olib tashlash (+ yangi taomlar bo'lsa yuborish)
  async function confirmChanges() {
    if (!selectedTable || !existingOrder) return;
    setSending(true);
    try {
      if (removeIds.length > 0) {
        await api.post(`/orders/${existingOrder.id}/remove-items`, { itemIds: removeIds });
      }
      if (cart.length > 0) {
        const items = cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity, note: c.note }));
        const created = await api.post<Order>('/orders', { tableId: selectedTable.id, waiterId: selectedWaiter.id, items });
        // Yangi qo'shilgan taomlarni bo'lim printerlariga yuboramiz
        await printToStations(created);
      }
      await loadTables();
      finishSend({ variant: 'success', title: 'O‘zgarish saqlandi', subtitle: `Stol №${selectedTable.number} — buyurtma yangilandi` });
    } catch (e) {
      setFeedback({ variant: 'warning', title: 'Xatolik', subtitle: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  // Stolni o'zgartirish (smenit stol) — buyurtmani boshqa stolga ko'chirish
  function openChangeTable() {
    setMoreOpen(false);
    setChangeTableOpen(true);
  }
  async function moveToTable(tableId: string) {
    if (!existingOrder) return;
    setChangeTableOpen(false);
    setSending(true);
    try {
      await api.post(`/orders/${existingOrder.id}/move-table`, { tableId });
      await loadTables();
      const nt = tables.find((t) => t.id === tableId);
      finishSend({ variant: 'success', title: 'Stol o‘zgartirildi', subtitle: `Buyurtma Stol №${nt?.number} ga ko‘chirildi` });
    } catch (e) {
      setFeedback({ variant: 'warning', title: 'Xatolik', subtitle: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  // Ofitsiantni o'zgartirish (smenit ofitsant)
  async function openChangeWaiter() {
    setMoreOpen(false);
    try {
      setWaiters(await api.get<User[]>('/users/waiters'));
    } catch {
      setWaiters([]);
    }
    setChangeWaiterOpen(true);
  }
  async function changeToWaiter(waiterId: string) {
    if (!existingOrder) return;
    setChangeWaiterOpen(false);
    setSending(true);
    try {
      const updated = await api.post<Order>(`/orders/${existingOrder.id}/change-waiter`, { waiterId });
      setExistingOrder(updated);
      setFeedback({ variant: 'success', title: 'Ofitsiant o‘zgartirildi', subtitle: updated.waiterName ? `Endi: ${updated.waiterName}` : '' });
    } catch (e) {
      setFeedback({ variant: 'warning', title: 'Xatolik', subtitle: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  // Schotni butunlay bekor qilish (annul) — stol bo'shaydi
  async function annulOrder() {
    if (!existingOrder || !selectedTable) return;
    setMoreOpen(false);
    const ok = await confirm({
      title: 'Schotni bekor qilish',
      message: `Stol №${selectedTable.number} buyurtmasi butunlay bekor qilinsinmi? Stol bo‘shaydi.`,
      danger: true,
    });
    if (!ok) return;
    setSending(true);
    try {
      await api.post(`/orders/${existingOrder.id}/cancel`, {});
      await loadTables();
      finishSend({ variant: 'success', title: 'Schot bekor qilindi', subtitle: `Stol №${selectedTable.number} bo‘shatildi` });
    } catch (e) {
      setFeedback({ variant: 'warning', title: 'Xatolik', subtitle: (e as Error).message });
    } finally {
      setSending(false);
    }
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
      const created = await api.post<Order>('/orders', { tableId: selectedTable.id, waiterId: selectedWaiter.id, items });
      await loadTables();
      loadActive();
      // Taomlarni bo'lim (sex) printerlariga yo'naltiramiz (oshxona/bar/somsaxona...)
      await printToStations(created);
      finishSend({ variant: 'success', title: 'Buyurtma yuborildi!', subtitle: `Stol №${tableNo} — bo‘limlarga uzatildi` });
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

  // Schot (hisob) chop etish — kassa printeridan (F3). Ochiq buyurtma bo'yicha.
  async function printSchot() {
    if (!existingOrder) return;
    if (cart.length > 0) {
      setFeedback({
        variant: 'warning',
        title: 'Avval yangi taomlarni yuboring',
        subtitle: 'Schotdan oldin qo‘shilgan taomlarni "Yuborish" tugmasi bilan tasdiqlang',
      });
      return;
    }
    const tableNo = selectedTable?.number;
    setPrintingBill(true);
    // Stolni "hisob kutilmoqda" holatiga o'tkazamiz (mijoz hisob so'radi)
    await api.post(`/orders/${existingOrder.id}/request-bill`).catch(() => undefined);
    try {
      // Shu terminalда printer bormi? (LAN/USB sozlangan bo'lsa — o'zi chiqaradi)
      const cfg = await window.hardweb?.printer?.getConfig?.().catch(() => null);
      const hasLocalPrinter = !!cfg && cfg.type !== 'none';

      if (hasLocalPrinter) {
        const res = await window.hardweb!.printer.printBill(existingOrder);
        await loadTables();
        if (res?.ok) {
          setPrintingBill(false);
          finishSend({ variant: 'success', title: 'Hisob chop etildi', subtitle: `Stol №${tableNo} — schot chiqdi` });
          return;
        }
        setFeedback({ variant: 'warning', title: 'Chop etilmadi', subtitle: res?.message || 'Printer xatosi' });
      } else {
        // Bu terminalда printer yo'q — kassa printeriga yuboramiz (relay)
        await api.post(`/orders/${existingOrder.id}/print-bill`);
        await loadTables();
        setPrintingBill(false);
        finishSend({ variant: 'success', title: 'Hisob kassaga yuborildi', subtitle: `Stol №${tableNo} — schot kassa printeridan chiqadi` });
        return;
      }
    } catch (e) {
      setFeedback({ variant: 'warning', title: 'Xatolik', subtitle: (e as Error)?.message || 'Hisob yuborilmadi' });
    } finally {
      setPrintingBill(false);
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

  // Kilo taomni tahrirlash modali (kg yoki so'm bo'yicha)
  const editModal = editItem && (
    <Modal title={`${editItem.name} — miqdor`} onClose={saveEdit}>
      <div className="text-sm text-muted mb-3">
        1 kg narxi: <span className="font-semibold text-text">{formatSum(editItem.price)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-muted mb-1">Og‘irligi (kg)</label>
          <input
            autoFocus
            inputMode="decimal"
            value={editKg}
            onChange={(e) => onEditKg(e.target.value)}
            placeholder="masalan: 1.5"
            className="w-full px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary text-lg font-bold"
          />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">Yoki summa (so‘m)</label>
          <input
            inputMode="numeric"
            value={editSum}
            onChange={(e) => onEditSum(e.target.value)}
            placeholder="masalan: 350000"
            className="w-full px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary text-lg font-bold"
          />
        </div>
      </div>
      <div className="mt-3 text-center text-sm">
        {Number(editKg) > 0 ? (
          <span className="text-primary font-semibold">
            {editKg} kg = {formatSum(Math.round(Number(editKg) * editItem.price))}
          </span>
        ) : (
          <span className="text-muted">Og‘irlik yoki summani kiriting</span>
        )}
      </div>
      <div className="flex gap-2 mt-4">
        <Button variant="ghost" className="flex-1" onClick={() => { removeItem(editItem.menuItemId); setEditItem(null); }}>
          O‘chirish
        </Button>
        <Button className="flex-1" onClick={saveEdit}>Saqlash</Button>
      </div>
    </Modal>
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
              const awaiting = tbl.status === TableStatus.AwaitingBill;
              const busy = tbl.status !== TableStatus.Free;
              const order = activeOrders.find((o) => o.tableId === tbl.id);
              const cls = awaiting
                ? 'bg-info/10 border-info/50 hover:bg-info/20'
                : busy
                  ? 'bg-warning/10 border-warning/40 hover:bg-warning/20'
                  : 'bg-surface border-border hover:bg-surface-hover';
              const statusText = awaiting ? 'Hisob kutilmoqda' : busy ? t('waiter.busy') : t('waiter.free');
              const statusColor = awaiting ? 'text-info' : busy ? 'text-warning' : 'text-success';
              return (
                <button
                  key={tbl.id}
                  onClick={() => openTable(tbl)}
                  className={`aspect-square rounded-2xl border flex flex-col items-center justify-center lift animate-card-in p-2 ${cls}`}
                >
                  <span className="text-2xl font-bold leading-none">№{tbl.number}</span>
                  {busy && order ? (
                    <>
                      <span className="text-base font-extrabold text-primary mt-1.5">
                        {formatSum(order.total ?? 0)}
                      </span>
                      <span className="text-[11px] text-muted mt-0.5 truncate max-w-full flex items-center gap-1">
                        🧑‍🍳 {order.waiterName ?? '—'}
                      </span>
                      <span className="text-[11px] text-muted">{order.items?.length ?? 0} ta taom</span>
                      <span className={`text-[11px] mt-0.5 font-semibold ${statusColor}`}>
                        {statusText}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-muted mt-1">{tbl.capacity} {t('waiter.people')}</span>
                      <span className={`text-xs mt-1 font-semibold text-center px-1 ${statusColor}`}>
                        {statusText}
                      </span>
                    </>
                  )}
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
      {editModal}

      {/* Stolni o'zgartirish — bo'sh stollardan tanlash */}
      {changeTableOpen && (
        <Modal title="Stolni o‘zgartirish" onClose={() => setChangeTableOpen(false)}>
          <div className="text-sm text-muted mb-3">Buyurtma qaysi stolga ko‘chirilsin? (bo‘sh stollar)</div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[55vh] overflow-auto">
            {tables
              .filter((tb) => tb.status === TableStatus.Free)
              .map((tb) => (
                <button
                  key={tb.id}
                  onClick={() => moveToTable(tb.id)}
                  disabled={sending}
                  className="aspect-square rounded-xl border border-border hover:border-primary hover:bg-surface-hover flex flex-col items-center justify-center disabled:opacity-50"
                >
                  <span className="text-xl font-bold">№{tb.number}</span>
                  <span className="text-[11px] text-muted text-center px-1">{tb.hall}</span>
                </button>
              ))}
          </div>
          {tables.filter((tb) => tb.status === TableStatus.Free).length === 0 && (
            <div className="text-muted text-sm mt-2">Bo‘sh stol yo‘q.</div>
          )}
        </Modal>
      )}

      {/* Ofitsiantni o'zgartirish — ofitsiantlar ro'yxatidan tanlash */}
      {changeWaiterOpen && (
        <Modal title="Ofitsiantni o‘zgartirish" onClose={() => setChangeWaiterOpen(false)}>
          <div className="space-y-2 max-h-[55vh] overflow-auto">
            {waiters.map((w) => (
              <button
                key={w.id}
                onClick={() => changeToWaiter(w.id)}
                disabled={sending}
                className="w-full text-left px-4 py-3 rounded-xl border border-border hover:border-primary hover:bg-surface-hover font-semibold flex items-center gap-3 disabled:opacity-50"
              >
                <span className="w-9 h-9 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center shrink-0">
                  {w.name.charAt(0)}
                </span>
                {w.name}
              </button>
            ))}
            {waiters.length === 0 && <div className="text-muted text-sm">Ofitsiant topilmadi.</div>}
          </div>
        </Modal>
      )}

      <div className="h-full flex flex-col md:flex-row">
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex flex-col gap-2 p-3 sm:p-4 border-b border-border">
            <div className="flex gap-2 items-center">
              <Button variant="ghost" onClick={() => { setSelectedTable(null); setExistingOrder(null); setCart([]); }}>← Stollar</Button>
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
                {hasFavorites && (
                  <button
                    onClick={() => setActiveCat('__fav__')}
                    className={`px-4 py-2 rounded-lg font-semibold whitespace-nowrap ${
                      activeCat === '__fav__' ? 'bg-warning text-white' : 'bg-surface text-warning hover:brightness-110'
                    }`}
                  >
                    ⭐ Sevimlilar
                  </button>
                )}
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
              {shownItems.map((item) => {
                const unit = item.unit ?? MenuUnit.Piece;
                return (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className="group bg-surface border border-border rounded-2xl p-2.5 text-left lift hover:border-primary animate-card-in"
                  >
                    <MenuTile name={item.name} image={item.image} />
                    <div className="font-semibold mt-2 px-1 flex items-center gap-1.5">
                      {item.name}
                      {unit === MenuUnit.Weight && (
                        <span className="text-[10px] font-bold text-warning bg-warning/15 rounded px-1.5 py-0.5">kg</span>
                      )}
                    </div>
                    <div className="text-primary font-bold px-1 pb-1">
                      {formatSum(Number(item.price))}
                      {unit === MenuUnit.Weight && <span className="text-xs text-muted font-normal"> /kg</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="w-full md:w-[360px] shrink-0 bg-surface border-t md:border-t-0 md:border-l border-border flex flex-col max-h-[45vh] md:max-h-none">
          <div className="px-5 py-3 md:py-4 border-b border-border font-bold text-lg">{t('waiter.order')}</div>
          <div className="flex-1 overflow-auto p-4 space-y-2">
            {/* Oldin yuborilgan taomlar (F1) — ✕ bilan qaytarish, ⋮ bilan annul */}
            {existingOrder && existingOrder.items.length > 0 && (
              <div className="mb-2">
                <div className="text-xs font-semibold text-success mb-1.5 flex items-center gap-1">
                  <span>✓ Yuborilgan buyurtma</span>
                  <div className="relative ml-auto">
                    <button
                      onClick={() => setMoreOpen((v) => !v)}
                      aria-label="Ko'proq"
                      className="w-7 h-7 rounded-lg hover:bg-bg flex items-center justify-center text-muted hover:text-text text-lg leading-none"
                    >
                      ⋮
                    </button>
                    {moreOpen && (
                      <div className="absolute right-0 top-8 z-20 w-56 bg-surface border border-border rounded-xl shadow-lg py-1 animate-pop-in">
                        <button
                          onClick={openChangeTable}
                          className="w-full text-left px-4 py-2.5 text-sm font-semibold hover:bg-bg"
                        >
                          🔀 Stolni o‘zgartirish
                        </button>
                        <button
                          onClick={openChangeWaiter}
                          className="w-full text-left px-4 py-2.5 text-sm font-semibold hover:bg-bg"
                        >
                          🧑‍🍳 Ofitsiantni o‘zgartirish
                        </button>
                        <div className="border-t border-border my-1" />
                        <button
                          onClick={annulOrder}
                          className="w-full text-left px-4 py-2.5 text-sm font-semibold text-danger hover:bg-danger/10"
                        >
                          🗑️ Schotni bekor qilish
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="bg-success/5 border border-success/25 rounded-xl divide-y divide-success/10">
                  {existingOrder.items.map((it) => {
                    const marked = removeIds.includes(it.id);
                    return (
                      <div key={it.id} className="flex items-center justify-between px-3 py-2 text-sm gap-2">
                        <span className={`min-w-0 truncate ${marked ? 'line-through text-danger/70' : ''}`}>
                          <span className={`font-bold ${marked ? 'text-danger/70' : 'text-success'}`}>
                            {qtyLabel(it.quantity, it.unit ?? MenuUnit.Piece)}×
                          </span>{' '}
                          {it.menuItemName}
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className={marked ? 'text-danger/60 line-through' : 'text-muted'}>
                            {formatSum(Number(it.price) * it.quantity)}
                          </span>
                          <button
                            onClick={() => toggleRemove(it.id)}
                            aria-label={marked ? 'Qaytarish' : 'Olib tashlash'}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center border transition-colors ${
                              marked
                                ? 'border-success/50 text-success hover:bg-success/10'
                                : 'border-border text-danger hover:bg-danger/10 hover:border-danger'
                            }`}
                          >
                            {marked ? '↩' : '✕'}
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
                {removeIds.length > 0 && (
                  <div className="text-xs text-danger font-semibold mt-1.5">
                    {removeIds.length} ta taom olib tashlanadi — tasdiqlash uchun pastdagi tugmani bosing
                  </div>
                )}
              </div>
            )}

            {/* Yangi qo'shilayotgan taomlar */}
            {cart.length === 0 && !existingOrder ? (
              <div className="text-muted text-sm text-center mt-8">{t('waiter.pickDish')}</div>
            ) : cart.length > 0 ? (
              <>
                <div className="text-xs font-semibold text-primary mb-1.5">＋ Yangi qo‘shilgan</div>
                {cart.map((c) => (
                  <div key={c.menuItemId} className="flex items-center justify-between bg-bg rounded-xl p-3">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{c.name}</div>
                      <div className="text-xs text-muted">
                        {c.unit === MenuUnit.Weight
                          ? `${qtyLabel(c.quantity, c.unit)} · ${formatSum(c.price)}/kg`
                          : formatSum(c.price)}
                      </div>
                    </div>
                    {c.unit === MenuUnit.Weight ? (
                      // Kilo taom — tahrirlash (kg/so'm) va o'chirish
                      <div className="flex items-center gap-2 ml-2">
                        <span className="font-extrabold text-lg text-primary">{formatSum(c.price * c.quantity)}</span>
                        <button
                          onClick={() => openEdit(c)}
                          aria-label="Tahrirlash"
                          className="w-11 h-11 rounded-xl bg-surface border border-border flex items-center justify-center hover:border-primary active:scale-90 transition-all text-lg"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => removeItem(c.menuItemId)}
                          aria-label="O'chirish"
                          className="w-11 h-11 rounded-xl bg-surface border border-border flex items-center justify-center hover:border-danger hover:text-danger active:scale-90 transition-all text-lg"
                        >
                          🗑️
                        </button>
                      </div>
                    ) : (
                      // Dona taom — miqdor +/-
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
                    )}
                  </div>
                ))}
              </>
            ) : (
              <div className="text-muted text-xs text-center mt-2">Yangi taom qo‘shish uchun menyudan tanlang</div>
            )}
          </div>
          <div className="p-4 border-t border-border">
            <div className="flex justify-between mb-3">
              <span className="text-muted">{t('common.total')}</span>
              <span className={`font-bold text-lg ${removeIds.length > 0 ? 'text-danger' : ''}`}>
                {formatSum(grandTotal)}
              </span>
            </div>
            <div className="flex gap-2">
              {existingOrder && (
                <Button
                  variant="ghost"
                  className="flex-1"
                  disabled={printingBill || removeIds.length > 0}
                  onClick={printSchot}
                >
                  🧾 {printingBill ? '...' : 'Schot'}
                </Button>
              )}
              {removeIds.length > 0 ? (
                // O'zgarishni (olib tashlash + yangi taomlar) tasdiqlash
                <Button
                  className="flex-1 !bg-danger hover:!brightness-110"
                  disabled={sending}
                  onClick={confirmChanges}
                >
                  {sending ? '...' : '✔ Tasdiqlash'}
                </Button>
              ) : (
                <Button className="flex-1" disabled={cart.length === 0 || sending} onClick={sendOrder}>
                  {sending ? t('waiter.sending') : t('waiter.sendToKitchen')}
                </Button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
