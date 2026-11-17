// Kirimlar tarixi (ta'minot): kim, nima, qancha, necha pulga. Vozvratlar (ta'minotchiga qaytarish)
// minus qator bo'lib qizil ko'rinadi. Filtr: mahsulot, ta'minotchi.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Product, Purchase } from '@hardweb-pos/shared';
import { Select } from '../../../components/Select';
import { formatSum } from '../../../components/ui';
import { EmptyState, ErrorLine, RefreshButton } from '../../../components/reports/parts';
import { dmyHm } from '../../../components/reports/reportUtils';
import { api } from '../../../lib/api';
import { LoadingBlock, useSuppliers } from './skladUi';
import { costText, errText, signedQtyText } from './skladUtils';

/** Kirim / vozvrat qatorlari (ta'minotchi sahifasida ham ishlatiladi) */
export const PurchaseRow = memo(function PurchaseRow({ p, showSupplier = true }: { p: Purchase; showSupplier?: boolean }) {
  const ret = Number(p.quantity) < 0;
  const meta = [showSupplier ? p.supplier || 'Ta’minotchisiz' : null, dmyHm(p.createdAt), p.note || null].filter(Boolean);
  return (
    <div className="flex items-start gap-3 px-3 sm:px-4 py-3" data-testid="pur-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-text break-words">{p.productName}</span>
          <span className={`font-extrabold tabular-nums ${ret ? 'text-danger' : 'text-success'}`}>
            {signedQtyText(p.quantity)} {p.unit}
          </span>
          {ret && <span className="text-xs font-extrabold px-2 py-0.5 rounded-md bg-danger text-white">↩ vozvrat</span>}
        </div>
        <div className="text-sm text-muted mt-0.5 break-words">{meta.join(' · ')}</div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-extrabold tabular-nums ${ret ? 'text-danger' : 'text-text'}`}>{formatSum(p.total)}</div>
        <div className="text-xs text-muted">
          {costText(p.unitPrice)}/{p.unit}
        </div>
      </div>
    </div>
  );
});

export function PurchasesView({ products }: { products: Product[] }) {
  const { suppliers } = useSuppliers();
  const [productId, setProductId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [items, setItems] = useState<Purchase[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  async function load() {
    const my = ++seq.current;
    setLoading(true);
    setError('');
    const q = new URLSearchParams();
    if (productId) q.set('productId', productId);
    if (supplierId) q.set('supplierId', supplierId);
    try {
      const list = await api.get<Purchase[]>(`/inventory/purchases${q.toString() ? `?${q}` : ''}`);
      if (my === seq.current) setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      if (my === seq.current) setError(errText(e, 'Kirimlar yuklanmadi'));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, supplierId]);

  const productOptions = useMemo(
    () => [{ value: '', label: 'Barcha mahsulotlar' }, ...products.map((p) => ({ value: p.id, label: p.name }))],
    [products],
  );
  const supplierOptions = useMemo(
    () => [{ value: '', label: 'Barcha ta’minotchilar' }, ...(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))],
    [suppliers],
  );
  const list = items ?? [];
  const sum = list.reduce((s, p) => s + (Number(p.total) || 0), 0);

  return (
    <div data-testid="purchases-view">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex-1 min-w-[200px]">
          <Select value={productId} onChange={setProductId} options={productOptions} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <Select value={supplierId} onChange={setSupplierId} options={supplierOptions} />
        </div>
        <RefreshButton onClick={() => void load()} loading={loading} />
      </div>
      <ErrorLine message={error} onRetry={() => void load()} />
      {items !== null && (
        <div className="text-sm text-muted mb-2 px-1">
          {list.length} ta yozuv · jami <b className="text-text">{formatSum(sum)}</b>
          {list.length >= 200 && ' · oxirgi 200 tasi ko‘rsatilgan'}
        </div>
      )}
      <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
        {items === null ? (
          loading ? <LoadingBlock /> : <EmptyState>Kirimlar yuklanmadi.</EmptyState>
        ) : list.length === 0 ? (
          <EmptyState>Hali kirim qilinmagan.</EmptyState>
        ) : (
          list.map((p) => <PurchaseRow key={p.id} p={p} />)
        )}
      </div>
    </div>
  );
}
