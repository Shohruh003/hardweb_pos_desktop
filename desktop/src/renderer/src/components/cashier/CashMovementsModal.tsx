import { useCallback, useEffect, useRef, useState } from 'react';
import { roundSum } from '@hardweb-pos/shared';
import type { CashMovementKind, CashSummary, PaymentMethodKind } from '@hardweb-pos/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { useConfirm } from '../../state/confirm';
import { formatSum } from '../ui';
import { Sheet, SheetError, Spinner } from '../waiter/Sheet';
import { NumPad, applyNumKey } from '../waiter/NumPad';
import type { NumKey } from '../waiter/NumPad';
import { KeyboardToggle, TouchKeyboard, useTouchKeyboardPref } from '../waiter/TouchKeyboard';
import { clock, groupDigits, todayKey } from './orderType';
import { KIND_TINT, MethodIcon } from './payMethods';
import { CashFlowIcon, CheckIcon, RefreshIcon, TrashIcon } from './icons';

// "Kirim / Chiqim" (B33 — eski POS'dagi kassir menyusi): kassaga qo'yilgan pul (ertalabki maydalik,
// egasi bergan pul) — kirim; kassadan chiqqan pul (non, gaz, bozorlik) — chiqim (avvalgi "Rasxod").
// O'ngda — bugungi "Kassa holati": to'lov usullari bo'yicha tushum, kirim, chiqim, qarzlar va
// "Kassada bo‘lishi kerak" (naqd). Harakatni o'chirish — faqat direktor.

export interface CashMovement {
  id: string;
  amount: number;
  note: string | null;
  kind: CashMovementKind;
  cashierName: string | null;
  createdAt: string;
}

const QUICK_NOTES: Record<CashMovementKind, string[]> = {
  kirim: ['Ertalabki qoldiq', 'Maydalik', 'Egasi berdi'],
  chiqim: ['Non', 'Gaz', 'Bozorlik', 'Taksi', 'Ish haqi', 'Inkassatsiya'],
};
const NOTE_MAX = 120;
const MAX_DIGITS = 9;

const KINDS: PaymentMethodKind[] = ['cash', 'card', 'online', 'debt', 'other'];
/** Server yuborgan usul turi (matn) -> ma'lum tur; noma'lum — 'other' */
const asKind = (k: string | null | undefined): PaymentMethodKind =>
  KINDS.includes(k as PaymentMethodKind) ? (k as PaymentMethodKind) : 'other';

function toMovements(raw: unknown): CashMovement[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { items?: unknown })?.items) ? (raw as { items: unknown[] }).items : [];
  return list
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      id: String(r.id ?? ''),
      amount: roundSum(r.amount as number),
      note: typeof r.note === 'string' && r.note ? r.note : null,
      // Eski yozuvlar (turi yo'q) — chiqim (avvalgi rasxod)
      kind: r.kind === 'kirim' ? 'kirim' : 'chiqim',
      cashierName: typeof r.cashierName === 'string' ? r.cashierName : null,
      createdAt: String(r.createdAt ?? ''),
    }));
}

