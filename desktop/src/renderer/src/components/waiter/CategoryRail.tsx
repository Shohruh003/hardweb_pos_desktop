// Menyu kategoriyalari: chap vertikal panel (kompyuter/monoblok), gorizontal "chip"lar (telefon)
// va mobil yon menyu ro'yxati. Faol kategoriya — to'q yashil (primary). Har kategoriyaning
// o'z rang chizig'i bor (tez tanish uchun; ko'k ranglar ishlatilmaydi).
import { memo } from 'react';
import type { Category } from '@hardweb-pos/shared';
import { IconStar } from './icons';

/** "Sevimlilar" — maxsus kategoriya kaliti */
export const FAV_CAT = '__fav__';

// Statik sinflar (Tailwind JIT) — kategoriya tartibi bo'yicha aylanadi; faqat tema tokenlari (ko'k yo'q)
const CAT_COLORS = [
  'bg-primary',
  'bg-warning',
  'bg-danger',
  'bg-info',
  'bg-success',
  'bg-primary/55',
  'bg-warning/55',
  'bg-danger/55',
  'bg-info/55',
];

export function categoryColor(index: number): string {
  return CAT_COLORS[((index % CAT_COLORS.length) + CAT_COLORS.length) % CAT_COLORS.length];
}

export interface CategoryListProps {
  categories: Category[];
  active: string | null;
  onSelect: (id: string) => void;
  /** "⭐ Sevimlilar" tugmasi (sevimli taom bo'lsa) */
  showFavorites: boolean;
  /** qidiruv yozilgan — hech qaysi kategoriya faol ko'rinmaydi */
  searching?: boolean;
}

/** Kompyuter/monoblok: chap vertikal panel (katta tugmalar) */
export const CategoryRail = memo(function CategoryRail({
  categories,
  active,
  onSelect,
  showFavorites,
  searching,
}: CategoryListProps) {
  const cls = (on: boolean) =>
    `relative w-full min-h-[56px] text-left pl-4 pr-3 py-2.5 rounded-2xl font-bold text-[15px] leading-tight select-none transition-[transform,background-color,border-color] duration-150 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
      on
        ? 'bg-primary-hover text-white shadow-md shadow-primary/25 border border-primary-hover'
        : 'bg-surface text-text border border-border hover:bg-surface-hover hover:border-primary/40'
    }`;
  return (
    <nav aria-label="Menyu kategoriyalari" className="flex flex-col gap-2">
      {showFavorites && (
        <button
          type="button"
          data-testid="category-fav"
          aria-pressed={!searching && active === FAV_CAT}
          onClick={() => onSelect(FAV_CAT)}
          className={cls(!searching && active === FAV_CAT)}
        >
          <span className="flex items-center gap-2">
            <IconStar className={`w-5 h-5 ${!searching && active === FAV_CAT ? '' : 'text-warning'}`} strokeWidth={2.4} />
            Sevimlilar
          </span>
        </button>
      )}
      {categories.map((c, i) => {
        const on = !searching && active === c.id;
        return (
          <button
            key={c.id}
            type="button"
            data-testid="category"
            data-name={c.name}
            aria-pressed={on}
            onClick={() => onSelect(c.id)}
            className={cls(on)}
          >
            {/* Kategoriya rangi — chap chiziq */}
            <span className={`absolute left-1.5 top-3 bottom-3 w-1.5 rounded-full ${on ? 'bg-white/80' : categoryColor(i)}`} />
            <span className="block line-clamp-2 break-words">{c.name}</span>
          </button>
        );
      })}
    </nav>
  );
});

/** Telefon: gorizontal aylantiriladigan "chip"lar */
export const CategoryChips = memo(function CategoryChips({
  categories,
  active,
  onSelect,
  showFavorites,
  searching,
}: CategoryListProps) {
  const cls = (on: boolean) =>
    `shrink-0 h-11 px-4 rounded-full font-bold text-sm whitespace-nowrap select-none border transition-colors active:scale-95 ${
      on ? 'bg-primary-hover text-white border-primary-hover shadow-md shadow-primary/25' : 'bg-surface text-text border-border'
    }`;
  return (
    <div className="flex gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {showFavorites && (
        <button type="button" onClick={() => onSelect(FAV_CAT)} className={cls(!searching && active === FAV_CAT)}>
          <span className="flex items-center gap-1.5">
            <IconStar className="w-4 h-4" strokeWidth={2.4} />
            Sevimlilar
          </span>
        </button>
      )}
      {categories.map((c) => (
        <button key={c.id} type="button" onClick={() => onSelect(c.id)} className={cls(!searching && active === c.id)}>
          {c.name}
        </button>
      ))}
    </div>
  );
});

/** Telefon: o'ngdan chiqadigan yon menyudagi ro'yxat (AppShell mobileDrawer) */
export function CategoryDrawerList({
  categories,
  active,
  onSelect,
  showFavorites,
  searching,
  close,
}: CategoryListProps & { close: () => void }) {
  const cls = (on: boolean) =>
    `relative w-full text-left pl-5 pr-4 py-3.5 rounded-xl font-bold transition-colors ${
      on ? 'bg-primary-hover text-white shadow-md' : 'bg-bg text-text hover:bg-surface-hover'
    }`;
  return (
    <div className="flex flex-col gap-2">
      {showFavorites && (
        <button
          type="button"
          onClick={() => {
            onSelect(FAV_CAT);
            close();
          }}
          className={cls(!searching && active === FAV_CAT)}
        >
          <span className="flex items-center gap-2">
            <IconStar className="w-5 h-5" strokeWidth={2.4} /> Sevimlilar
          </span>
        </button>
      )}
      {categories.map((c, i) => {
        const on = !searching && active === c.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              onSelect(c.id);
              close();
            }}
            className={cls(on)}
          >
            <span className={`absolute left-2 top-3 bottom-3 w-1.5 rounded-full ${on ? 'bg-white/80' : categoryColor(i)}`} />
            {c.name}
          </button>
        );
      })}
    </div>
  );
}
