import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { MenuUnit, Order, OrderStatus, OrderType, SplitOrderResult, orderTypeOf } from '@hardweb-pos/shared';
import { useAuth } from '../state/auth';
import SplitCheckModal from './SplitCheckModal';
import VoidModal from './VoidModal';
import { ChangeTypeModal } from './orderActions/ChangeTypeModal';
import { MoveTableModal } from './orderActions/MoveTableModal';
import { ChangeWaiterModal } from './orderActions/ChangeWaiterModal';
import { printBillAndMark } from './orderActions/printBill';
import { canChangeWaiter, canPrintBill, canVoid, canWorkOrders } from './orderActions/perms';
import { IconBan, IconPrinter, IconProps, IconRepeat, IconScissors, IconTableMove, IconUserSwap } from './waiter/icons';
import { Spinner } from './waiter/Sheet';

// Mavjud (yuborilgan) buyurtma ostidagi amallar qatori — eski POS'dagi "Turi | Ofitsiant | Chek" kabi (B22).
// Ofitsiant ekrani (har bir ochiq buyurtma) ham, kassadagi to'lov oynasi ham ishlatadi:
//  - Turi       — Stolga / Olib ketish / Yetkazib berish (POST /orders/:id/change-type)
//  - Stol       — boshqa stolga ko'chirish (POST /orders/:id/move-table; "butun stol" — barcha hisoblar)
//  - Ofitsiant  — ofitsiantni almashtirish (faqat kassir/direktor; POST /orders/:id/change-waiter)
//  - Chek       — schot (pre-bill) chop etish + "chek berildi" (POST /orders/:id/bill-printed)
//  - ✂ Bo'lish  — SplitCheckModal (faqat stol hisobi)
//  - 🚫 Otkaz   — VoidModal (faqat 'void' ruxsati bor xodim)
// Har bir tugma xodim ruxsatiga va buyurtma turiga qarab ko'rinadi; oynalar shu komponent ichida ochiladi.
// Natija (yoki xato) tugmalar ostida qisqa xabar bo'lib chiqadi.
export interface OrderActionsBarProps {
  order: Order;
  /** shu stoldagi boshqa ochiq hisoblar (bo'lish / butun stolni ko'chirish uchun) */
  siblings?: Order[];
  /** amal bajarilgach: yangilangan buyurtma (butun hisob bekor qilinsa — null) */
  onChanged: (order: Order | null) => void;
  /** qaysi tugmalar ko'rsatilmasin (masalan kassada 'bill' alohida bo'lsa) */
  hide?: Array<'type' | 'table' | 'waiter' | 'bill' | 'split' | 'void'>;
  /** ixcham (telefon / tor panel) */
  compact?: boolean;
  /**
   * (ixtiyoriy) amallar vaqtincha mumkin emas — sababi (masalan savatda yuborilmagan taom bor).
   * Tugma bosilsa oyna ochilmaydi, shu sabab ko'rsatiladi.
   */
  blocked?: string | null;
  /**
   * (ixtiyoriy) hisob bo'lingandan keyin — ikkala hisob (qolgan va yangi). Berilsa onChanged o'rniga
   * shu chaqiriladi (masalan ofitsiant ekrani yangi hisobni tanlaydi); berilmasa — onChanged(source).
   */
  onSplit?: (result: SplitOrderResult) => void;
}

type ActionKey = 'type' | 'table' | 'waiter' | 'bill' | 'split' | 'void';

interface ActionDef {
  key: ActionKey;
  label: string;
  Icon: (p: IconProps) => JSX.Element;
  /** tugma rangi: oddiy (neytral), chek (sariq), otkaz (qizil) */
  tone: 'plain' | 'bill' | 'danger';
  /** tugma ko'rinadi, lekin bosib bo'lmaydi — sababi */
  disabledReason?: string;
}

/** Hisobni bo'lish mumkinmi: kamida bitta taom qolishi kerak (1 dona bitta qator — bo'linmaydi) */
function canSplitItems(o: Order): boolean {
  const items = o.items ?? [];
  if (items.length >= 2) return true;
  const only = items[0];
  if (!only) return false;
  return only.unit === MenuUnit.Weight ? Number(only.quantity) > 0.001 : Number(only.quantity) >= 2;
}

const TONE: Record<ActionDef['tone'], string> = {
  plain: 'bg-surface text-text border-border hover:border-primary hover:bg-surface-hover',
  // Chek — to'q sariq (egasining talabi), qora matn
  bill: 'bg-bill text-black border-bill hover:brightness-105',
  // Otkaz — to'q qizil, oq matn
  danger: 'bg-danger text-white border-danger hover:brightness-110',
};

const ICON_TINT: Record<ActionKey, string> = {
  type: 'text-warning',
  table: 'text-primary',
  waiter: 'text-primary',
  bill: '',
  split: 'text-primary',
  void: '',
};

