// Ofitsiant / kassa amallari oynasi (umumiy qobiq): sarlavha, aylanadigan tana, pastki tugmalar qatori.
// Doim document.body'ga chiqariladi (portal): telefonda buyurtma paneli (transform'li) yoki kassadagi
// to'lov oynasi ichidan ochilsa ham ekranni to'liq qoplaydi. Telefonda pastdan chiqadi (sheet).
// Esc — faqat eng ustdagi oynani yopadi.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from './icons';

const SIZE = {
  sm: 'sm:max-w-[420px]',
  md: 'sm:max-w-[520px]',
  lg: 'sm:max-w-[720px]',
  xl: 'sm:max-w-[980px]',
} as const;

// Ochiq oynalar to'plami — Esc faqat eng oxirgisiga tegishli
const stack: number[] = [];
let seq = 0;

/**
 * Hozir biror Sheet oynasi ochiqmi. Ostidagi oyna (masalan kassadagi to'lov oynasi) o'zining Enter/Esc
 * tugmalarini shu paytda bajarmasligi uchun: `if (anySheetOpen()) return;`
 */
export function anySheetOpen(): boolean {
  return stack.length > 0;
}

export interface SheetProps {
  title: string;
  subtitle?: ReactNode;
  /** sarlavha yonidagi belgi (rangli kvadrat ichida) */
  icon?: ReactNode;
  /** belgi kvadrati rangi (Tailwind sinflari) */
  iconTone?: string;
  onClose: () => void;
  children: ReactNode;
  /** pastki qator (tugmalar) — doim ko'rinadi */
  footer?: ReactNode;
  size?: keyof typeof SIZE;
  testId?: string;
  /** amal bajarilmoqda — yopish vaqtincha o'chiq */
  busy?: boolean;
  /** tana ichki chegarasi (standart: p-4 sm:p-5) */
  bodyClassName?: string;
}

export function Sheet({
  title,
  subtitle,
  icon,
  iconTone = 'bg-primary/15 text-primary',
  onClose,
  children,
  footer,
  size = 'md',
  testId,
  busy,
  bodyClassName = 'p-4 sm:p-5',
}: SheetProps) {
  const live = useRef({ onClose, busy });
  live.current = { onClose, busy };

  useEffect(() => {
    const id = ++seq;
    stack.push(id);
    // Capture bosqichida: ostidagi oyna (masalan kassadagi to'lov oynasi) Esc'ni olmasin
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== id) return;
      e.preventDefault();
      e.stopPropagation();
      if (!live.current.busy) live.current.onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[56] flex items-end sm:items-center justify-center bg-black/60 animate-overlay-in sm:p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className={`w-full ${SIZE[size]} max-h-[96vh] sm:max-h-[94vh] flex flex-col bg-surface text-text border border-border rounded-t-3xl sm:rounded-3xl shadow-2xl animate-pop-in`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border">
          {icon && <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${iconTone}`}>{icon}</span>}
          <div className="min-w-0 flex-1">
            <div className="font-extrabold text-lg leading-tight truncate">{title}</div>
            {subtitle && <div className="text-sm text-muted font-semibold truncate mt-0.5">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Yopish"
            data-testid="sheet-close"
            className="w-12 h-12 rounded-xl text-muted hover:text-text hover:bg-bg flex items-center justify-center shrink-0 disabled:opacity-40"
          >
            <IconClose className="w-5 h-5" />
          </button>
        </div>
        <div className={`flex-1 min-h-0 overflow-auto ${bodyClassName}`}>{children}</div>
        {footer && (
          <div
            className="shrink-0 border-t border-border px-4 sm:px-5 pt-3 bg-surface rounded-b-none sm:rounded-b-3xl"
            style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Oyna ichidagi xato xabari (qizil) */
export function SheetError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-xl border border-danger/60 bg-danger/10 px-3 py-2.5 text-sm font-bold text-danger">
      {children}
    </div>
  );
}

/** Aylanuvchi "kutish" belgisi (tugma ichida) */
export function Spinner({ className = 'w-5 h-5 border-white' }: { className?: string }) {
  return <span className={`inline-block rounded-full border-[3px] border-t-transparent animate-spin ${className}`} aria-hidden />;
}
