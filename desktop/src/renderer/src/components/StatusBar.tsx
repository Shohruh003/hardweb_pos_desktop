import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PrinterStatus } from '@hardweb-pos/shared';
import { version as APP_VERSION } from '../../../../package.json';
import { useAuth } from '../state/auth';
import { useConnectivity } from '../state/connectivity';
import { MOCK } from '../lib/api';
import { getServerUrl } from '../lib/config';
import { canSeePrinting, usePrinterStatus } from './printing/printingStore';
import { PrintJobsModal } from './printing/PrintJobsModal';
import { AlertIcon, CheckIcon, CloseIcon, PrinterIcon, ServerIcon } from './printing/icons';

// Holat qatori (B26) — ekranning eng pastida, kassir va administrator/direktor uchun (eski POS
// pastki qatoridagidek: "● ONLINE  ● P-BAR  ● P-KASSA  ● P-OSHXONA"):
//   ● Server ulangan | ● Oshxona  ● Bar 2  ● Salatxona … | Kassa: 192.168.1.10 · v0.3.0 · 18:56
// Printer: yashil — ishlayapti, qizil — javob bermayapti (2 marta ketma-ket), kulrang — tekshirilmoqda;
// raqam — navbatda chiqmay turgan cheklar. Printer bosilsa — manzili, oxirgi javob vaqti, navbat.
// Printer javob bermay qolsa — bir marta ekranni to'smaydigan ogohlantirish chiqadi.
// Ingichka (36 px), kontentni to'smaydi (AppShell sahifani shu qadar qisqartiradi). Telefonda yo'q.

/** Holat qatori balandligi (AppShell suzuvchi xabarlarni shu qadar yuqoriga suradi) */
export const STATUS_BAR_HEIGHT = '2.25rem';

const pad2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

function clockOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? hhmm(d) : null;
}

function agoText(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return 'hozirgina';
  const min = Math.floor(ms / 60_000);
  return min < 60 ? `${min} daqiqa oldin` : `${Math.floor(min / 60)} soat ${min % 60} daqiqa oldin`;
}

type PrinterState = 'online' | 'offline' | 'checking';

function stateOf(p: PrinterStatus): PrinterState {
  if (p.lastCheckAt === null) return 'checking';
  return p.online ? 'online' : 'offline';
}

const keyOf = (p: PrinterStatus) => `${p.stationId}|${p.host}:${p.port}`;

/** Soat (HH:MM) — har daqiqa boshida yangilanadi */
function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number | undefined;
    const arm = () => {
      timer = window.setTimeout(() => {
        setNow(new Date());
        arm();
      }, 60_000 - (Date.now() % 60_000) + 50);
    };
    arm();
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return hhmm(now);
}

/**
 * Kassa (server) kompyuterining LAN IP manzili: terminal/telefonda — ulanish manzilidan; kassaning
 * o'zida (127.0.0.1) — Electron'dan (window.hardweb.getLanInfo). Demo rejimida ko'rsatilmaydi.
 */
