import { useCallback, useEffect, useRef, useState } from 'react';
import { Order } from '@hardweb-pos/shared';
import { api } from '../lib/api';

export interface OrderFilters {
  waiterId?: string;
  status?: string;
  hall?: string;
  paymentType?: string;
  dateFrom?: string; // ISO (eski — ochilgan vaqt bo'yicha)
  dateTo?: string; // ISO
  /** mahalliy sana 'YYYY-MM-DD' (yoki sana+vaqt) — yopilgan vaqt bo'yicha (ochiq hisobda — ochilgan) */
  from?: string;
  to?: string;
  search?: string;
  /** B7: buyurtma turi (stol / olib_ketish / yetkazish) — server ?type= filtri */
  type?: string;
}

/** Butun filtr bo'yicha yig'indi (sahifadan qat'i nazar) — server GET /orders/history summary */
export interface OrdersSummary {
  count: number;
  total: number;
  refundedCount: number;
  refundedTotal: number;
}

interface PageResult {
  items: Order[];
  total: number;
  hasMore: boolean;
  summary?: OrdersSummary;
}

/** Filtrlar -> so'rov qatori (bo'sh qiymatlar yuborilmaydi) */
export function historyQuery(filters: OrderFilters, page: number, limit: number): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, String(v));
  });
  return params.toString();
}

/** Keyingi sahifani qo'shish: sahifalar orasida siljigan (takror kelgan) buyurtmalar ikki marta chiqmasin */
function mergeUnique(prev: Order[], next: Order[]): Order[] {
  const seen = new Set(prev.map((o) => o.id));
  const add = next.filter((o) => !seen.has(o.id));
  return add.length ? [...prev, ...add] : prev;
}

// Buyurtmalar tarixini sahifalab yuklaydi (infinite scroll uchun).
// Filtrlar o'zgarsa — 1-sahifadan qayta yuklaydi. loadMore keyingi sahifani qo'shadi.
// Eskirgan javob (filtr o'zgargach kelgan) qo'llanmaydi; xato — `error` (bo'sh ro'yxat emas).
export function useInfiniteOrders(filters: OrderFilters, pageSize = 20) {
  const [items, setItems] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<OrdersSummary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(1);
  // Har qayta yuklashda oshadi — undan oldin boshlangan so'rov javobi e'tiborsiz
  const seqRef = useRef(0);
  const busyRef = useRef(false);
  const filtersKey = JSON.stringify(filters);

  const fetchPage = useCallback(
    (page: number): Promise<PageResult> => api.get<PageResult>(`/orders/history?${historyQuery(filters, page, pageSize)}`),
    [filtersKey, pageSize], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const reload = useCallback(async () => {
    const seq = ++seqRef.current;
    busyRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchPage(1);
      if (seq !== seqRef.current) return;
      setItems(mergeUnique([], r.items ?? []));
      setTotal(r.total ?? 0);
      setSummary(r.summary ?? null);
      setHasMore(!!r.hasMore);
      pageRef.current = 1;
    } catch (e) {
      if (seq !== seqRef.current) return;
      setItems([]);
      setTotal(0);
      setSummary(null);
      setHasMore(false);
      setError((e as Error)?.message || 'Ro‘yxat yuklanmadi');
    } finally {
      if (seq === seqRef.current) {
        busyRef.current = false;
        setLoading(false);
      }
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (busyRef.current || !hasMore) return;
    const seq = seqRef.current;
    busyRef.current = true;
    setLoading(true);
    try {
      const next = pageRef.current + 1;
      const r = await fetchPage(next);
      if (seq !== seqRef.current) return;
      setItems((prev) => mergeUnique(prev, r.items ?? []));
      setTotal(r.total ?? 0);
      if (r.summary) setSummary(r.summary);
      setHasMore(!!r.hasMore);
      pageRef.current = next;
    } catch (e) {
      if (seq !== seqRef.current) return;
      // To'xtaymiz (aks holda ko'rinib turgan sentinel so'rovni to'xtovsiz takrorlaydi) — "Qayta urinish"
      setHasMore(false);
      setError((e as Error)?.message || 'Ro‘yxat yuklanmadi');
    } finally {
      if (seq === seqRef.current) {
        busyRef.current = false;
        setLoading(false);
      }
    }
  }, [hasMore, fetchPage]);

  // Filtrlar o'zgarsa qayta yuklaymiz
  useEffect(() => {
    void reload();
  }, [filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { items, total, summary, hasMore, loading, error, loadMore, reload };
}

// Skroll pastiga yetganda callback'ni chaqiradigan sentinel ref (IntersectionObserver)
export function useScrollSentinel(
  onReach: () => void,
  enabled: boolean,
): (el: HTMLDivElement | null) => void {
  const obsRef = useRef<IntersectionObserver | null>(null);
  const cbRef = useRef(onReach);
  cbRef.current = onReach;

  return useCallback(
    (el: HTMLDivElement | null) => {
      if (obsRef.current) obsRef.current.disconnect();
      if (!el || !enabled) return;
      obsRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) cbRef.current();
        },
        { rootMargin: '120px' },
      );
      obsRef.current.observe(el);
    },
    [enabled],
  );
}
