import { useEffect, useMemo, useState } from 'react';
import { OrderStatus, PaymentType, Table, User, hasCapability } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Select } from '../../components/Select';
import { OrderHistory } from '../../components/OrderHistory';
import { api } from '../../lib/api';
import { useI18n } from '../../state/i18n';
import { useAuth } from '../../state/auth';
import {
  OrderFilters,
  useInfiniteOrders,
  useScrollSentinel,
} from '../../hooks/useInfiniteOrders';

type DatePreset = 'all' | 'today' | 'week' | 'month';

// Preset -> ISO sana oralig'i
function presetRange(p: DatePreset): { dateFrom?: string; dateTo?: string } {
  if (p === 'all') return {};
  const now = new Date();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (p === 'week') from.setDate(from.getDate() - 6);
  if (p === 'month') from.setDate(from.getDate() - 29);
  return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
}

// Cheklar / buyurtmalar tarixi — server-side pagination (20/sahifa) + infinite scroll + filtrlar
export function ReceiptsTab() {
  const { t } = useI18n();
  const { user } = useAuth();
  const canRefund = hasCapability(user, 'refund');
  const [preset, setPreset] = useState<DatePreset>('all');
  const [waiterId, setWaiterId] = useState('');
  const [hall, setHall] = useState('');
  const [status, setStatus] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [search, setSearch] = useState('');

  const [waiters, setWaiters] = useState<User[]>([]);
  const [halls, setHalls] = useState<string[]>([]);

  useEffect(() => {
    api.get<User[]>('/users/waiters').then(setWaiters).catch(() => {});
    api
      .get<Table[]>('/tables')
      .then((ts) => setHalls(Array.from(new Set(ts.map((x) => x.hall)))))
      .catch(() => {});
  }, []);

  const filters: OrderFilters = useMemo(() => {
    const { dateFrom, dateTo } = presetRange(preset);
    return {
      waiterId: waiterId || undefined,
      hall: hall || undefined,
      status: status || undefined,
      paymentType: paymentType || undefined,
      search: search.trim() || undefined,
      dateFrom,
      dateTo,
    };
  }, [preset, waiterId, hall, status, paymentType, search]);

  const { items, total, hasMore, loading, loadMore, reload } =
    useInfiniteOrders(filters, 20);
  const sentinelRef = useScrollSentinel(loadMore, hasMore && !loading);

  // Vozvrat (Direktor/Admin) — sabab bilan, keyin ro'yxatni yangilaymiz
  async function refund(order: { id: string }, reason: string) {
    await api.post(`/orders/${order.id}/refund`, { reason });
    reload();
  }

  function clear() {
    setPreset('all');
    setWaiterId('');
    setHall('');
    setStatus('');
    setPaymentType('');
    setSearch('');
  }
  const active =
    preset !== 'all' || waiterId || hall || status || paymentType || search;

  const PRESETS: { key: DatePreset; label: string }[] = [
    { key: 'all', label: t('common.all') },
    { key: 'today', label: t('filter.today') },
    { key: 'week', label: t('filter.week') },
    { key: 'month', label: t('filter.month') },
  ];

  return (
    <div className="w-full">
      {/* Filtrlar */}
      <div className="bg-surface border border-border rounded-2xl p-4 mb-4">
        {/* Sana presetlari */}
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                preset === p.key
                  ? 'bg-primary text-white border-primary'
                  : 'border-border text-muted hover:border-primary hover:text-text'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`${t('filter.hall')} №...`}
            className="px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />
          <Select
            value={waiterId}
            onChange={setWaiterId}
            options={[
              { value: '', label: `${t('common.all')} — ${t('filter.waiter')}` },
              ...waiters.map((w) => ({ value: w.id, label: w.name })),
            ]}
          />
          <Select
            value={hall}
            onChange={setHall}
            options={[
              { value: '', label: `${t('common.all')} — ${t('filter.hall')}` },
              ...halls.map((h) => ({ value: h, label: h })),
            ]}
          />
          <Select
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: `${t('common.all')} — ${t('filter.status')}` },
              { value: OrderStatus.Accepted, label: t('status.qabul_qilindi') },
              { value: OrderStatus.Cooking, label: t('status.tayyorlanmoqda') },
              { value: OrderStatus.Ready, label: t('status.tayyor') },
              { value: OrderStatus.Closed, label: t('status.yopildi') },
            ]}
          />
          <Select
            value={paymentType}
            onChange={setPaymentType}
            options={[
              { value: '', label: `${t('common.all')} — ${t('filter.payType')}` },
              { value: PaymentType.Cash, label: t('pay.naqd') },
              { value: PaymentType.Card, label: t('pay.karta') },
              { value: PaymentType.QR, label: t('pay.qr') },
            ]}
          />
        </div>
        <div className="flex items-center justify-between mt-3">
          <div className="text-sm text-muted">
            {total} ta buyurtma{loading ? ' · yuklanmoqda...' : ''}
          </div>
          <div className="flex gap-2">
            {active && (
              <Button variant="ghost" onClick={clear}>
                {t('common.cancel')} filtr
              </Button>
            )}
            <Button variant="ghost" onClick={reload}>
              {t('common.loading').replace('...', '')}
            </Button>
          </div>
        </div>
      </div>

      {/* Ro'yxat — infinite scroll (parent konteyner skroll qiladi) */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        {items.length === 0 && !loading ? (
          <div className="text-center text-muted py-16">{t('common.noData')}</div>
        ) : (
          <>
            <OrderHistory orders={items} onRefund={canRefund ? refund : undefined} />
            {/* Sentinel — ko'ringanda keyingi sahifa yuklanadi */}
            <div ref={sentinelRef} className="h-8" />
            {loading && (
              <div className="text-center text-muted text-sm py-3">
                {t('common.loading')}
              </div>
            )}
            {!hasMore && items.length > 0 && (
              <div className="text-center text-muted/60 text-xs py-3">
                — {total} ta buyurtma —
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
