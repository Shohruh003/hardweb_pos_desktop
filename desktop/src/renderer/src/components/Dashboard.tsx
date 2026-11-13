import { useEffect, useMemo, useRef, useState } from 'react';
import { ReportSummary, TopItem, WaiterStat, paymentMethodLabel } from '@hardweb-pos/shared';
import { formatSum } from './ui';
import { DonutChart, LineChart, HBars, CHART_COLORS, compactSum } from './charts';
import { OrderTypeBreakdown } from './cashier/OrderTypeBreakdown';
import { api } from '../lib/api';
import { usePosSettings } from '../lib/posSettings';
import { useAuth } from '../state/auth';
import { ReportTab, ReportTabs, useReportTab } from './reports/ReportTabs';
import { WaiterShareReport } from './reports/WaiterShareReport';
import { CashSummaryCard } from './reports/CashSummaryCard';
import { DebtsPanel } from './reports/DebtsPanel';
import { VoidsReport } from './reports/VoidsReport';
import { Segmented } from './reports/parts';
import { canSeeCash, canSeeVoids, canSeeWaiterShares, periodRange, qty } from './reports/reportUtils';

type Period = 'day' | 'week' | 'month';
interface DailyPoint { date: string; revenue: number }
interface ExpenseData { items: unknown[]; total: number }
interface RefundItem {
  id: string;
  total: number;
  reason: string;
  refundedAt: string | null;
  products: { name: string; quantity: number; unit?: string | null }[];
}
interface RefundData { count: number; total: number; items: RefundItem[] }
/** To'lov turi qatori (server B30 dan beri nom va toifa bilan beradi) */
type PaymentRow = ReportSummary['paymentBreakdown'][number] & { label?: string; kind?: string };

const PERIODS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Bugun' },
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Oy' },
];

/** To'lov usuli toifasi bo'yicha donut rangi (ko'k emas): naqd — yashil, karta — binafsha, onlayn — teal, qarz — sariq */
const KIND_COLOR: Record<string, string> = {
  cash: '#10b981',
  card: '#8b5cf6',
  online: '#14b8a6',
  debt: '#f59e0b',
  other: '#ec4899',
};

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

