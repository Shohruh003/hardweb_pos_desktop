// Chiqim — hisobdan chiqarish (buzildi, muddati o'tdi, yo'qoldi, xodimlar ovqati…). Sabab majburiy:
// egasi jurnalda nima uchun kamayganini ko'radi. Server: POST /inventory/products/:id/adjust
// { delta: −miqdor, type: 'writeoff', note } — omborda yetarli bo'lmasa rad etadi.
import { useState } from 'react';
import { Product, STOCK_QTY_POSITIVE_MESSAGE, roundStockQty, stockNotEnoughMessage } from '@hardweb-pos/shared';
import { Modal } from '../../../components/Modal';
import { parseDecimal } from '../../../components/numeric';
import { api } from '../../../lib/api';
import { Field, FormError, FormWarning, InfoRow, ModalFooter, QtyInput, TextInput, useSubmit } from './skladUi';
import { costText, productCost, qtyText } from './skladUtils';

const REASONS = ['Buzildi', 'Muddati o‘tdi', 'To‘kildi / yo‘qoldi', 'Xodimlar ovqati', 'Boshqa'];
const OTHER = 'Boshqa';

export function ChiqimModal({ product, onClose, onDone }: { product: Product; onClose: () => void; onDone: (message: string) => void }) {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const { busy, error, setError, run } = useSubmit();

  const q = roundStockQty(parseDecimal(qty));
  const stock = Number(product.stock) || 0;
  const notEnough = q > 0 && q > roundStockQty(stock);
  const cost = productCost(product);
  const extra = note.trim();
  const reasonOk = !!reason && (reason !== OTHER || !!extra);
  const fullNote = reason === OTHER ? extra : [reason, extra].filter(Boolean).join(': ');

  async function submit() {
    if (!(q > 0)) {
      setError(STOCK_QTY_POSITIVE_MESSAGE);
      return;
    }
    if (notEnough) {
      setError(stockNotEnoughMessage(product.name, stock, product.unit));
      return;
    }
    if (!reasonOk) {
      setError(reason === OTHER ? 'Chiqim sababini yozing' : 'Chiqim sababini tanlang');
      return;
    }
    await run(async () => {
      await api.post<Product>(`/inventory/products/${product.id}/adjust`, { delta: -q, type: 'writeoff', note: fullNote });
      onDone(`Chiqim saqlandi: −${qtyText(q)} ${product.unit} ${product.name}`);
    }, 'Chiqim saqlanmadi');
  }

  return (
    <Modal title={`📤 Chiqim — ${product.name}`} onClose={() => !busy && onClose()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
        data-testid="chiqim-modal"
      >
        <div className="rounded-xl border border-border bg-bg px-3 py-1.5">
          <InfoRow label="Hozirgi qoldiq" value={`${qtyText(stock)} ${product.unit}`} />
        </div>

        <Field label={`Chiqim miqdori (${product.unit})`}>
          <QtyInput value={qty} onChange={setQty} unit={product.unit} autoFocus big placeholder="Masalan: 2" testId="chiqim-qty" ariaLabel="Chiqim miqdori" />
        </Field>

        <Field label="Sabab">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Chiqim sababi">
            {REASONS.map((r, i) => {
              const on = reason === r;
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setReason(r)}
                  data-testid={`chiqim-reason-${i}`}
                  className={`h-11 px-3.5 rounded-xl border-2 font-bold transition-colors ${
                    on ? 'bg-danger border-danger text-white' : 'bg-bg border-border text-text hover:border-danger/60'
                  }`}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={reason === OTHER ? 'Sababni yozing' : 'Izoh (ixtiyoriy)'}>
          <TextInput value={note} onChange={setNote} placeholder="Masalan: muzlatkich o‘chib qoldi" testId="chiqim-note" ariaLabel="Chiqim izohi" />
        </Field>

        {q > 0 && !notEnough && (
          <div className="rounded-xl border-2 border-danger/40 bg-danger/10 px-3 py-1.5">
            <InfoRow label="Yangi qoldiq" value={`${qtyText(roundStockQty(stock - q))} ${product.unit}`} tone="danger" />
            {cost > 0 && <InfoRow label="Chiqim qiymati" value={costText(Math.round(q * cost))} />}
          </div>
        )}
        {notEnough && <FormWarning testId="chiqim-not-enough">{stockNotEnoughMessage(product.name, stock, product.unit)}</FormWarning>}

        <FormError message={error} />
        <ModalFooter
          onCancel={onClose}
          busy={busy}
          submitLabel="Chiqim qilish"
          tone="danger"
          disabled={!(q > 0) || notEnough || !reasonOk}
          testId="chiqim-save"
        />
      </form>
    </Modal>
  );
}
