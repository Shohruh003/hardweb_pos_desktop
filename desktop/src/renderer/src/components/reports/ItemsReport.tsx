// "Taomlar" hisoboti (0.3.2 — restoran talabi): tanlangan davrda sotilgan BARCHA taomlar (1 ta sotilgan
// bo'lsa ham) — miqdor, summa, ulush; zalda / saboy / olib ketish / yetkazish bo'yicha; qidiruv,
// toifa, saralash va Excel (CSV). Vozvrat qilingan cheklar kirmaydi, otkaz qilingan taomlar kirmaydi.
import { useMemo, useState } from 'react';
import type { SoldItemRow, SoldItemsReport } from '@hardweb-pos/shared';
import { EmptyState, ErrorLine, RefreshButton, ReportCard, Segmented } from './parts';
import { DateRange, buildCsv, downloadCsv, num, qty, rangeLabel } from './reportUtils';
import { useReportData } from './useReportData';

type TypeFilter = 'all' | 'stol' | 'olib_ketish' | 'yetkazish';
type SortKey = 'sum' | 'qty' | 'name';

const TYPES: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'Hammasi' },
  { value: 'stol', label: 'Stolga' },
  { value: 'olib_ketish', label: 'Olib ketish' },
  { value: 'yetkazish', label: 'Yetkazish' },
];
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'sum', label: 'Summa' },
  { value: 'qty', label: 'Miqdor' },
  { value: 'name', label: 'Nomi' },
];

export function ItemsReport({ range }: { range: DateRange }) {
  const [type, setType] = useState<TypeFilter>('all');
  const [sort, setSort] = useState<SortKey>('sum');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const path =
    `/reports/items?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` +
    (type !== 'all' ? `&type=${type}` : '');
  const { data, loading, error, forbidden, reload } = useReportData<SoldItemsReport>(path);

  const categories = useMemo(
    () => [...new Set((data?.items ?? []).map((i) => i.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'uz')),
    [data],
  );
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (data?.items ?? []).filter(
      (i) => (!needle || i.name.toLowerCase().includes(needle)) && (!category || i.category === category),
    );
    return [...list].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name, 'uz') : sort === 'qty' ? b.quantity - a.quantity : b.sum - a.sum,
    );
  }, [data, q, category, sort]);
  const total = rows.reduce((t, r) => t + r.sum, 0);
  const grand = Math.max(1, data?.total ?? 0);

  function exportCsv() {
    const head = ['Taom', 'Toifa', 'Miqdor', 'Birlik', 'Summa', 'Zalda', 'Saboy', 'Olib ketish', 'Yetkazish'];
    const body = rows.map((r) => [r.name, r.category ?? '', String(r.quantity).replace('.', ','), r.unit, r.sum, r.hall, r.saboy, r.takeaway, r.delivery]);
    downloadCsv(`taomlar-${range.from.slice(0, 10)}.csv`, buildCsv([head, ...body, ['Jami', '', '', '', total, '', '', '', '']]));
  }

  if (forbidden) return null;
  const input = 'h-11 px-3 rounded-xl bg-bg border-2 border-border focus:border-primary outline-none font-semibold text-text';

  return (
    <ReportCard
      testId="items-report"
      title="Taomlar bo‘yicha"
      badge={
        data && (
          <span className="px-2.5 py-1 rounded-full text-sm font-extrabold tabular-nums bg-primary text-white" data-testid="items-summary">
            {rows.length} ta taom · {num(total)} so‘m
          </span>
        )
      }
      actions={
        <>
          <span className="text-sm font-bold text-muted">{rangeLabel(range)}</span>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="h-11 px-4 rounded-xl bg-success text-white font-extrabold disabled:opacity-40"
            data-testid="items-csv"
          >
            📥 Excel
          </button>
          <RefreshButton onClick={reload} loading={loading} />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Segmented<TypeFilter> options={TYPES} value={type} onChange={setType} size="sm" testIdPrefix="items-type" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish: taom nomi" className={`${input} flex-1 min-w-[180px]`} data-testid="items-search" />
        {categories.length > 0 && (
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={input} aria-label="Toifa">
            <option value="">Barcha toifalar</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <Segmented<SortKey> options={SORTS} value={sort} onChange={setSort} size="sm" testIdPrefix="items-sort" />
      </div>
      <ErrorLine message={error} onRetry={reload} />
      {rows.length === 0 ? (
        <EmptyState>{loading && !data ? 'Yuklanmoqda…' : 'Bu davrda sotilgan taom yo‘q'}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg text-muted text-xs uppercase tracking-wide">
                <th className="text-left font-bold px-3 py-2.5">#</th>
                <th className="text-left font-bold px-3 py-2.5">Taom</th>
                <th className="text-right font-bold px-3 py-2.5">Miqdor</th>
                <th className="text-right font-bold px-3 py-2.5">Summa</th>
                <th className="text-right font-bold px-3 py-2.5 hidden md:table-cell">Zalda</th>
                <th className="text-right font-bold px-3 py-2.5 hidden md:table-cell">Saboy</th>
                <th className="text-right font-bold px-3 py-2.5 hidden md:table-cell">Olib ketish</th>
                <th className="text-right font-bold px-3 py-2.5 hidden md:table-cell">Yetkazish</th>
                <th className="text-left font-bold px-3 py-2.5 w-32 hidden lg:table-cell">Ulush</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <ItemRow key={r.name} r={r} index={i + 1} share={(r.sum / grand) * 100} />
              ))}
              <tr className="bg-bg font-extrabold">
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5">Jami</td>
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-right tabular-nums">{num(total)}</td>
                <td colSpan={5} className="hidden md:table-cell" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </ReportCard>
  );
}

function ItemRow({ r, index, share }: { r: SoldItemRow; index: number; share: number }) {
  const cell = 'px-3 py-2 text-right tabular-nums';
  const dash = (n: number) => (n > 0 ? num(n) : '—');
  return (
    <tr className="hover:bg-surface-hover">
      <td className="px-3 py-2 text-muted tabular-nums">{index}</td>
      <td className="px-3 py-2">
        <div className="font-bold text-text">{r.name}</div>
        {r.category && <div className="text-xs text-muted">{r.category}</div>}
      </td>
      <td className={`${cell} font-bold`}>{qty(r.quantity, r.unit)}</td>
      <td className={`${cell} font-extrabold text-text`}>{num(r.sum)}</td>
      <td className={`${cell} hidden md:table-cell`}>{dash(r.hall)}</td>
      <td className={`${cell} hidden md:table-cell`}>{dash(r.saboy)}</td>
      <td className={`${cell} hidden md:table-cell`}>{dash(r.takeaway)}</td>
      <td className={`${cell} hidden md:table-cell`}>{dash(r.delivery)}</td>
      <td className="px-3 py-2 hidden lg:table-cell">
        <div className="h-2.5 rounded-full bg-bg border border-border overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${Math.min(100, share).toFixed(1)}%` }} />
        </div>
      </td>
    </tr>
  );
}
