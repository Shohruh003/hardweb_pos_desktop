import { useEffect, useState } from 'react';
import {
  Order,
  OrderStatus,
  PaymentType,
  Receipt,
  ReportSummary,
  SOCKET_EVENTS,
} from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { Button, StatusBadge, formatSum } from '../components/ui';
import { ReceiptPreview } from '../components/ReceiptPreview';
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [discount, setDiscount] = useState(0);
  const [serviceFee, setServiceFee] = useState(0);
  const [payType, setPayType] = useState<PaymentType>(PaymentType.Cash);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
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
    socket.on(SOCKET_EVENTS.ORDER_CREATED, onCreated);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, onChange);
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, onChange);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, onCreated);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, onChange);
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, onChange);
    };
  }, []);

  const active = orders.filter((o) => o.status !== OrderStatus.Closed);
  // Zallar bo'yicha bo'lish (VIP, oddiy va h.k.)
  const halls = Array.from(new Set(active.map((o) => o.hall).filter(Boolean))) as string[];
  const shown = hallFilter ? active.filter((o) => o.hall === hallFilter) : active;

  function selectOrder(o: Order) {
    setSelected(o);
    setDiscount(0);
    setServiceFee(0);
    setPayType(PaymentType.Cash);
    setExciseInputs({});
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

  async function pay() {
    if (!selected) return;
    setPaying(true);
    try {
      const res = await api.post<{ receipt: Receipt }>(
        `/orders/${selected.id}/pay`,
        {
          type: payType,
          discountPercent: discount,
          serviceFeePercent: serviceFee,
        },
      );
      setReceipt(res.receipt);
      setSelected(null);
      refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setPaying(false);
    }
  }

  const payLabel: Record<string, string> = { naqd: 'Naqd', karta: 'Karta', qr: 'QR' };

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

  return (
    <AppShell title={t('title.cashier')}>
      <div className="h-full flex flex-col">
        {/* Bugungi tushum / smena yakuni */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border overflow-x-auto">
          <SummaryStat label="Bugungi tushum" value={formatSum(summary?.revenue ?? 0)} accent />
          <SummaryStat label="Yopilgan cheklar" value={String(summary?.ordersCount ?? 0)} />
          <SummaryStat label="O‘rtacha chek" value={formatSum(summary?.avgCheck ?? 0)} />
          <div className="h-8 w-px bg-border mx-1" />
          {(summary?.paymentBreakdown ?? []).map((p) => (
            <SummaryStat key={p.type} label={payLabel[p.type] || p.type} value={formatSum(p.amount)} />
          ))}
          <div className="h-8 w-px bg-border mx-1" />
          <SummaryStat label="Rasxod" value={formatSum(expenses.total)} />
          <SummaryStat label="Sof tushum" value={formatSum((summary?.revenue ?? 0) - expenses.total)} accent />
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

      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* Faol hisoblar ro'yxati */}
        <div className="w-full md:w-[320px] shrink-0 border-b md:border-b-0 md:border-r border-border overflow-auto max-h-[35vh] md:max-h-none">
          <div className="px-4 py-3 font-bold border-b border-border">
            {t('cashier.openBills')} ({shown.length})
          </div>
          {/* Zal bo'yicha filtr (VIP / oddiy / terrasa) */}
          {halls.length > 1 && (
            <div className="flex gap-1.5 flex-wrap p-2 border-b border-border">
              <button
                onClick={() => setHallFilter('')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                  hallFilter === '' ? 'bg-primary text-white' : 'bg-bg border border-border text-muted hover:text-text'
                }`}
              >
                {t('common.all')}
              </button>
              {halls.map((h) => (
                <button
                  key={h}
                  onClick={() => setHallFilter(h)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                    hallFilter === h ? 'bg-primary text-white' : 'bg-bg border border-border text-muted hover:text-text'
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
          )}
          {shown.length === 0 ? (
            <div className="text-muted text-sm p-4">{t('cashier.noBills')}</div>
          ) : (
            shown.map((o) => (
              <button
                key={o.id}
                onClick={() => selectOrder(o)}
                className={`w-full text-left px-4 py-3 border-b border-border flex items-center justify-between ${
                  selected?.id === o.id
                    ? 'bg-primary/15'
                    : 'hover:bg-surface-hover'
                }`}
              >
                <div>
                  <div className="font-semibold">Stol №{o.tableNumber ?? '—'}</div>
                  <div className="text-xs text-muted">
                    {o.hall ? `${o.hall} · ` : ''}{o.items.length} ta taom
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{formatSum(o.total ?? 0)}</div>
                  <StatusBadge status={o.status} />
                </div>
              </button>
            ))
          )}
        </div>

        {/* Hisob tafsiloti va to'lov */}
        <div className="flex-1 overflow-auto">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-muted">
              {t('cashier.selectBill')}
            </div>
          ) : (
            <div className="max-w-2xl mx-auto p-6">
              <div className="text-xl font-bold mb-4">
                Stol №{selected.tableNumber ?? '—'} — hisob
              </div>

              <div className="bg-surface border border-border rounded-xl divide-y divide-border mb-5">
                {selected.items.map((it) => (
                  <div key={it.id} className="flex justify-between px-4 py-2.5">
                    <span>
                      <span className="text-primary font-semibold">
                        {it.quantity}×
                      </span>{' '}
                      {it.menuItemName}
                      {it.note && (
                        <span className="text-warning text-sm"> ({it.note})</span>
                      )}
                    </span>
                    <span className="font-semibold">
                      {formatSum(it.price * it.quantity)}
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
                            // HID skaner kod oxirida Enter yuboradi
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
                <Field
                  label={t('cashier.discount')}
                  value={discount}
                  onChange={setDiscount}
                />
                <Field
                  label={t('cashier.serviceFee')}
                  value={serviceFee}
                  onChange={setServiceFee}
                />
              </div>

              {/* To'lov turi (TZ F-3.2) */}
              <div className="mb-5">
                <div className="text-sm text-muted mb-2">{t('cashier.payType')}</div>
                <div className="flex gap-2">
                  {PAYMENT_OPTIONS.map((p) => (
                    <button
                      key={p.type}
                      onClick={() => setPayType(p.type)}
                      className={`flex-1 py-3 rounded-lg font-semibold ${
                        payType === p.type
                          ? 'bg-primary text-white'
                          : 'bg-surface border border-border text-muted hover:text-text'
                      }`}
                    >
                      {t(`pay.${p.type}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Yakuniy summa */}
              <div className="bg-surface border border-border rounded-xl p-4 mb-5 space-y-1.5">
                <SumRow label="Jami" value={formatSum(subtotal)} />
                {discountAmount > 0 && (
                  <SumRow
                    label={`Chegirma (${discount}%)`}
                    value={`- ${formatSum(discountAmount)}`}
                    color="text-danger"
                  />
                )}
                {serviceFeeAmount > 0 && (
                  <SumRow
                    label={`Xizmat haqi (${serviceFee}%)`}
                    value={`+ ${formatSum(serviceFeeAmount)}`}
                  />
                )}
                <div className="border-t border-border pt-2 flex justify-between text-lg font-bold">
                  <span>To‘lanadi</span>
                  <span className="text-primary">{formatSum(total)}</span>
                </div>
              </div>

              <Button
                className="w-full py-3.5 text-lg"
                disabled={paying || pendingExcise.length > 0}
                onClick={pay}
              >
                {pendingExcise.length > 0
                  ? 'Avval aksiz kodini skanerlang'
                  : paying
                    ? t('common.saving')
                    : t('cashier.pay')}
              </Button>
            </div>
          )}
        </div>
      </div>
      </div>

      {receipt && (
        <ReceiptPreview receipt={receipt} onClose={() => setReceipt(null)} />
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
    <div className="px-3 whitespace-nowrap">
      <div className="text-xs text-muted">{label}</div>
      <div className={`font-bold ${accent ? 'text-primary text-lg' : ''}`}>{value}</div>
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
