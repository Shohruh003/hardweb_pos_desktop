// "Qarzlar" (B30/B34): "Qarzga" yozilgan to'lovlar — ochiqlari birinchi. Qidiruv (ism / telefon),
// holat (Ochiq / Qaytarilgan / Hammasi). Kassir yoki direktor "✓ To‘landi" -> usul tanlash -> tasdiqlash.
// Qaytarilgan pul shu kunning kassa holatiga kiradi (onChanged — kassa kartasini yangilash uchun).
import { memo, useMemo, useState } from 'react';
import type { DebtRow } from '@hardweb-pos/shared';
import { paymentMethodLabel } from '@hardweb-pos/shared';
import { api } from '../../lib/api';
import { usePosSettings } from '../../lib/posSettings';
import { useAuth } from '../../state/auth';
import { Sheet, SheetError, Spinner } from '../waiter/Sheet';
import { IconCheck, IconPhone, IconReceipt, IconSearch } from '../waiter/icons';
import { phoneLabel } from '../waiter/orderUi';
import { EmptyState, ErrorLine, RefreshButton, ReportCard, Segmented } from './parts';
import { canRepayDebt, dmyHm, num } from './reportUtils';
import { useDebounced, useReportData } from './useReportData';

type Status = 'open' | 'repaid' | 'all';

/** Server javobi: { rows | items, total, openTotal… } (eski/demo javob massiv bo'lishi ham mumkin) */
interface DebtsResponse {
  rows?: DebtRow[];
  items?: DebtRow[];
  total?: number;
  count?: number;
  openCount?: number;
  openTotal?: number;
}

function rowsOf(res: DebtsResponse | DebtRow[] | null): DebtRow[] {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  return res.rows ?? res.items ?? [];
}

export function DebtsPanel({ onChanged }: { onChanged?: () => void }) {
  const { user } = useAuth();
  const pos = usePosSettings();
  const [status, setStatus] = useState<Status>('open');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 350);
  const [repayFor, setRepayFor] = useState<DebtRow | null>(null);
  const canRepay = canRepayDebt(user);

  const { data, loading, error, forbidden, reload } = useReportData<DebtsResponse | DebtRow[]>(
    `/reports/debts?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
  );
  const rows = useMemo(() => rowsOf(data), [data]);
  const openRows = rows.filter((r) => !r.repaidAt);
  const openTotal = openRows.reduce((s, r) => s + r.amount, 0);

  if (forbidden) return null;

  return (
    <ReportCard
      testId="debts-panel"
      title="Qarzlar"
      icon={<IconReceipt className="w-5 h-5" strokeWidth={2.4} />}
      badge={
        openRows.length > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-warning text-black text-sm font-extrabold tabular-nums" data-testid="debts-open-total">
            Ochiq: {openRows.length} ta · {num(openTotal)} so‘m
          </span>
        )
      }
      actions={<RefreshButton onClick={reload} loading={loading} />}
    >
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Segmented<Status>
          size="sm"
          value={status}
          onChange={setStatus}
          testIdPrefix="debts-status"
          options={[
            { value: 'open', label: 'Ochiq' },
            { value: 'repaid', label: 'Qaytarilgan' },
            { value: 'all', label: 'Hammasi' },
          ]}
        />
        <label className="relative flex-1 min-w-[200px]">
          <IconSearch className="w-5 h-5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ism yoki telefon"
            data-testid="debts-search"
            className="w-full h-10 pl-10 pr-3 rounded-xl bg-bg border border-border outline-none focus:border-primary text-text"
          />
        </label>
      </div>

      <ErrorLine message={error} onRetry={reload} />
      {rows.length === 0 ? (
        <EmptyState>{loading && !data ? 'Yuklanmoqda…' : status === 'open' ? 'Ochiq qarz yo‘q' : 'Qarz yo‘q'}</EmptyState>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <DebtItem key={r.paymentId} row={r} methods={pos.paymentMethods} canRepay={canRepay} onRepay={setRepayFor} />
          ))}
        </div>
      )}

      {repayFor && (
        <RepaySheet
          row={repayFor}
          onClose={() => setRepayFor(null)}
          onDone={() => {
            setRepayFor(null);
            reload();
            onChanged?.();
          }}
        />
      )}
    </ReportCard>
  );
}

const DebtItem = memo(function DebtItem({
  row,
  methods,
  canRepay,
  onRepay,
}: {
  row: DebtRow;
  methods: { key: string; label: string }[];
  canRepay: boolean;
  onRepay: (r: DebtRow) => void;
}) {
  const open = !row.repaidAt;
  return (
    <div
      data-testid="debt-row"
      data-open={open ? '1' : '0'}
      className={`rounded-xl border px-3 py-2.5 flex items-center gap-3 flex-wrap ${
        open ? 'border-warning/60 bg-warning/10' : 'border-border bg-bg'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="font-extrabold text-text truncate">{row.debtorName || 'Ismsiz'}</div>
        <div className="text-sm text-muted flex items-center gap-x-2 gap-y-0.5 flex-wrap">
          {row.debtorPhone && (
            <span className="inline-flex items-center gap-1 font-semibold text-text">
              <IconPhone className="w-3.5 h-3.5" /> {phoneLabel(row.debtorPhone)}
            </span>
          )}
          <span>{row.orderName ?? '—'}</span>
          {row.queueNumber ? <span>№{row.queueNumber}</span> : null}
          <span>{dmyHm(row.createdAt)}</span>
        </div>
        {!open && (
          <div className="text-xs font-bold text-success mt-0.5">
            ✓ {dmyHm(row.repaidAt)} — {paymentMethodLabel(methods, row.repaidType)}
            {row.repaidByName ? ` · ${row.repaidByName}` : ''}
          </div>
        )}
      </div>
      <div className="text-right">
        <div className={`text-lg font-extrabold tabular-nums ${open ? 'text-text' : 'text-muted line-through'}`}>{num(row.amount)}</div>
        <div className="text-[11px] font-bold text-muted">so‘m</div>
      </div>
      {open && canRepay && (
        <button
          type="button"
          onClick={() => onRepay(row)}
          data-testid="debt-repay"
          className="h-12 px-4 rounded-xl bg-success text-black font-extrabold hover:brightness-105 active:scale-[0.98] inline-flex items-center gap-2"
        >
          <IconCheck className="w-5 h-5" strokeWidth={2.8} /> To‘landi
        </button>
      )}
    </div>
  );
});

