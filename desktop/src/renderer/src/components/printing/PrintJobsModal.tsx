import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../state/auth';
import {
  PrintJobRow,
  canSeePrinting,
  cancelPrintJob,
  retryAllPrintJobs,
  retryPrintJob,
  usePrintJobs,
} from './printingStore';
import { AlertIcon, CheckIcon, CloseIcon, PrinterIcon, RetryIcon, Spinner } from './icons';

// "Chiqmay turgan cheklar" oynasi (B17): navbatdagi va 3 soatdan oshgan bo'lim cheklari —
// har birini hozir chiqarish ("Chiqarish") yoki bekor qilish ("Bekor qilish", ikki bosqichli
// tasdiq). Telefonda pastdan chiqadigan varaq, kompyuterda markazdagi oyna.

const pad2 = (n: number) => String(n).padStart(2, '0');

function clock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '—';
}

/** "5 daqiqa oldin" / "2 soat 10 daqiqa oldin" / "hozirgina" */
function ago(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return 'hozirgina';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} daqiqa oldin`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} soat ${m} daqiqa oldin` : `${h} soat oldin`;
}

interface RowUi {
  busy?: 'retry' | 'cancel';
  /** "Bekor qilish" bir marta bosildi — ikkinchi bosish tasdiqlaydi */
  confirm?: boolean;
  error?: string;
}

interface Notice {
  ok: boolean;
  text: string;
}

