import { useEffect, useMemo, useState } from 'react';
import { ORDER_TYPES, ORDER_TYPE_LABELS, OrderStatus, OrderType } from '@hardweb-pos/shared';
import type { MyShare } from '@hardweb-pos/shared';
import { usePosSettings } from '../lib/posSettings';
import { api } from '../lib/api';
import { useAuth } from '../state/auth';
import { Button, formatSum } from './ui';
import { Select } from './Select';
import { OrderHistory } from './OrderHistory';
import { useI18n } from '../state/i18n';
import {
  OrderFilters,
  OrdersSummary,
  historyQuery,
  useInfiniteOrders,
  useScrollSentinel,
} from '../hooks/useInfiniteOrders';
import { shiftDays, todayKey } from './reports/reportUtils';
import { ORDER_TYPE_ICON } from './waiter/orderUi';

type DatePreset = 'all' | 'today' | 'week' | 'month';

/**
 * Davr -> mahalliy sanalar (server ?from=&to= — yopilgan vaqt bo'yicha, ochiq hisobda — ochilgan).
 * "Bugun" kun oxirigacha: ekran ochiq turganda yopilgan yangi cheklar ham kiradi.
 */
function presetRange(p: DatePreset): { from?: string; to?: string } {
  if (p === 'all') return {};
  const today = todayKey();
  if (p === 'week') return { from: shiftDays(today, -6), to: today };
  if (p === 'month') return { from: shiftDays(today, -29), to: today };
  return { from: today, to: today };
}

// Turi bo'yicha filtr (B7: GET /orders/history?type=) — OrderFilters'ga qo'shimcha maydon
type HistoryFilters = OrderFilters & { type?: string };

