// Cheklar tarixi (B25) — YAGONA komponent: admin "Cheklar" bo'limi va kassadagi "Cheklar" tugmasi
// (ReceiptsTab orqali) shuni ishlatadi. Filtrlar: sana oralig'i (Bugun / Kecha / Hafta / Oy / Sana +
// ixtiyoriy vaqt), buyurtma turi, holat (hammasi / yopilgan / ochiq / vozvrat), ofitsiant, kassir, to'lov
// turi, zal, stol, summa oralig'i, qidiruv (taom, #raqam, telefon). Natija: "N ta chek — X so‘m",
// cheksiz aylantirish (30 tadan), qatorni bossangiz — chek tafsiloti (qatorlar, saboy, xizmat bazasi,
// chegirma, yetkazish narxi, to'lovlar, kim/qachon, otkazlar) + "Qayta chop etish" + "Vozvrat".
//
// Shu fayl eski oddiy ro'yxatni ham beradi (OrderHistory) — KDS "Tarix" va ofitsiantning
// "Mening buyurtmalarim" ekranlari uchun.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MenuUnit,
  ORDER_TYPES,
  ORDER_TYPE_LABELS,
  Order,
  OrderItem,
  OrderStatus,
  OrderType,
  calcOrderTotals,
  hasCapability,
  lineSum,
  orderDisplayName,
  orderTypeOf,
  paymentMethodLabel,
  roundSum,
} from '@hardweb-pos/shared';
import type { Receipt, Table, User, VoidReport } from '@hardweb-pos/shared';
import { StatusBadge, formatSum, formatDateTime, formatTime } from './ui';
import { Modal } from './Modal';
import { Select } from './Select';
import { formatQty } from './numeric';
import { api } from '../lib/api';
import { sortHalls, usePosSettings } from '../lib/posSettings';
import { useAuth } from '../state/auth';
import { Sheet, SheetError, Spinner } from './waiter/Sheet';
import { IconPrinter, IconSearch, IconUndo } from './waiter/icons';
import { ORDER_TYPE_ICON, ORDER_TYPE_TONE, OrderTypeBadge, dailyNumberLabel, phoneLabel } from './waiter/orderUi';
import { useDebounced } from './reports/useReportData';
import { canSeeVoids, dateKey, dmHm, dmyHm, hm, isAdminRole, num, qty, shiftDays, todayKey } from './reports/reportUtils';

// =================================================================================================
// Umumiy yordamchilar
// =================================================================================================

/** Pul qatorlari (saboy belgisi bilan — saboy qatorlariga xizmat haqi olinmaydi) */
function moneyLinesOf(o: Pick<Order, 'items'>) {
  return (o.items ?? []).map((it) => ({ price: it.price ?? 0, quantity: it.quantity, takeaway: !!it.takeaway }));
}

/**
 * Chek summalari (shared/money — server bilan bir xil, butun so'm): total — mijoz to'laydigan/to'lagan
 * summa (chegirma, xizmat haqi va yetkazishda — yetkazish narxi bilan), subtotal — qatorlar yig'indisi.
 */
export function orderCheckTotals(o: Order) {
  const fee = orderTypeOf(o) === OrderType.Delivery ? o.deliveryFee ?? 0 : 0;
  return calcOrderTotals(moneyLinesOf(o), o.discountPercent, o.servicePercent, fee);
}

/** To'lanadigan summa: server bergan total (B5), bo'lmasa qatorlardan */
function payable(o: Order): number {
  return typeof o.total === 'number' && Number.isFinite(o.total) ? roundSum(o.total) : orderCheckTotals(o).total;
}

/** Miqdor: kg taom — "1,25 kg", dona — "2×" */
const qtyLabel = (it: OrderItem) =>
  it.unit === MenuUnit.Weight ? `${formatQty(it.quantity)} kg` : `${formatQty(it.quantity)}×`;

/** Buyurtma nomi zal bilan: "Stol 5 · Zal" / "Olib ketish #12" */
function fullName(o: Order): string {
  const name = orderDisplayName(o);
  return orderTypeOf(o) === OrderType.DineIn && o.hall ? `${name} · ${o.hall}` : name;
}

// =================================================================================================
// Oddiy ro'yxat (KDS "Tarix", ofitsiantning "Mening buyurtmalarim")
// =================================================================================================

