// Stol hisoblari (eski POS'dagidek): "Hisob-1 | Hisob-2 | Hisob-3 | Hisob-4". Kamida 4 ta tugma;
// hammasi band bo'lsa — yana bitta bo'sh tugma qo'shiladi. Ochiq hisobi bor tugmada uning summasi,
// tanlangani — to'q yashil (primary). Bo'sh tugma = shu raqamli YANGI hisob (Tasdiqlash uni ochadi).
import { memo, useEffect, useRef } from 'react';
import type { Order } from '@hardweb-pos/shared';
import { checkNoOf, formatAmount, payableTotal } from './orderUi';

/** Ko'rsatiladigan hisob raqamlari: kamida 4; hammasi band bo'lsa +1 bo'sh; tanlangani doim ko'rinadi */
export function checkTabNumbers(checks: Pick<Order, 'checkNo'>[], selected: number): number[] {
  const used = new Set(checks.map((c) => checkNoOf(c)));
  let count = Math.max(4, ...Array.from(used), selected);
  let allUsed = true;
  for (let n = 1; n <= count; n++) if (!used.has(n)) allUsed = false;
  if (allUsed) count += 1;
  return Array.from({ length: count }, (_, i) => i + 1);
}

function CheckTabsImpl({
  checks,
  selected,
  onSelect,
}: {
  /** shu stoldagi ochiq hisoblar */
  checks: Order[];
  selected: number;
  onSelect: (checkNo: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const byNo = new Map(checks.map((c) => [checkNoOf(c), c] as const));
  const numbers = checkTabNumbers(checks, selected);

  // Tanlangan hisob ko'rinib tursin (ko'p hisobda qator aylanadi)
  useEffect(() => {
    const el = rowRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    try {
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch {
      /* eski brauzer */
    }
  }, [selected]);

  return (
    <div
      ref={rowRef}
      role="tablist"
      aria-label="Stol hisoblari"
      className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {numbers.map((n) => {
        const check = byNo.get(n);
        const active = n === selected;
        return (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`check-tab-${n}`}
            data-used={check ? '1' : undefined}
            onClick={() => onSelect(n)}
            className={`flex-1 min-w-[74px] h-[50px] px-1.5 rounded-xl border-2 flex flex-col items-center justify-center leading-tight select-none transition-[transform,background-color,border-color] duration-150 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
              active
                ? 'bg-primary-hover border-primary-hover text-white shadow-md shadow-primary/25'
                : check
                  ? 'bg-primary/10 border-primary/60 text-text hover:border-primary'
                  : 'bg-bg border-border border-dashed text-muted hover:border-primary/60 hover:text-text'
            }`}
          >
            <span className="text-sm font-extrabold whitespace-nowrap">Hisob-{n}</span>
            <span
              className={`text-[12px] tabular-nums whitespace-nowrap ${
                active ? 'text-white font-extrabold' : check ? 'text-text font-extrabold' : 'text-muted font-bold'
              }`}
            >
              {check ? formatAmount(payableTotal(check)) : 'yangi'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const CheckTabs = memo(CheckTabsImpl);
