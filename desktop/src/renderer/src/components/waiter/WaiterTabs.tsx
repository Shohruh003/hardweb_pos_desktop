// Ofitsiant / kassir (POS) ekranining yagona yuqori qatori (egasining talabi, D1 + B23):
//   Barcha | Zal | Tapchan | Stol | Olib ketish | Yetkazib berish
// "Barcha" — barcha zallar stollari zal sarlavhalari bilan; zal tugmasi — shu zal stollari;
// "Olib ketish" / "Yetkazib berish" — ochiq buyurtmalar ro'yxati. Har tugmada son: zallarda band
// stollar, rejimlarda ochiq buyurtmalar. Faol tugma — to'q yashil (primary), oq matn.
// Qator hech qachon ikkinchi qatorga tushmaydi: tor ekranda gorizontal aylanadi, faol tugma doim ko'rinadi.
import { memo, useEffect, useRef, useState } from 'react';
import { ORDER_TYPE_LABELS, OrderType } from '@hardweb-pos/shared';
import { IconBag, IconChevronLeft, IconChevronRight, IconGrid, IconProps, IconScooter, IconTable } from './icons';

/** Bosh ekran bo'limi: hamma zallar / bitta zal / olib ketish / yetkazish */
export type HomeTab = 'all' | `hall:${string}` | OrderType.Takeaway | OrderType.Delivery;

export const hallTab = (hall: string): HomeTab => `hall:${hall}`;
/** Bo'lim zali (zal tugmasi bo'lsa) */
export function tabHall(tab: HomeTab | null): string | null {
  return tab && tab.startsWith('hall:') ? tab.slice(5) : null;
}
/** Bo'lim qaysi buyurtma turiga tegishli (Barcha va zallar — stolga) */
export function tabMode(tab: HomeTab | null): OrderType {
  return tab === OrderType.Takeaway || tab === OrderType.Delivery ? tab : OrderType.DineIn;
}
/** Saqlangan matndan bo'lim (noto'g'ri bo'lsa — null) */
export function parseTab(v: string | null | undefined): HomeTab | null {
  if (!v) return null;
  if (v === 'all' || v === OrderType.Takeaway || v === OrderType.Delivery) return v as HomeTab;
  if (v.startsWith('hall:') && v.length > 5) return v as HomeTab;
  return null;
}

export interface WaiterTabsProps {
  /** stolga rejimi zallari (sozlamadagi tartibda) */
  halls: string[];
  /** zal -> band stollar soni */
  busyByHall: Map<string, number>;
  /** barcha zallardagi band stollar */
  totalBusy: number;
  active: HomeTab | null;
  /** olib ketish / yetkazish ochiq buyurtmalari soni */
  takeawayCount: number;
  deliveryCount: number;
  compact?: boolean;
  onSelect: (tab: HomeTab) => void;
}

