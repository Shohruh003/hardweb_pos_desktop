// Hisobot ma'lumotini yuklash: manzil o'zgarsa — qayta yuklanadi, kechikib kelgan ESKI javob yangisini
// bosib ketmaydi (tez almashtirilgan sana/filtrlar). Yangilanayotganda oldingi natija ekranda qoladi
// (miltillamaydi). 403 — "ruxsat yo'q" (bo'lim yashiriladi), boshqa xatolar — o'zbekcha matn.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../lib/api';

export interface ReportData<T> {
  data: T | null;
  loading: boolean;
  error: string;
  forbidden: boolean;
  reload: () => void;
}

export function useReportData<T>(path: string | null): ReportData<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    setError('');
    api
      .get<T>(path)
      .then((res) => {
        if (id !== seq.current) return;
        setData(res);
        setForbidden(false);
      })
      .catch((e: unknown) => {
        if (id !== seq.current) return;
        if (e instanceof ApiError && e.status === 403) setForbidden(true);
        setError((e as Error)?.message || 'Ma’lumot yuklanmadi');
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
  }, [path, tick]);

  // Ekrandan ketganda kechikkan javob holatni o'zgartirmasin
  useEffect(
    () => () => {
      seq.current += 1;
    },
    [],
  );

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, forbidden, reload };
}

/** Qiymat o'zgarishini kechiktirish (qidiruv maydoni — har harfda so'rov yuborilmasin) */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
