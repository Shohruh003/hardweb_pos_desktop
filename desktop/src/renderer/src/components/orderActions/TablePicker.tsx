// Stol tanlash to'ri (stolni almashtirish, turini "Stolga" qilish): barcha zallar sozlamadagi tartibda,
// har zal — "# ZAL" sarlavhasi va ixcham plitkalar. Plitkada faqat raqam (katta, chapda — D4),
// bo'sh — tinch fon, band — to'q yashil + hisoblar soni. Band stol tanlansa — u yerda yangi hisob ochiladi.
// Ma'lumotni o'zi yuklaydi (kassadagi to'lov oynasidan ham ochiladi — u yerda stollar ro'yxati yo'q).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Order, OrderType, Table, TableStatus, orderTypeOf } from '@hardweb-pos/shared';
import { api } from '../../lib/api';
import { normalizeName } from '../../lib/menuImages';
import { sortHalls, usePosSettings } from '../../lib/posSettings';
import { checkNoOf } from '../waiter/orderUi';
import { IconRefresh } from '../waiter/icons';
import { Spinner } from '../waiter/Sheet';

// Eski POS'dan ko'chirilgan soxta zallar (endi buyurtma turlari) — band stoli bo'lmasa ko'rsatilmaydi
const PSEUDO_HALLS = new Set(['olib ketish', 'yetkazib berish', 'yetkazish']);

export interface TablePickerProps {
  /** ko'rsatilmaydigan stol (hozirgi stol) */
  excludeTableId?: string | null;
  /** amal bajarilmoqda — plitkalar vaqtincha o'chiq */
  disabled?: boolean;
  /** tanlangan stol va undagi ochiq hisoblar (bo'sh stol — []) */
  onPick: (table: Table, checks: Order[]) => void;
}

export function TablePicker({ excludeTableId, disabled, onPick }: TablePickerProps) {
  const pos = usePosSettings();
  const [tables, setTables] = useState<Table[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [tbl, ord] = await Promise.all([
        api.get<Table[]>('/tables'),
        api.get<Order[]>(`/orders?type=${OrderType.DineIn}`),
      ]);
      setTables(Array.isArray(tbl) ? tbl : []);
      setOrders(Array.isArray(ord) ? ord.filter((o) => orderTypeOf(o) === OrderType.DineIn && !!o.tableId) : []);
    } catch (e) {
      setError((e as Error)?.message || 'Stollar yuklanmadi');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const checksByTable = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of orders) {
      const list = m.get(o.tableId!);
      if (list) list.push(o);
      else m.set(o.tableId!, [o]);
    }
    m.forEach((list) => list.sort((a, b) => checkNoOf(a) - checkNoOf(b)));
    return m;
  }, [orders]);

  const groups = useMemo(() => {
    if (!tables) return [];
    const list = tables.filter((t) => t.id !== excludeTableId);
    const busyOf = (t: Table) => (checksByTable.get(t.id)?.length ?? 0) > 0 || t.status !== TableStatus.Free;
    const halls = sortHalls(
      list.map((t) => t.hall),
      pos.hallOrder,
    ).filter((h) => !PSEUDO_HALLS.has(normalizeName(h)) || list.some((t) => t.hall === h && busyOf(t)));
    return halls.map((h) => ({
      hall: h,
      tables: list.filter((t) => t.hall === h).sort((a, b) => a.number - b.number),
    }));
  }, [tables, excludeTableId, checksByTable, pos.hallOrder]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10 gap-3">
        <span className="font-semibold text-danger">{error}</span>
        <button
          type="button"
          onClick={() => void load()}
          className="h-12 px-5 rounded-xl bg-primary-hover text-white font-bold flex items-center gap-2"
        >
          <IconRefresh className="w-5 h-5" /> Qayta urinish
        </button>
      </div>
    );
  }
  if (!tables) {
    return (
      <div className="flex items-center justify-center gap-3 py-12 text-muted font-semibold">
        <Spinner className="w-6 h-6 border-primary" /> Stollar yuklanmoqda…
      </div>
    );
  }
  if (groups.length === 0) {
    return <div className="text-center text-muted py-10 font-semibold">Boshqa stol yo‘q</div>;
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.hall} aria-label={g.hall}>
          <h3 className="flex items-baseline gap-1.5 mb-1.5">
            <span className="text-muted font-black">#</span>
            <span className="font-black uppercase tracking-wide text-text">{g.hall}</span>
          </h3>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }}>
            {g.tables.map((t) => {
              const checks = checksByTable.get(t.id) ?? [];
              const busy = checks.length > 0 || t.status !== TableStatus.Free;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(t, checks)}
                  data-testid={`pick-table-${t.number}`}
                  data-status={busy ? 'busy' : 'free'}
                  aria-label={`Stol ${t.number}${busy ? `, band${checks.length > 1 ? `, ${checks.length} hisob` : ''}` : ', bo‘sh'}`}
                  className={`h-[72px] rounded-xl border-2 p-1.5 flex flex-col text-left select-none transition-[transform,filter] active:scale-95 disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/50 ${
                    busy
                      ? 'bg-primary-hover border-primary-hover text-white hover:brightness-110'
                      : 'bg-surface border-border text-text hover:border-primary'
                  }`}
                >
                  <span className="text-[28px] font-black leading-none tabular-nums">{t.number}</span>
                  <span
                    className={`mt-auto text-[11px] font-extrabold leading-tight truncate ${busy ? 'text-white' : 'text-muted'}`}
                  >
                    {busy ? (checks.length > 1 ? `band · ${checks.length} hisob` : 'band') : 'bo‘sh'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
