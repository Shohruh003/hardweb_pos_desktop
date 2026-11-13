import { memo } from 'react';
import { MenuUnit, OrderStatus, OrderType, orderTypeOf, roundSum } from '@hardweb-pos/shared';
import type { Order, Receipt } from '@hardweb-pos/shared';
import { formatSum, minutesSince } from '../ui';
import {
  OrderName,
  OrderTypeBadge,
  StatusChip,
  TYPE_STYLE,
  clock,
  dailyNumber,
  displayPhone,
  formatAge,
  orderTotals,
} from './orderType';
import { ClockIcon, PencilIcon, PhoneIcon, PinIcon, PrinterIcon, ScissorsIcon, UserIcon } from './icons';

export interface CashierOrderCardProps {
  order: Order;
  /** to'langan, lekin chek hali chiqarilmagan (kassa "chek chiqmadi" ro'yxati) */
  unprinted?: boolean;
  receipt?: Receipt;
  now: number;
  onOpen: (order: Order, receipt?: Receipt) => void;
  onEditDelivery?: (order: Order) => void;
  /** "O‘zgartirish" — POS ekranida shu hisobni ochish (taom qo'shish, amallar) */
  onEdit?: (order: Order) => void;
  /** "Hisobni bo‘lish" (faqat stol hisobi) */
  onSplit?: (order: Order) => void;
}

/** Bo'lish mumkinmi: kamida bitta taom qolishi kerak (1 dona bitta qator — bo'linmaydi) */
function canSplit(o: Order): boolean {
  const items = o.items ?? [];
  if (items.length >= 2) return true;
  const only = items[0];
  if (!only) return false;
  return only.unit === MenuUnit.Weight ? Number(only.quantity) > 0.001 : Number(only.quantity) >= 2;
}

