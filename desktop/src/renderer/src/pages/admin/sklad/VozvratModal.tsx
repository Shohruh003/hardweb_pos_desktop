// Vozvrat — ta'minotchiga qaytarish: ombor kamayadi, ta'minotchi qarzi kamayadi (minus kirim).
// Narx o'rtacha tannarx bilan to'ldiriladi; o'zgartirilmasa server aynan o'rtacha tannarxni oladi
// (yaxlitlashsiz). Mahsulot tanlanganda uning oxirgi ta'minotchisi tanlanadi (o'zgartirish mumkin).
import { useEffect, useMemo, useState } from 'react';
import { Product, Purchase, STOCK_QTY_POSITIVE_MESSAGE, roundStockQty, stockNotEnoughMessage } from '@hardweb-pos/shared';
import { Modal } from '../../../components/Modal';
import { Select } from '../../../components/Select';
import { parseDecimal } from '../../../components/numeric';
import { api } from '../../../lib/api';
import { Field, FormError, FormWarning, InfoRow, ModalFooter, MoneyInput, QtyInput, SupplierPicker, TextInput, useSubmit, useSuppliers } from './skladUi';
import { costText, productCost, qtyText } from './skladUtils';

export function VozvratModal({
  products,
  onClose,
  onDone,
}: {
  products: Product[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { suppliers, error: suppliersError } = useSuppliers();
  const [productId, setProductId] = useState('');
  const [supplierSel, setSupplierSel] = useState('');
  const [supplierTouched, setSupplierTouched] = useState(false);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [priceTouched, setPriceTouched] = useState(false);
  const [note, setNote] = useState('');
  const { busy, error, setError, run } = useSubmit();

  const product = products.find((p) => p.id === productId);
  const avg = productCost(product);
  const stock = Number(product?.stock) || 0;
  const q = roundStockQty(parseDecimal(qty));
  const notEnough = !!product && q > 0 && q > roundStockQty(stock);
  // Narx maydoni: o'zgartirilmaguncha — o'rtacha tannarx (butun so'mda ko'rinadi)
  const shownPrice = priceTouched ? price : avg >= 1 ? String(Math.round(avg)) : '';
  const effPrice = priceTouched && Number(price) > 0 ? Number(price) : avg;
  const total = Math.round(q * effPrice);

  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: `${p.name} — ${qtyText(p.stock)} ${p.unit}` })),
    [products],
  );

  // Mahsulotning oxirgi ta'minotchisi (foydalanuvchi o'zi tanlamagan bo'lsa)
  useEffect(() => {
    if (!productId || supplierTouched) return;
    let alive = true;
    api
      .get<Purchase[]>(`/inventory/purchases?productId=${encodeURIComponent(productId)}&limit=10`)
      .then((list) => {
        if (!alive || !Array.isArray(list)) return;
        const lastIn = list.find((p) => Number(p.quantity) > 0);
        if (lastIn?.supplierId) setSupplierSel(lastIn.supplierId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [productId, supplierTouched]);

  function pickProduct(id: string) {
    setProductId(id);
    if (!supplierTouched) setSupplierSel('');
    setPriceTouched(false);
    setPrice('');
    setError('');
  }

  async function submit() {
    if (!product) {
      setError('Mahsulotni tanlang');
      return;
    }
    if (!(q > 0)) {
      setError(STOCK_QTY_POSITIVE_MESSAGE);
      return;
    }
    if (notEnough) {
      setError(stockNotEnoughMessage(product.name, stock, product.unit));
      return;
    }
    await run(async () => {
      await api.post<Purchase>('/inventory/returns', {
        productId: product.id,
        ...(supplierSel ? { supplierId: supplierSel } : {}),
        quantity: q,
        // o'zgartirilmagan narx yuborilmaydi — server o'rtacha tannarxni aniq oladi
        ...(priceTouched && Number(price) > 0 ? { unitPrice: Number(price) } : {}),
        note: note.trim() || undefined,
      });
      onDone(`Vozvrat saqlandi: −${qtyText(q)} ${product.unit} ${product.name}`);
    }, 'Vozvrat saqlanmadi');
  }

  return (
    <Modal title="↩️ Ta’minotchiga qaytarish (vozvrat)" onClose={() => !busy && onClose()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
        data-testid="vozvrat-modal"
      >
        <div className="text-sm text-muted">Ombordagi qoldiq kamayadi va ta’minotchi qarzidan shu summa ayiriladi.</div>

        <Field label="Mahsulot">
          <div data-testid="vozvrat-product">
            <Select value={productId} onChange={pickProduct} options={productOptions} placeholder="Mahsulotni tanlang" />
          </div>
        </Field>

        <Field label="Ta’minotchi (kimga qaytariladi)">
          <SupplierPicker
            suppliers={suppliers}
            loadError={suppliersError}
            value={supplierSel}
            onChange={(v) => {
              setSupplierTouched(true);
              setSupplierSel(v);
            }}
            testId="vozvrat-supplier"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`Miqdor${product ? ` (${product.unit})` : ''}`}>
            <QtyInput value={qty} onChange={setQty} unit={product?.unit} placeholder="0" testId="vozvrat-qty" ariaLabel="Qaytariladigan miqdor" />
          </Field>
          <Field label={`Narx (1 ${product?.unit ?? 'birlik'})`}>
            <MoneyInput
              value={shownPrice}
              onChange={(v) => {
                setPriceTouched(true);
                setPrice(v);
              }}
              placeholder={avg > 0 ? costText(avg).replace(' so‘m', '') : '0'}
              testId="vozvrat-price"
              ariaLabel="Birlik narxi"
            />
          </Field>
        </div>
        {product && (
          <div className="text-xs text-muted -mt-2">
            {avg > 0 ? (
              <>
                O‘rtacha tannarx: <b className="text-text">{costText(avg)}/{product.unit}</b>. Narx o‘zgartirilmasa — aynan shu narx olinadi.
              </>
            ) : (
              'Bu mahsulotning tannarxi hali yo‘q — ta’minotchi bilan kelishilgan narxni kiriting.'
            )}
          </div>
        )}

        <Field label="Izoh (ixtiyoriy)">
          <TextInput value={note} onChange={setNote} placeholder="Masalan: sifatsiz keldi" testId="vozvrat-note" ariaLabel="Izoh" />
        </Field>

        {product && q > 0 && !notEnough && (
          <div className="rounded-xl border-2 border-border bg-bg px-3 py-1.5">
            <InfoRow label="Qaytarish summasi" value={costText(total)} testId="vozvrat-total" />
            <InfoRow label="Yangi qoldiq" value={`${qtyText(roundStockQty(stock - q))} ${product.unit}`} tone="danger" />
          </div>
        )}
        {notEnough && product && <FormWarning>{stockNotEnoughMessage(product.name, stock, product.unit)}</FormWarning>}

        <FormError message={error} />
        <ModalFooter onCancel={onClose} busy={busy} submitLabel="Qaytarish" disabled={!product || !(q > 0) || notEnough} testId="vozvrat-save" />
      </form>
    </Modal>
  );
}
