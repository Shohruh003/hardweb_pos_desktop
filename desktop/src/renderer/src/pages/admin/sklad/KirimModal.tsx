// Kirim — ta'minotchidan qabul qilish: ta'minotchi (ro'yxatdan / yangi / ta'minotchisiz), miqdor, narx
// (birlik narxi yoki jami summa), izoh. Jami summa va yangi o'rtacha tannarx jonli ko'rinadi.
// Server: POST /inventory/purchases — bitta tranzaksiyada kirim + qoldiq + o'rtacha tannarx + jurnal.
import { useEffect, useState } from 'react';
import {
  Product,
  Purchase,
  STOCK_QTY_POSITIVE_MESSAGE,
  SUPPLIER_NAME_REQUIRED_MESSAGE,
  nextAvgCost,
  roundStockQty,
} from '@hardweb-pos/shared';
import { Modal } from '../../../components/Modal';
import { parseDecimal } from '../../../components/numeric';
import { api } from '../../../lib/api';
import {
  Field,
  FormError,
  InfoRow,
  ModalFooter,
  NEW_SUPPLIER,
  PriceField,
  QtyInput,
  SupplierPicker,
  TextInput,
  useSubmit,
  useSuppliers,
} from './skladUi';
import { PriceMode, costText, productCost, qtyText, resolvePrice } from './skladUtils';

export function KirimModal({ product, onClose, onDone }: { product: Product; onClose: () => void; onDone: (message: string) => void }) {
  const { suppliers, error: suppliersError } = useSuppliers();
  const [supplierSel, setSupplierSel] = useState('');
  const [newName, setNewName] = useState('');
  const [qty, setQty] = useState('');
  const [priceMode, setPriceMode] = useState<PriceMode>('unit');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [last, setLast] = useState<Purchase | null>(null);
  const { busy, error, setError, run } = useSubmit();

  // Oxirgi kirim narxi — bir bosishda qo'yish uchun (xato bo'lsa — ko'rsatilmaydi)
  useEffect(() => {
    let alive = true;
    api
      .get<Purchase[]>(`/inventory/purchases?productId=${encodeURIComponent(product.id)}&limit=10`)
      .then((list) => {
        if (!alive || !Array.isArray(list)) return;
        setLast(list.find((p) => Number(p.quantity) > 0 && Number(p.unitPrice) > 0) ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [product.id]);

  const q = roundStockQty(parseDecimal(qty));
  const { unitPrice, total } = resolvePrice(priceMode, price, q);
  const avg = productCost(product);
  const newAvg = nextAvgCost(Number(product.stock) || 0, avg, q, unitPrice);

  async function submit() {
    if (!(q > 0)) {
      setError(STOCK_QTY_POSITIVE_MESSAGE);
      return;
    }
    const supplierName = newName.trim();
    if (supplierSel === NEW_SUPPLIER && !supplierName) {
      setError(SUPPLIER_NAME_REQUIRED_MESSAGE);
      return;
    }
    const supplier =
      supplierSel === NEW_SUPPLIER ? { supplier: supplierName } : supplierSel ? { supplierId: supplierSel } : {};
    await run(async () => {
      await api.post<Purchase>('/inventory/purchases', {
        productId: product.id,
        ...supplier,
        quantity: q,
        unitPrice,
        note: note.trim() || undefined,
      });
      onDone(`Kirim saqlandi: +${qtyText(q)} ${product.unit} ${product.name}`);
    }, 'Kirim saqlanmadi');
  }

  return (
    <Modal title={`📥 Kirim — ${product.name}`} wide onClose={() => !busy && onClose()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-3.5"
        data-testid="kirim-modal"
      >
        <div className="rounded-xl border border-border bg-bg px-3 py-2 text-sm text-muted flex flex-wrap gap-x-4 gap-y-1">
          <span>
            Hozirgi qoldiq:{' '}
            <b className="text-text tabular-nums">
              {qtyText(product.stock)} {product.unit}
            </b>
          </span>
          <span>
            O‘rtacha tannarx: <b className="text-text tabular-nums">{avg > 0 ? `${costText(avg)}/${product.unit}` : '—'}</b>
          </span>
        </div>

        <Field label="Ta’minotchi (kimdan)">
          <SupplierPicker
            suppliers={suppliers}
            loadError={suppliersError}
            value={supplierSel}
            onChange={setSupplierSel}
            allowNew
            newName={newName}
            onNewName={setNewName}
            testId="kirim-supplier"
          />
        </Field>

        {/* Miqdor | Narx — keng oynada yonma-yon (sarlavhalar bir balandlikda, maydonlar bir qatorda) */}
        <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] sm:items-start">
          <Field label={<span className="flex items-end sm:min-h-[44px]">Miqdor ({product.unit})</span>}>
            <QtyInput value={qty} onChange={setQty} unit={product.unit} autoFocus big placeholder="Masalan: 20" testId="kirim-qty" ariaLabel="Kirim miqdori" />
          </Field>
          <PriceField
            mode={priceMode}
            onMode={setPriceMode}
            value={price}
            onChange={setPrice}
            qty={q}
            unit={product.unit}
            testId="kirim-price"
            hint={
              last ? (
                <button
                  type="button"
                  onClick={() => {
                    const lp = Number(last.unitPrice) || 0;
                    // Kasrli birlik narxi (gramm/ml) butun so'mga yaxlitlanmasin — jami summa bo'lib qo'yiladi
                    if (Number.isInteger(lp) || !(q > 0)) {
                      setPriceMode('unit');
                      setPrice(String(Math.round(lp)));
                    } else {
                      setPriceMode('total');
                      setPrice(String(Math.round(q * lp)));
                    }
                  }}
                  className="min-h-[44px] -my-2 text-left font-semibold text-primary hover:underline"
                  data-testid="kirim-last-price"
                >
                  Oxirgi narx: {costText(last.unitPrice)}/{product.unit}
                  {last.supplier ? ` (${last.supplier})` : ''} — qo‘yish
                </button>
              ) : undefined
            }
          />
        </div>

        <Field label="Izoh (ixtiyoriy)">
          <TextInput value={note} onChange={setNote} placeholder="Masalan: faktura №125" testId="kirim-note" ariaLabel="Izoh" />
        </Field>

        <div className="rounded-xl border-2 border-success/40 bg-success/10 px-3 py-2">
          <InfoRow label="Jami summa" value={costText(total)} testId="kirim-total" />
          {q > 0 && <InfoRow label="Yangi qoldiq" value={`${qtyText(roundStockQty((Number(product.stock) || 0) + q))} ${product.unit}`} tone="success" />}
          {q > 0 && unitPrice > 0 && (
            <InfoRow label="Yangi o‘rtacha tannarx" value={`${costText(newAvg)}/${product.unit}`} testId="kirim-avg-preview" />
          )}
          {q > 0 && !(unitPrice > 0) && <div className="text-xs text-muted pb-1">Narxsiz kirim o‘rtacha tannarxni o‘zgartirmaydi.</div>}
        </div>

        <FormError message={error} />
        <ModalFooter onCancel={onClose} busy={busy} submitLabel="Kirim qilish" disabled={!(q > 0)} testId="kirim-save" />
      </form>
    </Modal>
  );
}
