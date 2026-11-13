import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { roundSum } from '@hardweb-pos/shared';
import type { DebtRow } from '@hardweb-pos/shared';
import { api } from '../../lib/api';
import { usePosSettings } from '../../lib/posSettings';
import { formatSum } from '../ui';
import { Sheet, SheetError, Spinner } from '../waiter/Sheet';
import { KeyboardToggle, TouchKeyboard, useTouchKeyboardPref } from '../waiter/TouchKeyboard';
import { dateTime, displayPhone, groupDigits } from './orderType';
import { KIND_TINT, MethodIcon, activeMethods, methodLabel } from './payMethods';
import { CheckIcon, CloseIcon, DebtIcon, PhoneIcon, SearchIcon, UserIcon } from './icons';

// "Qarzlar" (B34): "Qarzga" yozilgan to'lovlar — kim, qachon, qaysi hisob, qancha. Mijoz qarzini
// olib kelsa — "✓ To‘landi" -> qaysi usul bilan (Naqd, Terminal…) -> POST /debts/:paymentId/repay.
// Qaytarilgan pul shu kungi "Kassa holati"da hisoblanadi. Ochiq qarzlar birinchi.

type Status = 'open' | 'repaid';

const onlyDigits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');

/** Apostrof turlari va katta-kichik harfdan qat'i nazar (o‘ / o' bir xil) */
function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‘’ʼʻ`'´]/g, "'")
    .trim();
}

/** Server javobi: DebtRow[] yoki {rows|items, total} — ikkalasini ham qabul qilamiz */
function toRows(raw: unknown): DebtRow[] {
  let list: unknown = raw;
  if (!Array.isArray(list) && list && typeof list === 'object') {
    const o = list as { rows?: unknown; items?: unknown };
    list = Array.isArray(o.rows) ? o.rows : Array.isArray(o.items) ? o.items : [];
  }
  return (Array.isArray(list) ? (list as DebtRow[]) : []).filter((d) => !!d && typeof d === 'object' && !!d.paymentId);
}

export function DebtsModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const pos = usePosSettings();
  const kb = useTouchKeyboardPref();
  // Qarz faqat "qarz" bo'lmagan FAOL usul bilan qaytariladi
  const repayMethods = useMemo(() => activeMethods(pos.paymentMethods).filter((m) => m.kind !== 'debt'), [pos.paymentMethods]);
  const [status, setStatus] = useState<Status>('open');
  const [rows, setRows] = useState<DebtRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [repayId, setRepayId] = useState<string | null>(null);
  const [repayType, setRepayType] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const seq = useRef(0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async (st: Status) => {
    const my = ++seq.current;
    setLoaded(false);
    try {
      const raw = await api.get<unknown>(`/reports/debts?status=${st}`);
      if (!alive.current || my !== seq.current) return;
      setRows(toRows(raw));
      setLoadError('');
    } catch (e) {
      if (alive.current && my === seq.current) setLoadError((e as Error)?.message || 'Qarzlar yuklanmadi');
    } finally {
      if (alive.current && my === seq.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    setRepayId(null);
    void load(status);
  }, [status, load]);

  const shown = useMemo(() => {
    const needle = norm(q);
    const digits = onlyDigits(q);
    return rows
      .filter((d) => {
        if (!needle) return true;
        if (norm(d.debtorName).includes(needle)) return true;
        if (norm(d.orderName).includes(needle)) return true;
        return digits.length >= 2 && onlyDigits(d.debtorPhone).includes(digits);
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [rows, q]);
  const total = shown.reduce((s, d) => s + roundSum(d.amount), 0);

  function startRepay(d: DebtRow) {
    setError('');
    setFlash('');
    setRepayId(d.paymentId);
    setRepayType(repayMethods.find((m) => m.kind === 'cash')?.key ?? repayMethods[0]?.key ?? '');
  }

  async function confirmRepay(d: DebtRow) {
    if (busy || !repayType) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/debts/${d.paymentId}/repay`, { type: repayType });
      if (!alive.current) return;
      setFlash(`✓ ${d.debtorName || 'Mijoz'} — ${formatSum(roundSum(d.amount))} qaytarildi (${methodLabel(pos.paymentMethods, repayType)})`);
      setRepayId(null);
      // Ochiq ro'yxatdan darhol olib tashlaymiz, keyin serverdan yangilaymiz
      setRows((prev) => prev.filter((x) => x.paymentId !== d.paymentId));
      onChangedRef.current?.();
      void load(status);
    } catch (e) {
      if (alive.current) setError((e as Error)?.message || 'Qarz qaytarilmadi');
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <Sheet
      title="Qarzlar"
      subtitle="«Qarzga» yozilgan to‘lovlar — qaytarilganda belgilang"
      icon={<DebtIcon className="w-6 h-6" />}
      iconTone="bg-danger/15 text-danger"
      size="lg"
      busy={busy}
      onClose={onClose}
      testId="debts-modal"
      bodyClassName="p-0 flex flex-col"
      footer={
        <div className="space-y-2.5">
          {searchActive && kb.show && (
            <TouchKeyboard target={searchRef} value={q} onChange={(v) => setQ(v.slice(0, 60))} maxLength={60} onEnter={() => setSearchActive(false)} />
          )}
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0 text-sm font-semibold text-muted" data-testid="debts-total">
              {shown.length} ta · <span className="text-text font-extrabold">{formatSum(total)}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-14 px-6 rounded-2xl bg-bg border border-border font-bold text-text hover:border-text disabled:opacity-50"
            >
              Yopish
            </button>
          </div>
        </div>
      }
    >
      <div className="shrink-0 px-4 sm:px-5 pt-3 pb-2 space-y-2.5 border-b border-border">
        <div className="grid grid-cols-2 gap-2" role="tablist">
          {(['open', 'repaid'] as const).map((st) => {
            const on = status === st;
            return (
              <button
                key={st}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setStatus(st)}
                data-testid={`debts-tab-${st}`}
                className={`h-12 rounded-xl border-2 font-extrabold ${
                  on
                    ? st === 'open'
                      ? 'bg-danger text-white border-danger'
                      : 'bg-success text-black border-success'
                    : 'bg-bg text-text border-border hover:border-primary'
                }`}
              >
                {st === 'open' ? 'Ochiq qarzlar' : 'Qaytarilganlar'}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <SearchIcon className="w-5 h-5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setSearchActive(true)}
              inputMode={kb.touch && kb.show ? 'none' : undefined}
              placeholder="Ism yoki telefon bo‘yicha qidirish"
              data-testid="debts-search"
              className="w-full h-12 pl-10 pr-11 rounded-xl bg-bg border-2 border-border focus:border-primary outline-none text-base font-semibold text-text placeholder:font-normal placeholder:text-muted/60"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label="Tozalash"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg text-muted hover:text-text flex items-center justify-center"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            )}
          </div>
          <KeyboardToggle show={kb.show} onToggle={() => kb.setShow(!kb.show)} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-5 py-3 space-y-2">
        {flash && !error && (
          <div className="rounded-xl border border-success/50 bg-success/10 px-3 py-2 text-sm font-bold text-success">{flash}</div>
        )}
        <SheetError>{error}</SheetError>
        {!loaded && rows.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-3 text-muted">
            <Spinner className="w-8 h-8 border-primary" />
            Yuklanmoqda…
          </div>
        ) : loadError ? (
          <div className="py-10 text-center space-y-3">
            <div className="text-danger font-semibold">{loadError}</div>
            <button
              type="button"
              onClick={() => void load(status)}
              className="h-11 px-4 rounded-xl border border-border font-bold hover:border-primary"
            >
              Qayta urinish
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="py-12 text-center text-muted font-semibold">
            {q ? 'Hech narsa topilmadi' : status === 'open' ? 'Ochiq qarz yo‘q' : 'Qaytarilgan qarz yo‘q'}
          </div>
        ) : (
          shown.map((d) => {
            const open = status === 'open' && !d.repaidAt;
            const repaying = repayId === d.paymentId;
            return (
              <div
                key={d.paymentId}
                data-testid={`debt-row-${d.paymentId}`}
                className={`rounded-2xl border-2 p-3 ${repaying ? 'border-primary bg-primary/5' : open ? 'border-danger/40 bg-bg' : 'border-border bg-bg'}`}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-extrabold text-text min-w-0">
                      <UserIcon className="w-4 h-4 text-muted shrink-0" />
                      <span className="truncate">{d.debtorName || 'Ism ko‘rsatilmagan'}</span>
                    </div>
                    {d.debtorPhone && (
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-text">
                        <PhoneIcon className="w-4 h-4 text-muted shrink-0" /> {displayPhone(d.debtorPhone)}
                      </div>
                    )}
                    <div className="text-xs font-semibold text-muted mt-0.5">
                      {dateTime(d.createdAt)}
                      {d.orderName ? ` · ${d.orderName}` : ''}
                      {d.queueNumber && !(d.orderName ?? '').includes(`#${d.queueNumber}`) ? ` · №${d.queueNumber}` : ''}
                    </div>
                    {!open && d.repaidAt && (
                      <div className="text-xs font-bold text-success mt-0.5">
                        ✓ {dateTime(d.repaidAt)} qaytarildi
                        {d.repaidType ? ` — ${methodLabel(pos.paymentMethods, d.repaidType)}` : ''}
                        {d.repaidByName ? ` · ${d.repaidByName}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-xl font-black tabular-nums ${open ? 'text-danger' : 'text-text'}`}>
                      {groupDigits(String(roundSum(d.amount)))}
                    </div>
                    {open && !repaying && (
                      <button
                        type="button"
                        onClick={() => startRepay(d)}
                        disabled={busy}
                        data-testid={`debt-repay-${d.paymentId}`}
                        className="mt-1.5 h-11 px-3.5 rounded-xl bg-success text-black font-extrabold text-sm inline-flex items-center gap-1.5 hover:brightness-105 active:scale-95 disabled:opacity-50"
                      >
                        <CheckIcon className="w-4 h-4" /> To‘landi
                      </button>
                    )}
                  </div>
                </div>

                {repaying && (
                  <div className="mt-3 pt-3 border-t border-border space-y-2.5 animate-pop-in">
                    <div className="text-sm font-bold text-muted">Qarz qanday to‘landi?</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup">
                      {repayMethods.map((m) => {
                        const on = repayType === m.key;
                        return (
                          <button
                            key={m.key}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setRepayType(m.key)}
                            data-testid={`debt-method-${m.key}`}
                            className={`h-12 rounded-xl border-2 px-2.5 flex items-center gap-2 font-extrabold text-sm ${
                              on ? 'bg-primary-hover border-primary-hover text-white' : 'bg-surface border-border text-text hover:border-primary'
                            }`}
                          >
                            <span className={on ? 'text-white' : KIND_TINT[m.kind]}>
                              <MethodIcon kind={m.kind} className="w-5 h-5" />
                            </span>
                            <span className="truncate">{m.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setRepayId(null)}
                        disabled={busy}
                        className="h-12 px-4 rounded-xl border border-border bg-surface font-bold text-text hover:border-text disabled:opacity-50"
                      >
                        Bekor
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmRepay(d)}
                        disabled={busy || !repayType}
                        data-testid="debt-confirm"
                        className="flex-1 min-w-0 h-12 rounded-xl bg-success text-black font-black flex items-center justify-center gap-2 hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
                      >
                        {busy ? <Spinner className="w-5 h-5 border-black" /> : <CheckIcon className="w-5 h-5" />}
                        <span className="truncate">
                          Qabul qilish — {formatSum(roundSum(d.amount))}
                          {repayType ? ` (${methodLabel(pos.paymentMethods, repayType)})` : ''}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </Sheet>
  );
}
