// "Kassa holati" (B33): kun bo'yicha to'lov usullari (Naqd, Terminal, Click, Payme, Qarzga…), kirim,
// chiqim, qarzlar va kassada bo'lishi kerak bo'lgan NAQD pul (katta). Kassir smena oxirida pulni sanab
// shu raqam bilan solishtiradi. Kassa ("Kirim / Chiqim" oynasi) va hisobot sahifalarida ishlatiladi.
import { useEffect, useState } from 'react';
import type { CashSummary } from '@hardweb-pos/shared';
import { IconCash } from '../waiter/icons';
import { DateNavigator, ErrorLine, RefreshButton, ReportCard } from './parts';
import { num, todayKey } from './reportUtils';
import { useReportData } from './useReportData';

const KIND_TONE: Record<string, string> = {
  cash: 'border-success/50 bg-success/10',
  card: 'border-info/40 bg-info/10',
  online: 'border-primary/40 bg-primary/10',
  debt: 'border-warning/60 bg-warning/10',
  other: 'border-border bg-bg',
};
const KIND_DOT: Record<string, string> = {
  cash: 'bg-success',
  card: 'bg-info',
  online: 'bg-primary',
  debt: 'bg-warning',
  other: 'bg-muted',
};

export function CashSummaryCard({
  refreshKey = 0,
  initialDate,
  title = 'Kassa holati',
}: {
  /** O'zgarsa — qayta yuklanadi (masalan qarz qaytarilgach yoki kirim/chiqim qo'shilgach) */
  refreshKey?: number;
  initialDate?: string;
  title?: string;
}) {
  const [date, setDate] = useState(initialDate ?? todayKey());
  const { data, loading, error, forbidden, reload } = useReportData<CashSummary>(`/reports/cash-summary?date=${date}`);

  useEffect(() => {
    if (refreshKey > 0) reload();
  }, [refreshKey, reload]);

  if (forbidden) return null;
  const repaid = (data?.debtRepaid ?? []).reduce((s, r) => s + r.amount, 0);
  const cashSales = (data?.byMethod ?? []).filter((m) => m.kind === 'cash').reduce((s, m) => s + m.amount, 0);

  return (
    <ReportCard
      testId="cash-summary"
      title={title}
      icon={<IconCash className="w-5 h-5" strokeWidth={2.4} />}
      actions={<RefreshButton onClick={reload} loading={loading} />}
    >
      <div className="mb-4">
        <DateNavigator mode={null} anchor={date} onChange={(n) => setDate(n.anchor)} testId="cash-summary-date" />
      </div>
      <ErrorLine message={error} onRetry={reload} />

      {/* Asosiy raqam — kassada bo'lishi kerak (naqd) */}
      <div className="rounded-2xl border-2 border-success bg-success/15 px-4 py-3.5 mb-4 flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-extrabold uppercase tracking-wider text-success">Kassada bo‘lishi kerak (naqd)</div>
          <div className="text-[13px] text-muted font-semibold mt-0.5">
            Naqd tushum + kirim − chiqim + naqd qaytarilgan qarz − naqd vozvrat
          </div>
        </div>
        <div className="text-3xl sm:text-4xl font-black text-text tabular-nums" data-testid="cash-expected">
          {data ? num(data.expectedCash) : '—'}
          <span className="text-base font-bold text-muted"> so‘m</span>
        </div>
      </div>

      {/* To'lov usullari */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5 mb-4">
        {(data?.byMethod ?? []).map((m) => (
          <div key={m.key} className={`rounded-xl border px-3 py-2.5 min-w-0 ${KIND_TONE[m.kind] ?? KIND_TONE.other}`} data-testid={`cash-method-${m.key}`}>
            <div className="flex items-center gap-1.5 text-sm font-bold text-text truncate">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${KIND_DOT[m.kind] ?? KIND_DOT.other}`} />
              <span className="truncate">{m.label}</span>
            </div>
            <div className="text-xl font-extrabold text-text tabular-nums mt-0.5">{num(m.amount)}</div>
          </div>
        ))}
      </div>

      {/* Kassa harakatlari va qarzlar */}
      {data && (
        <div className="rounded-xl border border-border divide-y divide-border text-[15px]">
          <Line label="Naqd tushum" value={num(cashSales)} />
          <Line label="Kirim (kassaga qo‘yilgan)" value={`+ ${num(data.kirim)}`} tone="success" testId="cash-kirim" />
          <Line label="Chiqim (rasxod)" value={`− ${num(data.chiqim)}`} tone="danger" testId="cash-chiqim" />
          {repaid > 0 && (
            <Line
              label={`Qaytarilgan qarzlar (${data.debtRepaid.map((r) => `${r.label}: ${num(r.amount)}`).join(', ')})`}
              value={`+ ${num(repaid)}`}
              tone="success"
            />
          )}
          {data.refundsCash > 0 && <Line label="Naqd vozvrat" value={`− ${num(data.refundsCash)}`} tone="danger" />}
          <Line label="Qarzga yozildi (shu kuni)" value={num(data.debtCreated)} tone="warning" />
        </div>
      )}
    </ReportCard>
  );
}

function Line({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger' | 'warning';
  testId?: string;
}) {
  // Ochiq temada sariq matn xira ko'rinadi — qarz qatori oddiy matn rangida, belgisi sariq nuqta
  const cls = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-text';
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5" data-testid={testId}>
      <span className="text-muted font-semibold min-w-0 flex items-center gap-2">
        {tone === 'warning' && <span className="w-2.5 h-2.5 rounded-full bg-warning shrink-0" />}
        {label}
      </span>
      <span className={`font-extrabold tabular-nums whitespace-nowrap ${cls}`}>{value}</span>
    </div>
  );
}