// Kassa ekranidagi bitta hisob kartochkasi: nom (orderDisplayName — "Stol 5 · Hisob 2"), tur belgisi,
// kunlik raqam (№15), holat, "chek berildi" (schot vaqti bilan), (stolda) zal, (yetkazishda)
// telefon/manzil, to'lanadigan summa, to'langan/qoldiq, necha daqiqa ochiq va ofitsiant.
// Pastda amallar: O‘zgartirish (POS ekranida), Bo‘lish (stol hisobi), Manzil (yetkazish).
// memo — ro'yxat yangilanganda o'zgarmagan kartochka qayta chizilmaydi.
function CardImpl({ order, unprinted, receipt, now, onOpen, onEditDelivery, onEdit, onSplit }: CashierOrderCardProps) {
  const type = orderTypeOf(order);
  const style = TYPE_STYLE[type];
  const ready = !unprinted && order.status === OrderStatus.Ready;
  const payable = unprinted && receipt ? roundSum(receipt.total) : orderTotals(order).total;
  const paid = unprinted ? payable : Math.min(payable, roundSum(order.paidAmount ?? 0));
  const remaining = Math.max(0, payable - paid);
  const minutes = minutesSince(order.openedAt, now);
  const itemsCount = order.items?.length ?? 0;
  const dineIn = type === OrderType.DineIn;
  const no = dineIn ? order.tableNumber : order.queueNumber;
  const daily = dineIn ? dailyNumber(order) : null;
  const billAt = !unprinted && order.billPrintedAt ? clock(order.billPrintedAt) : '';
  // Bitta stolda bir nechta hisob bo'lsa (Hisob 2, 3…) — testid takrorlanmasin
  const check = dineIn && order.checkNo && order.checkNo > 1 ? `-${order.checkNo}` : '';
  const testId = `${unprinted ? 'cashier-unprinted' : 'cashier-card'}-${no ?? order.id}${check}`;

  const frame = unprinted
    ? 'bg-warning/10 border-warning/60'
    : billAt
      ? 'bg-warning/[0.08] border-warning'
      : ready
        ? 'bg-success/[0.07] border-success/60'
        : 'bg-surface border-border hover:border-primary/60';

  const actions: { key: string; label: string; short: string; icon: JSX.Element; onClick: () => void; tone: string; testId: string }[] = [];
  if (!unprinted && onEdit) {
    actions.push({
      key: 'edit',
      label: 'O‘zgartirish',
      short: 'Tahrir',
      icon: <PencilIcon className="w-4 h-4" />,
      onClick: () => onEdit(order),
      tone: 'text-text hover:bg-surface-hover',
      testId: 'card-action-edit',
    });
  }
  if (!unprinted && dineIn && onSplit && canSplit(order)) {
    actions.push({
      key: 'split',
      label: 'Bo‘lish',
      short: 'Bo‘lish',
      icon: <ScissorsIcon className="w-4 h-4" />,
      onClick: () => onSplit(order),
      tone: 'text-primary hover:bg-primary/10',
      testId: 'card-action-split',
    });
  }
  if (!unprinted && type === OrderType.Delivery && onEditDelivery) {
    actions.push({
      key: 'delivery',
      label: 'Manzil',
      short: 'Manzil',
      icon: <PinIcon className="w-4 h-4" />,
      onClick: () => onEditDelivery(order),
      tone: `${style.text} hover:bg-success/10`,
      testId: 'card-action-address',
    });
  }

  return (
    <div
      data-testid={testId}
      data-order-type={type}
      data-order-id={order.id}
      data-bill={billAt ? 'true' : undefined}
      className={`relative flex flex-col rounded-2xl border-2 transition-colors ${frame}`}
    >
      <button
        type="button"
        onClick={() => onOpen(order, receipt)}
        className="flex-1 flex flex-col items-stretch justify-start text-left p-3 sm:p-3.5 rounded-2xl active:scale-[0.99] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <OrderTypeBadge type={type} />
            {daily && (
              <span className="rounded-md bg-text text-bg px-1.5 text-xs font-black leading-5 whitespace-nowrap">{daily}</span>
            )}
          </span>
          {unprinted ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold bg-warning text-black whitespace-nowrap">
              <PrinterIcon className="w-3.5 h-3.5" /> Chek chiqmadi
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              {ready && type !== OrderType.DineIn && <span className="w-2 h-2 rounded-full bg-success animate-pulse" />}
              <StatusChip status={order.status} />
            </span>
          )}
        </div>

        <OrderName order={order} className="mt-2" />
        {dineIn && order.hall && <div className="text-sm font-semibold text-muted truncate">{order.hall}</div>}
        {type === OrderType.Delivery && (
          <div className="mt-1 space-y-0.5 text-sm">
            <div className="flex items-center gap-1.5 font-bold text-text min-w-0">
              <PhoneIcon className={`w-4 h-4 shrink-0 ${style.text}`} />
              <span className="truncate">{order.phone ? displayPhone(order.phone) : 'Telefon yo‘q'}</span>
            </div>
            <div className="flex items-start gap-1.5 text-muted min-w-0">
              <PinIcon className={`w-4 h-4 shrink-0 mt-0.5 ${style.text}`} />
              <span className="line-clamp-2 break-words">{order.address || 'Manzil kiritilmagan'}</span>
            </div>
          </div>
        )}

        {/* Schot (hisob cheki) mijozga berilgan — eski POS'dagidek sariq "chek berildi" va vaqti */}
        {billAt && (
          <div
            className="mt-2 self-start inline-flex items-center gap-1.5 rounded-lg bg-bill text-black px-2 py-1 text-xs font-extrabold"
            data-testid="card-bill"
          >
            <PrinterIcon className="w-3.5 h-3.5" /> chek berildi · {billAt}
          </div>
        )}

        <div className="mt-2 flex items-center gap-x-3 gap-y-1 flex-wrap text-xs font-semibold text-muted">
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="w-3.5 h-3.5" /> {clock(order.openedAt)} · {formatAge(minutes)}
          </span>
          <span>{itemsCount} ta taom</span>
          {order.waiterName && (
            <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
              <UserIcon className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{order.waiterName}</span>
            </span>
          )}
        </div>

        {/* Summa kartochka pastida — qatordagi kartochkalarda bir chiziqda turadi */}
        <div className="mt-auto pt-2.5 text-xl sm:text-[22px] font-extrabold text-text leading-none tabular-nums">{formatSum(payable)}</div>
        {unprinted ? (
          <div className="mt-1.5 text-xs font-bold text-warning">Chop etish uchun bosing</div>
        ) : (
          paid > 0 && (
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-bg overflow-hidden">
                <div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, (paid / Math.max(1, payable)) * 100)}%` }} />
              </div>
              <div className="mt-1 space-y-0.5 text-xs font-bold">
                <div className="flex justify-between gap-2">
                  <span className="text-muted">To‘langan</span>
                  <span className="text-success whitespace-nowrap">{formatSum(paid)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted">Qoldi</span>
                  <span className={`whitespace-nowrap ${remaining > 0 ? 'text-danger' : 'text-success'}`}>{formatSum(remaining)}</span>
                </div>
              </div>
            </div>
          )
        )}
      </button>

      {actions.length > 0 && (
        <div className="flex border-t border-border rounded-b-2xl overflow-hidden">
          {actions.map((a, i) => (
            <button
              key={a.key}
              type="button"
              onClick={a.onClick}
              data-testid={a.testId}
              className={`flex-1 min-w-0 h-12 flex items-center justify-center gap-1.5 text-sm font-bold transition-colors ${a.tone} ${
                i > 0 ? 'border-l border-border' : ''
              }`}
            >
              {a.icon}
              <span className="truncate hidden sm:inline">{a.label}</span>
              <span className="truncate sm:hidden">{a.short}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const CashierOrderCard = memo(CardImpl);
