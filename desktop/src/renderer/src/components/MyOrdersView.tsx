import { useEffect, useMemo, useState } from 'react';
import { ORDER_TYPES, ORDER_TYPE_LABELS, OrderStatus, OrderType, isOrderManager } from '@hardweb-pos/shared';
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
import { useDebounced } from './reports/useReportData';
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

/** Server tarix filtri: yopilmagan buyurtmalar (qabul qilindi / tayyorlanmoqda / tayyor) */
const OPEN_STATUS = 'open';

/** Ofitsiant holat kartalari uchun sonlar (server hisoblaydi — yuklangan sahifalar emas) */
interface StatusCounts {
  open: number;
  /** yopilganlar, vozvrat qilinganlari bilan (ro'yxatda "↩ Qaytarilgan" bo'lib turadi) */
  closed: number;
  refunded: number;
}

type HistoryPage = { total?: number; summary?: OrdersSummary };

// O'z buyurtmalari — alohida sahifa: tur/holat filtrlari + infinite scroll.
// Ofitsiant (restoran talabi): pul haqida HECH NARSA (ulush, tushum, chek summasi, narxlar, to'lov
// turi) ko'rsatilmaydi va faqat BUGUNGI buyurtmalar (server ham faqat bugungisini beradi). Yuqorida —
// Jami / Ochiq / Yopilgan kartalari (sonlar), bosilsa ro'yxat shu holat bo'yicha.
// Kassir / administrator / direktor (o'z POS ekranida) — summalar, davr va to'lov turi tanlovi bilan.
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
  // Kassa darajasidagi xodim emas — ofitsiant: pulsiz va faqat bugun
  const waiterView = !isOrderManager(user);
  // To'lov usullari sozlamadan (Naqd, Terminal, Click, Payme, Qarzga, maxsus…) — B30
  const { paymentMethods, waiterSharePercent } = usePosSettings();
  // Bugungi ulush (B20): "Bugun: N ta hisob · ulushingiz X so‘m" — faqat ulush foizi qo'yilgan bo'lsa.
  // Server faqat o'z ma'lumotini beradi (my-share) — boshqa ofitsiant nomidan ko'rilmaydi; xato bo'lsa jim.
  const [share, setShare] = useState<MyShare | null>(null);
  const ownView = !!user && user.id === waiterId;
  useEffect(() => {
    if (waiterView || !ownView || !(waiterSharePercent > 0)) {
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
  }, [ownView, waiterSharePercent, waiterView]);
  const [preset, setPreset] = useState<DatePreset>('today');
  const [type, setType] = useState<OrderType | ''>('');
  const [status, setStatus] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [search, setSearch] = useState('');
  // Har harfda emas — yozib bo'lgach so'raymiz
  const searchQuery = useDebounced(search.trim(), 300);

  // Kun almashsa "Bugun" yangi kunga o'tsin (ekran tun bo'yi ochiq turishi mumkin)
  const [day, setDay] = useState(todayKey);
  useEffect(() => {
    const id = window.setInterval(() => setDay((d) => (d === todayKey() ? d : todayKey())), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const filters: HistoryFilters = useMemo(() => {
    const { from, to } = presetRange(waiterView ? 'today' : preset);
    return {
      waiterId,
      type: type || undefined,
      status: status || undefined,
      paymentType: waiterView ? undefined : paymentType || undefined,
      search: searchQuery || undefined,
      from,
      to,
    };
    // day — kun almashganda davrni qayta hisoblash uchun
  }, [waiterId, preset, type, status, paymentType, searchQuery, day, waiterView]); // eslint-disable-line react-hooks/exhaustive-deps

  const { items, total, hasMore, loading, error, loadMore, reload } = useInfiniteOrders(filters, 20);
  const sentinelRef = useScrollSentinel(loadMore, hasMore && !loading);

  // Kartalar — server hisoblaydi (yuklangan sahifalar emas), holat filtridan tashqari shu filtrlar bilan:
  //  - kassada: Tushum — YOPILGAN (to'langan) cheklar summasi, vozvrat qilinganlarsiz (ochiq hisob kirmaydi);
  //  - ofitsiantda: faqat sonlar — ochiq va yopilgan buyurtmalar (Jami = ikkisi).
  const statsKey = JSON.stringify({ ...filters, status: undefined });
  const [revenue, setRevenue] = useState<number | null>(null);
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [statsError, setStatsError] = useState(false);
  useEffect(() => {
    let alive = true;
    setStatsError(false);
    const pageOf = (s: string) => api.get<HistoryPage>(`/orders/history?${historyQuery({ ...filters, status: s }, 1, 1)}`);
    const job = waiterView
      ? Promise.all([pageOf(OPEN_STATUS), pageOf(OrderStatus.Closed)]).then(([open, closed]) => {
          if (!alive) return;
          setCounts({ open: open.total ?? 0, closed: closed.total ?? 0, refunded: closed.summary?.refundedCount ?? 0 });
        })
      : pageOf(OrderStatus.Closed).then((r) => {
          if (!alive) return;
          const sm = r.summary;
          setRevenue(sm ? Math.max(0, sm.total - sm.refundedTotal) : null);
        });
    job.catch(() => {
      if (!alive) return;
      setRevenue(null);
      setCounts(null);
      setStatsError(true);
    });
    return () => {
      alive = false;
    };
  }, [statsKey, waiterView]); // eslint-disable-line react-hooks/exhaustive-deps

  const PRESETS: { key: DatePreset; label: string }[] = [
    { key: 'today', label: t('filter.today') },
    { key: 'week', label: t('filter.week') },
    { key: 'month', label: t('filter.month') },
    { key: 'all', label: t('common.all') },
  ];

  // Ofitsiant: holat kartalari (bosilsa — ro'yxat shu holat bo'yicha)
  const statusCards: { key: string; label: string; value: number | null; tone: string; testId: string; note?: string }[] = [
    { key: '', label: t('common.total'), value: counts ? counts.open + counts.closed : null, tone: 'text-text', testId: 'my-total' },
    { key: OPEN_STATUS, label: 'Ochiq', value: counts ? counts.open : null, tone: 'text-warning', testId: 'my-open' },
    {
      key: OrderStatus.Closed,
      label: 'Yopilgan',
      value: counts ? counts.closed : null,
      tone: 'text-success',
      testId: 'my-closed',
      note: counts && counts.refunded > 0 ? `${counts.refunded} tasi qaytarilgan` : undefined,
    },
  ];

  const chip = (on: boolean) =>
    `min-h-[40px] px-3.5 py-2 rounded-lg text-sm font-semibold border transition-colors flex items-center gap-1.5 ${
      on ? 'bg-primary-hover text-white border-primary-hover' : 'border-border text-muted hover:border-primary hover:text-text'
    }`;

  const searchInput = (
    <input
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      // Server taom nomi, kunlik raqam (#12), telefon va stol raqami bo'yicha qidiradi
      placeholder="Taom, #raqam, telefon yoki stol..."
      className="w-full px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary"
    />
  );

  const noFilters = !type && !status && !searchQuery;

  return (
    <div className="h-full overflow-auto p-3 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-xl font-bold">
          🧾 {t('waiter.myOrders')}
          {waiterView && (
            <span className="ml-2 text-base font-semibold text-muted">· {t('filter.today').toLowerCase()}</span>
          )}
        </div>
        <Button variant="ghost" className="shrink-0" onClick={onBack}>
          ← {t('common.back')}
        </Button>
      </div>

      {/* Bugungi ulush (ofitsiantlar hisobotidagi qoida bilan) — kassa darajasidagi xodimga */}
      {!waiterView && share && (
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
      {waiterView ? (
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4" role="group" aria-label={t('filter.status')}>
          {statusCards.map((c) => {
            const on = status === c.key;
            return (
              <button
                key={c.testId}
                type="button"
                data-testid={c.testId}
                aria-pressed={on}
                onClick={() => setStatus(c.key)}
                className={`text-left bg-surface rounded-2xl p-3 sm:p-4 border-2 transition-colors ${
                  on ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                }`}
              >
                <div className="text-sm text-muted">{c.label}</div>
                <div className={`text-2xl font-extrabold tabular-nums ${c.tone}`}>
                  {c.value !== null ? `${c.value} ta` : statsError ? '—' : '…'}
                </div>
                {c.note && <div className="text-xs text-muted mt-0.5">{c.note}</div>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div className="bg-surface border border-border rounded-2xl p-4" data-testid="my-total">
            <div className="text-sm text-muted">{t('common.total')}</div>
            <div className="text-2xl font-extrabold tabular-nums">{total} ta</div>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-4" data-testid="my-revenue">
            <div className="text-sm text-muted">{t('director.revenue')} · to‘langan cheklar</div>
            <div className="text-2xl font-extrabold text-primary tabular-nums">
              {revenue !== null ? formatSum(revenue) : statsError ? '—' : '…'}
            </div>
          </div>
        </div>
      )}

      {/* Filtrlar */}
      <div className="bg-surface border border-border rounded-2xl p-3 sm:p-4 mb-4">
        {!waiterView && (
          <div className="flex flex-wrap gap-2 mb-3">
            {PRESETS.map((p) => (
              <button key={p.key} onClick={() => setPreset(p.key)} className={chip(preset === p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        )}
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
        {waiterView ? (
          // Ofitsiantda holat — yuqoridagi kartalar, to'lov turi — yo'q (pul haqida ma'lumot)
          searchInput
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {searchInput}
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
        )}
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
          !error && (
            <div className="text-center text-muted py-16">
              {waiterView && noFilters ? 'Bugun hali buyurtmangiz yo‘q' : t('common.noData')}
            </div>
          )
        ) : (
          <>
            <OrderHistory orders={items} hideMoney={waiterView} />
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
