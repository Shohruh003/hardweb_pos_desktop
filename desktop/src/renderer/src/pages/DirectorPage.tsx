import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReportPeriod,
  ReportSummary,
  SOCKET_EVENTS,
  TopItem,
  WaiterStat,
  isFullAccessRole,
  paymentMethodLabel,
} from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { formatSum } from '../components/ui';
import { SettingsPanel } from '../components/SettingsPanel';
import { BackButton } from '../components/BackButton';
import { OrderTypeBreakdown } from '../components/cashier/OrderTypeBreakdown';
import { ReportTab, ReportTabs, useReportTab } from '../components/reports/ReportTabs';
import { RangePicker, ReportRange, customValid, defaultReportRange, periodQuery, toDateRange } from '../components/reports/RangePicker';
import { ItemsReport } from '../components/reports/ItemsReport';
import { WaiterShareReport } from '../components/reports/WaiterShareReport';
import { CashSummaryCard } from '../components/reports/CashSummaryCard';
import { DebtsPanel } from '../components/reports/DebtsPanel';
import { VoidsReport } from '../components/reports/VoidsReport';
import { Segmented } from '../components/reports/parts';
import { canSeeCash, canSeeVoids, canSeeWaiterShares, periodRange, qty } from '../components/reports/reportUtils';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { usePosSettings } from '../lib/posSettings';
import { useI18n } from '../state/i18n';
import { useAuth } from '../state/auth';

/** To'lov turi qatori (server B30 dan beri nom va toifa bilan beradi) */
type PaymentRow = ReportSummary['paymentBreakdown'][number] & { label?: string; kind?: string };

/** To'lov usuli toifasi bo'yicha ustun rangi (ko'k ishlatilmaydi) */
const KIND_BAR: Record<string, string> = {
  cash: 'bg-success',
  card: 'bg-info',
  online: 'bg-primary',
  debt: 'bg-warning',
  other: 'bg-muted',
};

