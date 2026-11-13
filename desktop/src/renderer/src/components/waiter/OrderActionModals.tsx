// Ochiq buyurtma qo'shimcha oynalari: chekka (buyurtma) izohi va mijoz (CRM) tanlash.
// Ikkalasida ham ekran klaviaturasi (monoblokda jismoniy klaviatura bo'lmasligi mumkin).
// Stol / ofitsiant / tur almashtirish — components/orderActions (OrderActionsBar) ichida.
import { useMemo, useRef, useState } from 'react';
import { Customer } from '@hardweb-pos/shared';
import { normalizeName } from '../../lib/menuImages';
import { Sheet } from './Sheet';
import { KeyboardToggle, TouchKeyboard, useTouchKeyboardPref } from './TouchKeyboard';
import { IconCheck, IconClose, IconNote, IconSearch, IconUser } from './icons';
import { phoneLabel } from './orderUi';

const ORDER_NOTE_MAX = 500;

/** Buyurtma (chek) izohi — oshxona va kassa ko'radi, chekda chiqadi */
export function OrderNoteModal({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave: (note: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const kb = useTouchKeyboardPref();

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(text.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Chekka izoh"
      subtitle="Oshxona va kassa ko‘radi, chekda chiqadi"
      icon={<IconNote className="w-6 h-6" />}
      iconTone="bg-warning/15 text-warning"
      size="lg"
      busy={busy}
      onClose={onClose}
      testId="order-note-modal"
      footer={
        <div className="space-y-2.5">
          {kb.show && <TouchKeyboard target={ref} value={text} onChange={setText} maxLength={ORDER_NOTE_MAX} onEnter={() => void save()} />}
          <div className="flex gap-2">
            {initial && (
              <button
                type="button"
                onClick={() => setText('')}
                className="h-14 px-4 rounded-2xl border-2 border-danger/50 text-danger font-bold hover:bg-danger/10"
              >
                Tozalash
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-14 px-5 rounded-2xl bg-bg border border-border font-bold hover:border-text disabled:opacity-50"
            >
              Bekor
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              data-testid="order-note-save"
              className="flex-1 h-14 rounded-2xl bg-primary-hover text-white text-lg font-black flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-50"
            >
              <IconCheck className="w-6 h-6" /> Saqlash
            </button>
          </div>
        </div>
      }
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-sm font-bold text-muted">Izoh matni</span>
        <KeyboardToggle show={kb.show} onToggle={() => kb.setShow(!kb.show)} />
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, ORDER_NOTE_MAX))}
        autoFocus={!kb.touch}
        inputMode={kb.touch && kb.show ? 'none' : undefined}
        rows={3}
        maxLength={ORDER_NOTE_MAX}
        placeholder="Masalan: achchiq bo‘lmasin, tez tayyorlansin..."
        data-testid="order-note-text"
        className="w-full px-3 py-2.5 rounded-xl bg-bg border-2 border-border outline-none focus:border-primary resize-none text-base font-semibold"
      />
    </Sheet>
  );
}

/** Mijoz (CRM) tanlash — ism yoki telefon bo'yicha qidiruv */
export function CustomerPickModal({
  customers,
  currentName,
  onPick,
  onClose,
}: {
  customers: Customer[];
  currentName?: string | null;
  onPick: (customerId: string | null) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const kb = useTouchKeyboardPref();
  const shown = useMemo(() => {
    const q = normalizeName(search);
    const digits = search.replace(/\D/g, '');
    return customers.filter(
      (c) => !q || normalizeName(c.name).includes(q) || (!!digits && (c.phone ?? '').replace(/\D/g, '').includes(digits)),
    );
  }, [customers, search]);

  return (
    <Sheet
      title="Mijoz tanlash"
      icon={<IconUser className="w-6 h-6" />}
      size="lg"
      onClose={onClose}
      testId="customer-modal"
      footer={kb.show ? <TouchKeyboard target={ref} value={search} onChange={setSearch} maxLength={60} /> : undefined}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <IconSearch className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            ref={ref}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus={!kb.touch}
            inputMode={kb.touch && kb.show ? 'none' : undefined}
            placeholder="Ism yoki telefon..."
            className="w-full h-12 pl-10 pr-3 rounded-xl bg-bg border-2 border-border outline-none focus:border-primary font-semibold"
          />
        </div>
        <KeyboardToggle show={kb.show} onToggle={() => kb.setShow(!kb.show)} />
      </div>
      {currentName && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="w-full min-h-[48px] text-left mb-2 px-3 py-2.5 rounded-xl text-danger bg-danger/10 border border-danger/40 text-sm font-bold flex items-center gap-2"
        >
          <IconClose className="w-4 h-4" /> Mijozni olib tashlash ({currentName})
        </button>
      )}
      <div className="space-y-1.5">
        {shown.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c.id)}
            className="w-full min-h-[56px] text-left px-3 py-2 rounded-xl border border-border hover:border-primary hover:bg-surface-hover flex items-center gap-3"
          >
            <span className="w-10 h-10 rounded-full bg-primary-hover text-white font-black flex items-center justify-center shrink-0">
              {c.name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block font-bold truncate">{c.name}</span>
              <span className="block text-xs text-muted truncate">{c.phone ? phoneLabel(c.phone) || c.phone : '—'}</span>
            </span>
          </button>
        ))}
        {customers.length === 0 && (
          <div className="text-muted text-sm text-center py-6 font-semibold">Mijoz yo‘q. Admin → Mijozlar bo‘limidan qo‘shing.</div>
        )}
        {customers.length > 0 && shown.length === 0 && (
          <div className="text-muted text-sm text-center py-6 font-semibold">Topilmadi</div>
        )}
      </div>
    </Sheet>
  );
}
