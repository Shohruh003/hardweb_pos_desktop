// Harakatlar jurnali — har bir qoldiq o'zgarishi: kim, qachon, qancha, qaysi hujjat bo'yicha.
// Filtrlar: mahsulot, tur, davr (Hammasi / Bugun / Hafta / Oy / Sana). Eng yangisi birinchi, 50 tadan
// ("Ko‘proq"). Filtr o'zgarganda eskirgan javob qo'llanmaydi.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PaginatedMovements, Product, STOCK_MOVEMENT_LABELS, STOCK_MOVEMENT_TYPES, StockMovement, StockMovementType } from '@hardweb-pos/shared';
import { Select } from '../../../components/Select';
import { EmptyState, ErrorLine, RefreshButton, Segmented } from '../../../components/reports/parts';
import { dmyHm, periodRange, shiftDays, todayKey } from '../../../components/reports/reportUtils';
import { Spinner } from '../../../components/waiter/Sheet';
import { api } from '../../../lib/api';
import { LoadingBlock } from './skladUi';
import { costText, errText, qtyText, signedQtyText } from './skladUtils';

const PAGE_SIZE = 50;

type Period = 'all' | 'day' | 'week' | 'month' | 'custom';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'Hammasi' },
  { value: 'day', label: 'Bugun' },
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Oy' },
  { value: 'custom', label: 'Sana' },
];

/** Tur belgisi rangi: kirish — yashil, chiqish — qizil, tuzatish — sariq, sotuv — asosiy */
const TYPE_TONE: Record<StockMovementType, string> = {
  initial: 'bg-muted/15 text-text',
  purchase: 'bg-success/15 text-success',
  refund: 'bg-success/15 text-success',
  production_in: 'bg-success/15 text-success',
  return: 'bg-danger/15 text-danger',
  writeoff: 'bg-danger/15 text-danger',
  production_out: 'bg-danger/15 text-danger',
  count: 'bg-warning/20 text-text',
  adjust: 'bg-warning/20 text-text',
  sale: 'bg-primary/15 text-primary',
};

function mergeUnique(prev: StockMovement[], next: StockMovement[]): StockMovement[] {
  const seen = new Set(prev.map((m) => m.id));
  const add = next.filter((m) => !seen.has(m.id));
  return add.length ? [...prev, ...add] : prev;
}

