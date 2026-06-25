import { useState } from 'react';
import { Order, OrderStatus, PaymentType } from '@hardweb-pos/shared';
import { StatusBadge, formatSum, formatDateTime, formatTime } from './ui';
import { Modal } from './Modal';

const PAY_LABEL: Record<string, string> = {
  [PaymentType.Cash]: 'Naqd',
  [PaymentType.Card]: 'Karta',
  [PaymentType.QR]: 'QR',
};

// Buyurtmalar/cheklar tarixi ro'yxati + tafsilot modali (shikoyatlar uchun).
// onRevert berilsa — "Tayyor" holatdagi buyurtmani ortga qaytarish tugmasi chiqadi (KDS uchun).
export function OrderHistory({
  orders,
  onRevert,
}: {
  orders: Order[];
  onRevert?: (order: Order) => Promise<void> | void;
}) {
  const [sel, setSel] = useState<Order | null>(null);
  const [reverting, setReverting] = useState(false);

  async function doRevert() {
    if (!sel || !onRevert) return;
    setReverting(true);
    try {
      await onRevert(sel);
      setSel(null);
    } finally {
      setReverting(false);
    }
  }

  if (orders.length === 0) {
    return <div className="text-muted text-center py-10">Tarix bo‘sh</div>;
  }

  return (
    <>
      <div className="divide-y divide-border">
        {orders.map((o) => (
          <button
            key={o.id}
            onClick={() => setSel(o)}
            className="w-full text-left flex items-center justify-between gap-3 px-2 py-3 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <div className="min-w-0">
              <div className="font-semibold">
                Stol №{o.tableNumber ?? '—'}
                <span className="text-muted font-normal"> · {formatDateTime(o.openedAt)}</span>
                {o.waiterName && <span className="text-muted font-normal"> · {o.waiterName}</span>}
              </div>
              <div className="text-sm text-muted truncate">
                {o.items.map((i) => `${i.quantity}× ${i.menuItemName}`).join(', ')}
              </div>
            </div>
            <div className="text-right shrink-0">
              <StatusBadge status={o.status} />
              <div className="text-sm font-bold mt-1">{formatSum(o.total ?? 0)}</div>
            </div>
          </button>
        ))}
      </div>

      {sel && (
        <Modal title={`Stol №${sel.tableNumber ?? '—'} — buyurtma`} onClose={() => setSel(null)}>
          <div className="space-y-1.5 text-sm mb-4">
            <Row label="Ochilgan" value={formatDateTime(sel.openedAt)} />
            {sel.closedAt && <Row label="Yopilgan" value={formatDateTime(sel.closedAt)} />}
            {sel.waiterName && <Row label="Ofitsiant" value={sel.waiterName} />}
            {sel.paymentType && <Row label="To‘lov" value={PAY_LABEL[sel.paymentType] ?? sel.paymentType} />}
          </div>

          <div className="bg-bg rounded-xl divide-y divide-border mb-4">
            {sel.items.map((it) => (
              <div key={it.id} className="flex justify-between px-3 py-2">
                <span>
                  <span className="text-primary font-semibold">{it.quantity}×</span> {it.menuItemName}
                  {it.note && <span className="text-warning text-xs"> ({it.note})</span>}
                </span>
                <span className="font-semibold">{formatSum((it.price ?? 0) * it.quantity)}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <StatusBadge status={sel.status} />
            <div className="text-xl font-extrabold text-primary">{formatSum(sel.total ?? 0)}</div>
          </div>
          {sel.status !== OrderStatus.Closed && (
            <div className="text-xs text-muted mt-2 text-right">Hali to‘lanmagan</div>
          )}

          {/* Adashib "Tayyor" bosilgan bo'lsa — ortga qaytarish (faqat to'lanmagan) */}
          {onRevert && sel.status === OrderStatus.Ready && (
            <button
              onClick={doRevert}
              disabled={reverting}
              className="w-full mt-4 py-3 rounded-xl bg-warning text-black font-bold active:scale-[0.98] hover:brightness-110 transition-all disabled:opacity-60"
            >
              {reverting ? 'Qaytarilmoqda...' : '↩ Tayyorlanmoqdaga qaytarish'}
            </button>
          )}

          <div className="text-xs text-muted mt-3 text-center">Buyurtma vaqti: {formatTime(sel.openedAt)}</div>
        </Modal>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
