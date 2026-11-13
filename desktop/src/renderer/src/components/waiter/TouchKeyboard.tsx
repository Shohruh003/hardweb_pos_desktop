// Ekrandagi o'zbek (lotin) klaviaturasi — monoblokda jismoniy klaviatura bo'lmasligi mumkin.
// Harflar (QWERTY), o‘ g‘ sh ch ʼ, raqamlar, bo'shliq, o'chirish va Enter. Katta tugmalar.
// Matn maydonidagi kursor joyiga yoziladi; tugma bosilganda fokus maydondan ketmaydi.
// Sensorli monoblokda (keng ekran) avtomatik ochiq, telefonda — tizim klaviaturasi (tugma bilan yoqiladi).
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { IconBackspace, IconEnter, IconKeyboard, IconShift } from './icons';

const ROWS: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ʼ'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.'],
];
// O'zbek tiliga xos harflar — alohida katta tugmalar (apostrof U+2018, ilovadagi yozuv bilan bir xil)
const UZ_KEYS = ['o‘', 'g‘', 'sh', 'ch'];

const PREF_KEY = 'touch_kb';

/** Sensorli keng ekran (monoblok) — klaviatura avtomatik ochiladi; telefonda tizim klaviaturasi */
function autoDefault(): boolean {
  try {
    return navigator.maxTouchPoints > 0 && window.innerWidth >= 768;
  } catch {
    return false;
  }
}

/**
 * Ekran klaviaturasi ko'rinsinmi (qurilmada eslab qolinadi): xodim tugma bilan yoqadi/o'chiradi.
 * touch — sensorli qurilmami (u yerda tizim klaviaturasi ochilmasligi uchun inputMode="none").
 */
export function useTouchKeyboardPref(): { show: boolean; setShow: (v: boolean) => void; touch: boolean } {
  const [show, setShowState] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(PREF_KEY);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch {
      /* localStorage yopiq */
    }
    return autoDefault();
  });
  const touch = (() => {
    try {
      return navigator.maxTouchPoints > 0;
    } catch {
      return false;
    }
  })();
  const setShow = useCallback((v: boolean) => {
    setShowState(v);
    try {
      localStorage.setItem(PREF_KEY, v ? '1' : '0');
    } catch {
      /* e'tiborsiz */
    }
  }, []);
  return { show, setShow, touch };
}

/** "⌨ Klaviatura" tugmasi (ekran klaviaturasini yoqish/o'chirish) */
export function KeyboardToggle({ show, onToggle, className = '' }: { show: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.preventDefault()}
      onClick={onToggle}
      aria-pressed={show}
      data-testid="touch-kb-toggle"
      title={show ? 'Ekran klaviaturasini yopish' : 'Ekran klaviaturasini ochish'}
      className={`h-10 px-3 rounded-xl border text-sm font-bold flex items-center gap-1.5 transition-colors ${
        show ? 'bg-primary-hover text-white border-primary-hover' : 'bg-bg text-text border-border hover:border-primary'
      } ${className}`}
    >
      <IconKeyboard className="w-5 h-5" />
      <span className="hidden sm:inline">Klaviatura</span>
    </button>
  );
}

export interface TouchKeyboardProps {
  /** klaviatura yozadigan maydon (kursor joyiga qo'yiladi) */
  target: RefObject<HTMLInputElement | HTMLTextAreaElement>;
  value: string;
  onChange: (next: string) => void;
  /** Enter: berilsa — shu amal (masalan saqlash), aks holda ko'p qatorli maydonda yangi qator */
  onEnter?: () => void;
  maxLength?: number;
  className?: string;
}

