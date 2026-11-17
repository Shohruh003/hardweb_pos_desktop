// Mahsulot qo'shish / tahrirlash.
// Yangi: nom, birlik, minimal qoldiq, boshlang'ich qoldiq va tannarx (jurnalga "Boshlang‘ich qoldiq").
// Tahrirlash: faqat nom, birlik va minimal qoldiq. Qoldiq bu yerda o'zgarmaydi — faqat Kirim / Chiqim /
// Inventarizatsiya orqali (har o'zgarish jurnalga yoziladi). Harakati bor yoki qoldig'i 0 bo'lmagan
// mahsulotning o'lchov birligi qulflanadi (server ham rad etadi).
import { useState } from 'react';
import {
  PRODUCT_NAME_REQUIRED_MESSAGE,
  PRODUCT_NAME_TAKEN_MESSAGE,
  Product,
  ProductUnit,
  STOCK_UNIT_LOCKED_MESSAGE,
  roundStockQty,
} from '@hardweb-pos/shared';
import { Modal } from '../../../components/Modal';
import { formatQty, parseDecimal } from '../../../components/numeric';
import { api } from '../../../lib/api';
import { Field, FormError, ModalFooter, PriceField, QtyInput, TextInput, UnitPicker, useSubmit } from './skladUi';
import { PriceMode, costText, productCost, qtyText, resolvePrice, sameName } from './skladUtils';

export function ProductFormModal({
  product,
  products,
  onClose,
  onDone,
}: {
  /** berilsa — tahrirlash */
  product?: Product;
  /** nom takrorini darrov ko'rsatish uchun */
  products: Product[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const editing = !!product;
  const [name, setName] = useState(product?.name ?? '');
  const [unit, setUnit] = useState<ProductUnit>(product?.unit ?? ProductUnit.Kg);
  const [minStock, setMinStock] = useState(product && Number(product.minStock) > 0 ? formatQty(product.minStock) : '');
  const [stock, setStock] = useState('');
  const [priceMode, setPriceMode] = useState<PriceMode>('unit');
  const [price, setPrice] = useState('');
  const { busy, error, setError, run } = useSubmit();

  const unitLocked = !!product && (!!product.hasHistory || roundStockQty(product.stock) !== 0);
  const startQty = roundStockQty(parseDecimal(stock));
  const trimmed = name.trim();
  const duplicate = !!trimmed && products.some((p) => p.id !== product?.id && sameName(p.name, trimmed));

  async function submit() {
    if (!trimmed) {
      setError(PRODUCT_NAME_REQUIRED_MESSAGE);
      return;
    }
    if (duplicate) {
      setError(PRODUCT_NAME_TAKEN_MESSAGE);
      return;
    }
    const body: Record<string, unknown> = { name: trimmed, minStock: roundStockQty(parseDecimal(minStock)) };
    if (!product) {
      body.unit = unit;
      if (startQty > 0) body.stock = startQty;
      const { unitPrice } = resolvePrice(priceMode, price, startQty);
      if (unitPrice > 0) body.unitCost = unitPrice;
    } else if (unit !== product.unit) {
      body.unit = unit;
    }
    await run(async () => {
      if (product) await api.patch<Product>(`/inventory/products/${product.id}`, body);
      else await api.post<Product>('/inventory/products', body);
      onDone(product ? `«${trimmed}» saqlandi` : `«${trimmed}» qo‘shildi`);
    });
  }

  return (
    <Modal title={editing ? 'Mahsulotni tahrirlash' : 'Yangi mahsulot'} onClose={() => !busy && onClose()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <Field label="Nomi" hint={duplicate ? <span className="text-danger font-bold">{PRODUCT_NAME_TAKEN_MESSAGE}</span> : undefined}>
          <TextInput value={name} onChange={setName} placeholder="Masalan: Guruch" autoFocus={!editing} maxLength={120} testId="pf-name" ariaLabel="Mahsulot nomi" />
        </Field>

        <Field
          label="O‘lchov birligi"
          hint={
            unitLocked ? (
              <span className="font-semibold" data-testid="pf-unit-locked">
                🔒 {STOCK_UNIT_LOCKED_MESSAGE}
              </span>
            ) : undefined
          }
        >
          <UnitPicker value={unit} onChange={setUnit} disabled={unitLocked} />
        </Field>

        {product ? (
          <div className="rounded-xl border border-border bg-bg px-3 py-2.5" data-testid="pf-stock-readonly">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-bold text-muted">Hozirgi qoldiq</span>
              <span className="text-xl font-black tabular-nums text-text">
                {qtyText(product.stock)} {product.unit}
              </span>
            </div>
            {productCost(product) > 0 && (
              <div className="text-sm text-muted text-right">
                o‘rtacha tannarx {costText(productCost(product))}/{product.unit}
              </div>
            )}
            <div className="text-xs text-muted mt-1.5">
              Qoldiq bu yerda o‘zgarmaydi — <b className="text-text">Kirim</b>, <b className="text-text">Chiqim</b> yoki{' '}
              <b className="text-text">Inventarizatsiya</b> orqali o‘zgartiring (har bir o‘zgarish jurnalga yoziladi).
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Boshlang‘ich qoldiq" hint="Hozir omborda bor miqdor (bo‘lmasa 0)">
              <QtyInput value={stock} onChange={setStock} unit={unit} testId="pf-stock" ariaLabel="Boshlang‘ich qoldiq" />
            </Field>
            <Field label="Minimal qoldiq" hint="Shundan kam qolsa — ogohlantiradi">
              <QtyInput value={minStock} onChange={setMinStock} unit={unit} testId="pf-min" ariaLabel="Minimal qoldiq" />
            </Field>
          </div>
        )}

        {product && (
          <Field label="Minimal qoldiq" hint="Shundan kam qolsa — ro‘yxatda qizil bo‘lib ko‘rinadi (0 — ogohlantirishsiz)">
            <QtyInput value={minStock} onChange={setMinStock} unit={unit} testId="pf-min" ariaLabel="Minimal qoldiq" />
          </Field>
        )}

        {!product && (
          <PriceField
            label="Boshlang‘ich tannarx (ixtiyoriy)"
            mode={priceMode}
            onMode={setPriceMode}
            value={price}
            onChange={setPrice}
            qty={startQty}
            unit={unit}
            testId="pf-price"
            hint="Taom tannarxi shundan hisoblanadi; keyingi kirimlar o‘rtacha tannarxni o‘zi yangilaydi."
          />
        )}

        <FormError message={error} />
        <ModalFooter onCancel={onClose} busy={busy} submitLabel={editing ? 'Saqlash' : 'Qo‘shish'} testId="pf-save" disabled={!trimmed} />
      </form>
    </Modal>
  );
}
