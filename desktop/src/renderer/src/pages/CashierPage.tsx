import { useEffect, useState } from 'react';
import {
  MenuUnit,
  Order,
  OrderStatus,
  PaymentType,
  Receipt,
  ReportSummary,
  SOCKET_EVENTS,
  hasCapability,
} from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { Button, StatusBadge, formatSum } from '../components/ui';
import { ReceiptPreview } from '../components/ReceiptPreview';
import { Dashboard } from '../components/Dashboard';
import { Modal } from '../components/Modal';
import { ReceiptsTab } from './admin/ReceiptsTab';
import { BackButton } from '../components/BackButton';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useI18n } from '../state/i18n';
import { useAuth } from '../state/auth';

interface ExpenseRow {
  id: string;
  amount: number;
  note: string | null;
  cashierName: string | null;
  createdAt: string;
}

const PAYMENT_OPTIONS: { type: PaymentType; label: string }[] = [
  { type: PaymentType.Cash, label: 'Naqd' },
  { type: PaymentType.Card, label: 'Karta' },
  { type: PaymentType.QR, label: 'QR' },
];

// Kassa moduli (TZ 5.3): hisobni ko'rish, chegirma, to'lov turi, chek chiqarish
export function CashierPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const canHistory = (user?.permissions ?? []).includes('history');
  // Tushum/statistikani ko'rish ruxsati (direktor bera oladi)
  const canRevenue = hasCapability(user, 'revenue') || hasCapability(user, 'reports');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [discount, setDiscount] = useState(0);
  const [serviceFee, setServiceFee] = useState(0);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // Bo'lib to'lash — shu buyurtmaning to'lovlari (naqd/karta/qr)
  const [payments, setPayments] = useState<{ id: string; type: PaymentType; amount: number }[]>([]);
  const [payAmount, setPayAmount] = useState('');
  // To'langan, lekin hali chek chiqarilmagan hisoblar — chop etilgunча ro'yxatда qoladi
  const [unprinted, setUnprinted] = useState<{ order: Order; receipt: Receipt }[]>([]);
  const [exciseInputs, setExciseInputs] = useState<Record<string, string>>({});
  const [savingExcise, setSavingExcise] = useState(false);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [hallFilter, setHallFilter] = useState<string>('');
  const [expenses, setExpenses] = useState<{ items: ExpenseRow[]; total: number }>({ items: [], total: 0 });
  const [showExpenses, setShowExpenses] = useState(false);
  const [expAmount, setExpAmount] = useState('');
  const [expNote, setExpNote] = useState('');

  function refresh() {
    api.get<Order[]>('/orders').then(setOrders).catch(() => {});
    // Bugungi tushum / smena yakuni (TZ: kassir kunlik tushumni ko'radi)
    api.get<ReportSummary>('/reports/summary?period=day').then(setSummary).catch(() => {});
    api.get<{ items: ExpenseRow[]; total: number }>('/expenses').then(setExpenses).catch(() => {});
  }

  async function addExpense() {
    const amount = Number(expAmount);
    if (!amount || amount <= 0) return;
    await api.post('/expenses', { amount, note: expNote.trim() || undefined });
    setExpAmount('');
    setExpNote('');
    api.get<{ items: ExpenseRow[]; total: number }>('/expenses').then(setExpenses).catch(() => {});
  }


  useEffect(() => {
    refresh();
    const socket = getSocket();
    const onChange = () => refresh();
    // Yangi zakas kelganda — kassa printeridan avtomatik chek (#11).
    // Printer sozlanmagan bo'lsa hech narsa chiqmaydi (best-effort).
    const onCreated = (payload: { order?: Order }) => {
      refresh();
      const order = payload?.order;
      if (order) {
        window.hardweb?.printer?.printOrderTicket?.(order).catch(() => undefined);
      }
    };
    // Faqat printeri sozlangan terminal (kassa) relay cheklarни chop etadi
    const printIfHost = async (fn: () => Promise<unknown> | undefined) => {
      try {
        const cfg = await window.hardweb?.printer?.getConfig?.();
        if (cfg && cfg.type !== 'none') await fn();
      } catch {
        /* ignore */
      }
    };
    // Boshqa terminal Schot bossa — kassa printeridan hisob chiqadi (relay)
    const onPrintBill = (payload: { order?: Order }) => {
      if (payload?.order) printIfHost(() => window.hardweb?.printer?.printBill?.(payload.order!));
    };
    // Boshqa terminal to'lov qilса — kassa printeridan chek chiqadi (relay)
    const onPrintReceipt = (payload: { receipt?: Receipt }) => {
      if (payload?.receipt) printIfHost(() => window.hardweb?.printer?.printReceipt?.(payload.receipt!));
    };
    socket.on(SOCKET_EVENTS.ORDER_CREATED, onCreated);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, onChange);
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, onChange);
    socket.on(SOCKET_EVENTS.PRINT_BILL, onPrintBill);
    socket.on(SOCKET_EVENTS.PRINT_RECEIPT, onPrintReceipt);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, onCreated);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, onChange);
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, onChange);
      socket.off(SOCKET_EVENTS.PRINT_BILL, onPrintBill);
      socket.off(SOCKET_EVENTS.PRINT_RECEIPT, onPrintReceipt);
    };
  }, []);

  const active = orders.filter((o) => o.status !== OrderStatus.Closed);
  // Faol hisoblar + to'langan-lekin-chop etilmagan hisoblar (belgi bilan)
  type Bill = Order & { _unprinted?: boolean; _receipt?: Receipt };
  const bills: Bill[] = [
    ...active.map((o) => ({ ...o })),
    ...unprinted.map((u) => ({ ...u.order, _unprinted: true, _receipt: u.receipt })),
  ];
  // Zallar bo'yicha bo'lish (VIP, oddiy va h.k.)
  const halls = Array.from(new Set(bills.map((o) => o.hall).filter(Boolean))) as string[];
  const shown = hallFilter ? bills.filter((o) => o.hall === hallFilter) : bills;

  // Ro'yxatдаги hisobни bosish: chop etilmagan bo'lsa chek oynasi, aks holda to'lov
  function openBill(o: Bill) {
    if (o._unprinted && o._receipt) setReceipt(o._receipt);
    else selectOrder(o);
  }
  function removeUnprinted(orderId: string) {
    setUnprinted((prev) => prev.filter((u) => u.order.id !== orderId));
  }

  function selectOrder(o: Order) {
    setSelected(o);
    setExciseInputs({});
    // chegirma/xizmat/to'lovlar — selected o'zgarganda useEffect yuklaydi
  }

  // Aksiz kodi kerak bo'lib, hali skanerlanmagan taomlar (TZ F-8.5/8.6)
  const pendingExcise = (selected?.items ?? []).filter(
    (it) => it.exciseRequired && !it.exciseCode,
  );

  async function saveExcise() {
    if (!selected) return;
    const codes = pendingExcise
      .map((it) => ({ orderItemId: it.id, code: (exciseInputs[it.id] || '').trim() }))
      .filter((c) => c.code.length > 0);
    if (codes.length === 0) return;
    setSavingExcise(true);
    try {
      const updated = await api.post<Order>(`/orders/${selected.id}/excise`, {
        codes,
      });
      setSelected(updated); // yangilangan (exciseCode bilan) buyurtma
      setExciseInputs({});
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSavingExcise(false);
    }
  }

  const subtotal = selected?.total ?? 0;
  const discountAmount = Math.round((subtotal * discount) / 100);
  const serviceFeeAmount = Math.round((subtotal * serviceFee) / 100);
  const total = subtotal - discountAmount + serviceFeeAmount;
  const paidAmount = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, total - paidAmount);

  // Buyurtma tanlanganda — uning to'lovlari va chegirma/xizmatini yuklaymiz
  useEffect(() => {
    if (!selected) {
      setPayments([]);
      setPayAmount('');
      return;
    }
    setDiscount(selected.discountPercent ?? 0);
    setServiceFee(selected.servicePercent ?? 0);
    setPayAmount('');
    api
      .get<{ id: string; type: PaymentType; amount: number }[]>(`/orders/${selected.id}/payments`)
      .then((ps) => setPayments(ps))
      .catch(() => setPayments([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Bir to'lov qo'shish (bo'lib to'lash). To'liq to'langanda — chek chiqadi va hisob yopiladi.
  async function addPayment(type: PaymentType) {
    if (!selected || remaining <= 0) return;
    const amt = payAmount.trim() ? Math.round(Number(payAmount)) : remaining;
    if (!amt || amt <= 0) {
      alert('To‘lov summasi noto‘g‘ri');
      return;
    }
    setPaying(true);
    try {
      const res = await api.post<{
        fullyPaid: boolean;
        receipt?: Receipt;
        paidAmount: number;
        payments: { id: string; type: PaymentType; amount: number }[];
      }>(`/orders/${selected.id}/pay`, {
        type,
        amount: amt,
        discountPercent: discount,
        serviceFeePercent: serviceFee,
      });
      if (res.fullyPaid && res.receipt) {
        // To'liq to'landi — chek chiqarilgunga qadar ro'yxatda "chek chiqmadi" bo'lib qoladi
        const rc = res.receipt;
        setUnprinted((prev) => [...prev, { order: selected, receipt: rc }]);
        setReceipt(rc);
        setSelected(null);
        refresh();
      } else {
        // Qisman to'landi — buyurtma ochiq qoladi
        setPayments(res.payments);
        setPayAmount('');
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setPaying(false);
    }
  }

  async function removePayment(pid: string) {
    if (!selected) return;
    try {
      await api.del(`/orders/${selected.id}/payments/${pid}`);
      const ps = await api.get<{ id: string; type: PaymentType; amount: number }[]>(
        `/orders/${selected.id}/payments`,
      );
      setPayments(ps);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  // Cheklar tarixi — alohida sahifa (filtrlar + infinite scroll, ReceiptsTab qayta ishlatiladi)
  if (historyOpen) {
    return (
      <AppShell title="Cheklar tarixi">
        <div className="h-full flex flex-col p-3 sm:p-6 overflow-hidden">
          <div className="flex items-center justify-between gap-2 mb-4 shrink-0">
            <div className="text-xl font-bold">🧾 Cheklar tarixi</div>
            <button
              onClick={() => setHistoryOpen(false)}
              className="shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-lg border border-border hover:border-primary hover:bg-surface-hover font-semibold"
            >
              <span className="text-lg leading-none">←</span> Orqaga
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <ReceiptsTab />
          </div>
        </div>
      </AppShell>
    );
  }

  if (dashboardOpen && canRevenue) {
    return (
      <AppShell title="Hisobot">
        <Dashboard onBack={() => setDashboardOpen(false)} />
      </AppShell>
    );
  }

  return (
    <AppShell title={t('title.cashier')}>
      <div className="h-full flex flex-col">
        {/* Soddalashtirilgan tepa panel: tugmalar (tushum ko'rsatkichlari ruxsatga bog'liq) */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border overflow-x-auto">
          {canRevenue && (
            <>
              <SummaryStat label="Bugungi tushum" value={formatSum(summary?.revenue ?? 0)} accent />
              <SummaryStat label="Sof tushum" value={formatSum((summary?.revenue ?? 0) - expenses.total)} />
              <button
                onClick={() => setDashboardOpen(true)}
                className="shrink-0 px-3.5 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 text-sm font-bold whitespace-nowrap"
              >
                📊 Hisobot
              </button>
            </>
          )}
          <button
            onClick={() => setShowExpenses(true)}
            className="shrink-0 px-3 py-2 rounded-lg bg-surface border border-border hover:border-primary text-sm font-semibold whitespace-nowrap"
          >
            ＋ Rasxod
          </button>
          {canHistory && (
            <button
              onClick={() => setHistoryOpen(true)}
              className="shrink-0 px-3 py-2 rounded-lg bg-surface border border-border hover:border-primary text-sm font-semibold whitespace-nowrap"
            >
              🧾 Cheklar tarixi
            </button>
          )}
          <BackButton className="ml-auto" />
        </div>

        {showExpenses && (
          <Modal title="Kunlik rasxodlar" onClose={() => setShowExpenses(false)} wide>
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <input
                value={expAmount}
                inputMode="numeric"
                onChange={(e) => setExpAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="Summa"
                className="w-full sm:w-36 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
              />
              <input
                value={expNote}
                onChange={(e) => setExpNote(e.target.value)}
                placeholder="Izoh (masalan: non, gaz, ...)"
                className="flex-1 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
                onKeyDown={(e) => e.key === 'Enter' && addExpense()}
              />
              <Button onClick={addExpense} className="shrink-0">Qo‘shish</Button>
            </div>
            <div className="bg-bg rounded-xl divide-y divide-border max-h-[45vh] overflow-auto">
              {expenses.items.length === 0 ? (
                <div className="text-muted text-sm p-4 text-center">Bugun rasxod yo‘q</div>
              ) : (
                expenses.items.map((e) => (
                  <div key={e.id} className="flex justify-between px-3 py-2 text-sm">
                    <span className="text-muted">
                      {new Date(e.createdAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
                      {e.note ? ` · ${e.note}` : ''}
                      {e.cashierName ? ` · ${e.cashierName}` : ''}
                    </span>
                    <span className="font-semibold text-danger">- {formatSum(Number(e.amount))}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-between mt-3 font-bold">
              <span>Jami rasxod</span>
              <span className="text-danger">{formatSum(expenses.total)}</span>
            </div>
          </Modal>
        )}

      {/* Ochiq hisoblar — kartochka to'ri (bosilsa to'lov modal ochiladi) */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {/* Zal bo'yicha filtr (VIP / oddiy / terrasa) */}
        {halls.length > 1 && (
          <div className="flex gap-2 flex-wrap mb-4">
            <button
              onClick={() => setHallFilter('')}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                hallFilter === '' ? 'bg-primary text-white border-primary' : 'bg-surface border-border text-muted hover:text-text'
              }`}
            >
              {t('common.all')}
            </button>
            {halls.map((h) => (
              <button
                key={h}
                onClick={() => setHallFilter(h)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                  hallFilter === h ? 'bg-primary text-white border-primary' : 'bg-surface border-border text-muted hover:text-text'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        )}
        <div className="text-sm text-muted mb-3">
          {t('cashier.openBills')} — {shown.length} ta
        </div>
        {shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-muted py-24">
            <div className="text-5xl mb-3">🍽️</div>
            <div>{t('cashier.noBills')}</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4">
            {shown.map((o) => {
              const ready = o.status === OrderStatus.Ready;
              const unp = !!o._unprinted;
              return (
                <button
                  key={unp ? `u-${o.id}` : o.id}
                  onClick={() => openBill(o)}
                  className={`group text-left rounded-2xl border p-4 lift animate-card-in transition-all hover:border-primary hover:-translate-y-0.5 ${
                    unp ? 'bg-warning/10 border-warning/50' : ready ? 'bg-success/5 border-success/30' : 'bg-surface border-border'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-2xl font-extrabold leading-none">
                      <span className="text-muted text-lg font-bold">№</span>{o.tableNumber ?? '—'}
                    </div>
                    {unp ? (
                      <span className="text-[11px] font-bold text-warning bg-warning/20 rounded px-1.5 py-0.5">
                        chek chiqmadi
                      </span>
                    ) : (
                      <StatusBadge status={o.status} />
                    )}
                  </div>
                  <div className="text-xs text-muted mt-2 truncate">
                    {o.hall ? `${o.hall} · ` : ''}{o.items.length} ta taom
                  </div>
                  <div className="mt-4 text-xl font-extrabold text-primary">
                    {formatSum(o.total ?? 0)}
                  </div>
                  <div className={`mt-2 text-xs font-semibold transition-colors ${unp ? 'text-warning' : 'text-muted group-hover:text-primary'}`}>
                    {unp ? '🖨 Chek chiqarish uchun bosing →' : 'To‘lov uchun bosing →'}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      </div>

      {/* To'lov modal oynasi — kartochka bosilganda ochiladi */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-overlay-in p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-surface border border-border rounded-2xl w-full max-w-[520px] max-h-[92vh] flex flex-col animate-pop-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-border font-bold flex items-center justify-between sticky top-0 bg-surface rounded-t-2xl">
              <span>Stol №{selected.tableNumber ?? '—'} — hisob</span>
              <button onClick={() => setSelected(null)} className="text-muted hover:text-text text-xl leading-none">
                ✕
              </button>
            </div>
            <div className="p-5 overflow-auto">
              <div className="bg-bg border border-border rounded-xl divide-y divide-border mb-5">
                {selected.items.map((it) => (
                  <div key={it.id} className="flex justify-between px-4 py-2.5">
                    <span>
                      <span className="text-primary font-semibold">
                        {it.unit === MenuUnit.Weight ? `${it.quantity} kg` : `${it.quantity}×`}
                      </span>{' '}
                      {it.menuItemName}
                      {it.note && (
                        <span className="text-warning text-sm"> ({it.note})</span>
                      )}
                    </span>
                    <span className="font-semibold">
                      {formatSum((it.price ?? 0) * it.quantity)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Aksiz kodlarini skanerlash (TZ F-8.5/8.6) */}
              {pendingExcise.length > 0 && (
                <div className="bg-warning/10 border border-warning/40 rounded-xl p-4 mb-5">
                  <div className="font-semibold text-warning mb-2">
                    Aksiz kodi skanerlanishi kerak
                  </div>
                  <div className="space-y-2">
                    {pendingExcise.map((it) => (
                      <div key={it.id} className="flex items-center gap-2">
                        <span className="flex-1">{it.menuItemName}</span>
                        <input
                          autoFocus
                          value={exciseInputs[it.id] || ''}
                          onChange={(e) =>
                            setExciseInputs((p) => ({ ...p, [it.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveExcise();
                          }}
                          placeholder="Aksiz kodini skanerlang yoki kiriting"
                          className="flex-[2] px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
                        />
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    className="mt-3"
                    disabled={savingExcise}
                    onClick={saveExcise}
                  >
                    {savingExcise ? 'Saqlanmoqda...' : 'Aksiz kodlarini saqlash'}
                  </Button>
                </div>
              )}

              {/* Chegirma va xizmat haqi (TZ F-3.3) */}
              <div className="grid grid-cols-2 gap-4 mb-5">
                <Field label={t('cashier.discount')} value={discount} onChange={setDiscount} />
                <Field label={t('cashier.serviceFee')} value={serviceFee} onChange={setServiceFee} />
              </div>

              {/* Yakuniy summa */}
              <div className="bg-bg border border-border rounded-xl p-4 mb-4 space-y-1.5">
                <SumRow label="Jami" value={formatSum(subtotal)} />
                {discountAmount > 0 && (
                  <SumRow label={`Chegirma (${discount}%)`} value={`- ${formatSum(discountAmount)}`} color="text-danger" />
                )}
                {serviceFeeAmount > 0 && (
                  <SumRow label={`Xizmat haqi (${serviceFee}%)`} value={`+ ${formatSum(serviceFeeAmount)}`} />
                )}
                <div className="border-t border-border pt-2 flex justify-between text-lg font-bold">
                  <span>To‘lanadi</span>
                  <span className="text-primary">{formatSum(total)}</span>
                </div>
                {paidAmount > 0 && (
                  <>
                    <SumRow label="To‘langan" value={formatSum(paidAmount)} color="text-success" />
                    <div className="flex justify-between font-bold">
                      <span>Qoldi</span>
                      <span className={remaining > 0 ? 'text-danger' : 'text-success'}>{formatSum(remaining)}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Qilingan to'lovlar (bo'lib to'lash) */}
              {payments.length > 0 && (
                <div className="mb-4 space-y-1.5">
                  {payments.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-sm bg-bg border border-border rounded-lg px-3 py-2">
                      <span className="font-semibold">{t(`pay.${p.type}`)}</span>
                      <span className="ml-auto font-bold">{formatSum(p.amount)}</span>
                      <button
                        onClick={() => removePayment(p.id)}
                        aria-label="O'chirish"
                        className="w-7 h-7 shrink-0 rounded-lg hover:bg-danger/10 text-muted hover:text-danger flex items-center justify-center"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* To'lov summasi (bo'sh qoldirilsa — qolgan summa to'liq to'lanadi) */}
              <div className="mb-3">
                <div className="text-sm text-muted mb-2">To‘lov summasi <span className="text-xs">(bo‘sh — qolganini to‘liq)</span></div>
                <input
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  placeholder={formatSum(remaining)}
                  className="w-full px-3 py-3 rounded-xl bg-bg border border-border outline-none focus:border-primary text-lg font-bold text-center"
                />
              </div>

              {/* To'lov usullari — bosilganda summa shu usul bilan to'lanadi */}
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_OPTIONS.map((p) => (
                  <button
                    key={p.type}
                    onClick={() => addPayment(p.type)}
                    disabled={paying || pendingExcise.length > 0 || remaining <= 0}
                    className="py-3.5 rounded-xl font-bold bg-primary text-white hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
                  >
                    {t(`pay.${p.type}`)}
                  </button>
                ))}
              </div>
              {pendingExcise.length > 0 && (
                <div className="text-xs text-danger mt-2 text-center">Avval aksiz kodini skanerlang</div>
              )}
            </div>
          </div>
        </div>
      )}

      {receipt && (
        <ReceiptPreview
          receipt={receipt}
          onPrinted={() => removeUnprinted(receipt.orderId)}
          onClose={() => setReceipt(null)}
        />
      )}
    </AppShell>
  );
}

function SummaryStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`shrink-0 rounded-xl border px-4 py-2 whitespace-nowrap ${
        accent ? 'bg-primary/10 border-primary/30' : 'bg-surface border-border'
      }`}
    >
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`font-bold ${accent ? 'text-primary text-lg' : 'text-base'}`}>{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm text-muted">{label}</span>
      <input
        type="number"
        min={0}
        max={100}
        placeholder="0"
        value={value === 0 ? '' : value}
        onFocus={(e) => e.target.select()}
        onChange={(e) =>
          onChange(Math.min(100, Math.max(0, Number(e.target.value) || 0)))
        }
        className="w-full mt-1 px-3 py-2 rounded-lg bg-bg border border-border text-text outline-none focus:border-primary"
      />
    </label>
  );
}

function SumRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={color ?? ''}>{value}</span>
    </div>
  );
}