export function PrintJobsModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const q = usePrintJobs(canSeePrinting(user));
  const titleId = useId();
  const [now, setNow] = useState(() => Date.now());
  const [rows, setRows] = useState<Record<string, RowUi>>({});
  const [busyAll, setBusyAll] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const confirmTimers = useRef(new Map<string, number>());
  const noticeTimer = useRef<number | undefined>(undefined);
  const closeRef = useRef<HTMLButtonElement>(null);

  // "N daqiqa oldin" yangilanib tursin
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Esc — yopish; ochilganda fokus "Yopish" tugmasida (klaviatura bilan ishlash uchun)
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const timers = confirmTimers.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const patchRow = (id: string, patch: RowUi | null) =>
    setRows((prev) => {
      const next = { ...prev };
      if (patch) next[id] = { ...prev[id], ...patch };
      else delete next[id];
      return next;
    });

  const flash = (n: Notice) => {
    setNotice(n);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000);
  };

  async function retryAll() {
    if (busyAll) return;
    setBusyAll(true);
    try {
      const r = await retryAllPrintJobs();
      flash(
        r.pending === 0
          ? { ok: true, text: 'Navbatdagi cheklar chiqarildi' }
          : { ok: false, text: `Printer hali javob bermayapti — ${r.pending} ta chek navbatda` },
      );
    } catch (e) {
      flash({ ok: false, text: (e as Error)?.message || 'Urinib bo‘lmadi' });
    } finally {
      setBusyAll(false);
    }
  }

  async function retry(job: PrintJobRow) {
    if (rows[job.id]?.busy) return;
    patchRow(job.id, { busy: 'retry', error: undefined, confirm: false });
    try {
      const r = await retryPrintJob(job.id);
      if (r.ok) {
        patchRow(job.id, null);
        flash({ ok: true, text: `${job.stationName}: ${job.orderName ?? 'chek'} chiqdi` });
      } else {
        patchRow(job.id, { busy: undefined, error: r.message || 'Chek chiqmadi' });
      }
    } catch (e) {
      patchRow(job.id, { busy: undefined, error: (e as Error)?.message || 'Chek chiqmadi' });
    }
  }

  async function cancel(job: PrintJobRow) {
    const ui = rows[job.id];
    if (ui?.busy) return;
    if (!ui?.confirm) {
      // 1-bosish: tasdiq so'raymiz (5 s ichida yana bosilmasa — bekor)
      patchRow(job.id, { confirm: true, error: undefined });
      window.clearTimeout(confirmTimers.current.get(job.id));
      confirmTimers.current.set(
        job.id,
        window.setTimeout(() => patchRow(job.id, { confirm: false }), 5000),
      );
      return;
    }
    window.clearTimeout(confirmTimers.current.get(job.id));
    patchRow(job.id, { busy: 'cancel', confirm: false });
    try {
      await cancelPrintJob(job.id);
      patchRow(job.id, null);
      flash({ ok: true, text: `${job.orderName ?? 'Chek'} (${job.stationName}) bekor qilindi — oshpazga og‘zaki ayting` });
    } catch (e) {
      patchRow(job.id, { busy: undefined, error: (e as Error)?.message || 'Bekor qilib bo‘lmadi' });
    }
  }

  const jobs = q.data;
  const pendingCount = jobs.filter((j) => j.status === 'pending').length;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 animate-overlay-in sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full sm:max-w-3xl max-h-[92vh] sm:max-h-[85vh] flex flex-col bg-surface border border-border rounded-t-3xl sm:rounded-2xl shadow-2xl animate-pop-in overflow-hidden"
      >
        {/* Sarlavha */}
        <div className="shrink-0 flex items-start gap-3 px-4 sm:px-6 pt-4 pb-3 border-b border-border">
          <span className="shrink-0 w-12 h-12 rounded-2xl bg-warning text-black flex items-center justify-center">
            <PrinterIcon className="w-6 h-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg sm:text-xl font-extrabold leading-tight flex items-center gap-2 flex-wrap">
              Chiqmay turgan cheklar
              {jobs.length > 0 && (
                <span className="rounded-full bg-warning text-black text-sm font-black px-2.5 py-0.5">
                  {jobs.length >= 100 ? '100+' : jobs.length}
                </span>
              )}
            </h2>
            <p className="text-sm text-muted mt-0.5">
              Printer yoqilishi bilan navbatdagi cheklar o‘zi chiqadi. 3 soatdan oshgani — shu yerdan qo‘lda chiqaring.
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Yopish"
            className="shrink-0 w-12 h-12 -mr-2 rounded-xl flex items-center justify-center text-muted hover:text-text hover:bg-surface-hover"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Hammasini urinish + natija */}
        <div className="shrink-0 flex flex-wrap items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 border-b border-border bg-bg/40">
          <button
            onClick={retryAll}
            disabled={busyAll || pendingCount === 0}
            className="h-12 px-5 rounded-xl bg-primary hover:bg-primary-hover text-white font-extrabold flex items-center gap-2 shadow active:scale-[0.97] transition-transform disabled:opacity-50 disabled:active:scale-100"
          >
            {busyAll ? <Spinner /> : <RetryIcon />}
            Hozir urinish
          </button>
          {notice ? (
            <span
              role="status"
              className={`min-w-0 flex-1 text-sm font-bold flex items-center gap-1.5 ${notice.ok ? 'text-success' : 'text-danger'}`}
            >
              {notice.ok ? <CheckIcon className="w-5 h-5 shrink-0" /> : <AlertIcon className="w-5 h-5 shrink-0" />}
              <span className="min-w-0">{notice.text}</span>
            </span>
          ) : (
            <span className="min-w-0 flex-1 text-sm text-muted">
              {pendingCount > 0
                ? `${pendingCount} ta chek navbatda — har 15 soniyada o‘zi qayta urinadi`
                : 'Avtomatik urinadigan chek yo‘q'}
            </span>
          )}
        </div>

        {/* Ro'yxat */}
        <div className="flex-1 min-h-0 overflow-auto px-3 sm:px-5 py-3 space-y-2.5">
          {!q.loaded ? (
            <div className="py-12 flex items-center justify-center gap-2 text-muted">
              <Spinner /> Yuklanmoqda…
            </div>
          ) : q.unavailable ? (
            <div className="py-12 text-center text-muted">Bu ro‘yxat sizga ochiq emas</div>
          ) : jobs.length === 0 ? (
            <div className="py-10 flex flex-col items-center text-center gap-3">
              <span className="w-16 h-16 rounded-full bg-success text-white flex items-center justify-center animate-ring">
                <CheckIcon className="w-9 h-9" />
              </span>
              <div className="text-lg font-extrabold">Barcha cheklar chiqdi</div>
              <div className="text-sm text-muted">Navbatda chiqmay turgan chek yo‘q</div>
              <button
                onClick={onClose}
                className="mt-1 h-12 px-6 rounded-xl bg-surface-hover border border-border font-bold hover:border-primary"
              >
                Yopish
              </button>
            </div>
          ) : (
            jobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                now={now}
                ui={rows[job.id]}
                onRetry={() => retry(job)}
                onCancel={() => cancel(job)}
              />
            ))
          )}
          {q.error && q.loaded && !q.unavailable && (
            <div role="alert" className="rounded-xl border border-danger/50 bg-danger/10 text-danger text-sm font-semibold px-3 py-2">
              Ro‘yxatni yangilab bo‘lmadi: {q.error}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function JobRow({
  job,
  now,
  ui,
  onRetry,
  onCancel,
}: {
  job: PrintJobRow;
  now: number;
  ui?: RowUi;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const expired = job.status === 'expired';
  const isVoid = job.kind === 'void';
  return (
    <div
      className={`rounded-2xl border-2 bg-bg/60 p-3 sm:p-4 flex flex-col md:flex-row md:items-center gap-3 ${
        expired ? 'border-danger' : 'border-warning/70'
      }`}
    >
      {/* Vaqt */}
      <div className="flex md:flex-col items-baseline md:items-start gap-2 md:gap-0 md:w-24 shrink-0">
        <span className="text-2xl font-black tabular-nums leading-none">{clock(job.createdAt)}</span>
        <span className="text-xs text-muted">{ago(job.createdAt, now)}</span>
      </div>

      {/* Buyurtma, bo'lim, holat */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-lg font-extrabold truncate">{job.orderName || 'Buyurtma'}</span>
          {isVoid && (
            <span className="rounded-md bg-danger text-white text-xs font-black uppercase tracking-wide px-2 py-0.5">
              Otkaz
            </span>
          )}
          {job.append && !isVoid && (
            <span className="rounded-md bg-text/10 text-text text-xs font-bold px-2 py-0.5">Qo‘shimcha</span>
          )}
          <span
            className={`rounded-full text-xs font-extrabold px-2.5 py-0.5 ${
              expired ? 'bg-danger text-white' : 'bg-warning text-black'
            }`}
          >
            {expired ? '3 soatdan oshdi' : 'Navbatda'}
          </span>
        </div>
        <div className="mt-1.5 text-sm flex items-center gap-x-2 gap-y-1 flex-wrap">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-hover border border-border px-2 py-0.5 font-bold text-text">
            <PrinterIcon className="w-4 h-4 text-muted" />
            {job.stationName || 'Bo‘lim'}
          </span>
          <span className="text-muted whitespace-nowrap">
            {job.itemsCount} ta taom · {job.attempts} marta urinildi
            {job.lastAttemptAt ? `, oxirgisi ${clock(job.lastAttemptAt)}` : ''}
          </span>
        </div>
        {job.lastError && !ui?.error && <div className="mt-1 text-xs text-muted line-clamp-2 break-words">{job.lastError}</div>}
        {ui?.error && (
          <div role="alert" className="mt-1.5 text-sm font-bold text-danger flex items-start gap-1.5">
            <AlertIcon className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="break-words">{ui.error}</span>
          </div>
        )}
        {ui?.confirm && (
          <div className="mt-1.5 text-sm font-bold text-danger">
            Chek oshxonaga chiqmaydi — oshpazga og‘zaki ayting. Tasdiqlash uchun yana bosing.
          </div>
        )}
      </div>

      {/* Amallar */}
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onRetry}
          disabled={!!ui?.busy}
          className="flex-1 md:flex-none h-12 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white font-extrabold flex items-center justify-center gap-2 active:scale-[0.97] transition-transform disabled:opacity-60"
        >
          {ui?.busy === 'retry' ? <Spinner /> : <PrinterIcon />}
          Chiqarish
        </button>
        <button
          onClick={onCancel}
          disabled={!!ui?.busy}
          className={`flex-1 md:flex-none h-12 px-4 rounded-xl font-extrabold flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-60 ${
            ui?.confirm
              ? 'bg-danger text-white shadow-lg'
              : 'bg-surface border-2 border-danger/60 text-danger hover:bg-danger/10'
          }`}
        >
          {ui?.busy === 'cancel' ? <Spinner /> : <CloseIcon />}
          {ui?.confirm ? 'Ha, bekor qilish' : 'Bekor qilish'}
        </button>
      </div>
    </div>
  );
}
