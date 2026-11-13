// "Otkazlar" bo'limi (B19): tanlangan davrdagi otkazlar — soni, summasi va ro'yxat
// (vaqt, buyurtma, taom, miqdor, summa, sabab, kim). Direktor nazorati uchun: kim, qachon, nimani.
import { memo } from 'react';
import type { VoidLog, VoidReport } from '@hardweb-pos/shared';
import { IconBan } from '../waiter/icons';
import { OrderTypeBadge } from '../waiter/orderUi';
import { EmptyState, ErrorLine, RefreshButton, ReportCard } from './parts';
import { DateRange, dmHm, num, qty, rangeLabel } from './reportUtils';
import { useReportData } from './useReportData';

export function VoidsReport({ range, title = 'Otkazlar' }: { range: DateRange; title?: string }) {
  const { data, loading, error, forbidden, reload } = useReportData<VoidReport>(
    `/reports/voids?from=${range.from}&to=${range.to}`,
  );
  if (forbidden) return null;
  const items = data?.items ?? [];
  const more = data ? data.count - items.length : 0;

  return (
    <ReportCard
      testId="voids-report"
      title={title}
      icon={<IconBan className="w-5 h-5" strokeWidth={2.4} />}
      badge={
        data && (
          <span
            data-testid="voids-summary"
            className={`px-2.5 py-1 rounded-full text-sm font-extrabold tabular-nums ${
              data.count > 0 ? 'bg-danger text-white' : 'bg-bg border border-border text-muted'
            }`}
          >
            {data.count} ta · {num(data.total)} so‘m
          </span>
        )
      }
      actions={
        <>
          <span className="text-sm font-bold text-muted">{rangeLabel(range)}</span>
          <RefreshButton onClick={reload} loading={loading} />
        </>
      }
    >
      <ErrorLine message={error} onRetry={reload} />
      {items.length === 0 ? (
        <EmptyState>{loading && !data ? 'Yuklanmoqda…' : 'Bu davrda otkaz bo‘lmagan'}</EmptyState>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg text-muted text-xs uppercase tracking-wide">
                  <th className="text-left font-bold px-3 py-2.5">Vaqt</th>
                  <th className="text-left font-bold px-3 py-2.5">Buyurtma</th>
                  <th className="text-left font-bold px-3 py-2.5">Taom</th>
                  <th className="text-right font-bold px-3 py-2.5">Miqdor</th>
                  <th className="text-right font-bold px-3 py-2.5">Summa</th>
                  <th className="text-left font-bold px-3 py-2.5">Sabab</th>
                  <th className="text-left font-bold px-3 py-2.5">Kim</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((v) => (
                  <VoidRow key={v.id} v={v} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-2">
            {items.map((v) => (
              <div key={v.id} className="rounded-xl border border-danger/30 bg-danger/5 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-text">
                      {qty(v.quantity, v.unit)} × {v.name}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      {dmHm(v.createdAt)} · {v.orderName ?? '—'}
                      {v.userName ? ` · ${v.userName}` : ''}
                    </div>
                  </div>
                  <div className="font-extrabold text-danger tabular-nums">−{num(v.sum)}</div>
                </div>
                {v.reason && <div className="text-sm text-text mt-1.5">Sabab: {v.reason}</div>}
              </div>
            ))}
          </div>
          {more > 0 && <div className="text-xs text-muted mt-2 text-center">…yana {more} ta (eng yangilari ko‘rsatilgan)</div>}
        </>
      )}
    </ReportCard>
  );
}

const VoidRow = memo(function VoidRow({ v }: { v: VoidLog }) {
  return (
    <tr className="hover:bg-surface-hover" data-testid="void-row">
      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-muted font-semibold">{dmHm(v.createdAt)}</td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          {v.orderType && <OrderTypeBadge type={v.orderType} short />}
          <span className="font-bold text-text">{v.orderName ?? '—'}</span>
        </div>
        {v.wholeOrder && <div className="text-[11px] font-bold text-danger mt-0.5">butun hisob bekor qilingan</div>}
      </td>
      <td className="px-3 py-2.5 font-semibold text-text">{v.name}</td>
      <td className="px-3 py-2.5 text-right tabular-nums font-bold">{qty(v.quantity, v.unit)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums font-extrabold text-danger">−{num(v.sum)}</td>
      <td className="px-3 py-2.5 text-text max-w-[260px]">{v.reason || <span className="text-muted">—</span>}</td>
      <td className="px-3 py-2.5 whitespace-nowrap text-text">{v.userName ?? '—'}</td>
    </tr>
  );
});
