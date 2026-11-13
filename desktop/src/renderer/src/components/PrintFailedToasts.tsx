import { useCallback, useEffect, useRef, useState } from 'react';
import { PrintFailedPayload, PrintRecoveredPayload, SOCKET_EVENTS } from '@hardweb-pos/shared';
import { getSocket } from '../lib/socket';
import { formatTime } from './ui';
import { CheckIcon, CloseIcon, PrinterIcon } from './printing/icons';

// Bo'lim (oshxona/bar...) printeriga chek chiqmaganda server "print:failed" hodisasini
// hammaga yuboradi. Kassa barcha xabarlarni ko'rsatadi; ofitsiant — faqat o'zi yuborgan
// buyurtmaniki. Xabarlar ekran ustida, bosilgan ishni to'xtatmaydi (bloklamaydi).
// Chiqmay qolgan chek navbatdan keyinroq chiqsa (printer/svet tiklangach) server "print:recovered"
// yuboradi — yashil xabar: "✓ Oshxona: kechikkan chek chiqdi (Olib ketish #12)". Shu chekning
// qizil xabari (agar ko'rinib turgan bo'lsa) olib tashlanadi. Bir bo'limdan ketma-ket chiqqan
// cheklar bitta yashil xabarga jamlanadi ("3 ta kechikkan chek chiqdi").
// Doimiy holat (nechta chek chiqmay turibdi, ro'yxat) — AppShell'dagi PrintQueueBanner.

export interface PrintFailedToast extends PrintFailedPayload {
  key: string;
  at: string; // ISO — qachon kelgani
  /** 'failed' (standart) — chek chiqmadi; 'recovered' — kechikkan chek chiqdi */
  kind?: 'failed' | 'recovered';
  /** recovered: buyurtmadan necha soniya keyin chiqdi */
  delayedSeconds?: number;
  /** recovered: shu bo'limdan nechta kechikkan chek chiqdi (jamlangan xabar) */
  count?: number;
}

interface Options {
  /** Faqat shu shartga mos xabarlar ko'rsatiladi (berilmasa — hammasi). Kechikib chiqqan chekka ham qo'llanadi. */
  filter?: (payload: PrintFailedPayload) => boolean;
  /** Bir vaqtda ko'rinadigan eng ko'p xabar (eskilari tushib qoladi) */
  max?: number;
  /** Berilsa — "chek chiqmadi" xabari shuncha ms dan keyin o'zi yopiladi (aks holda faqat qo'lda) */
  autoDismissMs?: number;
}

/** "Kechikkan chek chiqdi" xabari doim o'zi yopiladi */
const RECOVERED_DISMISS_MS = 8000;

let seq = 0;

function isPayload(p: unknown): p is PrintFailedPayload {
  const v = p as PrintFailedPayload | null;
  return !!v && typeof v === 'object' && typeof v.station === 'string';
}

function isRecovered(p: unknown): p is PrintRecoveredPayload {
  const v = p as PrintRecoveredPayload | null;
  return !!v && typeof v === 'object' && typeof v.station === 'string' && typeof v.jobId === 'string';
}

/** print:failed va print:recovered hodisalarini tinglash (komponent o'chganda obuna ham bekor qilinadi) */
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
    const pending = timers.current;
    const arm = (key: string, ms: number) => {
      window.clearTimeout(pending.get(key));
      pending.set(
        key,
        window.setTimeout(() => {
          pending.delete(key);
          setToasts((prev) => prev.filter((x) => x.key !== key));
        }, ms),
      );
    };

    const onFailed = (payload: unknown) => {
      if (!isPayload(payload)) return;
      if (filterRef.current && !filterRef.current(payload)) return;
      const key = `pf-${Date.now()}-${++seq}`;
      setToasts((prev) => [{ ...payload, kind: 'failed' as const, key, at: new Date().toISOString() }, ...prev].slice(0, max));
      if (autoDismissMs && autoDismissMs > 0) arm(key, autoDismissMs);
    };

    const onRecovered = (payload: unknown) => {
      if (!isRecovered(payload)) return;
      // Filtr PrintFailedPayload ko'rinishini kutadi (ofitsiant: o'zi yuborgan buyurtma bo'yicha)
      const asFailed: PrintFailedPayload = {
        orderId: payload.orderId ?? undefined,
        orderName: payload.orderName ?? undefined,
        station: payload.station,
        host: payload.host,
        message: '',
      };
      if (filterRef.current && !filterRef.current(asFailed)) return;
      const at = new Date().toISOString();
      // Har bo'limning yashil xabari bitta (kalit — bo'lim nomi): ketma-ket chiqqan cheklar jamlanadi
      const key = `pr-${payload.station}`;
      setToasts((prev) => {
        // Shu chekning "chiqmadi" xabari endi kerak emas
        const rest = prev.filter(
          (t) =>
            !(
              t.kind !== 'recovered' &&
              t.station === payload.station &&
              ((payload.orderId && t.orderId === payload.orderId) || (!payload.orderId && t.orderName === payload.orderName))
            ),
        );
        const same = rest.find((t) => t.key === key);
        const next: PrintFailedToast = {
          ...asFailed,
          kind: 'recovered',
          key,
          at,
          delayedSeconds: Math.max(0, Number(payload.delayedSeconds) || 0),
          count: (same?.count ?? 0) + 1,
        };
        return [next, ...rest.filter((t) => t.key !== key)].slice(0, max);
      });
      arm(key, RECOVERED_DISMISS_MS); // har yangi chekda 8 s qaytadan
    };

    socket.on(SOCKET_EVENTS.PRINT_FAILED, onFailed);
    socket.on(SOCKET_EVENTS.PRINT_RECOVERED, onRecovered);
    return () => {
      socket.off(SOCKET_EVENTS.PRINT_FAILED, onFailed);
      socket.off(SOCKET_EVENTS.PRINT_RECOVERED, onRecovered);
      pending.forEach((t) => window.clearTimeout(t));
      pending.clear();
    };
  }, [max, autoDismissMs]);

  return { toasts, dismiss, clear };
}

