import { useEffect, useState } from 'react';
import {
  Order,
  OrderStatus,
  PaymentType,
  Receipt,
  SOCKET_EVENTS,
} from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { Button, StatusBadge, formatSum } from '../components/ui';
import { ReceiptPreview } from '../components/ReceiptPreview';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';

const PAYMENT_OPTIONS: { type: PaymentType; label: string }[] = [
  { type: PaymentType.Cash, label: 'Naqd' },
  { type: PaymentType.Card, label: 'Karta' },
  { type: PaymentType.QR, label: 'QR' },
];

// Kassa moduli (TZ 5.3): hisobni ko'rish, chegirma, to'lov turi, chek chiqarish
export function CashierPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [discount, setDiscount] = useState(0);
  const [serviceFee, setServiceFee] = useState(0);
  const [payType, setPayType] = useState<PaymentType>(PaymentType.Cash);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  function refresh() {
    api.get<Order[]>('/orders').then(setOrders).catch(() => {});
  }

  useEffect(() => {
    refresh();
    const socket = getSocket();
    const onChange = () => refresh();
    socket.on(SOCKET_EVENTS.ORDER_CREATED, onChange);
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, onChange);
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, onChange);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, onChange);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, onChange);
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, onChange);
    };
  }, []);

  const active = orders.filter((o) => o.status !== OrderStatus.Closed);

  function selectOrder(o: Order) {
    setSelected(o);
    setDiscount(0);
    setServiceFee(0);
    setPayType(PaymentType.Cash);
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

  return (
    <AppShell title="Kassa">
      <div className="h-full flex">
        {/* Faol hisoblar ro'yxati */}
        <div className="w-[320px] border-r border-border overflow-auto">
          <div className="px-4 py-3 font-bold border-b border-border">
            Ochiq hisoblar ({active.length})
          </div>
          {active.length === 0 ? (
            <div className="text-muted text-sm p-4">Ochiq hisob yo‘q</div>
          ) : (
            active.map((o) => (
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
                    {o.items.length} ta taom
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
              To‘lov uchun hisobni tanlang
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

              {/* Chegirma va xizmat haqi (TZ F-3.3) */}
              <div className="grid grid-cols-2 gap-4 mb-5">
                <Field
                  label="Chegirma (%)"
                  value={discount}
                  onChange={setDiscount}
                />
                <Field
                  label="Xizmat haqi (%)"
                  value={serviceFee}
                  onChange={setServiceFee}
                />
              </div>

              {/* To'lov turi (TZ F-3.2) */}
              <div className="mb-5">
                <div className="text-sm text-muted mb-2">To‘lov turi</div>
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
                      {p.label}
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

              <Button className="w-full py-3.5 text-lg" disabled={paying} onClick={pay}>
                {paying ? 'Yopilmoqda...' : 'To‘lash va chek chiqarish'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {receipt && (
        <ReceiptPreview receipt={receipt} onClose={() => setReceipt(null)} />
      )}
    </AppShell>
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
        value={value}
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