/** Qarz qaytarildi: qaysi usul bilan (faol, qarz bo'lmagan usullar) -> tasdiqlash */
function RepaySheet({ row, onClose, onDone }: { row: DebtRow; onClose: () => void; onDone: () => void }) {
  const pos = usePosSettings();
  const methods = pos.paymentMethods.filter((m) => m.active && m.kind !== 'debt');
  const [type, setType] = useState(methods.find((m) => m.kind === 'cash')?.key ?? methods[0]?.key ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function confirm() {
    if (!type || busy) return;
    setBusy(true);
    setErr('');
    try {
      await api.post(`/debts/${row.paymentId}/repay`, { type });
      onDone();
    } catch (e) {
      setErr((e as Error)?.message || 'Saqlanmadi');
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Qarz qaytarildi"
      subtitle={`${row.debtorName || 'Ismsiz'} · ${num(row.amount)} so‘m`}
      icon={<IconCheck className="w-6 h-6" strokeWidth={2.6} />}
      iconTone="bg-success/20 text-success"
      onClose={onClose}
      busy={busy}
      size="sm"
      testId="debt-repay-sheet"
      footer={
        <div className="flex gap-2 pb-1">
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 h-14 rounded-2xl border border-border font-bold text-text hover:bg-bg">
            Orqaga
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || !type}
            data-testid="debt-repay-confirm"
            className="flex-[2] h-14 rounded-2xl bg-success text-black text-lg font-extrabold hover:brightness-105 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {busy ? <Spinner className="w-5 h-5 border-black" /> : <IconCheck className="w-6 h-6" strokeWidth={2.8} />}
            Qabul qilindi
          </button>
        </div>
      }
    >
      <div className="text-sm font-bold text-muted mb-2">Qanday to‘landi?</div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {methods.map((m) => {
          const on = m.key === type;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setType(m.key)}
              data-testid={`debt-method-${m.key}`}
              aria-pressed={on}
              className={`h-14 rounded-xl border-2 font-extrabold text-[15px] px-2 ${
                on ? 'bg-primary-hover border-primary-hover text-white' : 'bg-bg border-border text-text hover:border-primary/60'
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <div className="rounded-xl bg-bg border border-border px-3 py-2.5 text-sm text-muted mb-2">
        {row.orderName ?? '—'} · {dmyHm(row.createdAt)}
        <br />
        Pul bugungi kassa holatiga qo‘shiladi.
      </div>
      <SheetError>{err}</SheetError>
    </Sheet>
  );
}
