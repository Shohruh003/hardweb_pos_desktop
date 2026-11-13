// Katta raqam klaviaturasi (sensorli monoblok/telefon): 7 8 9 / 4 5 6 / 1 2 3 / (,|000) 0 ⌫.
// Miqdor, narx, og'irlik va summa maydonlari shu bilan to'ldiriladi (jismoniy klaviatura ham ishlaydi).
import { memo } from 'react';
import type { ReactNode } from 'react';
import { IconBackspace } from './icons';

export type NumKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '000' | ',' | 'back';

const ROWS: NumKey[][] = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
];

/**
 * Kiritilgan matnga tugmani qo'llash: decimal — vergul (kasr) ruxsat, aks holda butun son.
 * maxDecimals — kasr xonalari chegarasi; maxDigits — butun qism chegarasi.
 */
export function applyNumKey(value: string, key: NumKey, opts: { decimal?: boolean; maxDecimals?: number; maxDigits?: number } = {}): string {
  const { decimal = false, maxDecimals = 3, maxDigits = 9 } = opts;
  if (key === 'back') return value.slice(0, -1);
  if (key === ',') {
    if (!decimal || value.includes(',')) return value;
    return value ? `${value},` : '0,';
  }
  const [intPart, frac] = value.split(',');
  if (frac !== undefined) {
    if (key === '000') return value;
    return frac.length >= maxDecimals ? value : `${value}${key}`;
  }
  // Boshidagi nollar olib tashlanadi: "0" + "5" -> "5", "" + "000" -> "0"
  const base = intPart === '0' ? '' : intPart;
  const nextInt = `${base}${key}`.replace(/^0+(?=\d)/, '') || '0';
  if (nextInt.replace(/^0+/, '').length > maxDigits) return value;
  return nextInt;
}

export const NumPad = memo(function NumPad({
  onKey,
  decimal,
  disabled,
  compact,
  testIdPrefix = 'numpad',
}: {
  onKey: (key: NumKey) => void;
  /** vergul tugmasi (kg) — aks holda "000" (so'm) */
  decimal?: boolean;
  disabled?: boolean;
  compact?: boolean;
  testIdPrefix?: string;
}) {
  const h = compact ? 'h-12' : 'h-14';
  const key = (k: NumKey, label: ReactNode, cls = '') => (
    <button
      key={k}
      type="button"
      disabled={disabled}
      data-testid={`${testIdPrefix}-${k === ',' ? 'comma' : k}`}
      // Fokus maydonda qolsin (kursor o'z joyida)
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onKey(k)}
      aria-label={k === 'back' ? 'O‘chirish' : k === ',' ? 'Vergul' : k}
      className={`${h} rounded-2xl border border-border font-extrabold flex items-center justify-center select-none transition-[transform,background-color] duration-100 active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${cls}`}
    >
      {label}
    </button>
  );
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Raqam klaviaturasi">
      {ROWS.flat().map((k) => key(k, k, 'bg-bg text-text text-2xl hover:bg-surface-hover active:bg-primary/20'))}
      {decimal
        ? key(',', ',', 'bg-surface text-text text-3xl hover:bg-surface-hover')
        : key('000', '000', 'bg-surface text-text text-xl hover:bg-surface-hover')}
      {key('0', '0', 'bg-bg text-text text-2xl hover:bg-surface-hover active:bg-primary/20')}
      {key('back', <IconBackspace className="w-7 h-7" />, 'bg-surface text-muted hover:text-text')}
    </div>
  );
});
