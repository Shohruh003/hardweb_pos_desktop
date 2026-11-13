import { useCallback, useEffect, useRef, useState } from 'react';
import { PrintFailedPayload, SOCKET_EVENTS } from '@hardweb-pos/shared';
import { getSocket } from '../lib/socket';
import { formatTime } from './ui';

// Bo'lim (oshxona/bar...) printeriga chek chiqmaganda server "print:failed" hodisasini
// hammaga yuboradi. Kassa barcha xabarlarni ko'rsatadi; ofitsiant — faqat o'zi yuborgan
// buyurtmaniki. Xabarlar ekran ustida, bosilgan ishni to'xtatmaydi (bloklamaydi).

export interface PrintFailedToast extends PrintFailedPayload {
  key: string;
  at: string; // ISO — qachon kelgani
}

interface Options {
  /** Faqat shu shartga mos xabarlar ko'rsatiladi (berilmasa — hammasi) */
  filter?: (payload: PrintFailedPayload) => boolean;
  /** Bir vaqtda ko'rinadigan eng ko'p xabar (eskilari tushib qoladi) */
  max?: number;
  /** Berilsa — xabar shuncha ms dan keyin o'zi yopiladi (aks holda faqat qo'lda) */
  autoDismissMs?: number;
}

let seq = 0;

function isPayload(p: unknown): p is PrintFailedPayload {
  const v = p as PrintFailedPayload | null;
  return !!v && typeof v === 'object' && typeof v.station === 'string';
}

/** print:failed hodisasini tinglash (komponent o'chganda obuna ham bekor qilinadi) */
export function usePrintFailedToasts({ filter, max = 5, autoDismissMs }: Options = {}) {
  const [toasts, setToasts] = useState<PrintFailedToast[]>([]);
  // Filtr har renderda yangi funksiya bo'lishi mumkin — obunani qayta qilmaslik uchun ref
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((key: string) => {
    const t = timers.current.get(key);
    if (t !== undefined) {
      window.clearTimeout(t);
      timers.current.delete(key);
    }
    setToasts((prev) => prev.filter((x) => x.key !== key));
  }, []);

  const clear = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onFailed = (payload: unknown) => {
      if (!isPayload(payload)) return;
      if (filterRef.current && !filterRef.current(payload)) return;
      const key = `pf-${Date.now()}-${++seq}`;
      setToasts((prev) => [{ ...payload, key, at: new Date().toISOString() }, ...prev].slice(0, max));
      if (autoDismissMs && autoDismissMs > 0) {
        timers.current.set(
          key,
          window.setTimeout(() => {
            timers.current.delete(key);
            setToasts((prev) => prev.filter((x) => x.key !== key));
          }, autoDismissMs),
        );
      }
    };
    socket.on(SOCKET_EVENTS.PRINT_FAILED, onFailed);
    const pending = timers.current;
    return () => {
      socket.off(SOCKET_EVENTS.PRINT_FAILED, onFailed);
      pending.forEach((t) => window.clearTimeout(t));
      pending.clear();
    };
  }, [max, autoDismissMs]);

  return { toasts, dismiss, clear };
}

/**
 * Ogohlantirishlar to'plami (ekranning yuqori o'ng burchagida, modallardan ham ustida).
 * compact — qisqa ko'rinish (ofitsiant): sarlavha + sabab; to'liq — stol raqami va vaqt bilan (kassa).
 */
export function PrintFailedToasts({
  toasts,
  onDismiss,
  onClearAll,
  compact,
}: {
  toasts: PrintFailedToast[];
  onDismiss: (key: string) => void;
  onClearAll?: () => void;
  compact?: boolean;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      // 360px — 1280px+ ekranda markazdagi to'lov oynasi (520px) va uning ✕ tugmasini to'smaydi
      className="fixed z-[65] top-16 right-3 left-3 sm:left-auto sm:w-[360px] flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => (
        <div
          key={t.key}
          className="pointer-events-auto flex items-start gap-3 bg-surface border-2 border-danger rounded-2xl shadow-2xl p-3 pr-2 animate-pop-in"
        >
          <span className="shrink-0 w-10 h-10 rounded-xl bg-danger/15 text-danger flex items-center justify-center text-xl">
            🖨️
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-extrabold text-danger leading-snug">
              ⚠️ {t.station || 'Bo‘lim'} printeriga chek chiqmadi
              {!compact && t.tableNumber != null && <span className="text-text"> — Stol {t.tableNumber}</span>}
            </div>
            {t.message && <div className="text-sm text-text mt-0.5 break-words">{t.message}</div>}
            {!compact && (
              <div className="text-xs text-muted mt-1">
                {formatTime(t.at)}
                {t.host ? ` · printer ${t.host}` : ''} · printer yoqilganini, qog‘oz va kabelni tekshiring
              </div>
            )}
          </div>
          <button
            onClick={() => onDismiss(t.key)}
            aria-label="Yopish"
            className="shrink-0 w-10 h-10 rounded-xl text-muted hover:text-text hover:bg-bg flex items-center justify-center text-lg"
          >
            ✕
          </button>
        </div>
      ))}
      {onClearAll && toasts.length > 1 && (
        <button
          onClick={onClearAll}
          className="pointer-events-auto self-end px-3 py-1.5 rounded-lg bg-surface border border-border text-sm font-semibold text-text shadow-lg hover:border-danger hover:text-danger"
        >
          Hammasini yopish ({toasts.length})
        </button>
      )}
    </div>
  );
}
