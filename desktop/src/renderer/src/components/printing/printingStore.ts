import { useEffect, useSyncExternalStore } from 'react';
import {
  PrintJob,
  PrinterStatus,
  PrintersStatusPayload,
  SOCKET_EVENTS,
  UserRole,
  hasCapability,
} from '@hardweb-pos/shared';
import type { User } from '@hardweb-pos/shared';
import { ApiError, api } from '../../lib/api';
import { getSocket } from '../../lib/socket';

// Bo'lim (oshxona/bar) cheklari navbati (B17) va printerlar holati (B26) — kassa/admin ekranlari
// uchun umumiy ma'lumot ombori. Bir nechta komponent (banner, ro'yxat oynasi, holat qatori) bir
// xil ma'lumotni ko'radi, lekin serverga bitta so'rov ketadi:
//  • kamida bitta komponent ko'rsatayotgan paytdagina ishlaydi (oxirgisi yopilsa — to'xtaydi);
//  • har 30 s da yangilanadi, socket hodisasida (chek chiqmadi / chiqdi / printer holati) —
//    qisqa kutib (debounce) bitta so'rov bilan, server qayta ulanganda va oyna qayta ko'ringanda;
//  • 403 (ruxsat yo'q) yoki 404 (eski server / demo) — jim to'xtaydi, ekranda hech narsa chiqmaydi.

/** Cheklar navbati va printerlar holatini ko'rish/boshqarish: kassir yoki administrator / direktor */
export function canSeePrinting(user: Pick<User, 'role' | 'permissions'> | null | undefined): boolean {
  if (!user) return false;
  return hasCapability(user, 'cashier') || user.role === UserRole.Admin;
}

export interface PolledState<T> {
  data: T;
  /** Kamida bir marta muvaffaqiyatli yuklandimi */
  loaded: boolean;
  /** Oxirgi so'rov xatosi (tarmoq) — eski ma'lumot saqlanadi */
  error: string | null;
  /** 403/404 — bu foydalanuvchi/server uchun mavjud emas (UI yashiriladi) */
  unavailable: boolean;
}

interface PolledConfig<T> {
  path: string;
  empty: T;
  parse: (raw: unknown) => T;
  /** Davriy yangilash oralig'i (ms) */
  pollMs: number | (() => number);
  /** Shu socket hodisalarida qayta yuklanadi */
  refreshOn: string[];
  /** Hodisa ma'lumotni o'zi olib kelsa — so'rovsiz qo'llanadi (null — e'tiborsiz) */
  apply?: { event: string; map: (payload: unknown) => T | null };
}

const EVENT_DEBOUNCE_MS = 600;
/** Oxirgi komponent yopilgach shuncha kutib to'xtaymiz — sahifa almashganda banner "lip" etib yo'qolmasin */
const STOP_GRACE_MS = 3000;

