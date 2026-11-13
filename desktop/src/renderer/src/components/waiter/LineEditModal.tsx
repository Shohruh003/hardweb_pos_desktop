// Savat qatorini tahrirlash (eski POS'dagi "Mahsulot miqdorini yoki narxini o‘zgartirish", B31 + D6):
//  • Miqdor — katta raqam klaviaturasi (dona) yoki ikkita bog'langan maydon (kg):
//    "Og‘irligi (kg)" va "Summa (so‘m)". Summa yozilsa og'irlik = summa / 1 kg narxi (6 xonagacha —
//    chekda aynan yozilgan summa chiqadi): baliq 75 000/kg, bo'lak 83 000 -> 1,107 kg. Bu narxni
//    o'zgartirish EMAS — har bir xodim qila oladi;
//  • Narx — faqat kassir / direktor ('cashier' yoki 'void' ruxsati) ko'radi va o'zgartiradi;
//  • Izoh oshxonaga — tez izohlar, "⏰ 15:00 ga tayyor", erkin matn (ekran klaviaturasi bilan);
//  • "Faqat N tasiga" — 5 tadan 2 tasiga izoh: qator ikkiga bo'linadi.
// Menyudagi "💬" (izoh bilan qo'shish) ham shu oynani 'add' rejimida ochadi — har doim YANGI qator.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { MenuUnit, lineSum } from '@hardweb-pos/shared';
import { formatSum } from '../ui';
import { Sheet } from './Sheet';
import { NumKey, NumPad, applyNumKey } from './NumPad';
import { NoteEditor } from './NoteEditor';
import { KeyboardToggle, TouchKeyboard, useTouchKeyboardPref } from './TouchKeyboard';
import { NOTE_MAX, PRICE_MAX, QTY_MAX, kgForSum, roundQty } from './cart';
import { formatAmount, formatKg } from './orderUi';
import { IconCheck, IconEdit, IconMinus, IconNote, IconPlus, IconTag, IconTrash, IconUndo } from './icons';

export interface LineEditValue {
  /** miqdor (dona — butun; kg — 6 xonagacha) */
  quantity: number;
  /** bir birlik (dona / 1 kg) narxi */
  price: number;
  /** izoh ('' — izohsiz) */
  note: string;
  /** izoh nechta porsiyaga (dona; quantity'dan kam bo'lsa — qator bo'linadi) */
  count: number;
}

export interface LineEditModalProps {
  /** add — menyudan yangi qator (💬 yoki kg taom); edit — savatdagi qator */
  mode: 'add' | 'edit';
  name: string;
  unit: MenuUnit;
  /** menyudagi narx (o'zgartirilgan narxni qaytarish uchun) */
  menuPrice: number;
  initial: { quantity: number; price: number; note: string };
  /** narxni o'zgartirish huquqi (kassir / direktor) */
  canEditPrice: boolean;
  onSave: (value: LineEditValue) => void;
  /** savatdan olib tashlash (faqat edit) */
  onRemove?: () => void;
  onClose: () => void;
  /** "💬 Izoh" bosilgan — izoh maydonidan boshlanadi */
  focusNote?: boolean;
}

type Field = 'qty' | 'kg' | 'sum' | 'price' | 'note';