// Ofitsiantning o'z buyurtmalari — alohida sahifa: kun/tur/holat/to'lov filtrlari + infinite scroll
export function MyOrdersView({
  waiterId,
  onBack,
}: {
  waiterId: string;
  waiterName: string;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  // To'lov usullari sozlamadan (Naqd, Terminal, Click, Payme, Qarzga, maxsus…) — B30
  const { paymentMethods, waiterSharePercent } = usePosSettings();
  // Bugungi ulush (B20): "Bugun: N ta hisob · ulushingiz X so‘m" — faqat ulush foizi qo'yilgan bo'lsa.
  // Server faqat o'z ma'lumotini beradi (my-share) — boshqa ofitsiant nomidan ko'rilmaydi; xato bo'lsa jim.
  const [share, setShare] = useState<MyShare | null>(null);
  const ownView = !!user && user.id === waiterId;
  useEffect(() => {
    if (!ownView || !(waiterSharePercent > 0)) {
      setShare(null);
      return;
    }
    let alive = true;
    api
      .get<MyShare>('/reports/my-share')
      .then((r) => {
        if (alive) setShare(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ownView, waiterSharePercent]);
  const [preset, setPreset] = useState<DatePreset>('today');
  const [type, setType] = useState<OrderType | ''>('');
  const [status, setStatus] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [search, setSearch] = useState('');

  // Kun almashsa "Bugun" yangi kunga o'tsin (ekran tun bo'yi ochiq turishi mumkin)
  const [day, setDay] = useState(todayKey);
  useEffect(() => {
    const id = window.setInterval(() => setDay((d) => (d === todayKey() ? d : todayKey())), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const filters: HistoryFilters = useMemo(() => {
    const { from, to } = presetRange(preset);
    return {
      waiterId,
      type: type || undefined,
      status: status || undefined,
      paymentType: paymentType || undefined,
      search: search.trim() || undefined,
      from,
      to,
    };
    // day — kun almashganda davrni qayta hisoblash uchun
  }, [waiterId, preset, type, status, paymentType, search, day]); // eslint-disable-line react-hooks/exhaustive-deps

  const { items, total, hasMore, loading, error, loadMore, reload } = useInfiniteOrders(filters, 20);
  const sentinelRef = useScrollSentinel(loadMore, hasMore && !loading);

  // Tushum — server hisoblaydi (yuklangan sahifalar emas): shu filtrdagi YOPILGAN (to'langan) cheklar
  // summasi, vozvrat qilinganlarsiz. Ochiq (hali to'lanmagan) hisoblar tushumga kirmaydi.
  const revenueKey = JSON.stringify({ ...filters, status: OrderStatus.Closed });
  const [revenue, setRevenue] = useState<number | null>(null);
  const [revenueError, setRevenueError] = useState(false);
  useEffect(() => {
    let alive = true;
    setRevenueError(false);
    api
      .get<{ summary?: OrdersSummary }>(`/orders/history?${historyQuery({ ...filters, status: OrderStatus.Closed }, 1, 1)}`)
      .then((r) => {
        if (!alive) return;
        const sm = r.summary;
        setRevenue(sm ? Math.max(0, sm.total - sm.refundedTotal) : null);
      })
      .catch(() => {
        if (!alive) return;
        setRevenue(null);
        setRevenueError(true);
      });
    return () => {
      alive = false;
    };
  }, [revenueKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const PRESETS: { key: DatePreset; label: string }[] = [
    { key: 'today', label: t('filter.today') },
    { key: 'week', label: t('filter.week') },
    { key: 'month', label: t('filter.month') },
    { key: 'all', label: t('common.all') },
  ];

  const chip = (on: boolean) =>
    `min-h-[40px] px-3.5 py-2 rounded-lg text-sm font-semibold border transition-colors flex items-center gap-1.5 ${
      on ? 'bg-primary-hover text-white border-primary-hover' : 'border-border text-muted hover:border-primary hover:text-text'
    }`;

  return (
    <div className="h-full overflow-auto p-3 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-xl font-bold">🧾 {t('waiter.myOrders')}</div>
        <Button variant="ghost" className="shrink-0" onClick={onBack}>
          ← {t('common.back')}
        </Button>
      </div>

      {/* Bugungi ulush (ofitsiantlar hisobotidagi qoida bilan) */}
      {share && (
        <div
          data-testid="my-share"
          className="mb-4 rounded-2xl border-2 border-primary/50 bg-primary/10 px-4 py-3 flex items-center gap-3 flex-wrap"
        >
          <span className="text-[15px] font-bold text-text">
            Bugun: <span className="tabular-nums">{share.ordersCount}</span> ta hisob
          </span>
          <span className="text-muted">·</span>
          <span className="text-[15px] font-bold text-text">
            ulushingiz{' '}
            <span className="text-xl font-extrabold text-primary tabular-nums">{formatSum(share.shareAmount)}</span>
          </span>
          <span className="text-xs text-muted ml-auto">
            stolga buyurtmalar {formatSum(share.dineInSales)} × {share.sharePercent}%
          </span>
        </div>
      )}

      {/* Statistika kartalari */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-surface border border-border rounded-2xl p-4">
          <div className="text-sm text-muted">{t('common.total')}</div>
          <div className="text-2xl font-extrabold">{total} ta</div>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-4" data-testid="my-revenue">
          <div className="text-sm text-muted">{t('director.revenue')} · to‘langan cheklar</div>
          <div className="text-2xl font-extrabold text-primary tabular-nums">
            {revenue !== null ? formatSum(revenue) : revenueError ? '—' : '…'}
          </div>
        </div>
      </div>

      {/* Filtrlar */}
      <div className="bg-surface border border-border rounded-2xl p-3 sm:p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => setPreset(p.key)} className={chip(preset === p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        {/* Buyurtma turi */}
        <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Buyurtma turi">
          <button onClick={() => setType('')} className={chip(type === '')} data-testid="history-type-all">
            Barcha turlar
          </button>
          {ORDER_TYPES.map((ot) => {
            const Icon = ORDER_TYPE_ICON[ot];
            return (
              <button
                key={ot}
                onClick={() => setType(ot)}
                className={chip(type === ot)}
                data-testid={`history-type-${ot}`}
                aria-pressed={type === ot}
              >
                <Icon className="w-4 h-4" />
                {ORDER_TYPE_LABELS[ot]}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // Server taom nomi, kunlik raqam (#12), telefon va stol raqami bo'yicha qidiradi
            placeholder="Taom, #raqam, telefon yoki stol..."
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
              ...paymentMethods.map((m) => ({ value: m.key, label: m.label })),
            ]}
          />
        </div>
      </div>

      {/* Ro'yxat */}
      <div className="bg-surface border border-border rounded-2xl p-3 sm:p-4">
        {error && (
          <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-danger/50 bg-danger/10 px-4 py-3">
            <span className="flex-1 min-w-[200px] text-sm font-semibold text-text">⚠️ {error}</span>
            <Button variant="ghost" className="shrink-0" onClick={() => void reload()}>
              Qayta urinish
            </Button>
          </div>
        )}
        {items.length === 0 && !loading ? (
          !error && <div className="text-center text-muted py-16">{t('common.noData')}</div>
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