function createPolled<T>(cfg: PolledConfig<T>) {
  const initial: PolledState<T> = { data: cfg.empty, loaded: false, error: null, unavailable: false };
  let state = initial;
  const listeners = new Set<() => void>();
  let users = 0;
  let pollTimer: number | undefined;
  let debounceTimer: number | undefined;
  let stopTimer: number | undefined;
  let inflight: Promise<void> | null = null;
  let again = false;
  let generation = 0; // to'xtatilgandan keyin kech kelgan javob holatni buzmasin
  let cleanup: (() => void) | null = null;

  const set = (patch: Partial<PolledState<T>>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  async function fetchOnce(gen: number): Promise<void> {
    try {
      const raw = await api.get<unknown>(cfg.path);
      if (gen !== generation) return;
      set({ data: cfg.parse(raw), loaded: true, error: null, unavailable: false });
    } catch (e) {
      if (gen !== generation) return;
      const status = e instanceof ApiError ? e.status : -1;
      if (status === 403 || status === 404) {
        // Ruxsat yo'q yoki server bu yo'lni bilmaydi — so'rovlarni to'xtatamiz (spam yo'q)
        set({ data: cfg.empty, loaded: true, unavailable: true, error: null });
        window.clearInterval(pollTimer);
        pollTimer = undefined;
        return;
      }
      set({ error: (e as Error)?.message || 'Yuklab bo‘lmadi' });
    }
  }

  /** Hozir yangilash. Bir vaqtda bitta so'rov; davomida yana so'ralsa — tugagach yana bir marta. */
  function refresh(): Promise<void> {
    if (users === 0) return Promise.resolve();
    if (inflight) {
      again = true;
      return inflight;
    }
    const gen = generation;
    inflight = (async () => {
      do {
        again = false;
        await fetchOnce(gen);
      } while (again && gen === generation && !state.unavailable);
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function refreshSoon(): void {
    if (users === 0 || state.unavailable) return;
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => void refresh(), EVENT_DEBOUNCE_MS);
  }

  function schedulePoll(): void {
    window.clearInterval(pollTimer);
    const ms = typeof cfg.pollMs === 'function' ? cfg.pollMs() : cfg.pollMs;
    pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return; // yashirin oynada so'rov yubormaymiz
      void refresh();
    }, ms);
  }

  function start(): void {
    generation += 1;
    const socket = getSocket();
    const onEvent = () => refreshSoon();
    const onApply = (payload: unknown) => {
      const next = cfg.apply?.map(payload);
      if (next != null && !state.unavailable) {
        set({ data: next, loaded: true, error: null });
        schedulePoll(); // hodisa kelib turibdi — oraliq qaytadan hisoblanadi
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshSoon();
    };
    for (const ev of cfg.refreshOn) socket.on(ev, onEvent);
    socket.on('connect', onEvent); // server qayta ishga tushdi / tarmoq qaytdi
    if (cfg.apply) socket.on(cfg.apply.event, onApply);
    document.addEventListener('visibilitychange', onVisible);
    schedulePoll();
    void refresh();
    cleanup = () => {
      for (const ev of cfg.refreshOn) socket.off(ev, onEvent);
      socket.off('connect', onEvent);
      if (cfg.apply) socket.off(cfg.apply.event, onApply);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }

  function stop(): void {
    generation += 1;
    window.clearInterval(pollTimer);
    window.clearTimeout(debounceTimer);
    pollTimer = debounceTimer = undefined;
    cleanup?.();
    cleanup = null;
    // Keyingi ochilishda (boshqa xodim kirgan bo'lishi mumkin) eski ma'lumot ko'rinmasin
    state = initial;
  }

  function acquire(): () => void {
    users += 1;
    if (stopTimer !== undefined) {
      // Yangi sahifa darhol qayta ulandi — ishlab turgan so'rovlar davom etadi
      window.clearTimeout(stopTimer);
      stopTimer = undefined;
    } else if (users === 1) {
      start();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      users -= 1;
      if (users > 0) return;
      stopTimer = window.setTimeout(() => {
        stopTimer = undefined;
        if (users === 0) stop();
      }, STOP_GRACE_MS);
    };
  }

  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const getSnapshot = () => state;

  /** enabled=false — hech narsa yuklanmaydi va bo'sh holat qaytadi (ruxsatsiz xodim) */
  function useData(enabled: boolean): PolledState<T> {
    useEffect(() => (enabled ? acquire() : undefined), [enabled]);
    const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return enabled ? snap : initial;
  }

  return { useData, refresh, refreshSoon };
}

// ---------------------------------------------------------------------------------------------
// Cheklar navbati (B17): GET /printing/jobs — chiqmagan (pending + muddati o'tgan) cheklar
// ---------------------------------------------------------------------------------------------

/** Ro'yxat qatori: shared PrintJob + chek turi (server qo'shadi: 'order' | 'void' — OTKAZ cheki) */
export type PrintJobRow = PrintJob & { kind?: 'order' | 'void' | string };

function parseJobs(raw: unknown): PrintJobRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (j): j is PrintJobRow =>
      !!j && typeof j === 'object' && typeof (j as PrintJob).id === 'string' && typeof (j as PrintJob).status === 'string',
  );
}

const jobsStore = createPolled<PrintJobRow[]>({
  path: '/printing/jobs',
  empty: [],
  parse: parseJobs,
  pollMs: 30_000,
  // Chek chiqmadi / chiqdi / printer holati (navbat soni) o'zgardi — ro'yxat yangilanadi
  refreshOn: [SOCKET_EVENTS.PRINT_FAILED, SOCKET_EVENTS.PRINT_RECOVERED, SOCKET_EVENTS.PRINTERS_STATUS],
});

/** Chiqmay turgan cheklar (yangisi birinchi) — banner va ro'yxat oynasi uchun */
export const usePrintJobs = jobsStore.useData;
export const refreshPrintJobs = jobsStore.refresh;

/** "Hozir urinish" — navbatdagi barcha cheklarni darhol yuborish; javobda qolgan navbat soni */
export async function retryAllPrintJobs(): Promise<{ ok: boolean; pending: number }> {
  try {
    const r = await api.post<{ ok?: boolean; pending?: number }>('/printing/retry-all');
    return { ok: r?.ok !== false, pending: Number(r?.pending) || 0 };
  } finally {
    void jobsStore.refresh();
    statusStore.refreshSoon();
  }
}

/** Bitta chekni hozir chiqarish (navbatdagi yoki 3 soatdan oshgan) */
export async function retryPrintJob(id: string): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await api.post<{ ok?: boolean; message?: string }>(`/printing/jobs/${encodeURIComponent(id)}/retry`);
    return { ok: r?.ok === true, message: String(r?.message ?? '') };
  } finally {
    void jobsStore.refresh();
    statusStore.refreshSoon();
  }
}

/** Chekni bekor qilish (oshpazga og'zaki aytilgan yoki qo'lda chiqarilgan) */
export async function cancelPrintJob(id: string): Promise<void> {
  try {
    await api.post(`/printing/jobs/${encodeURIComponent(id)}/cancel`);
  } finally {
    void jobsStore.refresh();
    statusStore.refreshSoon();
  }
}

// ---------------------------------------------------------------------------------------------
// Printerlar holati (B26): GET /printing/status + 'printers:status' socket hodisasi
// ---------------------------------------------------------------------------------------------

function parsePrinters(raw: unknown): PrinterStatus[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is PrinterStatus =>
      !!p && typeof p === 'object' && typeof (p as PrinterStatus).stationId === 'string' && typeof (p as PrinterStatus).host === 'string',
  );
}

// Socket orqali holat kelib tursa — so'rov kamroq (60 s), aks holda 30 s
let statusEventsSeen = false;

const statusStore = createPolled<PrinterStatus[]>({
  path: '/printing/status',
  empty: [],
  parse: parsePrinters,
  pollMs: () => (statusEventsSeen ? 60_000 : 30_000),
  // Navbatdagi cheklar soni o'zgaradi
  refreshOn: [SOCKET_EVENTS.PRINT_FAILED, SOCKET_EVENTS.PRINT_RECOVERED],
  apply: {
    event: SOCKET_EVENTS.PRINTERS_STATUS,
    map: (payload) => {
      const printers = (payload as PrintersStatusPayload | null)?.printers;
      if (!Array.isArray(printers)) return null;
      statusEventsSeen = true;
      return parsePrinters(printers);
    },
  },
});

/** Bo'lim printerlari holati (holat qatori) */
export const usePrinterStatus = statusStore.useData;