const toKgText = (q: number) => (q > 0 ? formatKg(q) : '');
const parseKg = (s: string) => {
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const parseInt0 = (s: string) => {
  const n = Number(String(s).replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function LineEditModal({
  mode,
  name,
  unit,
  menuPrice,
  initial,
  canEditPrice,
  onSave,
  onRemove,
  onClose,
  focusNote,
}: LineEditModalProps) {
  const kg = unit === MenuUnit.Weight;
  const kb = useTouchKeyboardPref();
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const [price, setPrice] = useState(() => Math.max(0, Math.round(initial.price)));
  // Miqdor — haqiqiy qiymat (kg: summa bo'yicha 6 xonagacha); maydonlar matni alohida
  const [qty, setQty] = useState(() => (initial.quantity > 0 ? roundQty(initial.quantity, unit) : 0));
  const [qtyText, setQtyText] = useState(() => (initial.quantity > 0 ? String(Math.round(initial.quantity)) : ''));
  const [kgText, setKgText] = useState(() => toKgText(initial.quantity));
  const [sumText, setSumText] = useState(() =>
    initial.quantity > 0 ? String(lineSum(initial.price, initial.quantity)) : '',
  );
  const [priceText, setPriceText] = useState(() => String(Math.max(0, Math.round(initial.price))));
  const [note, setNote] = useState(initial.note ?? '');
  const [count, setCount] = useState<number | null>(null); // null — hammasiga
  // Faol maydon (raqam klaviaturasi shunga yozadi). Kg taomda — og'irlik, donada — miqdor
  const [active, setActive] = useState<Field>(focusNote ? 'note' : kg ? 'kg' : 'qty');
  // Maydon yangi tanlandi — birinchi raqam eski qiymatni almashtiradi (POS odati)
  const fresh = useRef(true);

  const noteChanged = note.trim() !== (initial.note ?? '').trim();
  const intQty = Math.round(qty);
  const showCount = !kg && intQty >= 2 && !!note.trim() && noteChanged;
  const portions = showCount ? Math.min(Math.max(1, count ?? intQty), intQty) : intQty;
  const total = lineSum(price, qty);
  const priceChanged = Math.round(price) !== Math.round(menuPrice);
  const valid = qty > 0 && (kg || (Number.isInteger(qty) && qty <= QTY_MAX)) && price >= 0 && price <= PRICE_MAX;

  function selectField(f: Field) {
    fresh.current = true;
    setActive(f);
    if (f !== 'note') noteRef.current?.blur();
  }

  // ---- Raqam kiritish ----
  function setQtyFromText(text: string) {
    const n = Math.min(QTY_MAX, parseInt0(text));
    setQtyText(text);
    setQty(n);
  }
  function setKgFromText(text: string) {
    setKgText(text);
    const q = roundQty(parseKg(text), MenuUnit.Weight);
    setQty(q);
    setSumText(q > 0 ? String(lineSum(price, q)) : '');
  }
  function setSumFromText(text: string) {
    setSumText(text);
    const s = parseInt0(text);
    const q = kgForSum(s, price);
    setQty(q);
    setKgText(toKgText(q));
  }
  function setPriceFromText(text: string) {
    const p = Math.min(PRICE_MAX, parseInt0(text));
    setPriceText(text);
    setPrice(p);
    // Kg: og'irlik o'zgarmaydi — summa yangi narx bo'yicha
    if (kg && qty > 0) setSumText(String(lineSum(p, qty)));
  }

  function pressKey(k: NumKey) {
    const first = fresh.current;
    fresh.current = false;
    // Yangi tanlangan maydonda birinchi tugma eski qiymatni almashtiradi (⌫ — tozalaydi)
    const base = (cur: string) => (first ? '' : cur);
    if (active === 'qty') setQtyFromText(applyNumKey(base(qtyText), k, { maxDigits: 3 }));
    else if (active === 'kg') setKgFromText(applyNumKey(base(kgText), k, { decimal: true, maxDecimals: 3, maxDigits: 3 }));
    else if (active === 'sum') setSumFromText(applyNumKey(base(sumText), k, { maxDigits: 9 }));
    else if (active === 'price') setPriceFromText(applyNumKey(base(priceText), k, { maxDigits: 9 }));
  }

  function stepQty(d: number) {
    const n = Math.min(QTY_MAX, Math.max(1, intQty + d));
    fresh.current = true;
    setActive('qty');
    setQty(n);
    setQtyText(String(n));
  }

  function resetPrice() {
    fresh.current = true;
    setPriceFromText(String(Math.round(menuPrice)));
  }

  function save() {
    if (!valid) return;
    onSave({
      quantity: roundQty(qty, unit),
      price: Math.round(price),
      note: note.trim().slice(0, NOTE_MAX),
      count: portions,
    });
  }

  // "💬 Izoh" orqali ochilganda — kursor darhol izoh maydonida (sensorli ekranda tizim klaviaturasi
  // chiqmaydi: ekran klaviaturasi yoqiq bo'lsa maydon inputMode="none")
  useEffect(() => {
    if (!focusNote) return;
    const t = window.setTimeout(() => {
      const el = noteRef.current;
      if (!el) return;
      el.focus({ preventScroll: false });
      el.setSelectionRange(el.value.length, el.value.length);
    }, 60);
    return () => window.clearTimeout(t);
  }, [focusNote]);

  // Jismoniy klaviatura: raqamlar faol maydonga, Enter — saqlash (izoh maydonida emas)
  const live = useRef({ pressKey, save, active });
  live.current = { pressKey, save, active };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      const { active: f } = live.current;
      if (e.key === 'Enter') {
        if (t?.tagName === 'BUTTON') return;
        e.preventDefault();
        live.current.save();
        return;
      }
      if (f === 'note') return;
      let k: NumKey | null = null;
      if (/^[0-9]$/.test(e.key)) k = e.key as NumKey;
      else if (e.key === 'Backspace') k = 'back';
      else if ((e.key === ',' || e.key === '.') && f === 'kg') k = ',';
      if (k) {
        e.preventDefault();
        live.current.pressKey(k);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const numericActive = active !== 'note';
  const totalLine =
    qty > 0 ? (
      <>
        {kg ? `${formatKg(qty)} kg` : `${intQty} ×`} {formatAmount(price)} ={' '}
        <span className="text-text text-lg font-black">{formatSum(total)}</span>
      </>
    ) : (
      <span className="text-warning">{kg ? 'Og‘irlik yoki summani kiriting' : 'Miqdorni kiriting'}</span>
    );
  const showKeyboard = active === 'note' && kb.show;

  const card = (f: Field, label: string, value: string, suffix: string, testId: string, extra?: ReactNode) => (
    <button
      type="button"
      onClick={() => selectField(f)}
      aria-pressed={active === f}
      data-testid={testId}
      className={`min-w-0 flex-1 rounded-2xl border-2 px-3 py-2 text-left transition-colors ${
        active === f ? 'border-primary bg-primary/10' : 'border-border bg-bg hover:border-primary/60'
      }`}
    >
      <span className="block text-xs font-bold text-muted">{label}</span>
      <span className="flex items-baseline gap-1 min-w-0">
        <span className="text-[28px] font-black tabular-nums leading-tight truncate text-text">{value || '0'}</span>
        <span className="text-sm font-bold text-muted shrink-0">{suffix}</span>
      </span>
      {extra}
    </button>
  );

  return (
    <Sheet
      title={name}
      subtitle={`${formatSum(menuPrice)} / ${kg ? 'kg' : 'dona'}${mode === 'add' ? ' · yangi qator' : ''}`}
      icon={<IconEdit className="w-6 h-6" />}
      size="xl"
      onClose={onClose}
      testId="line-edit-modal"
      footer={
        <div className="space-y-2.5">
          {showKeyboard && (
            <TouchKeyboard target={noteRef} value={note} onChange={(v) => setNote(v.slice(0, NOTE_MAX))} maxLength={NOTE_MAX} onEnter={save} />
          )}
          {/* Telefonda summa alohida qatorda — tugmalar siqilmasin */}
          <div className="sm:hidden text-right text-sm font-bold text-muted truncate">{totalLine}</div>
          <div className="flex items-center gap-2">
            {mode === 'edit' && onRemove && (
              <button
                type="button"
                onClick={onRemove}
                data-testid="line-remove"
                className="h-14 px-4 rounded-2xl border-2 border-danger/60 text-danger font-extrabold flex items-center gap-2 hover:bg-danger/10 active:scale-[0.97]"
              >
                <IconTrash className="w-5 h-5" />
                <span className="hidden sm:inline">O‘chirish</span>
              </button>
            )}
            <span className="hidden sm:block flex-1 min-w-0 text-right text-sm font-bold text-muted truncate">{totalLine}</span>
            <span className="flex-1 sm:hidden" />
            <button
              type="button"
              onClick={onClose}
              className="h-14 px-5 rounded-2xl bg-bg border border-border font-bold hover:border-text active:scale-[0.97]"
            >
              Orqaga
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!valid}
              data-testid="line-save"
              className="h-14 px-6 rounded-2xl bg-primary-hover text-white text-lg font-black flex items-center gap-2 shadow-lg shadow-primary/25 hover:brightness-110 active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
            >
              <IconCheck className="w-6 h-6" />
              {mode === 'add' ? 'Qo‘shish' : 'Saqlash'}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* Chap: miqdor / og'irlik / summa / narx + raqam klaviaturasi */}
        <div className="space-y-3">
          {kg ? (
            <div className="flex gap-2">
              {card('kg', 'Og‘irligi (kg)', kgText, 'kg', 'line-kg')}
              {card('sum', 'Summa (so‘m)', sumText ? formatAmount(parseInt0(sumText)) : '', 'so‘m', 'line-sum')}
            </div>
          ) : (
            <div className={`rounded-2xl border-2 px-2 py-2 flex items-center gap-2 ${active === 'qty' ? 'border-primary bg-primary/10' : 'border-border bg-bg'}`}>
              <button
                type="button"
                onClick={() => stepQty(-1)}
                disabled={intQty <= 1}
                aria-label="Kamaytirish"
                className="w-14 h-14 rounded-xl bg-surface border border-border flex items-center justify-center active:scale-90 disabled:opacity-40"
              >
                <IconMinus className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={() => selectField('qty')}
                data-testid="line-qty"
                className="flex-1 min-w-0 text-center"
              >
                <span className="block text-xs font-bold text-muted">Miqdor (dona)</span>
                <span className="block text-4xl font-black tabular-nums leading-tight text-text">{qtyText || '0'}</span>
              </button>
              <button
                type="button"
                onClick={() => stepQty(1)}
                disabled={intQty >= QTY_MAX}
                aria-label="Ko‘paytirish"
                className="w-14 h-14 rounded-xl bg-primary-hover text-white flex items-center justify-center active:scale-90 disabled:opacity-40"
              >
                <IconPlus className="w-6 h-6" />
              </button>
            </div>
          )}

          {canEditPrice && (
            <div className="flex gap-2 items-stretch">
              {card(
                'price',
                `Narx (1 ${kg ? 'kg' : 'dona'})`,
                formatAmount(price),
                'so‘m',
                'line-price',
                priceChanged ? (
                  <span className="block text-xs font-bold text-warning mt-0.5">
                    * o‘zgartirilgan · menyuda <span className="line-through">{formatAmount(menuPrice)}</span>
                  </span>
                ) : (
                  <span className="block text-xs font-semibold text-muted mt-0.5 flex items-center gap-1">
                    <IconTag className="w-3.5 h-3.5" /> faqat kassir / direktor
                  </span>
                ),
              )}
              {priceChanged && (
                <button
                  type="button"
                  onClick={resetPrice}
                  aria-label="Menyudagi narxga qaytarish"
                  title="Menyudagi narxga qaytarish"
                  className="w-14 rounded-2xl border-2 border-border bg-bg flex items-center justify-center text-muted hover:text-text hover:border-primary"
                >
                  <IconUndo className="w-6 h-6" />
                </button>
              )}
            </div>
          )}

          {numericActive ? (
            <div className="max-w-[340px]">
              <NumPad onKey={pressKey} decimal={active === 'kg'} testIdPrefix="line-key" />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => selectField(kg ? 'kg' : 'qty')}
              className="w-full h-12 rounded-xl border border-dashed border-border text-sm font-bold text-muted hover:text-text hover:border-primary"
            >
              Raqam klaviaturasini ko‘rsatish
            </button>
          )}
        </div>

        {/* O'ng: izoh (oshxonaga) */}
        <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-2 text-sm font-extrabold text-text">
            <IconNote className="w-5 h-5 text-warning" /> Oshxonaga izoh
            {initial.note && !note.trim() && <span className="text-xs font-bold text-danger">(izoh olib tashlanadi)</span>}
          </div>
          <NoteEditor
            value={note}
            onChange={(v) => setNote(v)}
            textRef={noteRef}
            onTextFocus={() => {
              fresh.current = true;
              setActive('note');
            }}
            suppressSystemKeyboard={kb.touch && kb.show}
            toolbar={<KeyboardToggle show={kb.show} onToggle={() => kb.setShow(!kb.show)} />}
          />
          {showCount && (
            <div className="rounded-2xl border-2 border-warning/50 bg-warning/10 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-extrabold text-text">
                  Faqat <span className="text-warning">{portions}</span> tasiga{' '}
                  <span className="font-semibold text-muted">(jami {intQty} ta)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Kamaytirish"
                    disabled={portions <= 1}
                    onClick={() => setCount(Math.max(1, portions - 1))}
                    className="w-12 h-12 rounded-xl border border-border bg-surface flex items-center justify-center disabled:opacity-40 active:scale-90"
                  >
                    <IconMinus className="w-5 h-5" />
                  </button>
                  <span className="w-10 text-center text-2xl font-black tabular-nums" data-testid="line-note-count">
                    {portions}
                  </span>
                  <button
                    type="button"
                    aria-label="Ko‘paytirish"
                    disabled={portions >= intQty}
                    onClick={() => setCount(Math.min(intQty, portions + 1))}
                    className="w-12 h-12 rounded-xl bg-primary-hover text-white flex items-center justify-center disabled:opacity-40 active:scale-90"
                  >
                    <IconPlus className="w-5 h-5" />
                  </button>
                </span>
              </div>
              {portions < intQty && (
                <div className="text-xs font-bold text-warning mt-1.5">
                  Qator bo‘linadi: {portions} tasi izoh bilan, {intQty - portions} tasi {initial.note ? 'avvalgi izoh bilan' : 'izohsiz'}.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