// Direktor hisobotlari (TZ 5.5) — lokal serverdan, deyarli jonli. Bo'limlar: Umumiy (tushum, turlar,
// to'lov usullari, ofitsiantlar, top taomlar), Ofitsiantlar hisoboti (ulush), Kassa holati, Qarzlar, Otkazlar.
export function DirectorPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const pos = usePosSettings();
  // Restoran sozlamalari (Telegram, xizmat haqi...) — server faqat direktor/superadmin'ga ruxsat beradi
  const canSettings = !!user && isFullAccessRole(user.role);
  const tabs = useMemo<ReportTab[]>(() => {
    const list: ReportTab[] = ['overview', 'items'];
    if (canSeeWaiterShares(user)) list.push('waiters');
    if (canSeeCash(user)) list.push('cash', 'debts');
    if (canSeeVoids(user)) list.push('voids');
    return list;
  }, [user]);
  const [tab, setTab] = useReportTab('director.tab', tabs);
  const [rr, setRr] = useState<ReportRange>(defaultReportRange);
  const pq = periodQuery(rr);
  const [showSettings, setShowSettings] = useState(false);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [waiters, setWaiters] = useState<WaiterStat[]>([]);
  // Qarz qaytarilganda kassa holati ham yangilansin
  const [cashTick, setCashTick] = useState(0);

  // Har so'rov alohida (bittasi xato bersa ham qolganlari ko'rinadi); davr almashtirilganda
  // kechikkan eski javoblar yangisini bosib ketmaydi
  const reqRef = useRef(0);
  const load = useCallback((p: string) => {
    const req = ++reqRef.current;
    const fresh = <T,>(set: (v: T) => void) => (v: T) => {
      if (req === reqRef.current) set(v);
    };
    api.get<ReportSummary>(`/reports/summary?${p}`).then(fresh(setSummary)).catch(() => {});
    api.get<TopItem[]>(`/reports/top-items?${p}`).then(fresh(setTopItems)).catch(() => {});
    api.get<WaiterStat[]>(`/reports/waiters?${p}`).then(fresh(setWaiters)).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== 'overview' || !customValid(rr)) return;
    load(pq);
    // Hisob yopilganda hisobotni yangilash (deyarli jonli — TZ F-5.6); ketma-ket hodisalar bitta so'rov
    const socket = getSocket();
    let timer: number | undefined;
    const onClosed = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => load(pq), 400);
    };
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, onClosed);
    return () => {
      window.clearTimeout(timer);
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, onClosed);
    };
  }, [pq, rr, load, tab]);

  const maxTop = Math.max(1, ...topItems.map((x) => x.quantity));
  const maxWaiter = Math.max(1, ...waiters.map((w) => w.revenue));
  const payments = (summary?.paymentBreakdown ?? []) as PaymentRow[];
  const totalPay = Math.max(1, payments.reduce((s, p) => s + p.amount, 0));
  const voidRange = useMemo(() => toDateRange(rr), [rr]);

  // Davr: Bugun / Hafta / Oy yoki istalgan sana va vaqt oralig'i (0.3.2)
  const periodChips = <RangePicker value={rr} onChange={setRr} />;

  return (
    <AppShell title={t('title.director')}>
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      <div className="h-full overflow-auto p-3 sm:p-6">
        {/* Bo'limlar + sozlamalar + orqaga (telefonda bo'limlar alohida, to'liq kenglikdagi qatorda) */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 mb-4 sm:mb-5">
          <div className="min-w-0 sm:flex-1">
            <ReportTabs tabs={tabs} value={tab} onChange={setTab} />
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            {canSettings && (
              <button
                onClick={() => setShowSettings(true)}
                className="shrink-0 h-12 px-3.5 rounded-xl bg-surface border border-border hover:border-primary font-semibold"
                title="Sozlamalar"
                aria-label="Restoran sozlamalari"
                data-testid="director-settings"
              >
                ⚙️
              </button>
            )}
            <BackButton className="shrink-0" />
          </div>
        </div>

        {tab === 'overview' && (
          <>
            <div className="mb-4 sm:mb-5">{periodChips}</div>
            {/* Asosiy ko'rsatkichlar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
              <StatCard label={t('director.revenue')} value={formatSum(summary?.revenue ?? 0)} accent />
              <StatCard label={t('director.ordersCount')} value={String(summary?.ordersCount ?? 0)} />
              <StatCard label={t('director.avgCheck')} value={formatSum(summary?.avgCheck ?? 0)} />
            </div>

            {/* Buyurtma turlari: stolga / olib ketish / yetkazib berish */}
            <OrderTypeBreakdown data={summary?.byOrderType} className="mb-4 sm:mb-6 animate-card-in" />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              {/* To'lov turlari (sozlamadagi nomlar bilan: Naqd, Terminal, Click, Payme, Qarzga…) */}
              <Panel title={t('director.byPayment')}>
                {payments.length > 0 ? (
                  payments.map((p) => (
                    <Bar
                      key={p.type}
                      label={p.label ?? paymentMethodLabel(pos.paymentMethods, p.type)}
                      value={formatSum(p.amount)}
                      percent={(p.amount / totalPay) * 100}
                      color={KIND_BAR[p.kind ?? ''] ?? 'bg-primary'}
                    />
                  ))
                ) : (
                  <Empty />
                )}
              </Panel>

              {/* Ofitsiantlar statistikasi */}
              <Panel title={t('director.byWaiter')}>
                {waiters.length > 0 ? (
                  waiters.map((w) => (
                    <Bar
                      key={w.waiterId ?? w.waiterName}
                      label={`${w.waiterName} · ${w.ordersCount} ta`}
                      value={formatSum(w.revenue)}
                      percent={(w.revenue / maxWaiter) * 100}
                      color="bg-info"
                    />
                  ))
                ) : (
                  <Empty />
                )}
              </Panel>

              {/* Eng ko'p sotilgan taomlar */}
              <Panel title={t('director.topItems')} wide>
                {topItems.length > 0 ? (
                  topItems.map((x) => (
                    <Bar
                      key={x.name}
                      label={`${x.name} · ${qty(x.quantity)} ta`}
                      value={formatSum(x.sum)}
                      percent={(x.quantity / maxTop) * 100}
                      color="bg-success"
                    />
                  ))
                ) : (
                  <Empty />
                )}
              </Panel>
            </div>
          </>
        )}

        {tab === 'waiters' && <WaiterShareReport />}

        {tab === 'cash' && <CashSummaryCard refreshKey={cashTick} />}

        {tab === 'debts' && <DebtsPanel onChanged={() => setCashTick((n) => n + 1)} />}

        {tab === 'items' && (
          <>
            <div className="mb-4 sm:mb-5">{periodChips}</div>
            {customValid(rr) && <ItemsReport range={voidRange} />}
          </>
        )}

        {tab === 'voids' && (
          <>
            <div className="mb-4 sm:mb-5">{periodChips}</div>
            <VoidsReport range={voidRange} />
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5 lift animate-card-in">
      <div className="text-muted text-sm">{label}</div>
      <div
        className={`text-2xl font-bold mt-1 ${accent ? 'text-primary' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`bg-surface border border-border rounded-2xl p-5 animate-card-in ${
        wide ? 'lg:col-span-2' : ''
      }`}
    >
      <div className="font-bold mb-4">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Bar({
  label,
  value,
  percent,
  color,
}: {
  label: string;
  value: string;
  percent: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted">{label}</span>
        <span className="font-semibold">{value}</span>
      </div>
      <div className="h-2.5 bg-bg rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-700 ease-out`}
          style={{ width: `${Math.max(4, percent)}%` }}
        />
      </div>
    </div>
  );
}

function Empty() {
  const { t } = useI18n();
  return <div className="text-muted text-sm">{t('common.noData')}</div>;
}
