// Sklad oynalarining umumiy bo'laklari: maydonlar (miqdor, so'm), o'lchov birligi tanlagichi, narx
// rejimi, ta'minotchi tanlagichi, xato qatori, pastki tugmalar va "ikki marta bosish"dan himoyalangan
// saqlash (useSubmit). Faqat tema tokenlari — ko'k rang ishlatilmaydi; tugmalar ≥ 44 px.
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ProductUnit, Supplier } from '@hardweb-pos/shared';
import { cleanDecimalInput, cleanDigitsInput } from '../../../components/numeric';
import { groupDigits } from '../../../components/cashier/orderType';
import { Segmented } from '../../../components/reports/parts';
import { Select } from '../../../components/Select';
import { Spinner } from '../../../components/waiter/Sheet';
import { api } from '../../../lib/api';
import { PriceMode, UNITS, costText, errText, resolvePrice, sameName } from './skladUtils';

export const inputCls =
  'w-full h-12 px-3 rounded-xl bg-bg border-2 border-border outline-none focus:border-primary text-text font-semibold placeholder:font-normal placeholder:text-muted disabled:opacity-60';

/** Qidiruv maydoni (qator ichida, flex-1) */
export const searchCls =
  'h-11 flex-1 min-w-[180px] px-4 rounded-xl bg-bg border-2 border-border outline-none focus:border-primary text-text font-semibold placeholder:font-normal placeholder:text-muted';

/**
 * Saqlash amali: bir vaqtda bitta (tez ikki bosish = ikki kirim emas), xato — oynada qoladi
 * (kiritilgan ma'lumot yo'qolmaydi). run() muvaffaqiyatda true qaytaradi.
 */
export function useSubmit() {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async (fn: () => Promise<void>, fallback = 'Saqlanmadi'): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errText(e, fallback));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

/** Maydon: sarlavha + mazmun + izoh (label emas — ichidagi tugmalar sarlavha bosilganda ishlamasin) */
export function Field({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-sm font-bold text-muted mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-xs text-muted mt-1.5">{hint}</div>}
    </div>
  );
}

/** Miqdor maydoni (kasr: "1,5" = 1.5), o'ng tomonda birlik */
export function QtyInput({
  value,
  onChange,
  unit,
  autoFocus,
  testId,
  placeholder = '0',
  big,
  ariaLabel,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  autoFocus?: boolean;
  testId?: string;
  placeholder?: string;
  big?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <input
        inputMode="decimal"
        autoComplete="off"
        value={value}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onChange={(e) => onChange(cleanDecimalInput(e.target.value, 3))}
        placeholder={placeholder}
        data-testid={testId}
        className={`${inputCls} tabular-nums ${unit ? 'pr-14' : ''} ${big ? 'text-xl font-extrabold' : ''}`}
      />
      {unit && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted pointer-events-none">{unit}</span>
      )}
    </div>
  );
}

/** So'm maydoni: faqat butun son, minglik bo'shliq bilan ko'rinadi ("150 000") */
export function MoneyInput({
  value,
  onChange,
  autoFocus,
  testId,
  placeholder = '0',
  big,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  testId?: string;
  placeholder?: string;
  big?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <input
        inputMode="numeric"
        autoComplete="off"
        value={value ? groupDigits(value) : ''}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onChange={(e) => onChange(cleanDigitsInput(e.target.value).replace(/^0+(?=\d)/, '').slice(0, 12))}
        placeholder={placeholder}
        data-testid={testId}
        className={`${inputCls} pr-14 tabular-nums ${big ? 'text-xl font-extrabold' : ''}`}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted pointer-events-none">so‘m</span>
    </div>
  );
}

/** Matn maydoni (izoh, nom) */
export function TextInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  testId,
  maxLength = 200,
  ariaLabel,
  inputMode,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  testId?: string;
  maxLength?: number;
  ariaLabel?: string;
  inputMode?: 'text' | 'tel';
  onBlur?: () => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      autoFocus={autoFocus}
      maxLength={maxLength}
      aria-label={ariaLabel}
      inputMode={inputMode}
      autoComplete="off"
      data-testid={testId}
      className={inputCls}
    />
  );
}