/** Bugungi kassa harakatlari: GET /expenses?from=&to= (ikkala tur) */
export async function loadTodayMovements(): Promise<CashMovement[]> {
  const d = todayKey();
  const raw = await api.get<unknown>(`/expenses?from=${d}&to=${d}&date=${d}`);
  return toMovements(raw).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function CashMovementsModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const kb = useTouchKeyboardPref();
  const canDelete = user?.role === 'direktor' || user?.role === 'superadmin';
  const [kind, setKind] = useState<CashMovementKind>('chiqim');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [noteActive, setNoteActive] = useState(false);
  const [rows, setRows] = useState<CashMovement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState('');
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [summaryState, setSummaryState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const noteRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadRows = useCallback(async () => {
    try {
      const list = await loadTodayMovements();
      if (!alive.current) return;
      setRows(list);
      setListError('');
    } catch (e) {
      if (alive.current) setListError((e as Error)?.message || 'Harakatlar yuklanmadi');
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const s = await api.get<CashSummary>(`/reports/cash-summary?date=${todayKey()}`);
      if (!alive.current) return;
      setSummary(s && typeof s === 'object' ? s : null);
      setSummaryState('ok');
    } catch {
      if (alive.current) setSummaryState('error');
    }
  }, []);

  useEffect(() => {
    void loadRows();
    void loadSummary();
  }, [loadRows, loadSummary]);

  const value = Number(amount) || 0;

  function press(k: NumKey) {
    setError('');
    setFlash('');
    setAmount((a) => {
      const next = applyNumKey(a, k, { maxDigits: MAX_DIGITS });
      return next === '0' ? '' : next;
    });
  }

  async function add() {
    if (busy) return;
    if (value <= 0) {
      setError('Summani kiriting');
      return;
    }
    setBusy(true);
    setError('');
    setFlash('');
    try {
      await api.post('/expenses', { amount: value, note: note.trim() || undefined, kind });
      if (!alive.current) return;
      setFlash(`✓ ${kind === 'kirim' ? 'Kirim' : 'Chiqim'}: ${formatSum(value)}${note.trim() ? ` — ${note.trim()}` : ''}`);
      setAmount('');
      setNote('');
      setNoteActive(false);
      onChangedRef.current?.();
      await Promise.all([loadRows(), loadSummary()]);
    } catch (e) {
      if (alive.current) setError((e as Error)?.message || 'Saqlanmadi');
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function remove(r: CashMovement) {
    const ok = await confirm({
      title: r.kind === 'kirim' ? 'Kirimni o‘chirish' : 'Chiqimni o‘chirish',
      message: `${clock(r.createdAt)} · ${formatSum(r.amount)}${r.note ? ` — ${r.note}` : ''} o‘chirilsinmi?`,
      confirmText: 'O‘chirish',
      danger: true,
    });
    if (!ok || !alive.current) return;
    setError('');
    try {
      await api.del(`/expenses/${r.id}`);
      if (!alive.current) return;
      onChangedRef.current?.();
      await Promise.all([loadRows(), loadSummary()]);
    } catch (e) {
      if (alive.current) setError((e as Error)?.message || 'O‘chirilmadi');
    }
  }

  // Jismoniy klaviatura: raqamlar / ⌫ — summa, Enter — qo'shish (izoh maydonida ham)
  const live = useRef({ press, add });
  live.current = { press, add };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      if (!typing && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        live.current.press(e.key as NumKey);
      } else if (!typing && e.key === 'Backspace') {
        e.preventDefault();
        live.current.press('back');
      } else if (e.key === 'Enter' && t?.tagName !== 'BUTTON' && !e.isComposing) {
        e.preventDefault();
        void live.current.add();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const kirimTotal = rows.filter((r) => r.kind === 'kirim').reduce((s, r) => s + r.amount, 0);
  const chiqimTotal = rows.filter((r) => r.kind === 'chiqim').reduce((s, r) => s + r.amount, 0);
  const isKirim = kind === 'kirim';

  return (
    <Sheet
      title="Kirim / Chiqim"
      subtitle="Kassaga kirgan va kassadan chiqqan pul — bugun"
      icon={<CashFlowIcon className="w-6 h-6" />}
      iconTone="bg-primary/15 text-primary"
      size="xl"
      busy={busy}
      onClose={onClose}
      testId="cash-modal"
      footer={
        <div className="space-y-2.5">
          {noteActive && kb.show && (
            <TouchKeyboard
              target={noteRef}
              value={note}
              onChange={(v) => setNote(v.slice(0, NOTE_MAX))}
              maxLength={NOTE_MAX}
              onEnter={() => void add()}
            />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-14 px-5 rounded-2xl bg-bg border border-border font-bold text-text hover:border-text disabled:opacity-50"
            >
              Yopish
            </button>
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy}
              data-testid="cash-add"
              className={`flex-1 min-w-0 h-14 rounded-2xl text-lg font-black flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50 ${
                isKirim ? 'bg-success text-black hover:brightness-105' : 'bg-danger text-white hover:brightness-110'
              } ${value > 0 ? '' : 'opacity-60'}`}
            >
              {busy ? <Spinner className={`w-5 h-5 ${isKirim ? 'border-black' : 'border-white'}`} /> : <CheckIcon className="w-6 h-6" />}
              <span className="truncate">
                {isKirim ? 'Kirim qo‘shish' : 'Chiqim qo‘shish'}
                {value > 0 ? ` — ${formatSum(value)}` : ''}
              </span>
            </button>
          </div>
        </div>
      }
    >
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-5 space-y-4 md:space-y-0">
        {/* Chap: yangi harakat */}
        <div className="space-y-3 min-w-0">
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Harakat turi">
            {(['kirim', 'chiqim'] as const).map((k) => {
              const on = kind === k;
              const cls = on
                ? k === 'kirim'
                  ? 'bg-success text-black border-success shadow-lg shadow-success/20'
                  : 'bg-danger text-white border-danger shadow-lg shadow-danger/20'
                : 'bg-bg text-text border-border hover:border-primary';
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => {
                    setKind(k);
                    setError('');
                    setFlash('');
                  }}
                  data-testid={`cash-tab-${k}`}
                  className={`h-14 rounded-2xl border-2 text-lg font-black transition-colors ${cls}`}
                >
                  {k === 'kirim' ? '+ Kirim' : '− Chiqim'}
                </button>
              );
            })}
          </div>

          <div
            className={`rounded-2xl border-2 px-4 py-2.5 ${isKirim ? 'border-success bg-success/10' : 'border-danger bg-danger/10'}`}
          >
            <div className="text-xs font-extrabold uppercase tracking-wider text-muted">
              {isKirim ? 'Kassaga qo‘yilgan summa' : 'Kassadan olingan summa'}
            </div>
            <div className="text-4xl font-black text-text tabular-nums" data-testid="cash-amount">
              {value > 0 ? groupDigits(String(value)) : '0'} <span className="text-base font-bold text-muted">so‘m</span>
            </div>
          </div>

          <NumPad onKey={press} disabled={busy} compact testIdPrefix="cash-key" />

          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label htmlFor="cash-note" className="text-sm font-bold text-muted">
                Izoh (nima uchun)
              </label>
              <KeyboardToggle show={kb.show} onToggle={() => kb.setShow(!kb.show)} />
            </div>
            <input
              ref={noteRef}
              id="cash-note"
              data-testid="cash-note"
              value={note}
              maxLength={NOTE_MAX}
              inputMode={kb.touch && kb.show ? 'none' : undefined}
              onFocus={() => setNoteActive(true)}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isKirim ? 'Masalan: ertalabki qoldiq' : 'Masalan: non, gaz'}
              className="w-full h-12 px-3 rounded-xl bg-bg border-2 border-border focus:border-primary outline-none text-base font-semibold text-text placeholder:font-normal placeholder:text-muted/60"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_NOTES[kind].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNote(n)}
                  className={`h-10 px-3 rounded-full border text-sm font-bold ${
                    note === n ? 'bg-primary-hover text-white border-primary-hover' : 'bg-bg text-text border-border hover:border-primary'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <SheetError>{error}</SheetError>
          {flash && !error && (
            <div className="rounded-xl border border-success/50 bg-success/10 px-3 py-2 text-sm font-bold text-success">{flash}</div>
          )}
        </div>

        {/* O'ng: kassa holati + bugungi harakatlar */}
        <div className="space-y-3 min-w-0">
          <CashSummaryCard summary={summary} state={summaryState} onRefresh={() => void loadSummary()} />

          <div>
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <div className="text-sm font-extrabold uppercase tracking-wider text-muted">Bugungi harakatlar</div>
              <div className="text-xs font-bold whitespace-nowrap">
                <span className="text-success">+{groupDigits(String(kirimTotal))}</span>
                <span className="text-muted"> · </span>
                <span className="text-danger">−{groupDigits(String(chiqimTotal))}</span>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-bg divide-y divide-border max-h-[34vh] overflow-auto">
              {!loaded ? (
                <div className="p-4 text-center text-sm text-muted">Yuklanmoqda…</div>
              ) : listError ? (
                <div className="p-4 text-center text-sm text-danger font-semibold">{listError}</div>
              ) : rows.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted">Bugun kirim yoki chiqim yo‘q</div>
              ) : (
                rows.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 pl-3 pr-1.5 py-1.5" data-testid={`cash-row-${r.id}`}>
                    <span
                      className={`shrink-0 rounded-md px-1.5 text-[11px] font-black leading-5 ${
                        r.kind === 'kirim' ? 'bg-success text-black' : 'bg-danger text-white'
                      }`}
                    >
                      {r.kind === 'kirim' ? 'KIRIM' : 'CHIQIM'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-text truncate">{r.note || '—'}</span>
                      <span className="block text-xs text-muted truncate">
                        {clock(r.createdAt)}
                        {r.cashierName ? ` · ${r.cashierName}` : ''}
                      </span>
                    </span>
                    <span className={`font-extrabold tabular-nums whitespace-nowrap ${r.kind === 'kirim' ? 'text-success' : 'text-danger'}`}>
                      {r.kind === 'kirim' ? '+' : '−'}
                      {groupDigits(String(r.amount))}
                    </span>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => void remove(r)}
                        aria-label="O‘chirish"
                        data-testid={`cash-delete-${r.id}`}
                        className="w-10 h-10 shrink-0 rounded-lg text-muted hover:text-danger hover:bg-danger/10 flex items-center justify-center"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * "Kassa holati" (bugun): to'lov usullari bo'yicha tushum, kirim, chiqim, qarzlar, naqd vozvrat va
 * eng muhimi — "Kassada bo‘lishi kerak" (naqd). GET /reports/cash-summary?date=YYYY-MM-DD.
 */
export function CashSummaryCard({
  summary,
  state,
  onRefresh,
}: {
  summary: CashSummary | null;
  state: 'loading' | 'ok' | 'error';
  onRefresh?: () => void;
}) {
  const byMethod = Array.isArray(summary?.byMethod) ? summary!.byMethod : [];
  const repaid = Array.isArray(summary?.debtRepaid) ? summary!.debtRepaid.filter((r) => roundSum(r.amount) > 0) : [];
  const hasDebtRow = byMethod.some((m) => m.kind === 'debt');
  return (
    <div className="rounded-2xl border-2 border-primary/50 bg-primary/5 p-3.5" data-testid="cash-summary">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="font-extrabold text-text">Kassa holati · bugun</div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Yangilash"
            className="w-10 h-10 rounded-lg text-muted hover:text-text hover:bg-surface-hover flex items-center justify-center"
          >
            <RefreshIcon className="w-5 h-5" />
          </button>
        )}
      </div>
      {state === 'loading' && !summary ? (
        <div className="py-4 text-center text-sm text-muted">Yuklanmoqda…</div>
      ) : state === 'error' && !summary ? (
        <div className="py-3 text-center text-sm text-muted">Kassa holati hozircha olinmadi</div>
      ) : summary ? (
        <div className="space-y-1">
          {byMethod.map((m) => (
            <div key={m.key} className="flex items-center gap-2 text-sm">
              <span className={KIND_TINT[asKind(m.kind)]}>
                <MethodIcon kind={asKind(m.kind)} className="w-4 h-4" />
              </span>
              <span className="flex-1 min-w-0 truncate text-text font-semibold">
                {m.label}
                {m.kind === 'debt' ? ' (yozildi)' : ''}
              </span>
              <span className="font-bold tabular-nums text-text">{groupDigits(String(roundSum(m.amount)))}</span>
            </div>
          ))}
          {!hasDebtRow && roundSum(summary.debtCreated) > 0 && (
            <Line label="Qarzga yozildi" value={groupDigits(String(roundSum(summary.debtCreated)))} />
          )}
          <div className="border-t border-border my-1.5" />
          <Line label="Kirim" value={`+ ${groupDigits(String(roundSum(summary.kirim)))}`} tone="text-success" />
          <Line label="Chiqim" value={`− ${groupDigits(String(roundSum(summary.chiqim)))}`} tone="text-danger" />
          {repaid.map((r) => (
            <Line key={r.key} label={`Qarz qaytdi (${r.label})`} value={`+ ${groupDigits(String(roundSum(r.amount)))}`} tone="text-success" />
          ))}
          {roundSum(summary.refundsCash) > 0 && (
            <Line label="Naqd vozvrat" value={`− ${groupDigits(String(roundSum(summary.refundsCash)))}`} tone="text-danger" />
          )}
          <div className="mt-2 rounded-xl bg-primary-hover text-white px-3 py-2.5 flex items-center justify-between gap-2">
            <span className="text-sm font-extrabold leading-tight">Kassada bo‘lishi kerak (naqd)</span>
            <span className="text-2xl font-black tabular-nums whitespace-nowrap" data-testid="cash-expected">
              {formatSum(roundSum(summary.expectedCash))}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted font-semibold">{label}</span>
      <span className={`font-bold tabular-nums ${tone ?? 'text-text'}`}>{value}</span>
    </div>
  );
}