export default function OrderActionsBar({ order, siblings, onChanged, hide, compact, blocked, onSplit }: OrderActionsBarProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState<ActionKey | null>(null);
  const [printing, setPrinting] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const msgTimer = useRef<number | undefined>(undefined);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(msgTimer.current);
    };
  }, []);
  // Boshqa buyurtma ochilsa — eski xabar o'chadi
  useEffect(() => {
    setMsg(null);
    setOpen(null);
  }, [order.id]);

  function flash(tone: 'ok' | 'error' | 'warn', text: string) {
    window.clearTimeout(msgTimer.current);
    setMsg({ tone, text });
    // Muvaffaqiyat xabari o'zi yo'qoladi; xato — keyingi amalgacha turadi
    if (tone === 'ok') msgTimer.current = window.setTimeout(() => alive.current && setMsg(null), 4000);
  }

  if (order.status === OrderStatus.Closed) return null;

  const type = orderTypeOf(order);
  const dineIn = type === OrderType.DineIn;
  const hidden = new Set(hide ?? []);
  const others = (siblings ?? []).filter((s) => s.id !== order.id);
  const work = canWorkOrders(user);
  const noItems = (order.items ?? []).length === 0;

  const actions: ActionDef[] = [];
  if (work && !hidden.has('type')) actions.push({ key: 'type', label: 'Turi', Icon: IconRepeat, tone: 'plain' });
  if (work && dineIn && !hidden.has('table')) actions.push({ key: 'table', label: 'Stol', Icon: IconTableMove, tone: 'plain' });
  if (canChangeWaiter(user) && !hidden.has('waiter')) {
    actions.push({ key: 'waiter', label: 'Ofitsiant', Icon: IconUserSwap, tone: 'plain' });
  }
  if (work && canPrintBill(user) && !hidden.has('bill')) {
    actions.push({
      key: 'bill',
      label: 'Chek',
      Icon: IconPrinter,
      tone: 'bill',
      disabledReason: noItems ? 'Hisobda taom yo‘q' : undefined,
    });
  }
  if (work && dineIn && !hidden.has('split')) {
    actions.push({
      key: 'split',
      label: 'Bo‘lish',
      Icon: IconScissors,
      tone: 'plain',
      disabledReason: canSplitItems(order) ? undefined : 'Bo‘lish uchun hisobda kamida 2 ta taom bo‘lishi kerak',
    });
  }
  if (canVoid(user) && !hidden.has('void')) {
    actions.push({
      key: 'void',
      label: 'Otkaz',
      Icon: IconBan,
      tone: 'danger',
      disabledReason: noItems ? 'Hisobda taom yo‘q' : undefined,
    });
  }
  if (actions.length === 0) return null;

  async function printBill() {
    if (printing) return;
    setPrinting(true);
    setMsg(null);
    try {
      const res = await printBillAndMark(order);
      if (!alive.current) return;
      flash('ok', res.via === 'local' ? '✓ Schot chiqdi — chek berildi' : '✓ Schot kassa printeriga yuborildi');
      onChanged(res.order);
    } catch (e) {
      if (alive.current) flash('error', (e as Error)?.message || 'Schot chiqmadi');
    } finally {
      if (alive.current) setPrinting(false);
    }
  }

  function press(a: ActionDef) {
    if (blocked) {
      flash('warn', blocked);
      return;
    }
    if (a.disabledReason) {
      flash('warn', a.disabledReason);
      return;
    }
    setMsg(null);
    if (a.key === 'bill') void printBill();
    else setOpen(a.key);
  }

  const done = (text: string) => (o: Order | null) => {
    setOpen(null);
    flash('ok', text);
    onChanged(o);
  };

  const btn = (a: ActionDef): ReactNode => {
    const busy = a.key === 'bill' && printing;
    const dim = !!blocked || !!a.disabledReason;
    return (
      <button
        key={a.key}
        type="button"
        onClick={() => press(a)}
        disabled={busy}
        aria-disabled={dim || undefined}
        data-testid={`action-${a.key}`}
        title={a.disabledReason ?? blocked ?? a.label}
        className={`relative select-none rounded-xl border font-extrabold transition-[transform,background-color,border-color,filter] duration-150 active:scale-[0.96] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-wait ${
          TONE[a.tone]
        } ${dim ? 'opacity-55' : ''} ${
          compact
            ? 'min-w-0 h-14 px-1 flex flex-col items-center justify-center gap-0.5 text-[11px] leading-none'
            : 'h-12 px-3.5 flex items-center gap-2 text-sm'
        }`}
      >
        {busy ? (
          <Spinner className={`${compact ? 'w-5 h-5' : 'w-4 h-4'} border-black`} />
        ) : (
          <a.Icon className={`${compact ? 'w-5 h-5' : 'w-5 h-5'} ${ICON_TINT[a.key]}`} strokeWidth={2.3} />
        )}
        <span className="truncate max-w-full">{a.label}</span>
      </button>
    );
  };

  return (
    <div data-testid="order-actions">
      {compact ? (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}>
          {actions.map(btn)}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">{actions.map(btn)}</div>
      )}
      {msg && (
        <div
          role={msg.tone === 'error' ? 'alert' : 'status'}
          className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold ${
            msg.tone === 'ok'
              ? 'bg-success/15 text-success'
              : msg.tone === 'warn'
                ? 'bg-warning/15 text-warning'
                : 'bg-danger/10 text-danger'
          }`}
        >
          {msg.text}
        </div>
      )}

      {open === 'type' && (
        <ChangeTypeModal order={order} onClose={() => setOpen(null)} onDone={done('✓ Buyurtma turi o‘zgartirildi')} />
      )}
      {open === 'table' && (
        <MoveTableModal order={order} siblings={others} onClose={() => setOpen(null)} onDone={done('✓ Stol o‘zgartirildi')} />
      )}
      {open === 'waiter' && (
        <ChangeWaiterModal order={order} onClose={() => setOpen(null)} onDone={done('✓ Ofitsiant almashtirildi')} />
      )}
      {open === 'split' && (
        <SplitCheckModal
          order={order}
          siblings={others}
          onClose={() => setOpen(null)}
          onDone={(r) => {
            setOpen(null);
            flash('ok', '✓ Hisob bo‘lindi');
            if (onSplit) onSplit(r);
            else onChanged(r.source);
          }}
        />
      )}
      {open === 'void' && (
        <VoidModal order={order} onClose={() => setOpen(null)} onDone={done('✓ Otkaz qilindi')} />
      )}
    </div>
  );
}

export { OrderActionsBar };