function TouchKeyboardImpl({ target, value, onChange, onEnter, maxLength = 500, className = '' }: TouchKeyboardProps) {
  // Bir martalik "Shift": keyingi harf katta bo'ladi (telefon klaviaturasidek)
  const [shift, setShift] = useState(false);
  // Joriy qiymat va kursor — tez-tez bosilganda ham eski qiymat ustiga yozilmasin
  const live = useRef({ value, onChange });
  live.current = { value, onChange };
  const caret = useRef<number | null>(null);

  // Maydon tashqaridan o'zgarsa (jismoniy klaviatura) — eslab qolingan kursor eskiradi
  useEffect(() => {
    caret.current = null;
  }, [target]);

  const insert = useCallback(
    (text: string) => {
      const el = target.current;
      const cur = live.current.value;
      let start = cur.length;
      let end = cur.length;
      if (el && typeof el.selectionStart === 'number') {
        start = el.selectionStart;
        end = el.selectionEnd ?? start;
      } else if (caret.current !== null) {
        start = end = Math.min(caret.current, cur.length);
      }
      if (text === '\b') {
        if (start === end) start = Math.max(0, start - 1);
        const next = cur.slice(0, start) + cur.slice(end);
        live.current.onChange(next);
        caret.current = start;
      } else {
        const room = Math.max(0, maxLength - (cur.length - (end - start)));
        const add = text.slice(0, room);
        if (!add) return;
        const next = cur.slice(0, start) + add + cur.slice(end);
        live.current.onChange(next);
        caret.current = start + add.length;
      }
      // Kursorni yangi joyga qo'yamiz (React qiymatni yangilagach)
      const pos = caret.current;
      requestAnimationFrame(() => {
        const node = target.current;
        if (!node) return;
        try {
          if (document.activeElement !== node) node.focus({ preventScroll: true });
          node.setSelectionRange(pos, pos);
        } catch {
          /* ba'zi maydonlar selection'ni qo'llamaydi */
        }
      });
    },
    [target, maxLength],
  );

  const press = (k: string) => {
    if (/^[a-z]$/.test(k) || UZ_KEYS.includes(k)) {
      const out = shift ? k.charAt(0).toUpperCase() + k.slice(1) : k;
      insert(out);
      if (shift) setShift(false);
      return;
    }
    insert(k);
  };

  const keyCls =
    'h-12 min-w-0 rounded-xl border border-border bg-surface text-text font-bold text-lg flex items-center justify-center select-none active:scale-95 active:bg-primary/20 transition-[transform,background-color] duration-75';
  const btn = (k: string, label: ReactNode, cls = '', onPress?: () => void, aria?: string) => (
    <button
      key={k}
      type="button"
      aria-label={aria ?? k}
      // Fokus matn maydonida qoladi (kursor yo'qolmaydi, tizim klaviaturasi ochilmaydi)
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress ?? (() => press(k))}
      className={`${keyCls} ${cls}`}
    >
      {label}
    </button>
  );

  const letter = (k: string) => (/^[a-z]$/.test(k) && shift ? k.toUpperCase() : k);

  return (
    <div
      data-testid="touch-keyboard"
      className={`rounded-2xl border border-border bg-bg p-2 space-y-1.5 select-none ${className}`}
      role="group"
      aria-label="Ekran klaviaturasi"
    >
      {ROWS.slice(0, 3).map((row, i) => (
        <div key={i} className="grid grid-cols-10 gap-1.5">
          {row.map((k) => btn(k, letter(k)))}
        </div>
      ))}
      <div className="grid grid-cols-10 gap-1.5">
        {btn(
          'shift',
          <IconShift className="w-6 h-6" />,
          shift ? '!bg-primary-hover !text-white !border-primary-hover' : 'text-muted',
          () => setShift((v) => !v),
          'Katta harf',
        )}
        {ROWS[3].map((k) => btn(k, letter(k)))}
      </div>
      <div className="grid grid-cols-10 gap-1.5">
        {UZ_KEYS.map((k) => btn(k, shift ? k.charAt(0).toUpperCase() + k.slice(1) : k, 'text-primary'))}
        {btn('space', 'bo‘shliq', 'col-span-3 text-sm text-muted', () => insert(' '), 'Bo‘shliq')}
        {btn('back', <IconBackspace className="w-6 h-6" />, 'col-span-1 text-muted', () => insert('\b'), 'O‘chirish')}
        {btn(
          'enter',
          <IconEnter className="w-6 h-6" />,
          'col-span-2 !bg-primary-hover !text-white !border-primary-hover',
          () => (onEnter ? onEnter() : insert('\n')),
          'Enter',
        )}
      </div>
    </div>
  );
}

export const TouchKeyboard = memo(TouchKeyboardImpl);
