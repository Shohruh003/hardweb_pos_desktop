import { useMemo, useState } from 'react';
import { OrderStatus, PaymentType } from '@hardweb-pos/shared';
import { Button, formatSum } from './ui';
import { Select } from './Select';
import { OrderHistory } from './OrderHistory';
import { useI18n } from '../state/i18n';
import {
  OrderFilters,
  useInfiniteOrders,
  useScrollSentinel,
} from '../hooks/useInfiniteOrders';

type DatePreset = 'all' | 'today' | 'week' | 'month';

function presetRange(p: DatePreset): { dateFrom?: string; dateTo?: string } {
  if (p === 'all') return {};
  const now = new Date();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (p === 'week') from.setDate(from.getDate() - 6);
  if (p === 'month') from.setDate(from.getDate() - 29);
  return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
}

// Ofitsiantning o'z buyurtmalari — alohida sahifa: kun/holat/to'lov filtrlari + infinite scroll
export function MyOrdersView({
  waiterId,
  onBack,
}: {
  waiterId: string;
  waiterName: string;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [preset, setPreset] = useState<DatePreset>('today');
  const [status, setStatus] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [search, setSearch] = useState('');

  const filters: OrderFilters = useMemo(() => {
    const { dateFrom, dateTo } = presetRange(preset);
    return {
      waiterId,
      status: status || undefined,
      paymentType: paymentType || undefined,
      search: search.trim() || undefined,
      dateFrom,
      dateTo,
    };
  }, [waiterId, preset, status, paymentType, search]);

  const { items, total, hasMore, loading, loadMore } = useInfiniteOrders(
    filters,
    20,
  );
  const sentinelRef = useScrollSentinel(loadMore, hasMore && !loading);

  // Jami tushum (yuklangan buyurtmalar bo'yicha)
  const sum = items.reduce((s, o) => s + (o.total ?? 0), 0);

  const PRESETS: { key: DatePreset; label: string }[] = [
    { key: 'today', label: t('filter.today') },
    { key: 'week', label: t('filter.week') },
    { key: 'month', label: t('filter.month') },
    { key: 'all', label: t('common.all') },
  ];

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" onClick={onBack}>
          ← {t('common.back')}
        </Button>
        <div className="text-xl font-bold">🧾 {t('waiter.myOrders')}</div>
      </div>

      {/* Statistika kartalari */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-surface border border-border rounded-2xl p-4">
          <div className="text-sm text-muted">{t('common.total')}</div>
          <div className="text-2xl font-extrabold">{total} ta</div>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-4">
          <div className="text-sm text-muted">{t('director.revenue')}</div>
          <div className="text-2xl font-extrabold text-primary">
            {formatSum(sum)}
          </div>
        </div>
      </div>

      {/* Filtrlar */}
      <div className="bg-surface border border-border rounded-2xl p-4 mb-4">
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
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`${t('filter.hall')} №...`}
            className="px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary"
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
      </div>

      {/* Ro'yxat */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        {items.length === 0 && !loading ? (
          <div className="text-center text-muted py-16">{t('common.noData')}</div>
        ) : (
          <>
            <OrderHistory orders={items} />
            <div ref={sentinelRef} className="h-8" />
            {loading && (
              <div className="text-center text-muted text-sm py-3">
                {t('common.loading')}
              </div>
            )}
            {!hasMore && items.length > 0 && (
              <div className="text-center text-muted/60 text-xs py-3">
                — {total} ta —
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
