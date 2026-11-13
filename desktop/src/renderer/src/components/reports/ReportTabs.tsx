// Hisobot sahifalarining bo'limlari (direktor "Hisobotlar" va kassadagi "Hisobot"):
// Umumiy | Ofitsiantlar | Kassa | Qarzlar | Otkazlar. Faol bo'lim — to'q yashil (uzoqdan ko'rinadi).
// Tanlangan bo'lim shu qurilmada eslab qolinadi.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { IconBan, IconCash, IconReceipt, IconUser } from '../waiter/icons';

export type ReportTab = 'overview' | 'waiters' | 'cash' | 'debts' | 'voids';

const TAB_META: Record<ReportTab, { label: string; icon: (cls: string) => ReactNode }> = {
  overview: { label: 'Umumiy', icon: (c) => <ChartIcon className={c} /> },
  waiters: { label: 'Ofitsiantlar', icon: (c) => <IconUser className={c} strokeWidth={2.4} /> },
  cash: { label: 'Kassa', icon: (c) => <IconCash className={c} strokeWidth={2.4} /> },
  debts: { label: 'Qarzlar', icon: (c) => <IconReceipt className={c} strokeWidth={2.4} /> },
  voids: { label: 'Otkazlar', icon: (c) => <IconBan className={c} strokeWidth={2.4} /> },
};

export function ReportTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: ReportTab[];
  value: ReportTab;
  onChange: (t: ReportTab) => void;
}) {
  // Telefonda qator yon tomonga suriladi — faol bo'lim doim ko'rinib tursin
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = rowRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [value]);
  return (
    <div ref={rowRef} className="flex gap-1.5 overflow-x-auto -mx-1 px-1 py-0.5" role="tablist" aria-label="Hisobot bo‘limlari">
      {tabs.map((t) => {
        const on = t === value;
        const meta = TAB_META[t];
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={on}
            data-testid={`report-tab-${t}`}
            onClick={() => onChange(t)}
            className={`shrink-0 h-12 px-4 rounded-xl font-extrabold text-[15px] border-2 inline-flex items-center gap-2 transition-colors ${
              on
                ? 'bg-primary-hover border-primary-hover text-white shadow-md'
                : 'bg-surface border-border text-text hover:border-primary/60'
            }`}
          >
            {meta.icon('w-5 h-5')}
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

/** Tanlangan bo'lim — shu qurilmada eslab qolinadi (ruxsat etilmagan bo'lim — birinchisi) */
export function useReportTab(storageKey: string, allowed: ReportTab[]): [ReportTab, (t: ReportTab) => void] {
  const [tab, setTab] = useState<ReportTab>(() => {
    try {
      const saved = localStorage.getItem(storageKey) as ReportTab | null;
      if (saved && allowed.includes(saved)) return saved;
    } catch {
      /* localStorage yopiq — standart bo'lim */
    }
    return allowed[0] ?? 'overview';
  });
  const current = allowed.includes(tab) ? tab : allowed[0] ?? 'overview';
  const set = (t: ReportTab) => {
    setTab(t);
    try {
      localStorage.setItem(storageKey, t);
    } catch {
      /* e'tiborsiz */
    }
  };
  return [current, set];
}

/** Grafik belgisi (Umumiy) */
function ChartIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}
