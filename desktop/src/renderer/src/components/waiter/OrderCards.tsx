// "Olib ketish" / "Yetkazib berish" rejimlari va "Mening buyurtmalarim": ochiq buyurtmalar kartochkalari.
// Birinchi plitka — "+ Yangi buyurtma". Kartochkada: katta raqam (#12 yoki stol raqami), tur nishoni,
// holat (Tayyor — ajralib turadi), necha daqiqa oldin, to'lanadigan summa, taomlar soni, yetkazishda —
// telefon va manzil. Stol hisobida — "Hisob 2" va kunlik raqam (№15). Kassa ruxsati bo'lsa — "To‘lash".
import { CSSProperties, memo } from 'react';
import { MenuUnit, ORDER_TYPE_LABELS, Order, OrderStatus, OrderType, orderDisplayName, orderTypeOf } from '@hardweb-pos/shared';
import { PendingOrder, pendingTitle, pendingType } from '../../lib/offlineQueue';
import { formatSum, minutesSince } from '../ui';
import { IconCash, IconClock, IconCloudUp, IconPhone, IconPin, IconPlus } from './icons';
import {
  OrderStatusChip,
  OrderTypeBadge,
  checkNoOf,
  dailyNumberLabel,
  elapsedLabel,
  formatKg,
  hhmm,
  orderBigNumber,
  orderItemCount,
  payableTotal,
  phoneLabel,
} from './orderUi';

export { payableTotal } from './orderUi';

const GRID_STYLE: CSSProperties = {
  gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(158px, 15vw, 248px), 1fr))',
};

/** Taomlar qisqacha: "Osh ×2, Choy ×1, Lag‘mon 1,5 kg" */
function itemsPreview(o: Order): string {
  return o.items
    .map((it) => `${it.menuItemName ?? ''} ${it.unit === MenuUnit.Weight ? `${formatKg(it.quantity)} kg` : `×${Math.round(Number(it.quantity) || 0)}`}`)
    .join(', ');
}

export interface OrderCardsGridProps {
  orders: Order[];
  /** oflayn navbatdagi YANGI buyurtmalar (hali raqam olmagan) */
  pending?: PendingOrder[];
  /** buyurtma id -> navbatda kutayotgan qo'shimchalar soni */
  queuedAppends?: Map<string, number>;
  now: number;
  /** berilsa — birinchi plitka "+ Yangi buyurtma" */
  onNew?: () => void;
  onOpen: (order: Order) => void;
  /** kassa ruxsati bo'lsa — kartochkada "To‘lash" tugmasi */
  onPay?: (order: Order) => void;
  onOpenPending?: () => void;
  /** kartochkada tur nishoni ko'rsatilsinmi (aralash ro'yxat — "Mening buyurtmalarim") */
  showType?: boolean;
}

function OrderCardsGridImpl({
  orders,
  pending,
  queuedAppends,
  now,
  onNew,
  onOpen,
  onPay,
  onOpenPending,
  showType,
}: OrderCardsGridProps) {
  return (
    <div className="grid gap-2.5 sm:gap-3" style={GRID_STYLE}>
      {onNew && <NewOrderTile onNew={onNew} />}
      {pending?.map((p) => (
        <PendingCard key={p.localId} p={p} onOpen={onOpenPending} />
      ))}
      {orders.map((o) => (
        <OrderCard
          key={o.id}
          order={o}
          now={now}
          queued={queuedAppends?.get(o.id) ?? 0}
          onOpen={onOpen}
          onPay={onPay}
          showType={showType}
        />
      ))}
    </div>
  );
}

export const OrderCardsGrid = memo(OrderCardsGridImpl);

const NewOrderTile = memo(function NewOrderTile({ onNew }: { onNew: () => void }) {
  return (
    <button
      type="button"
      data-testid="new-order"
      onClick={onNew}
      className="group min-h-[164px] rounded-2xl border-2 border-dashed border-primary bg-primary/10 hover:bg-primary/15 flex flex-col items-center justify-center gap-3 p-3 select-none transition-[transform,background-color,border-color] active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <span className="w-16 h-16 rounded-full bg-primary-hover text-white flex items-center justify-center shadow-lg shadow-primary/30 transition-transform group-hover:scale-105">
        <IconPlus className="w-8 h-8" />
      </span>
      <span className="text-lg font-extrabold text-text">Yangi buyurtma</span>
    </button>
  );
});

