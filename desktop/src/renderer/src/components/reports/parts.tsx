// Hisobot bo'limlarining umumiy UI bo'laklari: karta, segment tugmalar, sana navigatori, bo'sh/xato holat.
// Faqat tema tokenlari (bg-surface, border-border, primary, warning, danger…) — ko'k rang ishlatilmaydi.
import { memo } from 'react';
import type { ReactNode } from 'react';
import { IconChevronLeft, IconChevronRight, IconRefresh } from '../waiter/icons';
import { DateRange, RangeMode, modeRange, rangeLabel, shiftAnchor, todayKey } from './reportUtils';

/** Bo'lim kartasi: sarlavha (belgi bilan), o'ng tomonda amallar, ichida mazmun */
export function ReportCard({
  title,
  icon,
  badge,
  actions,
  children,
  className = '',
  testId,
}: {
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={`bg-surface border border-border rounded-2xl p-4 sm:p-5 animate-card-in ${className}`}
    >
      <div className="flex items-center gap-2.5 flex-wrap mb-4">
        {icon && (
          <span className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
            {icon}
          </span>
        )}
        <h2 className="text-lg font-extrabold text-text leading-tight">{title}</h2>
        {badge}
        {actions && <div className="ml-auto flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Segment tugmalar (Kun / Hafta / Oy; Ochiq / Qaytarilgan…): faol — to'q yashil, oq matn */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  testIdPrefix,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  testIdPrefix?: string;
}) {
  const h = size === 'sm' ? 'h-10 px-3 text-sm' : 'h-11 px-4 text-[15px]';
  return (
    <div className="inline-flex flex-wrap gap-1.5" role="group">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            data-testid={testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined}
            onClick={() => onChange(o.value)}
            className={`${h} rounded-xl font-bold border transition-colors inline-flex items-center gap-1.5 ${
              on
                ? 'bg-primary-hover border-primary-hover text-white shadow-sm'
                : 'bg-surface border-border text-muted hover:text-text hover:border-primary/60'
            }`}
          >
            {o.label}
            {o.count !== undefined && o.count > 0 && (
              <span
                className={`min-w-[22px] h-[22px] px-1.5 rounded-full text-xs font-extrabold inline-flex items-center justify-center ${
                  on ? 'bg-white text-primary-hover' : 'bg-warning text-black'
                }`}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const MODE_LABELS: { value: RangeMode; label: string }[] = [
  { value: 'day', label: 'Kun' },
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Oy' },
];

/**
 * Sana navigatori (eski POS'dagidek): ‹ 13.11.2026 › + "Bugun" va Kun / Hafta / Oy.
 * mode=null — faqat kun (kassa holati).
 */
export const DateNavigator = memo(function DateNavigator({
  mode,
  anchor,
  onChange,
  testId,
}: {
  mode: RangeMode | null;
  anchor: string;
  onChange: (next: { mode: RangeMode; anchor: string }) => void;
  testId?: string;
}) {
  const m: RangeMode = mode ?? 'day';
  const range: DateRange = modeRange(m, anchor);
  const today = todayKey();
  const isToday = range.from <= today && today <= range.to;
  const btn =
    'h-11 w-11 rounded-xl border border-border bg-surface text-text hover:border-primary/60 hover:bg-surface-hover flex items-center justify-center';
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid={testId}>
      {mode !== null && (
        <Segmented options={MODE_LABELS} value={m} onChange={(v) => onChange({ mode: v, anchor })} size="sm" testIdPrefix="range-mode" />
      )}
      <div className="flex items-center gap-1.5">
        <button type="button" className={btn} aria-label="Oldingi" onClick={() => onChange({ mode: m, anchor: shiftAnchor(m, anchor, -1) })}>
          <IconChevronLeft className="w-5 h-5" strokeWidth={2.6} />
        </button>
        <div
          className="h-11 min-w-[150px] px-3 rounded-xl bg-bg border border-border flex items-center justify-center font-extrabold text-text tabular-nums"
          data-testid={testId ? `${testId}-label` : undefined}
        >
          {rangeLabel(range)}
        </div>
        <button
          type="button"
          className={btn}
          aria-label="Keyingi"
          disabled={range.to >= today}
          onClick={() => onChange({ mode: m, anchor: shiftAnchor(m, anchor, 1) })}
        >
          <IconChevronRight className="w-5 h-5" strokeWidth={2.6} />
        </button>
      </div>
      <button
        type="button"
        onClick={() => onChange({ mode: m, anchor: today })}
        disabled={isToday && anchor === today}
        className="h-11 px-4 rounded-xl border border-border bg-surface font-bold text-text hover:border-primary/60 disabled:opacity-50"
      >
        Bugun
      </button>
    </div>
  );
});

/** Yangilash tugmasi (aylanadi) */
export function RefreshButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Yangilash"
      title="Yangilash"
      className="h-11 w-11 rounded-xl border border-border bg-surface text-muted hover:text-text hover:border-primary/60 flex items-center justify-center"
    >
      <IconRefresh className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
    </button>
  );
}

/** Bo'sh holat */
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="text-center text-muted py-8 font-semibold">{children}</div>;
}

/** Xato qatori (qayta urinish bilan) */
export function ErrorLine({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-3 rounded-xl border border-danger/60 bg-danger/10 px-3 py-2.5 text-sm font-bold text-danger flex items-center gap-2">
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="underline shrink-0">
          Qayta urinish
        </button>
      )}
    </div>
  );
}

/** Kichik ko'rsatkich plitasi (label + katta qiymat) */
export function StatTile({
  label,
  value,
  tone = 'default',
  sub,
  testId,
}: {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
  sub?: ReactNode;
  testId?: string;
}) {
  const tones: Record<string, string> = {
    default: 'border-border bg-bg',
    primary: 'border-primary/40 bg-primary/10',
    success: 'border-success/40 bg-success/10',
    warning: 'border-warning/50 bg-warning/10',
    danger: 'border-danger/40 bg-danger/10',
    info: 'border-info/40 bg-info/10',
  };
  return (
    <div className={`rounded-xl border px-3.5 py-3 min-w-0 ${tones[tone]}`} data-testid={testId}>
      <div className="text-xs font-bold text-muted uppercase tracking-wide truncate">{label}</div>
      <div className="text-xl font-extrabold text-text mt-0.5 tabular-nums truncate">{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5 truncate">{sub}</div>}
    </div>
  );
}
