// Yuborilgan (oshxonaga ketgan) taom qatori amallari — faqat 'void' ruxsati bor xodim (kassir/direktor):
//  • SentLineSheet  — qator bosilganda: "🚫 Otkaz" yoki "Narxni o‘zgartirish";
//  • SentPriceModal — narxni o'zgartirish (PATCH /orders/:id/items/:itemId/price, B31). Oshxonaga chek chiqmaydi.
import { useEffect, useRef, useState } from 'react';
import { MenuUnit, Order, OrderItem, lineSum } from '@hardweb-pos/shared';
import { api } from '../../lib/api';
import { formatSum } from '../ui';
import { Sheet, SheetError, Spinner } from './Sheet';
import { NumKey, NumPad, applyNumKey } from './NumPad';
import { PRICE_MAX } from './cart';
import { IconBag, IconBan, IconCheck, IconTag } from './icons';
import { addedAtLabel, formatAmount, orderFullName, qtyText } from './orderUi';

const PRICE_REASONS = ['Mijoz bilan kelishildi', 'Xato narx', 'Chegirma', 'Aksiya'];

/** Yuborilgan qator — amal tanlash */
export function SentLineSheet({
  order,
  item,
  canPrice,
  onVoid,
  onPrice,
  onClose,
}: {
  order: Order;
  item: OrderItem;
  canPrice: boolean;
  onVoid: () => void;
  onPrice: () => void;
  onClose: () => void;
}) {
  const price = Number(item.price ?? 0);
  return (
    <Sheet
      title={item.menuItemName ?? 'Taom'}
      subtitle={orderFullName(order)}
      size="sm"
      onClose={onClose}
      testId="sent-line-sheet"
    >
      <div className="space-y-3">
        <div className="rounded-2xl border border-border bg-bg p-3 space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-extrabold text-lg">
              {qtyText(item.quantity, item.unit)}
              {item.unit !== MenuUnit.Weight ? ' ×' : ''} {formatAmount(price)}
              {item.priceOverridden && <span className="text-warning"> *</span>}
            </span>
            <span className="font-black text-lg tabular-nums">{formatSum(lineSum(price, item.quantity))}</span>
          </div>
          {item.createdAt && <div className="text-xs font-bold text-warning">{addedAtLabel(item.createdAt)}</div>}
          {item.takeaway && (
            <div className="text-xs font-bold text-warning flex items-center gap-1">
              <IconBag className="w-3.5 h-3.5" /> Olib ketish (saboy)
            </div>
          )}
          {item.note && <div className="text-sm font-semibold text-warning">» {item.note}</div>}
        </div>
        <button
          type="button"
          onClick={onVoid}
          data-testid="sent-line-void"
          className="w-full h-14 rounded-2xl bg-danger text-white text-lg font-extrabold flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.98]"
        >
          <IconBan className="w-6 h-6" /> Otkaz
        </button>
        {canPrice && (
          <button
            type="button"
            onClick={onPrice}
            data-testid="sent-line-price"
            className="w-full h-14 rounded-2xl border-2 border-border bg-bg text-lg font-extrabold flex items-center justify-center gap-2 hover:border-primary active:scale-[0.98]"
          >
            <IconTag className="w-6 h-6 text-warning" /> Narxni o‘zgartirish
          </button>
        )}
      </div>
    </Sheet>
  );
}

/** Yuborilgan qator narxini o'zgartirish (faqat 'void' ruxsati) */
export function SentPriceModal({
  order,
  item,
  onClose,
  onDone,
}: {
  order: Order;
  item: OrderItem;
  onClose: () => void;
  onDone: (order: Order) => void;
}) {
  const current = Math.round(Number(item.price ?? 0));
  const original = item.originalPrice != null ? Math.round(Number(item.originalPrice)) : current;
  const [text, setText] = useState(String(current));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fresh = useRef(true);
  const price = Math.min(PRICE_MAX, Number(text.replace(/\D/g, '')) || 0);
  const kg = item.unit === MenuUnit.Weight;

  function press(k: NumKey) {
    const base = fresh.current ? '' : text;
    fresh.current = false;
    setText(applyNumKey(base, k, { maxDigits: 9 }));
    setError('');
  }

  async function save() {
    if (busy) return;
    if (price === current) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = { price };
      if (reason.trim()) body.reason = reason.trim();
      const updated = await api.patch<Order>(`/orders/${order.id}/items/${item.id}/price`, body);
      onDone(updated);
    } catch (e) {
      setError((e as Error)?.message || 'Narx o‘zgarmadi');
    } finally {
      setBusy(false);
    }
  }

  // Jismoniy klaviatura: raqamlar, Backspace, Enter
  const live = useRef({ press, save });
  live.current = { press, save };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        live.current.press(e.key as NumKey);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        live.current.press('back');
      } else if (e.key === 'Enter' && t?.tagName !== 'BUTTON') {
        e.preventDefault();
        void live.current.save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Sheet
      title="Narxni o‘zgartirish"
      subtitle={`${item.menuItemName ?? 'Taom'} · ${orderFullName(order)}`}
      icon={<IconTag className="w-6 h-6" />}
      iconTone="bg-warning/15 text-warning"
      size="md"
      busy={busy}
      onClose={onClose}
      testId="sent-price-modal"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-14 px-5 rounded-2xl bg-bg border border-border font-bold hover:border-text disabled:opacity-50"
          >
            Orqaga
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            data-testid="sent-price-save"
            className="flex-1 h-14 rounded-2xl bg-primary-hover text-white text-lg font-black flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? <Spinner /> : <IconCheck className="w-6 h-6" />}
            Saqlash
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-2xl border-2 border-primary bg-primary/10 px-4 py-3">
          <div className="text-xs font-bold text-muted">Yangi narx (1 {kg ? 'kg' : 'dona'})</div>
          <div className="text-4xl font-black tabular-nums text-text">
            {formatAmount(price)} <span className="text-base font-bold text-muted">so‘m</span>
          </div>
          <div className="text-sm font-semibold text-muted mt-1">
            Menyuda: <span className={price !== original ? 'line-through' : ''}>{formatSum(original)}</span> · qator:{' '}
            <span className="text-text font-extrabold">{formatSum(lineSum(price, item.quantity))}</span>
          </div>
        </div>
        <SheetError>{error}</SheetError>
        <NumPad onKey={press} testIdPrefix="price-key" />
        <div>
          <div className="text-sm font-bold text-muted mb-1.5">Sabab (ixtiyoriy)</div>
          <div className="flex flex-wrap gap-2">
            {PRICE_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason((cur) => (cur === r ? '' : r))}
                aria-pressed={reason === r}
                className={`min-h-[44px] px-3.5 rounded-full border text-sm font-bold active:scale-95 ${
                  reason === r ? 'bg-warning text-black border-warning' : 'bg-bg border-border text-text hover:border-warning'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
