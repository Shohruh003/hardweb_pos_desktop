// Menyu: rasmli taom plitkalari to'ri. Plitka: rasm (yoki emoji plitka), NOM, "6 000 so‘m / dona".
// Savatdagi miqdor plitka burchagida ko'rinadi; pastki o'ng burchakdagi "💬" — izoh (va miqdor) bilan
// alohida qator qo'shish. Tugagan taom (stop list) — xira, "Tugadi" yorlig'i bilan va bosilmaydi.
// React.memo: bitta taom qo'shilganda faqat o'sha plitka qayta chiziladi (149 taomli menyuda ham tez).
import { CSSProperties, memo } from 'react';
import { MenuItem, MenuUnit } from '@hardweb-pos/shared';
import { MenuTile } from '../MenuTile';
import { formatSum } from '../ui';
import { formatKg } from './orderUi';
import { IconChat } from './icons';

// Telefonda 2 ustun, 1366 px monoblokda 4–5, 1920 px da 6–7
const GRID_STYLE: CSSProperties = {
  gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(138px, 11vw, 200px), 1fr))',
};

export interface MenuGridProps {
  items: MenuItem[];
  /** taom id -> savatdagi miqdor */
  qtyById: Record<string, number>;
  onAdd: (item: MenuItem) => void;
  /** "💬" — izoh bilan yangi qator qo'shish */
  onAddWithNote?: (item: MenuItem) => void;
  /** bo'sh holat matni (qidiruv natijasi yo'q / kategoriya bo'sh) */
  emptyText: string;
}

function MenuGridImpl({ items, qtyById, onAdd, onAddWithNote, emptyText }: MenuGridProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-muted py-16 gap-2">
        <span className="text-5xl">🍽️</span>
        <span className="font-semibold">{emptyText}</span>
      </div>
    );
  }
  return (
    <div className="grid gap-2.5 sm:gap-3" style={GRID_STYLE}>
      {items.map((item) => (
        <MenuItemButton key={item.id} item={item} qty={qtyById[item.id] ?? 0} onAdd={onAdd} onAddWithNote={onAddWithNote} />
      ))}
    </div>
  );
}

export const MenuGrid = memo(MenuGridImpl);

const MenuItemButton = memo(function MenuItemButton({
  item,
  qty,
  onAdd,
  onAddWithNote,
}: {
  item: MenuItem;
  qty: number;
  onAdd: (item: MenuItem) => void;
  onAddWithNote?: (item: MenuItem) => void;
}) {
  const kg = item.unit === MenuUnit.Weight;
  const soldOut = item.available === false;
  const unit = kg ? 'kg' : 'dona';
  return (
    <div className="relative">
      <button
        type="button"
        data-testid="menu-tile"
        data-name={item.name}
        data-available={soldOut ? '0' : '1'}
        disabled={soldOut}
        onClick={() => onAdd(item)}
        aria-label={`${item.name}, ${formatSum(Number(item.price))} / ${unit}${soldOut ? ' — tugagan' : ''}${
          qty > 0 ? `, savatda ${kg ? `${formatKg(qty)} kg` : qty}` : ''
        }`}
        className={`group relative w-full h-full bg-surface border-2 rounded-2xl p-1.5 text-left flex flex-col select-none transition-[transform,border-color] duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
          soldOut
            ? 'border-border cursor-not-allowed'
            : `active:scale-[0.97] ${qty > 0 ? 'border-primary' : 'border-border hover:border-primary/60'}`
        }`}
      >
        <span className={`relative block ${soldOut ? 'opacity-45 grayscale' : ''}`}>
          <MenuTile name={item.name} imageUrl={item.imageUrl} image={item.image} className="aspect-[4/3] rounded-xl" />
        </span>
        {soldOut && (
          // Stop list: rasm ustida aniq ko'rinadigan qizil yorliq
          <span className="absolute left-1.5 right-1.5 top-[24%] flex justify-center pointer-events-none">
            <span className="rounded-lg bg-danger text-white text-sm font-black uppercase tracking-wider px-3 py-1 shadow-lg -rotate-6">
              Tugadi
            </span>
          </span>
        )}
        {/* Savatdagi miqdor — har qo'shilganda "sakraydi" (key o'zgaradi) */}
        {qty > 0 && (
          <span
            key={qty}
            className="absolute top-0.5 right-0.5 min-w-[34px] h-[34px] px-2 rounded-full bg-primary-hover text-white font-black text-base flex items-center justify-center shadow-lg ring-2 ring-surface animate-pop-in tabular-nums"
          >
            {kg ? formatKg(qty) : qty}
          </span>
        )}
        {kg && (
          <span className="absolute top-2.5 left-2.5 rounded-md bg-black/70 text-white text-[11px] font-extrabold px-1.5 py-0.5 leading-none">
            KG
          </span>
        )}
        <span
          className={`px-1.5 pt-2 font-extrabold text-[15px] leading-tight line-clamp-2 break-words min-h-[2.5em] ${
            soldOut ? 'text-muted line-through decoration-2' : 'text-text'
          }`}
        >
          {item.name}
        </span>
        <span className={`px-1.5 pt-1 pb-1 mt-auto pr-12 font-extrabold leading-tight tabular-nums ${soldOut ? 'text-muted' : 'text-primary'}`}>
          <span className="whitespace-nowrap">{formatSum(Number(item.price))}</span>
          {/* Birlik doim alohida qatorda — narx uzunligidan qat'i nazar barcha plitkalar bir xil */}
          <span className="block text-muted text-xs font-bold">/ {unit}</span>
        </span>
      </button>
      {/* Izoh bilan qo'shish — alohida tugma (tugma ichida tugma bo'lmasin) */}
      {onAddWithNote && !soldOut && (
        <button
          type="button"
          data-testid="menu-tile-note"
          onClick={() => onAddWithNote(item)}
          aria-label={`${item.name} — izoh bilan qo‘shish`}
          title="Izoh bilan qo‘shish"
          className="absolute bottom-1.5 right-1.5 w-11 h-11 rounded-xl bg-bg border border-border text-muted hover:text-warning hover:border-warning active:scale-90 transition-transform flex items-center justify-center"
        >
          <IconChat className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
);
