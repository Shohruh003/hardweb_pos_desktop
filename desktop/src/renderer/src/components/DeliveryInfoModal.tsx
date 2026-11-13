import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { DeliveryLookup, normalizeUzPhone } from '@hardweb-pos/shared';
import { api } from '../lib/api';
import { usePosSettings } from '../lib/posSettings';
import { Sheet, SheetError, Spinner } from './waiter/Sheet';
import { KeyboardToggle, TouchKeyboard, useTouchKeyboardPref } from './waiter/TouchKeyboard';
import { IconBackspace, IconCheck, IconPhone, IconPin, IconScooter, IconUser } from './waiter/icons';
import { apiPhone, formatAmount, onlyDigits } from './waiter/orderUi';

// "Buyurtma yaratish — Yetkazib berish": telefon (+998, ekran raqam klaviaturasi), manzil, izoh,
// yetkazish narxi (B28). Kassa (to'lov oynasi, kartochkadagi "Manzil") ham shu oynani ochadi.
export interface DeliveryInfo {
  phone: string; // to'liq raqam, masalan "+998901234567"
  address: string;
  note: string;
  /** yetkazish narxi, butun so'm (0 — bepul) */
  deliveryFee: number;
}

export interface DeliveryInfoModalProps {
  /** boshlang'ich qiymatlar; deliveryFee berilmasa — sozlamadagi standart narx */
  initial?: Partial<DeliveryInfo>;
  /** sarlavha (default: "Yetkazib berish — mijoz ma'lumotlari") */
  title?: string;
  /** Saqlash bosilganda (telefon tekshirilgan bo'ladi). Promise bo'lsa — tugaguncha tugma band; xato — oynada */
  onSave: (info: DeliveryInfo) => void | Promise<void>;
  onClose: () => void;
}

/** Manzil uzunligi chegarasi (server bilan bir xil) */
const ADDRESS_MAX = 300;
const NOTE_MAX = 300;
/** Yetkazish narxi chegarasi (server bilan bir xil) */
const FEE_MAX = 1_000_000;
/** Raqam to'liq kiritilgach mijozni qidirish oldidan kutish (ms) — tez yozilganda ortiqcha so'rov bo'lmasin */
const LOOKUP_DELAY_MS = 250;

type Field = 'phone' | 'fee' | 'address' | 'note';

/** Kiritilgan matndan mahalliy 9 raqam: "+998 90 123 45 67" / "998901234567" / "90 123 45 67" */
function localDigits(input: string | null | undefined): string {
  let d = onlyDigits(input);
  // Xalqaro ko'rinish (998 + 9 raqam) — prefiksni olib tashlaymiz
  if (d.length > 9 && d.startsWith('998')) d = d.slice(3);
  return d.slice(0, 9);
}

/** Mahalliy raqamni guruhlab ko'rsatish (yozish davomida ham): "90 123 45 67" */
function groupLocal(d: string): string {
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
}

/** Narx matni: faqat raqamlar, chegaradan oshmaydi */
function cleanFee(s: string): string {
  const d = onlyDigits(s).replace(/^0+(?=\d)/, '');
  if (!d) return '';
  return String(Math.min(FEE_MAX, Number(d)));
}