// Kassadagi "Hisobot" — bo'limlar: Umumiy (kartochkalar + grafiklar), Kassa holati, Qarzlar, Otkazlar va
// (hisobot ruxsati bo'lsa) Ofitsiantlar hisoboti.
export function Dashboard({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const pos = usePosSettings();
  const tabs = useMemo<ReportTab[]>(() => {
    const list: ReportTab[] = ['overview'];
    if (canSeeCash(user)) list.push('cash', 'debts');
    if (canSeeVoids(user)) list.push('voids');
    if (canSeeWaiterShares(user)) list.push('waiters');
    return list;
  }, [user]);
  const [tab, setTab] = useReportTab('dashboard.tab', tabs);
  const [period, setPeriod] = useState<Period>('day');
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [waiters, setWaiters] = useState<WaiterStat[]>([]);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [expenses, setExpenses] = useState<ExpenseData>({ items: [], total: 0 });
  const [refunds, setRefunds] = useState<RefundData>({ count: 0, total: 0, items: [] });
  const [cashTick, setCashTick] = useState(0);
  const range = useMemo(() => periodRange(period), [period]);

  // Davr tez almashtirilsa — kechikib kelgan eski davr javoblari yangisini bosib ketmasin
  const reqRef = useRef(0);

  useEffect(() => {
    if (tab !== 'overview') return;
    const req = ++reqRef.current;
    const fresh = <T,>(set: (v: T) => void) => (v: T) => {
      if (req === reqRef.current) set(v);
    };
    const days = period === 'month' ? 30 : period === 'week' ? 14 : 7;
    api.get<ReportSummary>(`/reports/summary?period=${period}`).then(fresh(setSummary)).catch(() => {});
    api.get<TopItem[]>(`/reports/top-items?period=${period}`).then(fresh(setTopItems)).catch(() => {});
    api.get<WaiterStat[]>(`/reports/waiters?period=${period}`).then(fresh(setWaiters)).catch(() => {});
    api.get<DailyPoint[]>(`/reports/daily?days=${days}`).then(fresh(setDaily)).catch(() => {});
    // Rasxod — tanlangan davrdagi CHIQIMlar (kirim — kassaga qo'yilgan pul, tushumdan ayirilmaydi)
    api
      .get<ExpenseData>(`/expenses?from=${range.from}&to=${range.to}&kind=chiqim`)
      .then(fresh(setExpenses))
      .catch(() => {});
    api.get<RefundData>(`/reports/refunds?period=${period}`).then(fresh(setRefunds)).catch(() => {});
  }, [period, range, tab]);

  const revenue = summary?.revenue ?? 0;
  const net = revenue - (expenses.total ?? 0);
  const donutData = useMemo(
    () =>
      ((summary?.paymentBreakdown ?? []) as PaymentRow[]).map((p) => ({
        label: p.label ?? paymentMethodLabel(pos.paymentMethods, p.type),
        value: p.amount,
        color: KIND_COLOR[p.kind ?? ''] ?? undefined,
      })),
    [summary, pos.paymentMethods],
  );

  const KPIS = [
    { label: 'Tushum', value: formatSum(revenue), accent: 'primary', icon: '💰' },
    { label: 'Yopilgan cheklar', value: String(summary?.ordersCount ?? 0), accent: 'info', icon: '🧾' },
    { label: "O'rtacha chek", value: formatSum(summary?.avgCheck ?? 0), accent: 'success', icon: '📊' },
    { label: 'Rasxod (chiqim)', value: formatSum(expenses.total ?? 0), accent: 'danger', icon: '📉' },
    { label: 'Sof tushum', value: formatSum(net), accent: 'primary', icon: '📈' },
    {
      label: `Vozvrat${refunds.count ? ` (${refunds.count} ta)` : ''}`,
      value: formatSum(refunds.total ?? 0),
      accent: 'warning',
      icon: '↩️',
    },
  ];
  const accentBg: Record<string, string> = {
    primary: 'from-primary/15 to-primary/5 border-primary/25',
    info: 'from-info/15 to-info/5 border-info/25',
    success: 'from-success/15 to-success/5 border-success/25',
    danger: 'from-danger/15 to-danger/5 border-danger/25',
    warning: 'from-warning/15 to-warning/5 border-warning/25',
  };

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      {/* Bo'limlar + orqaga (telefonda bo'limlar alohida, to'liq kenglikdagi qatorda) */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 mb-5">
        <div className="min-w-0 sm:flex-1">
          <ReportTabs tabs={tabs} value={tab} onChange={setTab} />
        </div>
        <button
          onClick={onBack}
          className="shrink-0 self-end sm:self-auto flex items-center gap-1.5 px-4 h-12 rounded-xl border border-border hover:border-primary hover:bg-surface-hover font-semibold"
        >
          <span className="text-lg leading-none">←</span> Orqaga
        </button>
      </div>

      {(tab === 'overview' || tab === 'voids') && (
        <div className="mb-5">
          <Segmented<Period> value={period} onChange={setPeriod} options={PERIODS} testIdPrefix="period" />
        </div>
      )}

      {tab === 'cash' && <CashSummaryCard refreshKey={cashTick} />}
      {tab === 'debts' && <DebtsPanel onChanged={() => setCashTick((n) => n + 1)} />}
      {tab === 'voids' && <VoidsReport range={range} />}
      {tab === 'waiters' && <WaiterShareReport />}

      {tab === 'overview' && (
        <>
          {/* KPI kartochkalar */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-5">
            {KPIS.map((k) => (
              <div key={k.label} className={`rounded-2xl border bg-gradient-to-br p-4 ${accentBg[k.accent]}`}>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted">{k.label}</div>
                  <div className="text-lg">{k.icon}</div>
                </div>
                <div className="text-xl sm:text-2xl xl:text-[22px] font-extrabold mt-2 truncate text-text" title={k.value}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Buyurtma turlari: stolga / olib ketish / yetkazib berish — soni, tushumi, ulushi */}
          <OrderTypeBreakdown data={summary?.byOrderType} className="mb-5" />

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
                valueFmt={(v) => `${qty(v)} ta`}
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
                <span className="text-xs font-semibold text-warning bg-warning/10 rounded-full px-2 py-0.5">
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
                    className="flex items-start justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {r.products.map((p) => `${qty(p.quantity, p.unit)}× ${p.name}`).join(', ') || '—'}
                      </div>
                      {r.reason && (
                        <div className="text-xs text-muted mt-0.5">Sabab: {r.reason}</div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-extrabold text-warning">
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
        </>
      )}
    </div>
  );
}