function useKassaIp(): string | null {
  const [ip, setIp] = useState<string | null>(() => {
    if (MOCK) return null;
    try {
      const host = new URL(getServerUrl()).hostname;
      return host && host !== 'localhost' && host !== '127.0.0.1' ? host : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (ip || MOCK || !window.hardweb?.getLanInfo) return;
    let alive = true;
    window.hardweb
      .getLanInfo()
      .then((info) => {
        if (alive && info?.ip) setIp(info.ip);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ip]);
  return ip;
}

// Qaysi printerlar "javob bermayapti" deb allaqachon aytildi (sahifa almashsa ham takrorlanmasin).
// Printer qayta ishlasa — ro'yxatdan chiqadi (keyingi o'chishda yana aytiladi).
const announcedOffline = new Set<string>();

interface OfflineToast {
  key: string;
  ok: boolean;
  text: string;
}

export function StatusBar() {
  const { user } = useAuth();
  const enabled = canSeePrinting(user);
  const { online } = useConnectivity();
  const st = usePrinterStatus(enabled);
  const clock = useClock();
  const ip = useKassaIp();
  const [detail, setDetail] = useState<{ printer: PrinterStatus; anchor: DOMRect } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [toasts, setToasts] = useState<OfflineToast[]>([]);
  const toastTimers = useRef(new Map<string, number>());

  // Printer javob bermay qoldi / qayta ishladi — bir martalik ogohlantirish (ekranni to'smaydi)
  useEffect(() => {
    if (!enabled || !st.loaded || st.unavailable) return;
    const add: OfflineToast[] = [];
    for (const p of st.data) {
      const k = keyOf(p);
      const s = stateOf(p);
      if (s === 'offline' && !announcedOffline.has(k)) {
        announcedOffline.add(k);
        add.push({ key: `off-${k}-${Date.now()}`, ok: false, text: `${p.stationName} printeri javob bermayapti (${p.host})` });
      } else if (s === 'online' && announcedOffline.has(k)) {
        announcedOffline.delete(k);
        add.push({ key: `on-${k}-${Date.now()}`, ok: true, text: `${p.stationName} printeri qayta ishlayapti` });
      }
    }
    if (add.length === 0) return;
    setToasts((prev) => [...add, ...prev].slice(0, 3));
    for (const t of add) {
      toastTimers.current.set(
        t.key,
        window.setTimeout(() => {
          toastTimers.current.delete(t.key);
          setToasts((prev) => prev.filter((x) => x.key !== t.key));
        }, t.ok ? 6000 : 10_000),
      );
    }
  }, [enabled, st.data, st.loaded, st.unavailable]);

  useEffect(() => {
    const timers = toastTimers.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  // Ochiq tafsilot — yangilangan holat bilan
  const detailPrinter = detail ? st.data.find((p) => p.stationId === detail.printer.stationId) ?? detail.printer : null;

  if (!enabled) return null;

  const printers = st.unavailable ? [] : st.data;

  return (
    <>
      <footer
        role="status"
        aria-label="Server va printerlar holati"
        data-testid="status-bar"
        style={{ height: STATUS_BAR_HEIGHT }}
        className="hidden md:flex shrink-0 items-center gap-2 pl-2 pr-3 border-t border-border bg-surface text-[13px] select-none"
      >
        {/* Server bilan aloqa */}
        {online ? (
          <span className="shrink-0 h-7 px-2 rounded-md flex items-center gap-1.5 font-bold text-text" title="Server bilan aloqa bor">
            <span className="w-2.5 h-2.5 rounded-full bg-success ring-[3px] ring-success/25" />
            <ServerIcon className="w-4 h-4 text-muted" />
            Server ulangan
          </span>
        ) : (
          <span className="shrink-0 h-7 px-2.5 rounded-md flex items-center gap-1.5 font-extrabold bg-danger text-white">
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
            Server bilan aloqa yo‘q
          </span>
        )}

        <span className="shrink-0 w-px h-5 bg-border" aria-hidden />

        {/* Bo'lim printerlari */}
        <div
          className={`min-w-0 flex-1 flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
            online ? '' : 'opacity-50'
          }`}
        >
          {printers.map((p) => (
            <PrinterChip
              key={p.stationId}
              printer={p}
              active={detail?.printer.stationId === p.stationId}
              onOpen={(anchor) =>
                setDetail((cur) => (cur?.printer.stationId === p.stationId ? null : { printer: p, anchor }))
              }
            />
          ))}
          {st.loaded && !st.unavailable && printers.length === 0 && (
            <span className="text-muted px-1 whitespace-nowrap">Bo‘lim printerlari sozlanmagan</span>
          )}
        </div>

        {/* Kassa IP, versiya, soat */}
        <div className="shrink-0 flex items-center gap-3 text-muted tabular-nums whitespace-nowrap">
          {ip && (
            <span className="hidden lg:inline" title="Kassa (server) kompyuterining tarmoqdagi manzili">
              Kassa: <span className="text-text font-semibold">{ip}</span>
            </span>
          )}
          <span title="Dastur versiyasi">v{APP_VERSION}</span>
          <span className="text-text font-extrabold text-sm">{clock}</span>
        </div>
      </footer>

      {detail && detailPrinter && (
        <PrinterDetail
          printer={detailPrinter}
          anchor={detail.anchor}
          onClose={() => setDetail(null)}
          onOpenList={() => {
            setDetail(null);
            setListOpen(true);
          }}
        />
      )}
      {listOpen && <PrintJobsModal onClose={() => setListOpen(false)} />}

      {toasts.length > 0 &&
        createPortal(
          <div
            aria-live="assertive"
            // Portal body'da. Yuqorida, o'rtada: pastki chap burchakda to'lov oynasining "Orqaga" kabi
            // tugmalarini 10 soniya to'sib qo'yardi; sarlavha o'rtasida bosiladigan tugma yo'q
            className="fixed z-[66] top-3 left-1/2 -translate-x-1/2 flex flex-col gap-2 w-[min(380px,calc(100vw-1.5rem))] pointer-events-none"
          >
            {toasts.map((t) => (
              <div
                key={t.key}
                role="alert"
                className={`pointer-events-auto flex items-center gap-3 rounded-2xl border-2 bg-surface shadow-2xl p-2.5 pl-3 animate-pop-in ${
                  t.ok ? 'border-success' : 'border-danger'
                }`}
              >
                <span
                  className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
                    t.ok ? 'bg-success text-white' : 'bg-danger text-white'
                  }`}
                >
                  {t.ok ? <CheckIcon className="w-6 h-6" /> : <AlertIcon className="w-6 h-6" />}
                </span>
                <span className="min-w-0 flex-1 font-extrabold text-text leading-snug">{t.text}</span>
                <button
                  onClick={() => setToasts((prev) => prev.filter((x) => x.key !== t.key))}
                  aria-label="Yopish"
                  className="shrink-0 w-11 h-11 rounded-xl text-muted hover:text-text hover:bg-surface-hover flex items-center justify-center"
                >
                  <CloseIcon className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function PrinterChip({
  printer,
  active,
  onOpen,
}: {
  printer: PrinterStatus;
  active: boolean;
  onOpen: (anchor: DOMRect) => void;
}) {
  const s = stateOf(printer);
  const pending = printer.pendingJobs || 0;
  const tone =
    s === 'offline'
      ? 'bg-danger text-white font-extrabold'
      : s === 'checking'
        ? 'text-muted font-semibold hover:bg-surface-hover'
        : 'text-text font-bold hover:bg-surface-hover';
  const dot = s === 'offline' ? 'bg-white' : s === 'checking' ? 'bg-muted animate-pulse' : 'bg-success';
  const label =
    s === 'offline' ? 'javob bermayapti' : s === 'checking' ? 'tekshirilmoqda' : 'ishlayapti';
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      aria-expanded={active}
      aria-label={`${printer.stationName} printeri: ${label}${pending ? `, ${pending} ta chek navbatda` : ''}`}
      title={`${printer.stationName}: ${label} (${printer.host}:${printer.port})`}
      data-testid="printer-chip"
      data-state={s}
      className={`shrink-0 h-7 px-2 rounded-md flex items-center gap-1.5 whitespace-nowrap transition-colors ${tone} ${
        active ? 'ring-2 ring-primary' : ''
      }`}
    >
      <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
      {printer.stationName}
      {pending > 0 && (
        <span
          className="min-w-[20px] h-5 px-1 rounded-md bg-warning text-black text-[11px] font-black flex items-center justify-center"
          title={`${pending} ta chek navbatda`}
        >
          {pending}
        </span>
      )}
    </button>
  );
}

/** Printer tafsiloti — chip ustida kichik oyna (manzil, oxirgi javob, navbat) */
function PrinterDetail({
  printer,
  anchor,
  onClose,
  onOpenList,
}: {
  printer: PrinterStatus;
  anchor: DOMRect;
  onClose: () => void;
  onOpenList: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, bottom: window.innerHeight - anchor.top + 8 });
  const s = stateOf(printer);
  const pending = printer.pendingJobs || 0;

  // Oyna ekrandan chiqib ketmasin (o'ng chetga yaqin chip)
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 300;
    setPos({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8)),
      bottom: window.innerHeight - anchor.top + 8,
    });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      // Chipning o'zi bosilsa — chip yopadi/almashtiradi (bu yerda yopmaymiz)
      if ((e.target as HTMLElement | null)?.closest?.('[data-testid="printer-chip"]')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onResize = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose]);

  const lastOk = clockOf(printer.lastOkAt);
  const checked = clockOf(printer.lastCheckAt);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`${printer.stationName} printeri`}
      style={{ position: 'fixed', left: pos.left, bottom: pos.bottom, zIndex: 67 }}
      className="w-[300px] rounded-2xl border border-border bg-surface shadow-2xl p-4 animate-pop-in text-sm"
    >
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
            s === 'offline' ? 'bg-danger text-white' : s === 'online' ? 'bg-success text-white' : 'bg-surface-hover text-muted'
          }`}
        >
          <PrinterIcon className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <div className="font-extrabold text-base truncate">{printer.stationName} printeri</div>
          <div
            className={`font-bold ${s === 'offline' ? 'text-danger' : s === 'online' ? 'text-success' : 'text-muted'}`}
          >
            {s === 'offline' ? 'Javob bermayapti' : s === 'online' ? 'Ishlayapti' : 'Tekshirilmoqda…'}
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5">
        <dt className="text-muted">Manzil</dt>
        <dd className="font-semibold tabular-nums break-all">
          {printer.host}:{printer.port}
        </dd>
        <dt className="text-muted">Oxirgi javob</dt>
        <dd className="font-semibold">
          {lastOk ? (
            <>
              {lastOk} <span className="text-muted font-normal">({agoText(printer.lastOkAt)})</span>
            </>
          ) : (
            '—'
          )}
        </dd>
        {checked && (
          <>
            <dt className="text-muted">Tekshirildi</dt>
            <dd className="font-semibold">{checked}</dd>
          </>
        )}
        <dt className="text-muted">Navbatda</dt>
        <dd className={`font-extrabold ${pending > 0 ? 'text-warning' : ''}`}>{pending} ta chek</dd>
      </dl>
      {s === 'offline' && (
        <p className="mt-3 text-xs text-muted leading-snug">
          Printer yoqilganini, qog‘oz va tarmoq kabelini tekshiring. Navbatdagi cheklar printer ishlashi bilan o‘zi chiqadi.
        </p>
      )}
      {pending > 0 && (
        <button
          onClick={onOpenList}
          className="mt-3 w-full h-12 rounded-xl bg-warning text-black font-extrabold flex items-center justify-center gap-2 hover:brightness-105 active:scale-[0.98] transition-transform"
        >
          <PrinterIcon /> Chiqmagan cheklar ro‘yxati
        </button>
      )}
    </div>,
    document.body,
  );
}
