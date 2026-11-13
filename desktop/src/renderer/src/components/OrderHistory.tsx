import { useState } from 'react';
import { MenuUnit, Order, OrderItem, OrderStatus, PaymentType, calcOrderTotals, lineSum } from '@hardweb-pos/shared';
import { StatusBadge, formatSum, formatDateTime, formatTime } from './ui';
import { Modal } from './Modal';
import { formatQty } from './numeric';

const PAY_LABEL: Record<string, string> = {
  [PaymentType.Cash]: 'Naqd',
  [PaymentType.Card]: 'Karta',
  [PaymentType.QR]: 'QR',
};

/**
 * Chek summalari (shared/money — server bilan bir xil, butun so'm): total — mijoz to'laydigan/to'lagan
 * summa (chegirma/xizmat haqi bilan), subtotal — qatorlar yig'indisi. Tarix, "Mening buyurtmalarim"
 * va vozvrat shu summani ko'rsatadi.
 */
export function orderCheckTotals(o: Order) {
  return calcOrderTotals(
    (o.items ?? []).map((it) => ({ price: it.price ?? 0, quantity: it.quantity })),
    o.discountPercent,
    o.servicePercent,
  );
}

/** Miqdor: kg taom — "1,25 kg", dona — "2×" */
const qtyLabel = (it: OrderItem) =>
  it.unit === MenuUnit.Weight ? `${formatQty(it.quantity)} kg` : `${formatQty(it.quantity)}×`;

// Buyurtmalar/cheklar tarixi ro'yxati + tafsilot modali (shikoyatlar uchun).
// onRevert berilsa — "Tayyor" holatdagi buyurtmani ortga qaytarish tugmasi chiqadi (KDS uchun).
export function OrderHistory({
  orders,
  onRevert,
  onRefund,
}: {
  orders: Order[];
  onRevert?: (order: Order) => Promise<void> | void;
  // Vozvrat (to'langan chekni qaytarish) — faqat Direktor/Admin sahifalarida beriladi
  onRefund?: (order: Order, reason: string) => Promise<void> | void;
}) {
  const [sel, setSel] = useState<Order | null>(null);
  const [reverting, setReverting] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);

  async function doRefund() {
    if (!sel || !onRefund) return;
    setRefunding(true);
    try {
      await onRefund(sel, refundReason);
      setSel(null);
      setRefundOpen(false);
      setRefundReason('');
    } finally {
      setRefunding(false);
    }
  }

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

  // Tanlangan chek summalari (tafsilot oynasi uchun)
  const selTotals = sel ? orderCheckTotals(sel) : null;

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
                {o.items.map((i) => `${qtyLabel(i)} ${i.menuItemName}`).join(', ')}
              </div>
            </div>
            <div className="text-right shrink-0">
              {o.refunded ? (
                <span className="px-2 py-0.5 rounded-md bg-danger/15 text-danger text-xs font-bold">
                  ↩ Qaytarilgan
                </span>
              ) : (
                <StatusBadge status={o.status} />
              )}
              <div className={`text-sm font-bold mt-1 ${o.refunded ? 'line-through text-muted' : ''}`}>
                {formatSum(orderCheckTotals(o).total)}
              </div>
            </div>
          </button>
        ))}
      </div>

      {sel && selTotals && (
        <Modal title={`Stol №${sel.tableNumber ?? '—'} — buyurtma`} onClose={() => setSel(null)}>
          <div className="space-y-1.5 text-sm mb-4">
            <Row label="Ochilgan" value={formatDateTime(sel.openedAt)} />
            {sel.closedAt && <Row label="Yopilgan" value={formatDateTime(sel.closedAt)} />}
            {sel.waiterName && <Row label="Ofitsiant" value={sel.waiterName} />}
            {sel.paymentType && <Row label="To‘lov" value={PAY_LABEL[sel.paymentType] ?? sel.paymentType} />}
          </div>

          <div className="bg-bg rounded-xl divide-y divide-border mb-4">
            {sel.items.map((it) => (
              <div key={it.id} className="flex justify-between gap-3 px-3 py-2">
                <span>
                  <span className="text-primary font-semibold">{qtyLabel(it)}</span> {it.menuItemName}
                  {it.note && <span className="text-warning text-xs"> ({it.note})</span>}
                </span>
                <span className="font-semibold whitespace-nowrap">{formatSum(lineSum(it.price ?? 0, it.quantity))}</span>
              </div>
            ))}
          </div>

          {/* Chegirma/xizmat haqi bo'lsa — qatorlar yig'indisidan chek summasigacha tushuntirish */}
          {(selTotals.discountAmount > 0 || selTotals.serviceAmount > 0) && (
            <div className="space-y-1 text-sm mb-3 px-1">
              <Row label="Jami" value={formatSum(selTotals.subtotal)} />
              {selTotals.discountAmount > 0 && (
                <Row label={`Chegirma (${selTotals.discountPercent}%)`} value={`- ${formatSum(selTotals.discountAmount)}`} />
              )}
              {selTotals.serviceAmount > 0 && (
                <Row label={`Xizmat haqi (${selTotals.servicePercent}%)`} value={`+ ${formatSum(selTotals.serviceAmount)}`} />
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <StatusBadge status={sel.status} />
            <div className="text-xl font-extrabold text-primary">{formatSum(selTotals.total)}</div>
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

          {/* Allaqachon qaytarilgan bo'lsa — ma'lumot */}
          {sel.refunded && (
            <div className="mt-4 bg-danger/10 border border-danger/30 rounded-xl p-3 text-sm">
              <div className="font-bold text-danger">↩ Chek qaytarilgan (vozvrat)</div>
              {sel.refundReason && (
                <div className="text-muted mt-1">Sabab: {sel.refundReason}</div>
              )}
            </div>
          )}

          {/* Vozvrat — faqat Direktor/Admin (onRefund berilgan) va to'langan, qaytarilmagan chek */}
          {onRefund && sel.status === OrderStatus.Closed && !sel.refunded && (
            <div className="mt-4">
              {!refundOpen ? (
                <button
                  onClick={() => setRefundOpen(true)}
                  className="w-full py-3 rounded-xl border border-danger/50 text-danger font-bold hover:bg-danger/10 transition-all"
                >
                  ↩ Vozvrat qilish
                </button>
              ) : (
                <div className="bg-bg border border-border rounded-xl p-3">
                  <div className="text-sm font-semibold mb-2">
                    Vozvrat sababi (majburiy):
                  </div>
                  <textarea
                    autoFocus
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    rows={2}
                    placeholder="Masalan: mijoz taomdan voz kechdi"
                    className="w-full px-3 py-2 rounded-lg bg-surface border border-border outline-none focus:border-primary text-sm"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => {
                        setRefundOpen(false);
                        setRefundReason('');
                      }}
                      className="flex-1 py-2.5 rounded-lg border border-border text-muted hover:text-text"
                    >
                      Bekor
                    </button>
                    <button
                      onClick={doRefund}
                      disabled={refunding || !refundReason.trim()}
                      className="flex-1 py-2.5 rounded-lg bg-danger text-white font-bold disabled:opacity-50 hover:brightness-110 transition-all"
                    >
                      {refunding ? 'Qaytarilmoqda...' : 'Tasdiqlash'}
                    </button>
                  </div>
                </div>
              )}
            </div>
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
