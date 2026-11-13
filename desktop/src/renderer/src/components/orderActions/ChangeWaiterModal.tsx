// "Ofitsiant" — hisobni boshqa ofitsiantga o'tkazish (B22b). Misol: 5-stol ofitsianti ishga
// yuborildi, stolni boshqasi oladi. Faqat kassir yoki administrator/direktor (server ham tekshiradi).
// Ofitsiantlar hisoboti (ulush) buyurtmaning joriy ofitsianti bo'yicha hisoblanadi.
import { useEffect, useState } from 'react';
import { Order, User, hasCapability } from '@hardweb-pos/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { Sheet, SheetError, Spinner } from '../waiter/Sheet';
import { IconCheck, IconUserSwap } from '../waiter/icons';
import { orderFullName } from '../waiter/orderUi';
import { isAdminRole } from './perms';

/** Ofitsiantlik qila oladigan faol xodimlar (rahbar barcha xodimlarni ko'radi — kassirlar ham) */
async function loadStaff(admin: boolean): Promise<User[]> {
  if (admin) {
    try {
      const all = await api.get<User[]>('/users');
      if (Array.isArray(all)) {
        return all
          .filter((u) => u.active !== false && hasCapability(u, 'waiter'))
          .sort((a, b) => a.name.localeCompare(b.name, 'uz'));
      }
    } catch {
      /* ruxsat yo'q — oddiy ro'yxat */
    }
  }
  const list = await api.get<User[]>('/users/waiters');
  return Array.isArray(list) ? list : [];
}

export function ChangeWaiterModal({
  order,
  onClose,
  onDone,
}: {
  order: Order;
  onClose: () => void;
  onDone: (order: Order) => void;
}) {
  const { user } = useAuth();
  const [staff, setStaff] = useState<User[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    loadStaff(isAdminRole(user))
      .then((list) => alive && setStaff(list))
      .catch((e) => {
        if (!alive) return;
        setStaff([]);
        setError((e as Error)?.message || 'Ofitsiantlar ro‘yxati yuklanmadi');
      });
    return () => {
      alive = false;
    };
  }, [user]);

  async function pick(w: User) {
    if (busyId || w.id === order.waiterId) return;
    setBusyId(w.id);
    setError('');
    try {
      const updated = await api.post<Order>(`/orders/${order.id}/change-waiter`, { waiterId: w.id });
      onDone(updated ?? { ...order, waiterId: w.id, waiterName: w.name });
    } catch (e) {
      setError((e as Error)?.message || 'Ofitsiant o‘zgarmadi');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Sheet
      title="Ofitsiantni almashtirish"
      subtitle={`${orderFullName(order)}${order.waiterName ? ` · hozir: ${order.waiterName}` : ''}`}
      icon={<IconUserSwap className="w-6 h-6" />}
      size="md"
      busy={!!busyId}
      onClose={onClose}
      testId="change-waiter-modal"
    >
      <div className="space-y-3">
        <SheetError>{error}</SheetError>
        {!staff ? (
          <div className="flex items-center justify-center gap-3 py-10 text-muted font-semibold">
            <Spinner className="w-6 h-6 border-primary" /> Yuklanmoqda…
          </div>
        ) : staff.length === 0 ? (
          <div className="text-center text-muted py-8 font-semibold">Ofitsiant topilmadi</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {staff.map((w) => {
              const current = w.id === order.waiterId;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => void pick(w)}
                  disabled={!!busyId || current}
                  data-testid="waiter-option"
                  data-name={w.name}
                  className={`min-h-[60px] text-left px-3 py-2 rounded-2xl border-2 flex items-center gap-3 transition-colors disabled:cursor-default ${
                    current
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-bg hover:border-primary active:scale-[0.98]'
                  } ${busyId && busyId !== w.id ? 'opacity-50' : ''}`}
                >
                  <span className="w-11 h-11 rounded-full bg-primary-hover text-white font-black text-lg flex items-center justify-center shrink-0">
                    {w.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-extrabold truncate">{w.name}</span>
                    {current && <span className="block text-xs font-bold text-primary">hozirgi ofitsiant</span>}
                  </span>
                  {busyId === w.id ? (
                    <Spinner className="w-5 h-5 border-primary" />
                  ) : current ? (
                    <IconCheck className="w-5 h-5 text-primary" />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
  );
}