export function MovementsView({ products, initialProductId = '' }: { products: Product[]; initialProductId?: string }) {
  const [productId, setProductId] = useState(initialProductId);
  const [type, setType] = useState<StockMovementType | ''>('');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(() => shiftDays(todayKey(), -6));
  const [to, setTo] = useState(() => todayKey());
  const [items, setItems] = useState<StockMovement[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const customBad = period === 'custom' && (!from || !to || from > to);
  const range = useMemo(() => {
    if (period === 'all' || customBad) return null;
    if (period === 'custom') return { from, to };
    return periodRange(period);
  }, [period, from, to, customBad]);

  const queryFor = useCallback(
    (p: number) => {
      const q = new URLSearchParams();
      q.set('page', String(p));
      q.set('limit', String(PAGE_SIZE));
      if (productId) q.set('productId', productId);
      if (type) q.set('type', type);
      if (range) {
        q.set('from', range.from);
        q.set('to', range.to);
      }
      return q.toString();
    },
    [productId, type, range],
  );

  const load = useCallback(
    async (p: number) => {
      const my = ++seq.current;
      setLoading(true);
      setError('');
      try {
        const r = await api.get<PaginatedMovements>(`/inventory/movements?${queryFor(p)}`);
        if (my !== seq.current) return;
        const list = Array.isArray(r?.items) ? r.items : [];
        setItems((prev) => (p === 1 ? list : mergeUnique(prev, list)));
        setTotal(Number(r?.total) || 0);
        setHasMore(!!r?.hasMore);
        setPage(p);
      } catch (e) {
        if (my !== seq.current) return;
        setError(errText(e, 'Jurnal yuklanmadi'));
        if (p === 1) {
          setItems([]);
          setHasMore(false);
        }
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [queryFor],
  );

  useEffect(() => {
    if (customBad) {
      seq.current++; // kelayotgan javob endi kerak emas
      setLoading(false);
      return;
    }
    void load(1);
  }, [load, customBad]);

  const productOptions = useMemo(
    () => [{ value: '', label: 'Barcha mahsulotlar' }, ...products.map((p) => ({ value: p.id, label: p.name }))],
    [products],
  );
  const typeOptions = useMemo(
    () => [{ value: '', label: 'Barcha turlar' }, ...STOCK_MOVEMENT_TYPES.map((t) => ({ value: t, label: STOCK_MOVEMENT_LABELS[t] }))],
    [],
  );
  const filtered = !!productId || !!type || period !== 'all';
  const dateCls = 'h-11 px-3 rounded-xl bg-bg border-2 border-border outline-none focus:border-primary text-text font-bold tabular-nums';

  return (
    <div data-testid="movements-view">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
        <div data-testid="mv-product">
          <Select value={productId} onChange={setProductId} options={productOptions} />
        </div>
        <div data-testid="mv-type">
          <Select value={type} onChange={(v) => setType(v as StockMovementType | '')} options={typeOptions} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Segmented<Period> options={PERIODS} value={period} onChange={setPeriod} testIdPrefix="mv-period" />
        {period === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm font-bold text-muted">
              dan
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={dateCls} data-testid="mv-from" />
            </label>
            <label className="flex items-center gap-1.5 text-sm font-bold text-muted">
              gacha
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={dateCls} data-testid="mv-to" />
            </label>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setProductId('');
                setType('');
                setPeriod('all');
              }}
              className="h-11 px-3.5 rounded-xl border border-border bg-surface font-bold text-text hover:border-primary/60"
            >
              Filtrni tozalash
            </button>
          )}
          <RefreshButton onClick={() => void load(1)} loading={loading} />
        </div>
      </div>
      {customBad && <div className="mb-3 text-sm font-bold text-danger">Boshlanish sanasi tugash sanasidan keyin bo‘lmasin.</div>}

      <ErrorLine message={error} onRetry={() => void load(items.length ? page + 1 : 1)} />

      {!customBad && (
        <div className="text-sm text-muted mb-2 px-1" data-testid="mv-total">
          {loading && items.length === 0 ? 'Yuklanmoqda…' : `${total} ta harakat${items.length < total ? ` · ko‘rsatilgan ${items.length} ta` : ''}`}
        </div>
      )}

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
        {loading && items.length === 0 ? (
          <LoadingBlock />
        ) : items.length === 0 ? (
          <EmptyState>{filtered ? 'Bu filtr bo‘yicha harakat yo‘q.' : 'Hali harakat yo‘q.'}</EmptyState>
        ) : (
          items.map((m) => <MovementRow key={m.id} m={m} />)
        )}
      </div>

      {hasMore && items.length > 0 && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void load(page + 1)}
            disabled={loading}
            data-testid="mv-more"
            className="h-12 px-6 rounded-xl border-2 border-border bg-surface font-extrabold text-text hover:border-primary/60 inline-flex items-center gap-2 disabled:opacity-60"
          >
            {loading && <Spinner className="w-5 h-5 border-text" />}
            Ko‘proq
          </button>
        </div>
      )}
    </div>
  );
}

const MovementRow = memo(function MovementRow({ m }: { m: StockMovement }) {
  const qty = Number(m.quantity) || 0;
  const meta = [
    m.referenceLabel || null,
    Number(m.unitCost) > 0 ? `${costText(m.unitCost)}/${m.unit}` : null,
    m.userName || null,
    dmyHm(m.createdAt),
  ].filter(Boolean);
  return (
    <div className="flex items-start gap-3 px-3 sm:px-4 py-3" data-testid="mv-row" data-type={m.type}>
      <div
        className={`w-24 sm:w-28 shrink-0 text-right font-black text-lg tabular-nums leading-tight ${
          qty > 0 ? 'text-success' : qty < 0 ? 'text-danger' : 'text-muted'
        }`}
        data-testid="mv-qty"
      >
        {signedQtyText(qty)}
        <span className="block text-xs font-bold">{m.unit}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-text break-words">{m.productName}</span>
          <span className={`text-xs font-extrabold px-2 py-0.5 rounded-md ${TYPE_TONE[m.type] ?? 'bg-muted/15 text-text'}`}>
            {STOCK_MOVEMENT_LABELS[m.type] ?? m.type}
          </span>
        </div>
        <div className="text-sm text-muted mt-0.5 break-words">{meta.join(' · ')}</div>
        {m.note && <div className="text-sm text-text mt-0.5 break-words">💬 {m.note}</div>}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-xs font-bold text-muted">Qoldiq</div>
        <div className="font-extrabold tabular-nums text-text" data-testid="mv-balance">
          {qtyText(m.balanceAfter)} <span className="text-xs text-muted">{m.unit}</span>
        </div>
      </div>
    </div>
  );
});
