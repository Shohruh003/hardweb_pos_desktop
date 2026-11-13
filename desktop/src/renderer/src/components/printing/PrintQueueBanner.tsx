import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../state/auth';
import { PrintJobRow, canSeePrinting, retryAllPrintJobs, usePrintJobs } from './printingStore';
import { PrintJobsModal } from './PrintJobsModal';
import { AlertIcon, CheckIcon, ListIcon, RetryIcon, Spinner } from './icons';

// Doimiy ogohlantirish qatori (B17): oshxona/bar cheklari chiqmay turgan paytda sarlavha ostida
// ko'rinadi (kontentni to'smaydi — sahifa shu qator balandligicha qisqaradi):
//   "⚠ 3 ta chek chiqmay turibdi (Oshxona, Bar) — printer yoqilishi bilan avtomatik chiqadi"
//   [Hozir urinish] [Ro'yxat]
// Faqat kassir / administrator / direktor uchun; boshqalarda hech narsa ko'rinmaydi va so'rov ketmaydi.
// 3 soatdan oshgan (avtomatik urinish to'xtagan) chek bo'lsa — qizil, "qo'lda chiqaring".

/** Banner balandligi — AppShell boshqa suzuvchi xabarlarni shu qadar pastga suradi */
export const PRINT_BANNER_HEIGHT = '3.5rem';

/** Banner hozir ko'rinadimi (AppShell joy ajratishi uchun) */
export function usePrintBannerVisible(): boolean {
  const { user } = useAuth();
  const enabled = canSeePrinting(user);
  const q = usePrintJobs(enabled);
  return enabled && q.data.length > 0;
}

/** Bo'limlar nomi — eng ko'p chek turgan bo'lim birinchi (ko'pi bilan 3 ta) */
function stationsText(jobs: PrintJobRow[]): string {
  const counts = new Map<string, number>();
  for (const j of jobs) {
    const name = (j.stationName || 'Bo‘lim').trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const names = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} …` : names.join(', ');
}

export function PrintQueueBanner() {
  const { user } = useAuth();
  const enabled = canSeePrinting(user);
  const q = usePrintJobs(enabled);
  const [listOpen, setListOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const jobs = q.data;
  const count = jobs.length;
  const expired = useMemo(() => jobs.filter((j) => j.status === 'expired').length, [jobs]);
  const stations = useMemo(() => stationsText(jobs), [jobs]);

  if (!enabled) return null;

  async function retryAll() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await retryAllPrintJobs();
      setFlash(
        r.pending === 0
          ? expired > 0
            ? { ok: false, text: '3 soatdan oshgan cheklarni ro‘yxatdan chiqaring' }
            : { ok: true, text: 'Cheklar chiqarildi' }
          : { ok: false, text: `Printer hali javob bermayapti (${r.pending} ta navbatda)` },
      );
    } catch (e) {
      setFlash({ ok: false, text: (e as Error)?.message || 'Urinib bo‘lmadi' });
    } finally {
      setBusy(false);
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), 6000);
    }
  }

  const danger = expired > 0;
  const shownCount = count >= 100 ? '100+' : String(count);
  const tail = danger
    ? `${expired} tasi 3 soatdan oshdi — ro‘yxatdan qo‘lda chiqaring`
    : 'printer yoqilishi bilan avtomatik chiqadi';

  return (
    <>
      {count > 0 && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="print-queue-banner"
          style={{ height: PRINT_BANNER_HEIGHT }}
          className={`relative z-40 shrink-0 flex items-center gap-2 sm:gap-3 pl-2.5 pr-2 sm:px-5 border-b border-black/10 shadow-sm ${
            danger ? 'bg-danger text-white' : 'bg-warning text-black'
          }`}
        >
          <span
            className={`shrink-0 w-9 h-9 rounded-full bg-surface flex items-center justify-center shadow-sm ${
              danger ? 'text-danger' : 'text-warning'
            }`}
          >
            <AlertIcon className="w-5 h-5" />
          </span>
          {/* Matn yirik va qalin (19px bold — WCAG "katta matn"): qizil fonda oq yozuv ham 2 m dan o'qiladi */}
          <div className="min-w-0 flex-1 leading-tight">
            <div className="font-extrabold truncate text-[19px]">
              <span className="sm:hidden">{shownCount} ta chek chiqmadi</span>
              <span className="hidden sm:inline">
                {shownCount} ta chek chiqmay turibdi ({stations})
                <span className="hidden xl:inline font-bold"> — {tail}</span>
              </span>
            </div>
            <div className="hidden sm:block xl:hidden text-sm font-bold truncate">
              {flash ? flash.text : tail}
            </div>
          </div>
          {flash && (
            <span
              role="status"
              className="hidden xl:flex items-center gap-1.5 shrink-0 max-w-[22rem] text-sm font-bold truncate"
            >
              {flash.ok ? <CheckIcon className="w-5 h-5 shrink-0" /> : <AlertIcon className="w-5 h-5 shrink-0" />}
              <span className="truncate">{flash.text}</span>
            </span>
          )}
          <button
            onClick={retryAll}
            disabled={busy}
            data-testid="print-queue-retry"
            aria-label="Hozir urinish"
            className="shrink-0 h-12 px-3 sm:px-4 rounded-xl bg-surface text-text font-extrabold flex items-center gap-2 shadow hover:brightness-110 active:scale-[0.97] transition-transform disabled:opacity-70"
          >
            {busy ? <Spinner /> : <RetryIcon />}
            <span className="hidden sm:inline whitespace-nowrap">Hozir urinish</span>
          </button>
          <button
            onClick={() => setListOpen(true)}
            data-testid="print-queue-list"
            aria-label="Ro‘yxat"
            className="shrink-0 h-12 px-3 sm:px-4 rounded-xl bg-surface text-text font-extrabold flex items-center gap-2 shadow hover:brightness-110 active:scale-[0.97] transition-transform"
          >
            <ListIcon />
            <span className="hidden sm:inline">Ro‘yxat</span>
          </button>
        </div>
      )}
      {listOpen && <PrintJobsModal onClose={() => setListOpen(false)} />}
    </>
  );
}
