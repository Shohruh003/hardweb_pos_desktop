import { useCallback, useEffect, useRef, useState } from 'react';
import { Order } from '@hardweb-pos/shared';
import { api } from '../lib/api';

export interface OrderFilters {
  waiterId?: string;
  status?: string;
  hall?: string;
  paymentType?: string;
  dateFrom?: string; // ISO
  dateTo?: string; // ISO
  search?: string;
}

interface PageResult {
  items: Order[];
  total: number;
  hasMore: boolean;
}

// Buyurtmalar tarixini sahifalab yuklaydi (infinite scroll uchun).
// Filtrlar o'zgarsa — 1-sahifadan qayta yuklaydi. loadMore keyingi sahifani qo'shadi.
export function useInfiniteOrders(filters: OrderFilters, pageSize = 20) {
  const [items, setItems] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const pageRef = useRef(1);
  const filtersKey = JSON.stringify(filters);

  const fetchPage = useCallback(
    async (page: number): Promise<PageResult> => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params.set(k, String(v));
      });
      return api.get<PageResult>(`/orders/history?${params.toString()}`);
    },
    [filtersKey, pageSize], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchPage(1);
      setItems(r.items);
      setTotal(r.total);
      setHasMore(r.hasMore);
      pageRef.current = 1;
    } catch {
      setItems([]);
      setTotal(0);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const next = pageRef.current + 1;
      const r = await fetchPage(next);
      setItems((prev) => [...prev, ...r.items]);
      setHasMore(r.hasMore);
      pageRef.current = next;
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, fetchPage]);

  // Filtrlar o'zgarsa qayta yuklaymiz
  useEffect(() => {
    reload();
  }, [filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { items, total, hasMore, loading, loadMore, reload };
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
