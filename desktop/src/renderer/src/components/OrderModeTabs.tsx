import { memo } from 'react';
import { ORDER_TYPE_LABELS, OrderType } from '@hardweb-pos/shared';
import { IconBag, IconGrid, IconProps, IconScooter, IconTable } from './waiter/icons';

// Ekran tepasidagi "Stolga | Olib ketish | Yetkazib berish" tugmalari (har birida ochiq buyurtmalar soni).
// Kassa ekrani withAll bilan ishlatadi: "Hammasi | Stolga | Olib ketish | Yetkazib berish".
export type OrderModeValue = OrderType | 'all';

export interface OrderModeTabsProps {
  value: OrderModeValue;
  onChange: (value: OrderModeValue) => void;
  /** har bir turdagi ochiq buyurtmalar soni (badge); 'all' — umumiy soni */
  counts?: Partial<Record<OrderModeValue, number>>;
  /** boshida "Hammasi" tugmasi ham bo'lsin (kassa) */
  withAll?: boolean;
  /** ixcham ko'rinish (telefon / tor ekran) */
  compact?: boolean;
}

interface ModeItem {
  value: OrderModeValue;
  label: string;
  short: string;
  Icon: (p: IconProps) => JSX.Element;
  /** Nofaol tugmadagi belgi rangi — tur rangi (R1); faol tugmada belgi oq */
  tint: string;
}

const ALL_ITEM: ModeItem = { value: 'all', label: 'Hammasi', short: 'Hammasi', Icon: IconGrid, tint: 'text-muted' };
const TYPE_ITEMS: ModeItem[] = [
  { value: OrderType.DineIn, label: ORDER_TYPE_LABELS[OrderType.DineIn], short: 'Stol', Icon: IconTable, tint: 'text-primary' },
  { value: OrderType.Takeaway, label: ORDER_TYPE_LABELS[OrderType.Takeaway], short: 'Olib', Icon: IconBag, tint: 'text-warning' },
  { value: OrderType.Delivery, label: ORDER_TYPE_LABELS[OrderType.Delivery], short: 'Yetkaz', Icon: IconScooter, tint: 'text-success' },
];

/**
 * Buyurtma rejimi tugmalari — katta, sensorli ekranga qulay (≥ 48 px). Faol tugma — to'q yashil
 * (primary) oq matn bilan; qolganlari — surface. Har tugmada ochiq buyurtmalar soni (badge).
 * data-testid: mode-stol / mode-olib_ketish / mode-yetkazish (/ mode-all).
 */
function OrderModeTabsImpl({ value, onChange, counts, withAll, compact }: OrderModeTabsProps) {
  const items = withAll ? [ALL_ITEM, ...TYPE_ITEMS] : TYPE_ITEMS;
  return (
    <div
      role="group"
      aria-label="Buyurtma turi"
      className={`flex gap-1.5 sm:gap-2 ${compact ? 'w-full' : 'flex-wrap'}`}
    >
      {items.map((it) => {
        const active = value === it.value;
        const count = counts?.[it.value];
        const hasCount = typeof count === 'number';
        const badge = active
          ? 'bg-white/25 text-white'
          : hasCount && count > 0
            ? 'bg-primary-hover text-white'
            : 'bg-bg text-muted border border-border';
        return (
          <button
            key={it.value}
            type="button"
            aria-pressed={active}
            aria-label={hasCount ? `${it.label}: ${count} ta ochiq buyurtma` : it.label}
            data-testid={`mode-${it.value}`}
            onClick={() => onChange(it.value)}
            className={`relative select-none rounded-xl font-bold transition-[transform,background-color,border-color] duration-150 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
              compact
                ? 'flex-1 min-w-0 h-12 px-1.5 flex flex-col items-center justify-center gap-0.5 text-xs'
                : 'h-14 px-4 lg:px-5 flex items-center gap-2.5 text-base'
            } ${
              active
                ? 'bg-primary-hover text-white shadow-lg shadow-primary/25 border border-primary-hover'
                : 'bg-surface text-text border border-border hover:bg-surface-hover hover:border-primary/40'
            }`}
          >
            {/* Nofaol tugmada belgi tur rangida (R1), faolida — oq */}
            <it.Icon className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} ${active ? '' : it.tint}`} strokeWidth={2.2} />
            <span className={`whitespace-nowrap ${compact ? 'leading-none truncate max-w-full' : ''}`}>
              {compact ? it.short : it.label}
            </span>
            {hasCount &&
              (compact ? (
                // Ixcham: burchakdagi kichik son
                <span
                  className={`absolute -top-1.5 right-0.5 min-w-[20px] h-5 px-1 rounded-full text-[11px] font-extrabold flex items-center justify-center ${badge}`}
                >
                  {count}
                </span>
              ) : (
                <span
                  className={`min-w-[26px] h-[26px] px-1.5 rounded-full text-sm font-extrabold flex items-center justify-center ${badge}`}
                >
                  {count}
                </span>
              ))}
          </button>
        );
      })}
    </div>
  );
}

const OrderModeTabs = memo(OrderModeTabsImpl);
export default OrderModeTabs;
export { OrderModeTabs };
