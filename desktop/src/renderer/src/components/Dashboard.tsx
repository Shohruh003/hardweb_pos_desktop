import { useEffect, useMemo, useState } from 'react';
import { ReportSummary, TopItem, WaiterStat } from '@hardweb-pos/shared';
import { formatSum } from './ui';
import { DonutChart, LineChart, HBars, CHART_COLORS, compactSum } from './charts';
import { api } from '../lib/api';

type Period = 'day' | 'week' | 'month';
interface DailyPoint { date: string; revenue: number }
interface ExpenseData { items: unknown[]; total: number }
interface RefundItem {
  id: string;
  total: number;
  reason: string;
  refundedAt: string | null;
  products: { name: string; quantity: number }[];
}
interface RefundData { count: number; total: number; items: RefundItem[] }

const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Bugun' },
  { key: 'week', label: 'Hafta' },
  { key: 'month', label: 'Oy' },
];

const PAY_LABEL: Record<string, string> = { naqd: 'Naqd', karta: 'Karta', qr: 'QR' };
const PAY_COLOR: Record<string, string> = { naqd: '#10b981', karta: '#8b5cf6', qr: '#f59e0b' };

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

// Hisobot / Dashboard — kartochkalar + doiraviy, chiziqli va ustunli grafiklar.
export function Dashboard({ onBack }: { onBack: () => void }) {
  const [period, setPeriod] = useState<Period>('day');
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [waiters, setWaiters] = useState<WaiterStat[]>([]);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [expenses, setExpenses] = useState<ExpenseData>({ items: [], total: 0 });
  const [refunds, setRefunds] = useState<RefundData>({ count: 0, total: 0, items: [] });

  useEffect(() => {
    const days = period === 'month' ? 30 : period === 'week' ? 14 : 7;
    api.get<ReportSummary>(`/reports/summary?period=${period}`).then(setSummary).catch(() => {});
    api.get<TopItem[]>(`/reports/top-items?period=${period}`).then(setTopItems).catch(() => {});
    api.get<WaiterStat[]>(`/reports/waiters?period=${period}`).then(setWaiters).catch(() => {});
    api.get<DailyPoint[]>(`/reports/daily?days=${days}`).then(setDaily).catch(() => {});
    api.get<ExpenseData>('/expenses').then(setExpenses).catch(() => {});
    api.get<RefundData>(`/reports/refunds?period=${period}`).then(setRefunds).catch(() => {});
  }, [period]);

  const revenue = summary?.revenue ?? 0;
  const net = revenue - (expenses.total ?? 0);
  const donutData = useMemo(
    () =>
      (summary?.paymentBreakdown ?? []).map((p) => ({
        label: PAY_LABEL[p.type] || p.type,
        value: p.amount,
        color: PAY_COLOR[p.type] || undefined,
      })),
    [summary],
  );

  const KPIS = [
    { label: 'Tushum', value: formatSum(revenue), accent: 'primary', icon: '💰' },
    { label: 'Yopilgan cheklar', value: String(summary?.ordersCount ?? 0), accent: 'violet', icon: '🧾' },
    { label: "O'rtacha chek", value: formatSum(summary?.avgCheck ?? 0), accent: 'teal', icon: '📊' },
    { label: 'Rasxod', value: formatSum(expenses.total ?? 0), accent: 'danger', icon: '📉' },
    { label: 'Sof tushum', value: formatSum(net), accent: 'primary', icon: '📈' },
    {
      label: `Vozvrat${refunds.count ? ` (${refunds.count} ta)` : ''}`,
      value: formatSum(refunds.total ?? 0),
      accent: 'amber',
      icon: '↩️',
    },
  ];
  const accentBg: Record<string, string> = {
    primary: 'from-emerald-500/15 to-emerald-500/5 border-emerald-500/25',
    violet: 'from-violet-500/15 to-violet-500/5 border-violet-500/25',
    teal: 'from-teal-500/15 to-teal-500/5 border-teal-500/25',
    danger: 'from-rose-500/15 to-rose-500/5 border-rose-500/25',
    amber: 'from-amber-500/15 to-amber-500/5 border-amber-500/25',
  };

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      {/* Sarlavha + sana filtri + orqaga */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="text-xl font-bold flex items-center gap-2">📊 Hisobot</div>
        <div className="flex gap-1.5 ml-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                period === p.key ? 'bg-primary text-white border-primary' : 'bg-surface border-border text-muted hover:text-text'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={onBack}
          className="ml-auto flex items-center gap-1.5 px-3 h-9 rounded-lg border border-border hover:border-primary hover:bg-surface-hover font-semibold"
        >
          <span className="text-lg leading-none">←</span> Orqaga
        </button>
      </div>

      {/* KPI kartochkalar */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4 mb-5">
        {KPIS.map((k) => (
          <div key={k.label} className={`rounded-2xl border bg-gradient-to-br p-4 ${accentBg[k.accent]}`}>
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted">{k.label}</div>
              <div className="text-lg">{k.icon}</div>
            </div>
            <div className="text-xl sm:text-2xl font-extrabold mt-2 truncate">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Chiziqli grafik — kunlik tushum */}
      <div className="bg-surface border border-border rounded-2xl p-4 sm:p-5 mb-5">
        <div className="font-bold mb-1">Kunlik tushum dinamikasi</div>
        <div className="text-xs text-muted mb-3">Oxirgi {daily.length} kun</div>
        <LineChart points={daily.map((d) => ({ label: shortDate(d.date), value: d.revenue }))} />
      </div>

      {/* Pastki qator: donut + top taomlar + ofitsiantlar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <div className="bg-surface border border-border rounded-2xl p-4 sm:p-5">
          <div className="font-bold mb-4">To'lov turlari</div>
          <DonutChart data={donutData} centerValue={compactSum(revenue)} centerLabel="jami so'm" />
        </div>

        <div className="bg-surface border border-border rounded-2xl p-4 sm:p-5">
          <div className="font-bold mb-4">Eng ko'p sotilgan (top 6)</div>
          <HBars
            rows={topItems.slice(0, 6).map((t) => ({ label: t.name, value: t.quantity, sub: formatSum(t.sum) }))}
            color={CHART_COLORS[2]}
            valueFmt={(v) => `${v} ta`}
          />
        </div>

        <div className="bg-surface border border-border rounded-2xl p-4 sm:p-5">
          <div className="font-bold mb-4">Ofitsiantlar reytingi</div>
          <HBars
            rows={waiters.slice(0, 6).map((w) => ({ label: w.waiterName, value: w.revenue, sub: `${w.ordersCount} ta buyurtma` }))}
            color={CHART_COLORS[3]}
            valueFmt={(v) => formatSum(v)}
          />
        </div>
      </div>

      {/* Vozvratlar (qaytarilgan cheklar) ro'yxati */}
      <div className="bg-surface border border-border rounded-2xl p-4 sm:p-5 mt-5">
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold flex items-center gap-2">
            <span>↩️ Vozvratlar</span>
            <span className="text-xs font-semibold text-amber-500 bg-amber-500/10 rounded-full px-2 py-0.5">
              {refunds.count} ta · {formatSum(refunds.total)}
            </span>
          </div>
        </div>
        {refunds.items.length === 0 ? (
          <div className="text-sm text-muted py-6 text-center">
            Bu davrda vozvrat qilinmagan 🎉
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {refunds.items.map((r) => (
              <div
                key={r.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {r.products.map((p) => `${p.quantity}× ${p.name}`).join(', ') || '—'}
                  </div>
                  {r.reason && (
                    <div className="text-xs text-muted mt-0.5">Sabab: {r.reason}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-extrabold text-amber-500">
                    −{formatSum(r.total)}
                  </div>
                  {r.refundedAt && (
                    <div className="text-[11px] text-muted">
                      {new Date(r.refundedAt).toLocaleString('uz-UZ', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