/** O'lchov birligi — 5 ta katta tugma (ochiladigan ro'yxatdan tezroq); qulflanganda faqat tanlangani ko'rinadi */
export function UnitPicker({ value, onChange, disabled }: { value: ProductUnit; onChange: (u: ProductUnit) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="O‘lchov birligi">
      {UNITS.map((u) => {
        const on = u.value === value;
        return (
          <button
            key={u.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={u.long}
            disabled={disabled && !on}
            onClick={() => !disabled && onChange(u.value)}
            data-testid={`unit-${u.value}`}
            className={`h-12 rounded-xl border-2 font-extrabold text-[15px] transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
              on ? 'bg-primary-hover border-primary-hover text-white' : 'bg-bg border-border text-text hover:border-primary/60'
            } ${disabled && on ? 'cursor-default' : ''}`}
          >
            {u.short}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Narx: "1 kg narxi" yoki "Jami summa" (butun so'm). Ikkinchisi jonli hisoblanib ko'rinadi.
 * Ko'rinadigan rejim = saqlanadigan rejim (ota komponent ham resolvePrice(mode, …) ni ishlatadi).
 */
export function PriceField({
  label = 'Narx',
  mode,
  onMode,
  value,
  onChange,
  qty,
  unit,
  testId,
  hint,
}: {
  label?: string;
  mode: PriceMode;
  onMode: (m: PriceMode) => void;
  value: string;
  onChange: (v: string) => void;
  qty: number;
  unit: string;
  testId?: string;
  hint?: ReactNode;
}) {
  const { unitPrice, total } = resolvePrice(mode, value, qty);
  const entered = (Number(value) || 0) > 0;
  function switchMode(next: PriceMode) {
    if (next === mode) return;
    // Kiritilgan qiymatni yangi rejimga o'giramiz (foydalanuvchi qaytadan yozmasin)
    if (next === 'total') onChange(total > 0 ? String(total) : '');
    else onChange(unitPrice >= 1 ? String(Math.round(unitPrice)) : '');
    onMode(next);
  }
  return (
    <Field
      label={
        <div className="flex flex-wrap items-center justify-between gap-2 -mb-0.5">
          <span>{label}</span>
          <Segmented<PriceMode>
            value={mode}
            onChange={switchMode}
            testIdPrefix={testId ? `${testId}-mode` : undefined}
            options={[
              { value: 'unit', label: `1 ${unit} narxi` },
              { value: 'total', label: 'Jami summa' },
            ]}
          />
        </div>
      }
      hint={hint}
    >
      <MoneyInput value={value} onChange={onChange} testId={testId} placeholder={mode === 'unit' ? `1 ${unit} narxi` : 'Jami summa'} ariaLabel={label} />
      {entered && (qty > 0 || mode === 'total') && (
        <div className="mt-1.5 text-sm text-muted" data-testid={testId ? `${testId}-calc` : undefined}>
          {mode === 'unit' ? (
            <>
              Jami: <b className="text-text">{costText(total)}</b>
            </>
          ) : qty > 0 ? (
            <>
              1 {unit}: <b className="text-text">{costText(unitPrice)}</b>
            </>
          ) : (
            <span className="font-semibold text-warning">Miqdorni kiriting — 1 {unit} narxi shundan hisoblanadi</span>
          )}
        </div>
      )}
    </Field>
  );
}

// ---- Ta'minotchilar ----

export const NEW_SUPPLIER = '__new__';

/** Ta'minotchilar ro'yxati (oyna ochilganda bir marta). Xato — bo'sh ro'yxat + xabar (oyna ishlayveradi) */
export function useSuppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api
      .get<Supplier[]>('/inventory/suppliers')
      .then((r) => {
        if (alive) setSuppliers(Array.isArray(r) ? [...r].sort((a, b) => a.name.localeCompare(b.name, 'uz')) : []);
      })
      .catch((e) => {
        if (!alive) return;
        setSuppliers([]);
        setError(errText(e, 'Ta’minotchilar yuklanmadi'));
      });
    return () => {
      alive = false;
    };
  }, []);
  return { suppliers, error };
}

/** Ta'minotchi: ro'yxatdan / "+ Yangi ta’minotchi" (nom yoziladi) / "Ta’minotchisiz" */
export function SupplierPicker({
  suppliers,
  loadError,
  value,
  onChange,
  allowNew,
  newName,
  onNewName,
  testId,
}: {
  suppliers: Supplier[] | null;
  loadError?: string;
  value: string;
  onChange: (v: string) => void;
  allowNew?: boolean;
  newName?: string;
  onNewName?: (v: string) => void;
  testId?: string;
}) {
  const options = [
    { value: '', label: 'Ta’minotchisiz' },
    ...(suppliers ?? []).map((s) => ({ value: s.id, label: s.name })),
    ...(allowNew ? [{ value: NEW_SUPPLIER, label: '+ Yangi ta’minotchi' }] : []),
  ];
  const typed = (newName ?? '').trim();
  const existing = typed ? (suppliers ?? []).find((s) => sameName(s.name, typed)) : undefined;
  return (
    <div data-testid={testId}>
      <Select value={value} onChange={onChange} options={options} placeholder={suppliers === null ? 'Yuklanmoqda…' : 'Tanlang'} />
      {value === NEW_SUPPLIER && onNewName && (
        <div className="mt-2">
          <TextInput
            value={newName ?? ''}
            onChange={onNewName}
            autoFocus
            maxLength={120}
            placeholder="Yangi ta’minotchi nomi (masalan: Baraka savdo)"
            ariaLabel="Yangi ta’minotchi nomi"
            testId={testId ? `${testId}-new` : undefined}
          />
          {existing && (
            <div className="text-xs text-muted mt-1">
              «{existing.name}» ro‘yxatda bor — kirim o‘sha ta’minotchiga yoziladi.
            </div>
          )}
        </div>
      )}
      {loadError && <div className="text-xs text-warning font-semibold mt-1">Ta’minotchilar ro‘yxati yuklanmadi: {loadError}</div>}
    </div>
  );
}

// ---- Xabarlar va tugmalar ----

/** Oyna ichidagi xato (qizil) — server xabari aynan ko'rinadi */
export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" data-testid="form-error" className="mt-4 rounded-xl border border-danger/60 bg-danger/10 px-3 py-2.5 text-sm font-bold text-danger">
      {message}
    </div>
  );
}

/** Ogohlantirish (sariq) — masalan "omborda yetarli emas" */
export function FormWarning({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="mt-3 rounded-xl border border-warning/60 bg-warning/10 px-3 py-2.5 text-sm font-bold text-text">
      ⚠️ {children}
    </div>
  );
}

/** Oyna pastidagi "Bekor" + asosiy tugma (submit). busy — kutish belgisi, ikkinchi bosish o'tmaydi */
export function ModalFooter({
  onCancel,
  busy,
  submitLabel,
  busyLabel = 'Saqlanmoqda…',
  disabled,
  tone = 'primary',
  testId,
}: {
  onCancel: () => void;
  busy: boolean;
  submitLabel: ReactNode;
  busyLabel?: string;
  disabled?: boolean;
  tone?: 'primary' | 'danger';
  testId?: string;
}) {
  return (
    <div className="flex gap-2 mt-5">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="flex-1 h-12 rounded-xl border-2 border-border bg-surface font-bold text-text hover:bg-surface-hover disabled:opacity-50"
      >
        Bekor
      </button>
      <button
        type="submit"
        disabled={busy || disabled}
        data-testid={testId}
        className={`flex-[2] h-12 rounded-xl font-extrabold text-white inline-flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${
          tone === 'danger' ? 'bg-danger hover:brightness-110' : 'bg-primary hover:bg-primary-hover'
        }`}
      >
        {busy && <Spinner className="w-5 h-5 border-white" />}
        {busy ? busyLabel : submitLabel}
      </button>
    </div>
  );
}

/** Ma'lumot qatori: "Hozirgi qoldiq — 12,5 kg" */
export function InfoRow({ label, value, tone, testId }: { label: ReactNode; value: ReactNode; tone?: 'success' | 'danger'; testId?: string }) {
  const color = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-text';
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-sm text-muted">{label}</span>
      <span className={`font-extrabold tabular-nums text-right ${color}`} data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

/** Asboblar paneli tugmasi (ikkilamchi amal) — 44 px */
export function ToolButton({
  onClick,
  children,
  testId,
  disabled,
  title,
}: {
  onClick: () => void;
  children: ReactNode;
  testId?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className="h-11 px-3.5 rounded-xl border border-border bg-surface text-text font-bold hover:border-primary/60 hover:bg-surface-hover inline-flex items-center gap-2 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

/** Asosiy amal tugmasi (yashil) — 44 px */
export function PrimaryButton({
  onClick,
  children,
  testId,
  className = '',
}: {
  onClick: () => void;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`h-11 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white font-extrabold inline-flex items-center justify-center gap-2 whitespace-nowrap active:scale-[0.98] transition-all ${className}`}
    >
      {children}
    </button>
  );
}

/** Orqaga tugmasi (bo'lim ichidagi sahifadan) */
export function BackButton({ onClick, label = 'Orqaga', testId }: { onClick: () => void; label?: string; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="h-11 px-3.5 rounded-xl border border-border bg-surface text-text font-bold hover:border-primary/60 inline-flex items-center gap-2 shrink-0"
    >
      <span className="text-lg leading-none">←</span> {label}
    </button>
  );
}

/** Yuklanmoqda (ro'yxat o'rnida) */
export function LoadingBlock() {
  return (
    <div className="py-10 flex items-center justify-center text-muted gap-3 font-semibold">
      <Spinner className="w-6 h-6 border-primary" /> Yuklanmoqda…
    </div>
  );
}