const OrderCard = memo(function OrderCard({
  order,
  now,
  queued,
  onOpen,
  onPay,
  showType,
}: {
  order: Order;
  now: number;
  queued: number;
  onOpen: (order: Order) => void;
  onPay?: (order: Order) => void;
  showType?: boolean;
}) {
  const type = orderTypeOf(order);
  const dineIn = type === OrderType.DineIn;
  const ready = order.status === OrderStatus.Ready;
  const cooking = order.status === OrderStatus.Cooking;
  const mins = minutesSince(order.openedAt, now);
  const check = dineIn ? checkNoOf(order) : 1;
  const daily = dineIn ? dailyNumberLabel(order) : null;
  const testId = `order-card-${dineIn ? order.tableNumber ?? '' : order.queueNumber ?? ''}`;
  const border = ready
    ? 'border-success shadow-[0_0_26px_-10px_rgb(var(--c-success)/0.9)]'
    : order.billPrintedAt
      ? 'border-warning'
      : cooking
        ? 'border-warning/55'
        : 'border-border';
  return (
    <div
      data-testid={testId}
      data-order-id={order.id}
      data-order-type={type}
      data-check={dineIn ? check : undefined}
      className={`relative rounded-2xl border-2 bg-surface flex flex-col overflow-hidden transition-colors ${border}`}
    >
      <button
        type="button"
        onClick={() => onOpen(order)}
        aria-label={`${orderDisplayName(order)} — ochish`}
        className="flex-1 text-left p-3 flex flex-col gap-1.5 hover:bg-surface-hover active:bg-surface-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[32px] font-black leading-none tracking-tight tabular-nums text-text">
              {orderBigNumber(order)}
            </span>
            {dineIn && check > 1 && (
              <span className="rounded-md bg-primary-hover text-white px-1.5 text-xs font-black leading-5">Hisob {check}</span>
            )}
          </span>
          <OrderStatusChip status={order.status} className="mt-1 shrink-0" />
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <OrderTypeBadge type={type} short={dineIn || !showType} />
          {dineIn && order.hall && <span className="text-xs font-semibold text-muted truncate">{order.hall}</span>}
          {daily && <span className="text-xs font-bold text-muted whitespace-nowrap">{daily}</span>}
          <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-muted shrink-0">
            <IconClock className="w-3.5 h-3.5" />
            {elapsedLabel(mins)}
          </span>
        </div>
        {type === OrderType.Delivery && (
          <div className="mt-0.5 space-y-0.5">
            {order.phone && (
              <div className="flex items-center gap-1.5 text-sm font-bold text-text">
                <IconPhone className="w-3.5 h-3.5 text-success" />
                <span className="truncate">{phoneLabel(order.phone)}</span>
              </div>
            )}
            {order.address && (
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <IconPin className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{order.address}</span>
              </div>
            )}
          </div>
        )}
        {order.billPrintedAt && (
          <div className="self-start rounded-md bg-warning text-black px-1.5 text-[11px] font-extrabold leading-5">
            chek berildi · {hhmm(order.billPrintedAt)}
          </div>
        )}
        {queued > 0 && (
          <div className="flex items-center gap-1 text-xs font-bold text-warning">
            <IconCloudUp className="w-4 h-4" /> Navbatda: +{queued} qo‘shimcha
          </div>
        )}
        {/* Nimalar buyurtma qilingan — kassir paketni tez yig'ishi uchun */}
        {order.items.length > 0 && (
          <div className="text-xs text-muted leading-snug line-clamp-2 break-words">{itemsPreview(order)}</div>
        )}
        <div className="mt-auto pt-1 flex flex-wrap items-end justify-between gap-x-2 gap-y-0.5">
          <span className="text-xs font-semibold text-muted whitespace-nowrap">{orderItemCount(order)} ta taom</span>
          <span className="ml-auto text-lg font-extrabold leading-none tabular-nums text-text whitespace-nowrap">
            {formatSum(payableTotal(order))}
          </span>
        </div>
      </button>
      {onPay && (
        <button
          type="button"
          data-testid="pay-order"
          onClick={() => onPay(order)}
          className="h-12 flex items-center justify-center gap-2 font-extrabold text-black bg-success hover:brightness-105 active:brightness-95 transition-[filter] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text/60"
        >
          <IconCash className="w-5 h-5" /> To‘lash
        </button>
      )}
    </div>
  );
});

/** Oflayn navbatdagi yangi buyurtma — server raqam bergunча "Navbatda (oflayn)" */
const PendingCard = memo(function PendingCard({ p, onOpen }: { p: PendingOrder; onOpen?: () => void }) {
  const type = pendingType(p);
  // Dona — butun miqdor, kg qator — 1 ta taom
  const count = p.items.reduce((n, it) => {
    const q = Number(it.quantity) || 0;
    return n + (it.unit === MenuUnit.Weight || !Number.isInteger(q) ? 1 : Math.max(1, q));
  }, 0);
  return (
    <button
      type="button"
      data-testid="pending-card"
      onClick={onOpen}
      className={`min-h-[164px] rounded-2xl border-2 border-dashed p-3 text-left flex flex-col gap-1.5 transition-colors ${
        p.failed ? 'border-danger bg-danger/5 hover:bg-danger/10' : 'border-warning bg-warning/5 hover:bg-warning/10'
      }`}
    >
      <div className="flex items-center gap-2">
        <IconCloudUp className={`w-7 h-7 ${p.failed ? 'text-danger' : 'text-warning'}`} />
        <span className={`text-sm font-extrabold leading-tight ${p.failed ? 'text-danger' : 'text-text'}`}>
          {p.failed ? 'Yuborilmadi — tekshiring' : 'Navbatda (oflayn)'}
        </span>
      </div>
      <OrderTypeBadge type={type} className="self-start" />
      <div className="text-sm font-bold text-text truncate">{type === OrderType.DineIn ? pendingTitle(p) : ORDER_TYPE_LABELS[type]}</div>
      {type === OrderType.Delivery && (p.phone || p.address) && (
        <div className="text-xs text-text font-semibold truncate">
          {p.phone ? phoneLabel(p.phone) : ''}
          {p.phone && p.address ? ' · ' : ''}
          {p.address}
        </div>
      )}
      {/* Taomlar nomi (navbatga yozilgan nomlardan) */}
      {p.items.some((it) => it.name) && (
        <div className="text-xs text-muted leading-snug line-clamp-2 break-words">
          {p.items
            .map((it) => `${it.name ?? ''} ${it.unit === MenuUnit.Weight ? `${formatKg(it.quantity)} kg` : `×${it.quantity}`}`)
            .join(', ')}
        </div>
      )}
      <div className="mt-auto flex items-end justify-between gap-2 text-xs font-semibold text-muted">
        <span>{count} ta taom</span>
        <span>{hhmm(new Date(p.createdAt).toISOString())}</span>
      </div>
    </button>
  );
});