// Buyurtmalar tarixi ro'yxati + tafsilot oynasi. onRevert berilsa — "Tayyor" holatdagi buyurtmani
// ortga qaytarish tugmasi chiqadi (KDS uchun). onRefund — vozvrat ('refund' ruxsati).
export function OrderHistory({
  orders,
  onRevert,
  onRefund,
}: {
  orders: Order[];
  onRevert?: (order: Order) => Promise<void> | void;
  onRefund?: (order: Order, reason: string) => Promise<void> | void;
}) {
  const [sel, setSel] = useState<Order | null>(null);
  const [reverting, setReverting] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [actionError, setActionError] = useState('');

  function openDetails(o: Order) {
    setSel(o);
    setRefundOpen(false);
    setRefundReason('');
    setActionError('');
  }

  async function doRefund() {
    if (!sel || !onRefund || refunding) return;
    setRefunding(true);
    setActionError('');
    try {
      await onRefund(sel, refundReason.trim());
      setSel(null);
      setRefundOpen(false);
      setRefundReason('');
    } catch (e) {
      setActionError((e as Error)?.message || 'Vozvrat qilinmadi');
    } finally {
      setRefunding(false);
    }
  }

  async function doRevert() {
    if (!sel || !onRevert || reverting) return;
    setReverting(true);
    setActionError('');
    try {
      await onRevert(sel);
      setSel(null);
    } catch (e) {
      setActionError((e as Error)?.message || 'Qaytarilmadi');
    } finally {
      setReverting(false);
    }
  }

  if (orders.length === 0) {
    return <div className="text-muted text-center py-10">Tarix bo‘sh</div>;
  }

  const selTotals = sel ? orderCheckTotals(sel) : null;
  const selType = sel ? orderTypeOf(sel) : OrderType.DineIn;

  return (
    <>
      <div className="divide-y divide-border">
        {orders.map((o) => {
          const type = orderTypeOf(o);
          const Icon = ORDER_TYPE_ICON[type];
          return (
            <button
              key={o.id}
              onClick={() => openDetails(o)}
              className="w-full text-left flex items-center justify-between gap-3 px-2 py-3 rounded-lg hover:bg-surface-hover transition-colors"
            >
              <div className="min-w-0 flex items-start gap-3">
                <span
                  title={ORDER_TYPE_LABELS[type]}
                  className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${ORDER_TYPE_TONE[type].soft} ${ORDER_TYPE_TONE[type].text}`}
                >
                  <Icon className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-text">
                    {fullName(o)}
                    {dailyNumberLabel(o) && <span className="text-muted font-normal"> · {dailyNumberLabel(o)}</span>}
                    <span className="text-muted font-normal"> · {formatDateTime(o.openedAt)}</span>
                    {o.waiterName && <span className="text-muted font-normal"> · {o.waiterName}</span>}
                  </div>
                  {type === OrderType.Delivery && (o.phone || o.address) && (
                    <div className="text-sm text-text truncate">
                      {o.phone ? phoneLabel(o.phone) : ''}
                      {o.phone && o.address ? ' · ' : ''}
                      {o.address ?? ''}
                    </div>
                  )}
                  <div className="text-sm text-muted truncate">
                    {(o.items ?? []).map((i) => `${qtyLabel(i)} ${i.menuItemName}`).join(', ')}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                {o.refunded ? (
                  <span className="px-2 py-0.5 rounded-md bg-danger/15 text-danger text-xs font-bold">↩ Qaytarilgan</span>
                ) : (
                  <StatusBadge status={o.status} />
                )}
                <div className={`text-sm font-bold mt-1 ${o.refunded ? 'line-through text-muted' : 'text-text'}`}>
                  {formatSum(payable(o))}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {sel && selTotals && (
        <Modal title={`${fullName(sel)} — buyurtma`} onClose={() => setSel(null)}>
          <div className="space-y-1.5 text-sm mb-4">
            <div className="flex justify-between items-center">
              <span className="text-muted">Turi</span>
              <OrderTypeBadge type={selType} />
            </div>
            {selType === OrderType.Delivery && (
              <>
                <Row label="Telefon" value={sel.phone ? phoneLabel(sel.phone) : '—'} />
                <Row label="Manzil" value={sel.address || '—'} />
              </>
            )}
            {sel.customerName && <Row label="Mijoz" value={sel.customerName} />}
            <Row label="Ochilgan" value={formatDateTime(sel.openedAt)} />
            {sel.closedAt && <Row label="Yopilgan" value={formatDateTime(sel.closedAt)} />}
            {sel.waiterName && <Row label="Ofitsiant" value={sel.waiterName} />}
            {sel.note && <Row label="Izoh" value={sel.note} />}
          </div>

          <div className="bg-bg rounded-xl divide-y divide-border mb-4">
            {(sel.items ?? []).map((it) => (
              <div key={it.id} className="flex justify-between gap-3 px-3 py-2">
                <span>
                  <span className="text-primary font-semibold">{qtyLabel(it)}</span> {it.menuItemName}
                  {it.note && <span className="text-warning text-xs"> ({it.note})</span>}
                  {it.takeaway && <span className="ml-1 px-1.5 py-0.5 rounded bg-warning/15 text-warning text-[11px] font-bold">olib ketadi</span>}
                </span>
                <span className="font-semibold whitespace-nowrap">{formatSum(lineSum(it.price ?? 0, it.quantity))}</span>
              </div>
            ))}
          </div>

          {(selTotals.discountAmount > 0 || selTotals.serviceAmount > 0 || selTotals.deliveryFee > 0) && (
            <div className="space-y-1 text-sm mb-3 px-1">
              <Row label="Mahsulotlar" value={formatSum(selTotals.subtotal)} />
              {selTotals.discountAmount > 0 && (
                <Row label={`Chegirma (${selTotals.discountPercent}%)`} value={`− ${formatSum(selTotals.discountAmount)}`} />
              )}
              {selTotals.serviceAmount > 0 && (
                <Row label={`Xizmat haqi (${selTotals.servicePercent}%)`} value={`+ ${formatSum(selTotals.serviceAmount)}`} />
              )}
              {selTotals.deliveryFee > 0 && <Row label="Yetkazish narxi" value={`+ ${formatSum(selTotals.deliveryFee)}`} />}
            </div>
          )}

          <div className="flex items-center justify-between">
            <StatusBadge status={sel.status} />
            <div className="text-xl font-extrabold text-primary">{formatSum(payable(sel))}</div>
          </div>
          {sel.status !== OrderStatus.Closed && (
            <div className="text-xs text-muted mt-2 text-right">
              {sel.paidAmount && roundSum(sel.paidAmount) > 0
                ? `Qisman to‘langan: ${formatSum(roundSum(sel.paidAmount))}`
                : 'Hali to‘lanmagan'}
            </div>
          )}

          {actionError && (
            <div role="alert" className="mt-3 bg-danger/10 border border-danger/50 text-danger rounded-xl px-3 py-2 text-sm font-semibold">
              ⚠️ {actionError}
            </div>
          )}

          {/* Adashib "Tayyor" bosilgan bo'lsa — ortga qaytarish (faqat to'lanmagan) */}
          {onRevert && sel.status === OrderStatus.Ready && (
            <button
              onClick={doRevert}
              disabled={reverting}
              className="w-full mt-4 h-12 rounded-xl bg-warning/20 border border-warning/60 text-warning font-bold active:scale-[0.98] hover:bg-warning/30 transition-all disabled:opacity-60"
            >
              {reverting ? 'Qaytarilmoqda...' : '↩ Tayyorlanmoqdaga qaytarish'}
            </button>
          )}

          {sel.refunded && (
            <div className="mt-4 bg-danger/10 border border-danger/30 rounded-xl p-3 text-sm">
              <div className="font-bold text-danger">↩ Chek qaytarilgan (vozvrat)</div>
              {sel.refundReason && <div className="text-muted mt-1">Sabab: {sel.refundReason}</div>}
            </div>
          )}

          {onRefund && sel.status === OrderStatus.Closed && !sel.refunded && (
            <div className="mt-4">
              {!refundOpen ? (
                <button
                  onClick={() => setRefundOpen(true)}
                  className="w-full h-12 rounded-xl border border-danger/50 text-danger font-bold hover:bg-danger/10 transition-all"
                >
                  ↩ Vozvrat qilish
                </button>
              ) : (
                <div className="bg-bg border border-border rounded-xl p-3">
                  <div className="text-sm font-semibold mb-2">Vozvrat sababi (majburiy):</div>
                  <textarea
                    autoFocus
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    rows={2}
                    placeholder="Masalan: mijoz taomdan voz kechdi"
                    className="w-full px-3 py-2 rounded-lg bg-surface border border-border outline-none focus:border-primary text-sm"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => {
                        setRefundOpen(false);
                        setRefundReason('');
                      }}
                      className="flex-1 h-11 rounded-lg border border-border text-muted hover:text-text"
                    >
                      Bekor
                    </button>
                    <button
                      onClick={doRefund}
                      disabled={refunding || !refundReason.trim()}
                      className="flex-1 h-11 rounded-lg bg-danger text-white font-bold disabled:opacity-50 hover:brightness-110 transition-all"
                    >
                      {refunding ? 'Qaytarilmoqda...' : 'Tasdiqlash'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="text-xs text-muted mt-3 text-center">Buyurtma vaqti: {formatTime(sel.openedAt)}</div>
        </Modal>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted shrink-0">{label}</span>
      <span className="font-medium text-right break-words min-w-0">{value}</span>
    </div>
  );
}

// =================================================================================================
// To'liq cheklar tarixi (B25)
// =================================================================================================

type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom' | 'all';
type StatusFilter = 'all' | 'closed' | 'open' | 'refunded';

interface HistorySummary {
  count: number;
  total: number;
  refundedCount?: number;
  refundedTotal?: number;
}
interface HistoryPage {
  items: Order[];
  total: number;
  hasMore: boolean;
  summary?: HistorySummary;
}

const PAGE_SIZE = 30;

/** Tugmalar qatori: telefonda bitta qator (yon tomonga suriladi), kattaroq ekranda — qatorlarga o'raladi */
const CHIP_ROW = 'flex items-center gap-2 overflow-x-auto sm:overflow-visible sm:flex-wrap -mx-1 px-1 pb-0.5';

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Bugun' },
  { value: 'yesterday', label: 'Kecha' },
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Oy' },
  { value: 'custom', label: 'Sana…' },
  { value: 'all', label: 'Hammasi' },
];
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Hammasi' },
  { value: 'closed', label: 'Yopilgan' },
  { value: 'open', label: 'Ochiq' },
  { value: 'refunded', label: 'Vozvrat' },
];

interface Filters {
  preset: DatePreset;
  fromDate: string;
  toDate: string;
  fromTime: string;
  toTime: string;
  type: OrderType | '';
  status: StatusFilter;
  waiterId: string;
  cashierId: string;
  paymentType: string;
  hall: string;
  tableNumber: string;
  minTotal: string;
  maxTotal: string;
}

const initialFilters = (): Filters => ({
  preset: 'today',
  fromDate: todayKey(),
  toDate: todayKey(),
  fromTime: '',
  toTime: '',
  type: '',
  status: 'all',
  waiterId: '',
  cashierId: '',
  paymentType: '',
  hall: '',
  tableNumber: '',
  minTotal: '',
  maxTotal: '',
});

/** Filtrlar -> /orders/history so'rov parametrlari (q — alohida, kechiktirilgan) */
function historyQuery(f: Filters, q: string): URLSearchParams {
  const p = new URLSearchParams();
  const today = todayKey();
  let from = '';
  let to = '';
  if (f.preset === 'today') from = to = today;
  else if (f.preset === 'yesterday') from = to = shiftDays(today, -1);
  else if (f.preset === 'week') {
    from = shiftDays(today, -6);
    to = today;
  } else if (f.preset === 'month') {
    from = shiftDays(today, -29);
    to = today;
  } else if (f.preset === 'custom') {
    from = f.fromDate ? (f.fromTime ? `${f.fromDate}T${f.fromTime}` : f.fromDate) : '';
    to = f.toDate ? (f.toTime ? `${f.toDate}T${f.toTime}` : f.toDate) : '';
  }
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (f.type) p.set('type', f.type);
  if (f.status === 'closed') p.set('status', OrderStatus.Closed);
  else if (f.status === 'open') p.set('status', 'open');
  else if (f.status === 'refunded') p.set('refunded', 'true');
  if (f.waiterId) p.set('waiterId', f.waiterId);
  if (f.cashierId) p.set('cashierId', f.cashierId);
  if (f.paymentType) p.set('paymentType', f.paymentType);
  // Zal va stol faqat stolga buyurtmalarda bor
  if (f.type !== OrderType.Takeaway && f.type !== OrderType.Delivery) {
    if (f.hall) p.set('hall', f.hall);
    if (f.tableNumber) p.set('tableNumber', f.tableNumber);
  }
  if (f.minTotal) p.set('minTotal', f.minTotal);
  if (f.maxTotal) p.set('maxTotal', f.maxTotal);
  if (q) p.set('q', q);
  return p;
}

/** Qo'shimcha (yig'iladigan) filtrlar soni — "Filtrlar (3)" */
function advancedCount(f: Filters): number {
  return [f.waiterId, f.cashierId, f.paymentType, f.hall, f.tableNumber, f.minTotal, f.maxTotal].filter(Boolean).length;
}

/** To'lov usullari nomlari: "Naqd + Click" */
function paymentsText(o: Order, methods: { key: string; label: string }[]): string {
  const labels = [...new Set((o.payments ?? []).map((p) => p.label || paymentMethodLabel(methods, p.type)))];
  if (labels.length) return labels.join(' + ');
  return o.paymentType ? paymentMethodLabel(methods, o.paymentType) : '';
}

/** Kassir(lar) ismi — to'lovlardan */
function cashiersText(o: Order): string {
  return [...new Set((o.payments ?? []).map((p) => p.cashierName).filter(Boolean) as string[])].join(', ');
}

/** Taom qatorlari soni (kg — 1 qator) */
function linesCount(o: Order): number {
  return (o.items ?? []).reduce((n, it) => n + (it.unit === MenuUnit.Weight ? 1 : Math.max(1, Math.round(Number(it.quantity) || 0))), 0);
}

export function CheckHistory() {
  const { user } = useAuth();
  const pos = usePosSettings();
  const canRefund = hasCapability(user, 'refund');
  const canReprint = hasCapability(user, 'history') || isAdminRole(user);

  const [f, setF] = useState<Filters>(initialFilters);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 400);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [items, setItems] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<Order | null>(null);
  const [refundFirst, setRefundFirst] = useState(false);

  // Filtr ma'lumotlari: ofitsiantlar, kassirlar, zallar
  const [waiters, setWaiters] = useState<{ id: string; name: string; role: string }[]>([]);
  const [cashiers, setCashiers] = useState<{ id: string; name: string }[]>([]);
  const [tableHalls, setTableHalls] = useState<string[]>([]);
  const fullStaffList = isAdminRole(user);
  useEffect(() => {
    let alive = true;
    // Buyurtma oluvchilar ichidagi kassirlar (to'liq xodimlar ro'yxati ko'rinmaydigan kassir uchun)
    const cashiersOf = (list: { id: string; name: string; role: string }[]) =>
      list.filter((u) => u.role === 'kassir' || u.role === 'administrator').map((u) => ({ id: u.id, name: u.name }));
    api
      .get<{ id: string; name: string; role: string }[]>('/users/waiters')
      .then((list) => {
        if (!alive) return;
        setWaiters(list);
        if (!fullStaffList) {
          setCashiers(cashiersOf(list));
          return;
        }
        // Administrator / direktor: to'lov oladigan barcha xodimlar (kassa ruxsati bor har kim)
        api
          .get<User[]>('/users')
          .then((all) => {
            if (!alive) return;
            setCashiers(
              all
                .filter((u) => u.active && (hasCapability(u, 'cashier') || u.role === 'direktor' || u.role === 'superadmin'))
                .map((u) => ({ id: u.id, name: u.name })),
            );
          })
          .catch(() => {
            if (alive) setCashiers(cashiersOf(list));
          });
      })
      .catch(() => {});
    api
      .get<Table[]>('/tables')
      .then((ts) => {
        if (alive) setTableHalls(ts.map((x) => x.hall));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fullStaffList]);
  const halls = useMemo(() => sortHalls(tableHalls, pos.hallOrder), [tableHalls, pos.hallOrder]);

  // ---- Yuklash: filtr o'zgarsa — 1-sahifadan; kechikkan eski javoblar e'tiborsiz ----
  const queryKey = useMemo(() => historyQuery(f, q).toString(), [f, q]);
  const seq = useRef(0);
  const pageRef = useRef(1);
  const loadingRef = useRef(false);

  const fetchPage = useCallback(
    async (page: number) => {
      const id = ++seq.current;
      loadingRef.current = true;
      setLoading(true);
      if (page === 1) setError('');
      try {
        const params = new URLSearchParams(queryKey);
        params.set('page', String(page));
        params.set('limit', String(PAGE_SIZE));
        const res = await api.get<HistoryPage>(`/orders/history?${params.toString()}`, { timeoutMs: 20_000 });
        if (id !== seq.current) return;
        setItems((prev) => (page === 1 ? res.items : [...prev, ...res.items.filter((o) => !prev.some((p) => p.id === o.id))]));
        setTotal(res.total);
        setHasMore(!!res.hasMore);
        if (page === 1) setSummary(res.summary ?? null);
        pageRef.current = page;
      } catch (e) {
        if (id !== seq.current) return;
        setError((e as Error)?.message || 'Cheklar yuklanmadi');
        if (page === 1) {
          setItems([]);
          setTotal(0);
          setHasMore(false);
          setSummary(null);
        }
      } finally {
        if (id === seq.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [queryKey],
  );

  useEffect(() => {
    void fetchPage(1);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore) return;
    void fetchPage(pageRef.current + 1);
  }, [fetchPage, hasMore]);

  // Ro'yxat oxiri ko'ringanda — keyingi sahifa
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore, hasMore, items.length]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const active =
    f.preset !== 'today' || f.type !== '' || f.status !== 'all' || advancedCount(f) > 0 || search.trim() !== '';
  const onRefunded = useCallback((updated: Order) => {
    // Server javobidagi DTO tarix qatoridagi qo'shimcha maydonlarsiz bo'lishi mumkin — eskisi bilan birlashtiramiz
    const merge = (o: Order): Order => ({
      ...o,
      ...updated,
      payments: updated.payments ?? o.payments,
      waiterName: updated.waiterName ?? o.waiterName,
      hall: updated.hall ?? o.hall,
    });
    setItems((list) => list.map((o) => (o.id === updated.id ? merge(o) : o)));
    setSel((cur) => (cur && cur.id === updated.id ? merge(cur) : cur));
    setSummary((s) => (s ? { ...s, refundedCount: (s.refundedCount ?? 0) + 1, refundedTotal: (s.refundedTotal ?? 0) + payable(updated) } : s));
  }, []);

  // Tanlangan chek nusxasi saqlanadi: ro'yxat yangilanib, chek filtrga tushmay qolsa ham oyna yopilmaydi
  const openRow = useCallback((o: Order, refund = false) => {
    setRefundFirst(refund);
    setSel(o);
  }, []);

  const chip = (on: boolean) =>
    `h-11 px-3.5 rounded-xl text-sm font-bold border-2 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
      on ? 'bg-primary-hover border-primary-hover text-white' : 'bg-surface border-border text-text hover:border-primary/60'
    }`;
  const input = 'h-11 px-3 rounded-xl bg-bg border border-border outline-none focus:border-primary text-text min-w-0';
  const methods = pos.paymentMethods;
  const adv = advancedCount(f);

  return (
    <div className="w-full h-full flex flex-col min-h-0" data-testid="check-history">
      {/* ---- Filtrlar ---- */}
      <div className="bg-surface border border-border rounded-2xl p-3 sm:p-4 mb-3 shrink-0 space-y-3">
        {/* Telefonda har bir tugmalar qatori bitta qator bo'lib suriladi (ro'yxatga joy qolsin) */}
        <div className={CHIP_ROW}>
          {DATE_PRESETS.map((p) => (
            <button key={p.value} type="button" onClick={() => set('preset', p.value)} className={chip(f.preset === p.value)} data-testid={`history-date-${p.value}`}>
              {p.label}
            </button>
          ))}
        </div>
        {f.preset === 'custom' && (
          <div className="flex items-center gap-2 flex-wrap" data-testid="history-custom-range">
            <input type="date" value={f.fromDate} max={f.toDate || undefined} onChange={(e) => set('fromDate', e.target.value)} className={input} aria-label="Boshlanish sanasi" />
            <input type="time" value={f.fromTime} onChange={(e) => set('fromTime', e.target.value)} className={`${input} w-[112px]`} aria-label="Boshlanish vaqti (ixtiyoriy)" />
            <span className="text-muted font-bold">—</span>
            <input type="date" value={f.toDate} min={f.fromDate || undefined} onChange={(e) => set('toDate', e.target.value)} className={input} aria-label="Tugash sanasi" />
            <input type="time" value={f.toTime} onChange={(e) => set('toTime', e.target.value)} className={`${input} w-[112px]`} aria-label="Tugash vaqti (ixtiyoriy)" />
            <span className="text-xs text-muted">Vaqt ixtiyoriy (yopilgan vaqt bo‘yicha)</span>
          </div>
        )}

        <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2">
          <div className={CHIP_ROW} role="group" aria-label="Buyurtma turi" data-testid="history-type-filter">
            <button type="button" onClick={() => set('type', '')} className={chip(f.type === '')}>
              Barcha turlar
            </button>
            {ORDER_TYPES.map((ty) => {
              const Icon = ORDER_TYPE_ICON[ty];
              return (
                <button key={ty} type="button" onClick={() => set('type', ty)} className={chip(f.type === ty)} data-testid={`history-type-${ty}`}>
                  <span className={f.type === ty ? '' : ORDER_TYPE_TONE[ty].text}>
                    <Icon className="w-4 h-4" />
                  </span>
                  {ORDER_TYPE_LABELS[ty]}
                </button>
              );
            })}
          </div>
          <span className="hidden md:block w-px h-8 bg-border mx-1" aria-hidden />
          <div className={CHIP_ROW} role="group" aria-label="Holat" data-testid="history-status-filter">
            {STATUS_OPTIONS.map((s) => (
              <button key={s.value} type="button" onClick={() => set('status', s.value)} className={chip(f.status === s.value)} data-testid={`history-status-${s.value}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[220px]">
            <IconSearch className="w-5 h-5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Qidirish: taom, #raqam, telefon"
              data-testid="history-search"
              className={`${input} w-full pl-10`}
            />
          </label>
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} className={chip(showAdvanced || adv > 0)} data-testid="history-more-filters" aria-expanded={showAdvanced}>
            Filtrlar{adv > 0 ? ` (${adv})` : ''}
          </button>
        </div>

        {showAdvanced && (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2" data-testid="history-advanced">
            <Select
              value={f.waiterId}
              onChange={(v) => set('waiterId', v)}
              options={[{ value: '', label: 'Ofitsiant — hammasi' }, ...waiters.map((w) => ({ value: w.id, label: w.name }))]}
            />
            <Select
              value={f.cashierId}
              onChange={(v) => set('cashierId', v)}
              options={[{ value: '', label: 'Kassir — hammasi' }, ...cashiers.map((c) => ({ value: c.id, label: c.name }))]}
            />
            <Select
              value={f.paymentType}
              onChange={(v) => set('paymentType', v)}
              options={[{ value: '', label: 'To‘lov turi — hammasi' }, ...methods.map((m) => ({ value: m.key, label: m.label }))]}
            />
            <Select
              value={f.type === OrderType.Takeaway || f.type === OrderType.Delivery ? '' : f.hall}
              onChange={(v) => set('hall', v)}
              options={[{ value: '', label: 'Zal — hammasi' }, ...halls.map((h) => ({ value: h, label: h }))]}
            />
            <input
              value={f.tableNumber}
              inputMode="numeric"
              placeholder="Stol raqami"
              onChange={(e) => set('tableNumber', e.target.value.replace(/\D/g, '').slice(0, 4))}
              className={input}
              disabled={f.type === OrderType.Takeaway || f.type === OrderType.Delivery}
            />
            <input
              value={f.minTotal}
              inputMode="numeric"
              placeholder="Summa: dan"
              onChange={(e) => set('minTotal', e.target.value.replace(/\D/g, '').slice(0, 10))}
              className={input}
            />
            <input
              value={f.maxTotal}
              inputMode="numeric"
              placeholder="Summa: gacha"
              onChange={(e) => set('maxTotal', e.target.value.replace(/\D/g, '').slice(0, 10))}
              className={input}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[15px] font-bold text-text" data-testid="history-summary">
            {summary ? (
              <>
                {summary.count} ta chek — <span className="text-primary">{num(summary.total)} so‘m</span>
                {summary.refundedCount ? (
                  <span className="text-danger font-semibold"> · vozvrat: {summary.refundedCount} ta — {num(summary.refundedTotal ?? 0)} so‘m</span>
                ) : null}
              </>
            ) : (
              <span className="text-muted">{loading ? 'Yuklanmoqda…' : `${total} ta chek`}</span>
            )}
          </div>
          <div className="flex gap-2">
            {active && (
              <button
                type="button"
                onClick={() => {
                  setF(initialFilters());
                  setSearch('');
                }}
                className="h-10 px-3 rounded-xl border border-border font-semibold text-muted hover:text-text"
              >
                Filtrni tozalash
              </button>
            )}
            <button type="button" onClick={() => void fetchPage(1)} className="h-10 px-3 rounded-xl border border-border font-semibold text-text hover:border-primary/60">
              ↻ Yangilash
            </button>
          </div>
        </div>
      </div>

      {/* ---- Natijalar ---- */}
      <div className="bg-surface border border-border rounded-2xl flex-1 min-h-0 overflow-auto">
        {error && (
          <div role="alert" className="m-3 rounded-xl border border-danger/60 bg-danger/10 px-3 py-2.5 text-sm font-bold text-danger">
            {error}{' '}
            <button type="button" className="underline" onClick={() => void fetchPage(1)}>
              Qayta urinish
            </button>
          </div>
        )}
        {items.length === 0 && !loading ? (
          <div className="text-center text-muted py-16 font-semibold">Bu filtr bo‘yicha chek topilmadi</div>
        ) : (
          <>
            {/* Katta ekran (1280+): eski POS'dagidek jadval. table-fixed — 1366 px'da admin menyusi yonida
                ham sig'adi (uzun matnlar qisqartiriladi, to'liq — tafsilot oynasida) */}
            <table className="hidden xl:table table-fixed w-full text-sm" data-testid="history-table">
              <colgroup>
                <col className="w-[34px]" />
                <col className="w-[92px]" />
                <col className="w-[66px]" />
                <col className="w-[132px]" />
                <col />
                <col className="w-[112px]" />
                <col className="w-[74px]" />
                <col className="w-[74px]" />
                <col className="w-[94px]" />
                <col className="w-[100px]" />
                <col className="w-[50px]" />
                <col className="w-[96px]" />
              </colgroup>
              <thead className="sticky top-0 z-[1] bg-bg">
                <tr className="text-muted text-[11px] uppercase tracking-wide leading-tight">
                  <th className="text-left font-bold px-2 py-2.5">No</th>
                  <th className="text-left font-bold px-2 py-2.5">Ochilgan / Yopilgan</th>
                  <th className="text-left font-bold px-2 py-2.5">Buyurtma</th>
                  <th className="text-left font-bold px-2 py-2.5">Turi</th>
                  <th className="text-left font-bold px-2 py-2.5">Mijoz</th>
                  <th className="text-left font-bold px-2 py-2.5">Ofitsiant</th>
                  <th className="text-right font-bold px-2 py-2.5">Yetkazish</th>
                  <th className="text-right font-bold px-2 py-2.5">Xizmat</th>
                  <th className="text-right font-bold px-2 py-2.5">Jami</th>
                  <th className="text-left font-bold px-2 py-2.5">To‘lov turi</th>
                  <th className="text-center font-bold px-1 py-2.5">Chek</th>
                  <th className="text-center font-bold px-1 py-2.5">Vozvrat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((o, i) => (
                  <HistoryRow
                    key={o.id}
                    order={o}
                    index={i + 1}
                    methodsText={paymentsText(o, methods)}
                    canRefund={canRefund}
                    canReprint={canReprint}
                    onOpen={openRow}
                  />
                ))}
              </tbody>
            </table>

            {/* Telefon / planshet: kartalar */}
            <div className="xl:hidden divide-y divide-border">
              {items.map((o, i) => (
                <HistoryCard key={o.id} order={o} index={i + 1} methodsText={paymentsText(o, methods)} onOpen={openRow} />
              ))}
            </div>

            <div ref={sentinel} className="h-8" />
            {loading && <div className="text-center text-muted text-sm py-3">Yuklanmoqda…</div>}
            {!hasMore && items.length > 0 && <div className="text-center text-muted text-xs py-3">— {total} ta chek —</div>}
          </>
        )}
      </div>

      {sel && (
        <CheckDetailSheet
          key={sel.id}
          order={sel}
          canRefund={canRefund}
          canReprint={canReprint}
          refundFirst={refundFirst}
          onClose={() => setSel(null)}
          onRefunded={onRefunded}
        />
      )}
    </div>
  );
}

// ---- Jadval qatori / karta ----

const HistoryRow = memo(function HistoryRow({
  order: o,
  index,
  methodsText,
  canRefund,
  canReprint,
  onOpen,
}: {
  order: Order;
  index: number;
  methodsText: string;
  canRefund: boolean;
  canReprint: boolean;
  onOpen: (o: Order, refund?: boolean) => void;
}) {
  const type = orderTypeOf(o);
  const closed = o.status === OrderStatus.Closed;
  const customer = o.customerName || (o.phone ? phoneLabel(o.phone) : '');
  const sameDay = o.closedAt && dateKey(new Date(o.closedAt)) === dateKey(new Date(o.openedAt));
  const fee = type === OrderType.Delivery ? roundSum(o.deliveryFee ?? 0) : 0;
  return (
    <tr className="hover:bg-surface-hover cursor-pointer" onClick={() => onOpen(o)} data-testid="history-row" data-order-id={o.id}>
      <td className="px-2 py-2.5 text-muted font-semibold tabular-nums">{index}</td>
      <td className="px-2 py-2.5 whitespace-nowrap tabular-nums">
        <div className="font-semibold text-text">{dmHm(o.openedAt)}</div>
        <div className="text-xs text-muted">{o.closedAt ? (sameDay ? hm(o.closedAt) : dmHm(o.closedAt)) : 'ochiq'}</div>
      </td>
      <td className="px-2 py-2.5 whitespace-nowrap">
        <div className="font-extrabold text-text">{dailyNumberLabel(o) ?? '—'}</div>
        <div className="text-xs text-muted">{linesCount(o)} ta taom</div>
      </td>
      <td className="px-2 py-2.5 min-w-0">
        <OrderTypeBadge type={type} />
        <div className="text-xs font-semibold text-text mt-0.5 truncate" title={fullName(o)}>
          {fullName(o)}
        </div>
      </td>
      <td className="px-2 py-2.5 truncate text-text" title={customer}>
        {customer || <span className="text-muted">—</span>}
      </td>
      <td className="px-2 py-2.5 truncate text-text" title={o.waiterName ?? ''}>
        {o.waiterName ?? '—'}
      </td>
      <td className="px-2 py-2.5 text-right tabular-nums">{fee > 0 ? num(fee) : <span className="text-muted">—</span>}</td>
      <td className="px-2 py-2.5 text-right tabular-nums">
        {(o.serviceAmount ?? 0) > 0 ? num(o.serviceAmount ?? 0) : <span className="text-muted">—</span>}
      </td>
      <td className={`px-2 py-2.5 text-right tabular-nums font-extrabold ${o.refunded ? 'line-through text-muted' : 'text-text'}`}>{num(payable(o))}</td>
      <td className="px-2 py-2.5 text-text truncate" title={methodsText}>
        {closed ? methodsText || '—' : <span className="px-2 py-0.5 rounded-md bg-warning text-black text-xs font-extrabold">Ochiq</span>}
      </td>
      <td className="px-1 py-2 text-center" onClick={(e) => e.stopPropagation()}>
        {closed && canReprint ? <ReprintButton orderId={o.id} compact /> : <span className="text-muted">—</span>}
      </td>
      <td className="px-1 py-2 text-center" onClick={(e) => e.stopPropagation()}>
        {o.refunded ? (
          <span className="inline-block px-1.5 py-1 rounded-md bg-danger text-white text-[11px] font-extrabold whitespace-nowrap">Qaytarilgan</span>
        ) : closed && canRefund ? (
          <button
            type="button"
            onClick={() => onOpen(o, true)}
            className="h-9 px-2.5 rounded-lg border border-danger/60 text-danger text-xs font-extrabold hover:bg-danger/10 whitespace-nowrap"
            data-testid="history-refund"
          >
            Vozvrat
          </button>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
    </tr>
  );
});

const HistoryCard = memo(function HistoryCard({
  order: o,
  index,
  methodsText,
  onOpen,
}: {
  order: Order;
  index: number;
  methodsText: string;
  onOpen: (o: Order, refund?: boolean) => void;
}) {
  const type = orderTypeOf(o);
  const Icon = ORDER_TYPE_ICON[type];
  const closed = o.status === OrderStatus.Closed;
  return (
    <button type="button" onClick={() => onOpen(o)} className="w-full text-left flex items-center gap-3 px-3 py-3 hover:bg-surface-hover" data-testid="history-card">
      <span className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${ORDER_TYPE_TONE[type].soft} ${ORDER_TYPE_TONE[type].text}`}>
        <Icon className="w-5 h-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-bold text-text truncate">
          <span className="text-muted font-semibold">{index}. </span>
          {fullName(o)}
          {dailyNumberLabel(o) && <span className="text-muted font-semibold"> · {dailyNumberLabel(o)}</span>}
        </div>
        <div className="text-xs text-muted truncate">
          {dmHm(o.closedAt ?? o.openedAt)}
          {o.waiterName ? ` · ${o.waiterName}` : ''}
          {closed && methodsText ? ` · ${methodsText}` : ''}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-extrabold tabular-nums ${o.refunded ? 'line-through text-muted' : 'text-text'}`}>{num(payable(o))}</div>
        {o.refunded ? (
          <span className="text-[11px] font-extrabold text-danger">↩ vozvrat</span>
        ) : !closed ? (
          <span className="text-[11px] font-extrabold text-warning">ochiq</span>
        ) : null}
      </div>
    </button>
  );
});

// ---- Qayta chop etish ----

/** Yopilgan chekni qayta chop etish: shu terminalda printer bo'lsa — o'zi, bo'lmasa kassa printeriga (relay) */
async function reprintReceipt(orderId: string): Promise<string> {
  const receipt = await api.get<Receipt>(`/orders/${orderId}/receipt`);
  const cfg = await window.hardweb?.printer?.getConfig?.().catch(() => null);
  if (cfg && cfg.type !== 'none' && window.hardweb?.printer) {
    const res = await window.hardweb.printer.printReceipt(receipt);
    if (!res?.ok) throw new Error(res?.message || 'Printer xatosi');
    return '✓ Chek chop etildi';
  }
  await api.post('/orders/print-receipt', receipt);
  return '✓ Chek kassa printeriga yuborildi';
}

function ReprintButton({ orderId, compact }: { orderId: string; compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    // StrictMode effektni ikki marta ulaydi — qayta ulanganda ham "tirik" bo'lsin
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run() {
    if (state === 'busy') return;
    setState('busy');
    setMsg('');
    try {
      const text = await reprintReceipt(orderId);
      if (!alive.current) return;
      setState('ok');
      setMsg(text);
      window.setTimeout(() => alive.current && setState('idle'), 2500);
    } catch (e) {
      if (!alive.current) return;
      setState('err');
      setMsg(`Chek chiqmadi: ${(e as Error)?.message || 'xato'}`);
    }
  }
  if (compact) {
    return (
      <button
        type="button"
        onClick={run}
        title={msg || 'Qayta chop etish'}
        aria-label="Qayta chop etish"
        data-testid="history-reprint"
        className={`h-9 w-9 rounded-lg border inline-flex items-center justify-center ${
          state === 'ok' ? 'border-success bg-success/15 text-success' : state === 'err' ? 'border-danger bg-danger/10 text-danger' : 'border-border text-text hover:border-primary/60'
        }`}
      >
        {state === 'busy' ? <Spinner className="w-4 h-4 border-text" /> : <IconPrinter className="w-4 h-4" />}
      </button>
    );
  }
  return (
    <div className="flex-1 min-w-[160px]">
      <button
        type="button"
        onClick={run}
        disabled={state === 'busy'}
        data-testid="detail-reprint"
        className="w-full h-14 rounded-2xl border-2 border-border bg-surface text-text font-extrabold hover:border-primary/60 inline-flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {state === 'busy' ? <Spinner className="w-5 h-5 border-text" /> : <IconPrinter className="w-5 h-5" />}
        Qayta chop etish
      </button>
      {msg && <div className={`text-xs font-bold mt-1 text-center ${state === 'err' ? 'text-danger' : 'text-success'}`}>{msg}</div>}
    </div>
  );
}

// ---- Chek tafsiloti ----

function CheckDetailSheet({
  order: o,
  canRefund,
  canReprint,
  refundFirst,
  onClose,
  onRefunded,
}: {
  order: Order;
  canRefund: boolean;
  canReprint: boolean;
  refundFirst: boolean;
  onClose: () => void;
  onRefunded: (o: Order) => void;
}) {
  const pos = usePosSettings();
  const { user } = useAuth();
  const type = orderTypeOf(o);
  const t = orderCheckTotals(o);
  const closed = o.status === OrderStatus.Closed;
  const [refundOpen, setRefundOpen] = useState(refundFirst && closed && !o.refunded);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [voids, setVoids] = useState<VoidReport | null>(null);
  const showVoids = canSeeVoids(user);

  // Shu chekning otkazlari — faqat otkazlar hisobotini ko'ra oladigan xodimga (xato bo'lsa — jim)
  useEffect(() => {
    if (!showVoids) return;
    let alive = true;
    api
      .get<VoidReport>(`/reports/voids?orderId=${encodeURIComponent(o.id)}`)
      .then((r) => {
        if (alive) setVoids(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [o.id, showVoids]);

  async function refund() {
    if (!reason.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      const updated = await api.post<Order>(`/orders/${o.id}/refund`, { reason: reason.trim() });
      onRefunded(updated && typeof updated === 'object' ? updated : { ...o, refunded: true, refundReason: reason.trim() });
      setRefundOpen(false);
      setReason('');
    } catch (e) {
      setErr((e as Error)?.message || 'Vozvrat qilinmadi');
    } finally {
      setBusy(false);
    }
  }

  const cashiers = cashiersText(o);
  const headline = fullName(o);
  const numberLabel = dailyNumberLabel(o);

  return (
    <Sheet
      title={headline}
      subtitle={
        <span className="inline-flex items-center gap-2 flex-wrap">
          <OrderTypeBadge type={type} />
          {numberLabel && <span>Buyurtma {numberLabel}</span>}
          {o.refunded ? (
            <span className="px-2 py-0.5 rounded-md bg-danger text-white text-[11px] font-extrabold">↩ Vozvrat</span>
          ) : !closed ? (
            <span className="px-2 py-0.5 rounded-md bg-warning text-black text-[11px] font-extrabold">Ochiq</span>
          ) : null}
        </span>
      }
      onClose={onClose}
      busy={busy}
      size="lg"
      testId="check-detail"
      footer={
        (closed && canReprint) || (closed && canRefund && !o.refunded) ? (
          <div className="flex gap-2 flex-wrap pb-1">
            {closed && canReprint && <ReprintButton orderId={o.id} />}
            {closed && canRefund && !o.refunded && !refundOpen && (
              <button
                type="button"
                onClick={() => setRefundOpen(true)}
                data-testid="detail-refund"
                className="flex-1 min-w-[160px] h-14 rounded-2xl bg-danger text-white font-extrabold hover:brightness-110 inline-flex items-center justify-center gap-2"
              >
                <IconUndo className="w-5 h-5" strokeWidth={2.6} /> Vozvrat
              </button>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1.15fr] gap-4">
        {/* Kim / qachon */}
        <div className="space-y-1.5 text-[15px]">
          <Info label="Ochilgan" value={dmyHm(o.openedAt)} />
          <Info label="Yopilgan" value={o.closedAt ? dmyHm(o.closedAt) : 'hali yopilmagan'} />
          <Info label="Ofitsiant" value={o.waiterName ?? '—'} />
          {cashiers && <Info label="Kassir" value={cashiers} />}
          {o.customerName && <Info label="Mijoz" value={o.customerName} />}
          {type === OrderType.Delivery && (
            <>
              <Info label="Telefon" value={o.phone ? phoneLabel(o.phone) : '—'} />
              <Info label="Manzil" value={o.address || '—'} />
            </>
          )}
          {o.note && <Info label="Izoh" value={o.note} />}
          {o.refunded && (
            <div className="mt-2 rounded-xl border border-danger/50 bg-danger/10 px-3 py-2.5 text-sm">
              <div className="font-extrabold text-danger">↩ Chek qaytarilgan (vozvrat)</div>
              <div className="text-text mt-0.5">
                {o.refundedAt ? dmyHm(o.refundedAt) : ''}
                {o.refundedByName ? ` · ${o.refundedByName}` : ''}
              </div>
              {o.refundReason && <div className="text-muted mt-0.5">Sabab: {o.refundReason}</div>}
            </div>
          )}
        </div>

        {/* Chek */}
        <div className="rounded-xl bg-bg border border-border">
          <div className="divide-y divide-border">
            {(o.items ?? []).map((it) => {
              const overridden = !!it.priceOverridden && it.originalPrice != null;
              return (
                <div key={it.id} className="px-3 py-2">
                  <div className="flex justify-between gap-3">
                    <span className="min-w-0 font-semibold text-text">
                      <span className="text-primary font-extrabold">{qty(it.quantity, it.unit)}</span>
                      {it.unit === MenuUnit.Weight ? ' ' : ' × '}
                      {it.menuItemName}
                      {it.takeaway && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-warning text-black text-[11px] font-extrabold align-middle">olib ketish</span>
                      )}
                    </span>
                    <span className="font-bold whitespace-nowrap tabular-nums">{num(lineSum(it.price ?? 0, it.quantity))}</span>
                  </div>
                  <div className="text-xs text-muted tabular-nums">
                    {overridden && <span className="line-through mr-1">{num(it.originalPrice ?? 0)}</span>}
                    {num(it.price ?? 0)}
                    {overridden && <span className="text-warning font-extrabold"> * narx o‘zgartirilgan</span>}
                    {it.note && <span className="text-warning"> · {it.note}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-border px-3 py-2.5 space-y-1 text-[15px]">
            <Info label="Mahsulotlar" value={num(t.subtotal)} />
            {t.discountAmount > 0 && <Info label={`Chegirma (${t.discountPercent}%)`} value={`− ${num(t.discountAmount)}`} />}
            {t.serviceAmount > 0 && (
              <Info
                label={`Xizmat haqi ${t.servicePercent}%${t.serviceBase !== t.subtotal ? ` (${num(t.serviceBase)} dan)` : ''}`}
                value={`+ ${num(t.serviceAmount)}`}
              />
            )}
            {t.deliveryFee > 0 && <Info label="Yetkazish narxi" value={`+ ${num(t.deliveryFee)}`} />}
            <div className="flex justify-between items-baseline pt-1.5 border-t border-border mt-1.5">
              <span className="font-extrabold text-text">JAMI</span>
              <span className={`text-2xl font-black tabular-nums ${o.refunded ? 'line-through text-muted' : 'text-text'}`}>{num(payable(o))}</span>
            </div>
          </div>
          {(o.payments ?? []).length > 0 && (
            <div className="border-t border-border px-3 py-2.5 space-y-1">
              <div className="text-xs font-extrabold uppercase tracking-wide text-muted">To‘lovlar</div>
              {(o.payments ?? []).map((p) => (
                <div key={p.id} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 text-text">
                    <span className="font-bold">{p.label || paymentMethodLabel(pos.paymentMethods, p.type)}</span>
                    <span className="text-muted">
                      {' '}
                      · {hm(p.createdAt)}
                      {p.cashierName ? ` · ${p.cashierName}` : ''}
                      {p.debtorName ? ` · qarzdor: ${p.debtorName}${p.debtorPhone ? ` (${phoneLabel(p.debtorPhone)})` : ''}` : ''}
                    </span>
                  </span>
                  <span className="font-bold tabular-nums whitespace-nowrap">{num(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Otkazlar (shu chekdan bekor qilingan taomlar) */}
      {voids && voids.count > 0 && (
        <div className="mt-4 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2.5" data-testid="detail-voids">
          <div className="font-extrabold text-danger mb-1">
            Otkazlar: {voids.count} ta — {num(voids.total)} so‘m
          </div>
          {voids.items.map((v) => (
            <div key={v.id} className="text-sm text-text">
              −{qty(v.quantity, v.unit)} × {v.name} ({num(v.sum)}) <span className="text-muted">— {dmHm(v.createdAt)}{v.userName ? ` · ${v.userName}` : ''}{v.reason ? ` · ${v.reason}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {refundOpen && (
        <div className="mt-4 rounded-xl border-2 border-danger/60 bg-danger/5 p-3" data-testid="refund-form">
          <div className="font-extrabold text-danger mb-2">Vozvrat — {num(payable(o))} so‘m mijozga qaytariladi</div>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Vozvrat sababi (majburiy): masalan, mijoz taomdan voz kechdi"
            data-testid="refund-reason"
            className="w-full px-3 py-2 rounded-xl bg-surface border border-border outline-none focus:border-danger text-[15px]"
          />
          <SheetError>{err}</SheetError>
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={() => setRefundOpen(false)} disabled={busy} className="flex-1 h-12 rounded-xl border border-border font-bold text-text">
              Bekor
            </button>
            <button
              type="button"
              onClick={refund}
              disabled={busy || !reason.trim()}
              data-testid="refund-confirm"
              className="flex-[2] h-12 rounded-xl bg-danger text-white font-extrabold disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {busy && <Spinner className="w-5 h-5 border-white" />}
              Vozvratni tasdiqlash
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted shrink-0">{label}</span>
      <span className="font-semibold text-text text-right break-words min-w-0 tabular-nums">{value}</span>
    </div>
  );
}
