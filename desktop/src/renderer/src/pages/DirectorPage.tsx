import { useCallback, useEffect, useState } from 'react';
import {
  PaymentType,
  ReportPeriod,
  ReportSummary,
  SOCKET_EVENTS,
  TopItem,
  WaiterStat,
} from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { formatSum } from '../components/ui';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';

const PERIODS: { key: ReportPeriod; label: string }[] = [
  { key: 'day', label: 'Bugun' },
  { key: 'week', label: '7 kun' },
  { key: 'month', label: '30 kun' },
];

const PAYMENT_LABEL: Record<PaymentType, string> = {
  [PaymentType.Cash]: 'Naqd',
  [PaymentType.Card]: 'Karta',
  [PaymentType.QR]: 'QR',
};

// Direktor hisobotlari (TZ 5.5) — lokal serverdan, deyarli jonli
export function DirectorPage() {
  const [period, setPeriod] = useState<ReportPeriod>('day');
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [waiters, setWaiters] = useState<WaiterStat[]>([]);

  const load = useCallback(async (p: ReportPeriod) => {
    const [s, t, w] = await Promise.all([
      api.get<ReportSummary>(`/reports/summary?period=${p}`),
      api.get<TopItem[]>(`/reports/top-items?period=${p}`),
      api.get<WaiterStat[]>(`/reports/waiters?period=${p}`),
    ]);
    setSummary(s);
    setTopItems(t);
    setWaiters(w);
  }, []);

  useEffect(() => {
    load(period).catch(() => {});
    // Hisob yopilganda hisobotni yangilash (deyarli jonli — TZ F-5.6)
    const socket = getSocket();
    const onClosed = () => load(period).catch(() => {});
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, onClosed);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, onClosed);
    };
  }, [period, load]);

  const maxTop = Math.max(1, ...topItems.map((t) => t.quantity));
  const maxWaiter = Math.max(1, ...waiters.map((w) => w.revenue));
  const totalPay = Math.max(
    1,
    summary?.paymentBreakdown.reduce((s, p) => s + p.amount, 0) ?? 1,
  );

  return (
    <AppShell title="Direktor — hisobotlar">
      <div className="h-full overflow-auto p-6">
        {/* Davr tanlash */}
        <div className="flex gap-2 mb-6">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-5 py-2.5 rounded-lg font-semibold ${
                period === p.key
                  ? 'bg-primary text-white'
                  : 'bg-surface border border-border text-muted hover:text-text'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Asosiy ko'rsatkichlar */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard label="Tushum" value={formatSum(summary?.revenue ?? 0)} accent />
          <StatCard label="Hisoblar soni" value={String(summary?.ordersCount ?? 0)} />
          <StatCard label="O‘rtacha chek" value={formatSum(summary?.avgCheck ?? 0)} />
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* To'lov turlari */}
          <Panel title="To‘lov turlari bo‘yicha">
            {summary && summary.paymentBreakdown.length > 0 ? (
              summary.paymentBreakdown.map((p) => (
                <Bar
                  key={p.type}
                  label={PAYMENT_LABEL[p.type]}
                  value={formatSum(p.amount)}
                  percent={(p.amount / totalPay) * 100}
                  color="bg-primary"
                />
              ))
            ) : (
              <Empty />
            )}
          </Panel>

          {/* Ofitsiantlar statistikasi */}
          <Panel title="Ofitsiantlar bo‘yicha">
            {waiters.length > 0 ? (
              waiters.map((w) => (
                <Bar
                  key={w.waiterName}
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
          <Panel title="Eng ko‘p sotilgan taomlar" wide>
            {topItems.length > 0 ? (
              topItems.map((t) => (
                <Bar
                  key={t.name}
                  label={`${t.name} · ${t.quantity} ta`}
                  value={formatSum(t.sum)}
                  percent={(t.quantity / maxTop) * 100}
                  color="bg-success"
                />
              ))
            ) : (
              <Empty />
            )}
          </Panel>
        </div>
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
    <div className="bg-surface border border-border rounded-xl p-5">
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
      className={`bg-surface border border-border rounded-xl p-5 ${
        wide ? 'col-span-2' : ''
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
          className={`h-full ${color} rounded-full`}
          style={{ width: `${Math.max(4, percent)}%` }}
        />
      </div>
    </div>
  );
}

function Empty() {
  return <div className="text-muted text-sm">Ma‘lumot yo‘q</div>;
}
