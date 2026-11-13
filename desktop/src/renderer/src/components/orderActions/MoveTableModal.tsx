// "Stol" — hisobni boshqa stolga ko'chirish (B22a / B18). Misol: 4-stoldagi 5 mehmonga do'stlari
// qo'shildi va hammasi 7-stolga o'tdi. Stolda bir nechta hisob bo'lsa — "Faqat shu hisob" yoki
// "Butun stol (barcha hisoblar)" tanlanadi (butun stol — har bir hisob alohida ko'chiriladi).
// Band stolga ko'chirilsa — hisob u yerda qo'shimcha hisob bo'lib qo'shiladi (server keyingi raqamni beradi).
import { useState } from 'react';
import { Order, Table, orderDisplayName } from '@hardweb-pos/shared';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';
import { Sheet, SheetError, Spinner } from '../waiter/Sheet';
import { IconTableMove } from '../waiter/icons';
import { checkNoOf, orderFullName } from '../waiter/orderUi';
import { TablePicker } from './TablePicker';

type Scope = 'one' | 'all';

export function MoveTableModal({
  order,
  siblings = [],
  onClose,
  onDone,
}: {
  order: Order;
  /** shu stoldagi boshqa ochiq hisoblar */
  siblings?: Order[];
  onClose: () => void;
  /** ko'chirilgandan keyin: shu hisobning yangilangan holati */
  onDone: (order: Order) => void;
}) {
  const confirm = useConfirm();
  const others = siblings.filter((s) => s.id !== order.id);
  const [scope, setScope] = useState<Scope>('one');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(table: Table, checks: Order[]) {
    if (busy) return;
    const moving = scope === 'all' ? [order, ...others].sort((a, b) => checkNoOf(a) - checkNoOf(b)) : [order];
    if (checks.length > 0) {
      const ok = await confirm({
        title: `Stol ${table.number} band`,
        message:
          moving.length > 1
            ? `${moving.length} ta hisob Stol ${table.number} ga qo‘shimcha hisoblar bo‘lib qo‘shiladi. Davom etilsinmi?`
            : `${orderDisplayName(order)} Stol ${table.number} ga qo‘shimcha hisob bo‘lib qo‘shiladi. Davom etilsinmi?`,
        confirmText: 'Ha, ko‘chirish',
        cancelText: 'Yo‘q',
      });
      if (!ok) return;
    }
    setBusy(true);
    setError('');
    let moved = 0;
    let mine: Order | null = null;
    try {
      // Butun stol: har bir hisob navbat bilan (server har birini alohida tekshiradi)
      for (const o of moving) {
        const updated = await api.post<Order>(`/orders/${o.id}/move-table`, { tableId: table.id });
        moved++;
        if (o.id === order.id) mine = updated ?? null;
      }
      onDone(mine ?? { ...order, tableId: table.id, tableNumber: table.number, hall: table.hall });
    } catch (e) {
      const msg = (e as Error)?.message || 'Stol o‘zgarmadi';
      setError(moved > 0 ? `${moved} ta hisob ko‘chirildi, qolganlari ko‘chmadi: ${msg}` : msg);
    } finally {
      setBusy(false);
    }
  }

  const scopeBtn = (value: Scope, title: string, hint: string) => (
    <button
      type="button"
      onClick={() => setScope(value)}
      aria-pressed={scope === value}
      data-testid={`move-scope-${value}`}
      disabled={busy}
      className={`flex-1 min-h-[60px] rounded-2xl border-2 px-3 py-2 text-left transition-colors ${
        scope === value
          ? 'bg-primary-hover border-primary-hover text-white'
          : 'bg-bg border-border text-text hover:border-primary'
      }`}
    >
      <span className="block font-extrabold leading-tight">{title}</span>
      <span className={`block text-xs font-semibold mt-0.5 ${scope === value ? 'text-white/90' : 'text-muted'}`}>{hint}</span>
    </button>
  );

  return (
    <Sheet
      title="Boshqa stolga ko‘chirish"
      subtitle={orderFullName(order)}
      icon={<IconTableMove className="w-6 h-6" />}
      size="lg"
      busy={busy}
      onClose={onClose}
      testId="move-table-modal"
      footer={
        <div className="flex items-center gap-3">
          <span className="flex-1 text-sm font-semibold text-muted">
            {busy ? (
              <span className="flex items-center gap-2 text-text">
                <Spinner className="w-5 h-5 border-primary" /> Ko‘chirilmoqda…
              </span>
            ) : (
              'Yangi stolni tanlang — bo‘sh yoki band'
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-12 px-5 rounded-xl bg-bg border border-border font-bold hover:border-text disabled:opacity-50"
          >
            Bekor
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {others.length > 0 && (
          <div className="flex gap-2">
            {scopeBtn('one', 'Faqat shu hisob', orderDisplayName(order))}
            {scopeBtn('all', 'Butun stol (barcha hisoblar)', `${others.length + 1} ta hisob birga ko‘chadi`)}
          </div>
        )}
        <SheetError>{error}</SheetError>
        <TablePicker excludeTableId={order.tableId} disabled={busy} onPick={(t, c) => void pick(t, c)} />
      </div>
    </Sheet>
  );
}