function WaiterTabsImpl({
  halls,
  busyByHall,
  totalBusy,
  active,
  takeawayCount,
  deliveryCount,
  compact,
  onSelect,
}: WaiterTabsProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  // Qator sig'masa — chetlarda soya va strelka: yashirin tugmalar (masalan telefonda "Olib ketish") borligi ko'rinsin
  const [edges, setEdges] = useState({ left: false, right: false });

  // Faol tugma ko'rinib tursin (tor ekranda qator aylanadi)
  useEffect(() => {
    const el = rowRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    try {
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch {
      /* eski brauzer */
    }
  }, [active]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const update = () => {
      const left = row.scrollLeft > 4;
      const right = row.scrollLeft + row.clientWidth < row.scrollWidth - 4;
      setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    row.addEventListener('scroll', update, { passive: true });
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(update);
      ro.observe(row);
    } catch {
      window.addEventListener('resize', update);
    }
    return () => {
      row.removeEventListener('scroll', update);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', update);
    };
  }, [halls.length, compact]);

  const scrollBy = (dir: 1 | -1) => {
    const row = rowRef.current;
    if (!row) return;
    try {
      row.scrollBy({ left: dir * Math.max(160, row.clientWidth * 0.6), behavior: 'smooth' });
    } catch {
      row.scrollLeft += dir * 200;
    }
  };

  return (
    <div className="relative min-w-0">
    <div
      ref={rowRef}
      role="tablist"
      aria-label="Zallar va buyurtma turlari"
      className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto min-w-0 py-1 -my-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {halls.length > 1 && (
        <Tab
          active={active === 'all'}
          Icon={IconGrid}
          tint="text-primary"
          label="Barcha"
          count={totalBusy}
          tone="busy"
          compact={compact}
          testId="tab-all"
          onClick={() => onSelect('all')}
        />
      )}
      {halls.map((h) => (
        <Tab
          key={`hall:${h}`}
          active={active === hallTab(h)}
          Icon={IconTable}
          tint="text-primary"
          label={h}
          count={busyByHall.get(h) ?? 0}
          tone="busy"
          compact={compact}
          testId={`hall-${h}`}
          hall={h}
          onClick={() => onSelect(hallTab(h))}
        />
      ))}
      {halls.length > 0 && <span className="shrink-0 w-px h-9 bg-border mx-0.5" aria-hidden />}
      <Tab
        active={active === OrderType.Takeaway}
        Icon={IconBag}
        tint="text-warning"
        label={ORDER_TYPE_LABELS[OrderType.Takeaway]}
        count={takeawayCount}
        tone="takeaway"
        showZero
        compact={compact}
        testId={`mode-${OrderType.Takeaway}`}
        onClick={() => onSelect(OrderType.Takeaway)}
      />
      <Tab
        active={active === OrderType.Delivery}
        Icon={IconScooter}
        tint="text-success"
        label={ORDER_TYPE_LABELS[OrderType.Delivery]}
        count={deliveryCount}
        tone="delivery"
        showZero
        compact={compact}
        testId={`mode-${OrderType.Delivery}`}
        onClick={() => onSelect(OrderType.Delivery)}
      />
    </div>
      {edges.left && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={() => scrollBy(-1)}
          className="absolute left-0 inset-y-0 w-10 flex items-center justify-start bg-gradient-to-r from-bg via-bg/80 to-transparent text-muted"
        >
          <IconChevronLeft className="w-6 h-6" />
        </button>
      )}
      {edges.right && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={() => scrollBy(1)}
          className="absolute right-0 inset-y-0 w-10 flex items-center justify-end bg-gradient-to-l from-bg via-bg/80 to-transparent text-text"
        >
          <IconChevronRight className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}

export const WaiterTabs = memo(WaiterTabsImpl);

// Son belgisi ranglari: band stollar — yashil (stol plitkalari bilan bir xil), olib ketish — sariq,
// yetkazish — yashil (R1). Kichik raqam uchun to'q fon + kontrast matn.
const BADGE: Record<'busy' | 'takeaway' | 'delivery', string> = {
  busy: 'bg-primary-hover text-white',
  takeaway: 'bg-warning text-black',
  delivery: 'bg-success text-black',
};

function Tab({
  active,
  Icon,
  tint,
  label,
  count,
  tone,
  showZero,
  compact,
  testId,
  hall,
  onClick,
}: {
  active: boolean;
  Icon: (p: IconProps) => JSX.Element;
  tint: string;
  label: string;
  count: number;
  tone: 'busy' | 'takeaway' | 'delivery';
  showZero?: boolean;
  compact?: boolean;
  testId: string;
  hall?: string;
  onClick: () => void;
}) {
  const visible = count > 0 || !!showZero;
  const badge = active ? 'bg-white text-black' : count > 0 ? BADGE[tone] : 'bg-bg text-muted border border-border';
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={count > 0 ? `${label}: ${count}` : label}
      data-testid={testId}
      data-hall={hall}
      onClick={onClick}
      className={`shrink-0 select-none rounded-xl font-bold whitespace-nowrap flex items-center border transition-[transform,background-color,border-color] duration-150 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
        compact ? 'h-12 px-3 gap-1.5 text-sm' : 'h-14 px-3.5 2xl:px-5 gap-2 2xl:gap-2.5 text-base'
      } ${
        active
          ? 'bg-primary-hover text-white border-primary-hover shadow-lg shadow-primary/25'
          : 'bg-surface text-text border-border hover:bg-surface-hover hover:border-primary/40'
      }`}
    >
      <Icon className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} ${active ? '' : tint}`} strokeWidth={2.2} />
      <span>{label}</span>
      {visible && (
        <span
          className={`min-w-[24px] h-6 px-1.5 rounded-full text-xs font-extrabold flex items-center justify-center tabular-nums ${badge}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