/**
 * Qaysi buyurtma: server yuborgan nom ("Stol 5" / "Olib ketish #12" / "Yetkazish #5"),
 * eski server bo'lsa — stol raqami.
 */
function failedOrderName(t: PrintFailedPayload): string {
  const name = typeof t.orderName === 'string' ? t.orderName.trim() : '';
  if (name) return name;
  return t.tableNumber != null ? `Stol ${t.tableNumber}` : '';
}

/** "4 daqiqa kechikib" / "1 soat 5 daqiqa kechikib" */
function delayText(seconds: number | undefined): string {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 60) return '';
  const min = Math.round(s / 60);
  if (min < 60) return `${min} daqiqa kechikib`;
  const h = Math.floor(min / 60);
  return `${h} soat${min % 60 ? ` ${min % 60} daqiqa` : ''} kechikib`;
}

/**
 * Ogohlantirishlar to'plami (o'ng burchakda, modallardan ham ustida).
 * compact — qisqa ko'rinish (ofitsiant): sarlavha + buyurtma + sabab; to'liq — vaqt va printer bilan (kassa).
 * placement — 'top' (standart, sarlavha ostida) yoki 'bottom' (kassa: yuqoridagi "Yangi buyurtma"
 * tugmasini to'smaydi). hidden — vaqtincha ko'rsatilmaydi (masalan to'lov oynasi ochiq), xabarlar
 * saqlanib turadi va oyna yopilgach yana chiqadi.
 * Joylashuv AppShell qatorlarini hisobga oladi: yuqorida — chiqmagan cheklar qatori ostida
 * (--printbanner-h), pastda — holat qatori ustida (--statusbar-h).
 */
export function PrintFailedToasts({
  toasts,
  onDismiss,
  onClearAll,
  compact,
  placement = 'top',
  hidden,
}: {
  toasts: PrintFailedToast[];
  onDismiss: (key: string) => void;
  onClearAll?: () => void;
  compact?: boolean;
  placement?: 'top' | 'bottom';
  hidden?: boolean;
}) {
  if (toasts.length === 0 || hidden) return null;
  const pos =
    placement === 'bottom'
      ? 'bottom-[calc(var(--statusbar-h,0px)+0.75rem)] flex-col-reverse'
      : 'top-[calc(4rem+var(--printbanner-h,0px))] flex-col';
  return (
    <div
      role="alert"
      aria-live="assertive"
      // 360px tor ustun — ekranning asosiy qismini to'smaydi
      className={`fixed z-[65] ${pos} right-3 left-3 sm:left-auto sm:w-[360px] flex gap-2 pointer-events-none`}
    >
      {toasts.map((t) => {
        const name = failedOrderName(t);
        if (t.kind === 'recovered') {
          const late = delayText(t.delayedSeconds);
          const many = (t.count ?? 1) > 1;
          return (
            <div
              key={t.key}
              data-testid="print-recovered-toast"
              className="pointer-events-auto flex items-start gap-3 bg-surface border-2 border-success rounded-2xl shadow-2xl p-3 pr-2 animate-pop-in"
            >
              <span className="shrink-0 w-10 h-10 rounded-xl bg-success text-white flex items-center justify-center">
                <CheckIcon className="w-6 h-6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-extrabold text-success leading-snug">
                  ✓ {t.station || 'Bo‘lim'}: {many ? `${t.count} ta kechikkan chek chiqdi` : 'kechikkan chek chiqdi'}
                  {name && <span className="text-text"> ({many ? `oxirgisi ${name}` : name})</span>}
                </div>
                {!compact && (
                  <div className="text-xs text-muted mt-1">
                    {formatTime(t.at)}
                    {late ? ` · ${late}` : ''} · printer qayta ishlayapti
                  </div>
                )}
              </div>
              <button
                onClick={() => onDismiss(t.key)}
                aria-label="Yopish"
                className="shrink-0 w-11 h-11 rounded-xl text-muted hover:text-text hover:bg-bg flex items-center justify-center"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>
          );
        }
        return (
          <div
            key={t.key}
            data-testid="print-failed-toast"
            className="pointer-events-auto flex items-start gap-3 bg-surface border-2 border-danger rounded-2xl shadow-2xl p-3 pr-2 animate-pop-in"
          >
            <span className="shrink-0 w-10 h-10 rounded-xl bg-danger text-white flex items-center justify-center">
              <PrinterIcon className="w-6 h-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-extrabold text-danger leading-snug">
                ⚠️ {t.station || 'Bo‘lim'} printeriga chek chiqmadi
                {name && <span className="text-text"> — {name}</span>}
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
              className="shrink-0 w-11 h-11 rounded-xl text-muted hover:text-text hover:bg-bg flex items-center justify-center"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>
        );
      })}
      {onClearAll && toasts.length > 1 && (
        <button
          onClick={onClearAll}
          className="pointer-events-auto self-end h-11 px-4 rounded-xl bg-surface border border-border text-sm font-semibold text-text shadow-lg hover:border-danger hover:text-danger"
        >
          Hammasini yopish ({toasts.length})
        </button>
      )}
    </div>
  );
}