type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'clear' | '000' | 'back';
const DIGITS: Key[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Yetkazish ma'lumotlari oynasi: telefon (+998 o'zgarmas prefiks + katta raqam klaviaturasi, jismoniy
 * klaviatura ham ishlaydi), yetkazish narxi (shu klaviatura bilan), manzil (majburiy), izoh — matn
 * maydonlari uchun ekran klaviaturasi (monoblokda jismoniy klaviatura bo'lmasligi mumkin).
 * 9 raqam kiritilganda oldingi yetkazish qidiriladi: manzil bo'sh bo'lsa — avtomatik to'ldiriladi,
 * "Doimiy mijoz — N marta" ko'rsatiladi. Saqlash — telefon to'g'ri va manzil kiritilgunча o'chiq;
 * onSave Promise bo'lsa tugaguncha band, xatosi oynaning ichida ko'rsatiladi (oyna yopilmaydi).
 */
export default function DeliveryInfoModal({ initial, title, onSave, onClose }: DeliveryInfoModalProps) {
  const pos = usePosSettings();
  const kb = useTouchKeyboardPref();
  const [digits, setDigits] = useState(() => localDigits(initial?.phone));
  const [address, setAddress] = useState(() => initial?.address ?? '');
  const [note, setNote] = useState(() => initial?.note ?? '');
  // Narx: berilgan (tahrirlash) yoki sozlamadagi standart narx; xodim o'zgartirmaguncha standart kuzatiladi
  const [feeText, setFeeText] = useState(() =>
    initial?.deliveryFee != null ? String(Math.max(0, Math.round(initial.deliveryFee))) : '',
  );
  const feeTouched = useRef(initial?.deliveryFee != null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lookup, setLookup] = useState<DeliveryLookup | null>(null);
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'done'>('idle');
  // Manzil oldingi buyurtmadan avtomatik qo'yildimi (xodimga bildiramiz)
  const [prefilled, setPrefilled] = useState(false);
  // Raqam klaviaturasi qaysi maydonga yozadi; matn maydonlari — ekran klaviaturasi
  const [active, setActive] = useState<Field>('phone');
  const feeFresh = useRef(true);
  const phoneRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  // Eng oxirgi so'ralgan raqam — eski javob yangisini bosib ketmasin
  const lookupFor = useRef('');
  // Manzil maydoni hozirgi qiymati (lookup javobi kelganda bo'sh-bo'sh emasligini bilish uchun)
  const addressRefValue = useRef(address);
  addressRefValue.current = address;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Sozlama keyin yuklansa — xodim o'zgartirmagan narx standartga tenglashadi
  useEffect(() => {
    if (!feeTouched.current) setFeeText(pos.deliveryFeeDefault > 0 ? String(pos.deliveryFeeDefault) : '0');
  }, [pos.deliveryFeeDefault]);

  const fee = Math.min(FEE_MAX, Number(feeText || '0') || 0);
  const phoneValid = digits.length === 9 && normalizeUzPhone(digits) !== null;
  const addressValid = address.trim().length > 0;
  const canSave = phoneValid && addressValid && !busy;
  const touchNoSystemKb = kb.touch && kb.show;

  // 9 raqam kiritilgach — shu telefon bilan oldingi yetkazishni qidiramiz
  useEffect(() => {
    if (!phoneValid) {
      lookupFor.current = '';
      setLookup(null);
      setLookupState('idle');
      return;
    }
    const phone = apiPhone(digits);
    if (!phone) return;
    lookupFor.current = phone;
    setLookupState('loading');
    const timer = window.setTimeout(() => {
      api
        .get<DeliveryLookup | null>(`/orders/delivery-lookup?phone=${encodeURIComponent(phone)}`)
        .then((res) => {
          if (!mounted.current || lookupFor.current !== phone) return;
          const found = res && typeof res === 'object' ? res : null;
          setLookup(found);
          setLookupState('done');
          // Manzil bo'sh bo'lsa — oxirgi yetkazish manzilini qo'yamiz
          if (found?.address && !addressRefValue.current.trim()) {
            setAddress(found.address.slice(0, ADDRESS_MAX));
            setPrefilled(true);
          }
        })
        .catch(() => {
          // Qidiruv ixtiyoriy — xato (oflayn/eski server) saqlashga xalaqit bermaydi
          if (!mounted.current || lookupFor.current !== phone) return;
          setLookup(null);
          setLookupState('done');
        });
    }, LOOKUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [digits, phoneValid]);

  function focusField(f: Field) {
    setActive(f);
    if (f === 'fee') feeFresh.current = true;
  }

  function pressKey(k: Key) {
    setError('');
    if (active === 'fee') {
      feeTouched.current = true;
      const first = feeFresh.current;
      feeFresh.current = false;
      setFeeText((cur) => {
        const base = first ? '' : cur;
        if (k === 'back') return base.slice(0, -1);
        if (k === 'clear') return '';
        return cleanFee(base + k);
      });
      return;
    }
    if (k === 'back') setDigits((d) => d.slice(0, -1));
    else if (k === 'clear') setDigits('');
    else if (k !== '000') setDigits((d) => (d.length >= 9 ? d : d + k));
  }

  async function save() {
    if (!canSave) return;
    const phone = normalizeUzPhone(digits);
    if (!phone) return;
    setBusy(true);
    setError('');
    try {
      await onSave({
        phone,
        address: address.trim().slice(0, ADDRESS_MAX),
        note: note.trim().slice(0, NOTE_MAX),
        deliveryFee: fee,
      });
    } catch (e) {
      if (mounted.current) setError((e as Error)?.message || 'Saqlanmadi — qayta urinib ko‘ring');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  // Jismoniy klaviatura: matn maydoni (manzil/izoh) tahrirlanmayotgan bo'lsa raqamlar telefon yoki narxga
  // yoziladi; Enter — saqlash (Esc — Sheet yopadi)
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement;
    if (el.tagName === 'TEXTAREA') return;
    if (el === phoneRef.current) {
      // Telefon maydonining o'zi onChange orqali ishlaydi; Enter — saqlash
      if (e.key === 'Enter') {
        e.preventDefault();
        void save();
      }
      return;
    }
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      pressKey(e.key as Key);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      pressKey('back');
    } else if (e.key === 'Enter' && el.tagName !== 'BUTTON') {
      e.preventDefault();
      void save();
    }
  }

  const lookupLine = (() => {
    if (!phoneValid) return null;
    if (lookupState === 'loading') return <span className="text-muted">Mijoz qidirilmoqda…</span>;
    if (lookupState !== 'done') return null;
    if (lookup && (lookup.ordersCount > 0 || lookup.customerName)) {
      return (
        <span className="flex items-start gap-2 text-success font-bold">
          <IconUser className="w-4 h-4 mt-0.5" />
          <span>
            {lookup.customerName && <span className="text-text font-extrabold">{lookup.customerName}</span>}
            {lookup.customerName && lookup.ordersCount > 0 && <span className="text-muted"> · </span>}
            {lookup.ordersCount > 0 && <>Doimiy mijoz — {lookup.ordersCount} marta buyurtma qilgan</>}
          </span>
        </span>
      );
    }
    return <span className="text-muted font-semibold">Yangi mijoz — bu raqam bilan yetkazish bo‘lmagan</span>;
  })();

  const textActive = active === 'address' || active === 'note';
  const showTextKb = textActive && kb.show;
  const feeChips = Array.from(new Set([0, pos.deliveryFeeDefault, 10_000, 15_000, 20_000].filter((v) => v >= 0))).slice(0, 5);

  const keypad = (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Raqam klaviaturasi">
      {[...DIGITS, active === 'fee' ? ('000' as Key) : ('clear' as Key), '0' as Key, 'back' as Key].map((k) => {
        const isDigit = /^[0-9]+$/.test(k);
        const disabled =
          busy || (active === 'fee' ? false : isDigit ? digits.length >= 9 : !digits);
        return (
          <button
            key={k}
            type="button"
            data-testid={`keypad-${k}`}
            disabled={disabled}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => pressKey(k)}
            aria-label={k === 'back' ? 'Oxirgi raqamni o‘chirish' : k === 'clear' ? 'Raqamni tozalash' : k}
            className={`h-14 rounded-2xl border font-extrabold flex items-center justify-center select-none transition-[transform,background-color] duration-100 active:scale-95 disabled:opacity-35 disabled:active:scale-100 ${
              isDigit && k !== '000'
                ? 'text-2xl bg-bg border-border text-text hover:bg-surface-hover active:bg-primary/20'
                : 'text-base bg-surface border-border text-muted hover:text-text'
            }`}
          >
            {k === 'back' ? <IconBackspace className="w-7 h-7" /> : k === 'clear' ? 'Tozalash' : k}
          </button>
        );
      })}
    </div>
  );

  return (
    <Sheet
      title={title || 'Yetkazib berish — mijoz ma‘lumotlari'}
      icon={<IconScooter className="w-6 h-6" />}
      iconTone="bg-success/15 text-success"
      size="xl"
      busy={busy}
      onClose={onClose}
      testId="delivery-modal"
      footer={
        <div className="space-y-2.5">
          {showTextKb && (
            <TouchKeyboard
              target={active === 'address' ? addressRef : noteRef}
              value={active === 'address' ? address : note}
              onChange={(v) => {
                setError('');
                if (active === 'address') {
                  setPrefilled(false);
                  setAddress(v.slice(0, ADDRESS_MAX));
                } else setNote(v.slice(0, NOTE_MAX));
              }}
              maxLength={active === 'address' ? ADDRESS_MAX : NOTE_MAX}
              onEnter={() => (active === 'address' ? noteRef.current?.focus() : void save())}
            />
          )}
          <div className="flex items-center gap-2">
            <span className="flex-1 min-w-0 text-xs font-semibold text-muted truncate">
              {!canSave && !busy ? (!phoneValid ? 'Telefon raqamini kiriting' : 'Yetkazish manzilini kiriting') : ''}
            </span>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-14 px-5 rounded-2xl bg-bg border border-border font-bold text-text hover:border-text active:scale-[0.97] transition-transform disabled:opacity-50"
            >
              Bekor
            </button>
            <button
              type="button"
              data-testid="delivery-save"
              onClick={() => void save()}
              disabled={!canSave}
              className="min-w-[160px] h-14 px-6 rounded-2xl bg-primary-hover text-white text-lg font-extrabold hover:brightness-110 active:scale-[0.98] transition-[transform,filter] shadow-lg shadow-primary/20 disabled:opacity-45 disabled:shadow-none disabled:active:scale-100 flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Spinner /> Saqlanmoqda…
                </>
              ) : (
                <>
                  <IconCheck className="w-6 h-6" /> Saqlash
                </>
              )}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2" onKeyDown={onKeyDown}>
        {/* Chap: telefon, yetkazish narxi + raqam klaviaturasi */}
        <div className="space-y-3">
          <div>
            <label htmlFor="delivery-phone" className="flex items-center gap-1.5 text-sm font-bold text-muted mb-1.5">
              <IconPhone className="w-4 h-4" /> Telefon raqami <span className="text-danger">*</span>
            </label>
            <div
              className={`flex items-center min-w-0 rounded-2xl border-2 bg-bg overflow-hidden transition-colors ${
                active === 'phone' ? 'border-primary' : phoneValid ? 'border-success' : digits ? 'border-warning' : 'border-border'
              }`}
            >
              <span className="pl-4 pr-2 text-2xl font-extrabold text-muted select-none">+998</span>
              <input
                ref={phoneRef}
                id="delivery-phone"
                data-testid="delivery-phone"
                type="tel"
                // Sensorli ekranda tizim klaviaturasi chiqmasin — pastdagi raqamlar bilan kiritiladi
                inputMode={kb.touch ? 'none' : 'tel'}
                autoComplete="off"
                autoFocus={!kb.touch}
                value={groupLocal(digits)}
                onFocus={() => focusField('phone')}
                onChange={(e) => {
                  setError('');
                  setDigits(localDigits(e.target.value));
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  setError('');
                  setDigits(localDigits(e.clipboardData.getData('text')));
                }}
                placeholder="90 123 45 67"
                aria-invalid={!!digits && !phoneValid}
                className="flex-1 w-0 min-w-0 py-3 pr-3 bg-transparent outline-none text-2xl font-extrabold tracking-wide text-text placeholder:text-muted/50"
              />
              {phoneValid && <IconCheck className="w-6 h-6 mr-4 text-success" />}
            </div>
            <div className="min-h-[22px] mt-1.5 text-sm">
              {digits && !phoneValid ? (
                <span className="text-warning font-bold">To‘liq raqam kiriting — {9 - digits.length} ta raqam qoldi</span>
              ) : (
                lookupLine
              )}
            </div>
          </div>

          {/* Yetkazish narxi (B28) */}
          <div>
            <div className="flex items-center gap-1.5 text-sm font-bold text-muted mb-1.5">
              <IconScooter className="w-4 h-4" /> Yetkazish narxi
            </div>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => focusField('fee')}
                data-testid="delivery-fee"
                aria-pressed={active === 'fee'}
                className={`min-w-0 flex-1 rounded-2xl border-2 px-4 py-2 text-left transition-colors ${
                  active === 'fee' ? 'border-primary bg-primary/10' : 'border-border bg-bg hover:border-primary/60'
                }`}
              >
                <span className="text-2xl font-black tabular-nums text-text">{fee > 0 ? formatAmount(fee) : '0'}</span>
                <span className="text-sm font-bold text-muted"> so‘m{fee === 0 ? ' · bepul' : ''}</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {feeChips.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    feeTouched.current = true;
                    feeFresh.current = true;
                    setFeeText(String(v));
                  }}
                  aria-pressed={fee === v}
                  className={`h-10 px-3 rounded-lg border text-sm font-extrabold tabular-nums active:scale-95 ${
                    fee === v ? 'bg-success text-black border-success' : 'bg-bg border-border text-text hover:border-success'
                  }`}
                >
                  {v === 0 ? 'Bepul' : formatAmount(v)}
                </button>
              ))}
            </div>
          </div>

          {/* Ekran raqam klaviaturasi (telefon yoki narx) */}
          {!showTextKb && keypad}
        </div>

        {/* O'ng: manzil, izoh */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label htmlFor="delivery-address" className="flex items-center gap-1.5 text-sm font-bold text-muted">
              <IconPin className="w-4 h-4" /> Yetkazish manzili <span className="text-danger">*</span>
            </label>
            <KeyboardToggle show={kb.show} onToggle={() => kb.setShow(!kb.show)} />
          </div>
          <textarea
            ref={addressRef}
            id="delivery-address"
            data-testid="delivery-address"
            value={address}
            maxLength={ADDRESS_MAX}
            inputMode={touchNoSystemKb ? 'none' : undefined}
            onFocus={() => focusField('address')}
            onChange={(e) => {
              setError('');
              setPrefilled(false);
              setAddress(e.target.value);
            }}
            rows={3}
            placeholder="Masalan: Chilonzor 9-kvartal, 12-uy, 45-xonadon"
            className={`w-full px-4 py-3 rounded-2xl bg-bg border-2 outline-none resize-none text-base font-semibold text-text placeholder:font-normal placeholder:text-muted/60 ${
              active === 'address' ? 'border-primary' : 'border-border'
            }`}
          />
          <div className="min-h-[20px] mt-1 text-xs">
            {prefilled ? (
              <span className="text-success font-bold">Oldingi buyurtmadagi manzil qo‘yildi — kerak bo‘lsa o‘zgartiring</span>
            ) : (
              <span className="text-muted">
                {address.length > 0 ? `${address.length}/${ADDRESS_MAX}` : 'Ko‘cha, uy, xonadon, mo‘ljal'}
              </span>
            )}
          </div>

          <label htmlFor="delivery-note" className="text-sm font-bold text-muted mt-2 mb-1.5">
            Izoh (ixtiyoriy)
          </label>
          <textarea
            ref={noteRef}
            id="delivery-note"
            data-testid="delivery-note"
            value={note}
            maxLength={NOTE_MAX}
            inputMode={touchNoSystemKb ? 'none' : undefined}
            onFocus={() => focusField('note')}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Masalan: domofon 45, qo‘ng‘iroq qilib keling"
            className={`w-full px-4 py-3 rounded-2xl bg-bg border-2 outline-none resize-none text-base text-text placeholder:text-muted/60 ${
              active === 'note' ? 'border-primary' : 'border-border'
            }`}
          />

          <div className="mt-3">
            <SheetError>{error}</SheetError>
          </div>
          {showTextKb && (
            <button
              type="button"
              onClick={() => focusField(phoneValid ? 'fee' : 'phone')}
              className="mt-2 self-start h-10 px-3 rounded-xl border border-dashed border-border text-sm font-bold text-muted hover:text-text hover:border-primary"
            >
              Raqam klaviaturasi (telefon / narx)
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

export { DeliveryInfoModal };
