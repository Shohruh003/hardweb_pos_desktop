import { useEffect, useState } from 'react';
import { DEFAULT_PAYMENT_METHODS } from '@hardweb-pos/shared';
import type { PaymentMethod, PaymentMethodKind } from '@hardweb-pos/shared';
import { Button } from './ui';
import { Modal } from './Modal';
import { Select } from './Select';
import { api } from '../lib/api';
import { refreshPosSettings } from '../lib/posSettings';
import { cleanDecimalInput, cleanDigitsInput, parseDecimal } from './numeric';
import { IconChevronDown, IconChevronUp, IconPlus, IconTrash } from './waiter/icons';

interface Settings {
  restaurantName: string;
  telegramToken: string | null;
  telegramChatId: string | null;
  dailyReportTime: string;
  serviceDineInPercent?: number | string | null;
  waiterSharePercent?: number | string | null;
  deliveryFeeDefault?: number | string | null;
  paymentMethods?: PaymentMethod[] | null;
  /** B35: direktor faqat server kompyuteridan kiradi */
  directorLocalOnly?: boolean;
  /** B35: bu so'rov server kompyuterining o'zidanmi (sozlamani faqat shunda o'zgartirish mumkin) */
  localRequest?: boolean;
}

/** Standart (o'rnatilgan) to'lov usullari kalitlari — o'chirib bo'lmaydi (faqat nofaol qilinadi): eski to'lovlar shu kalit bilan */
const BUILTIN_KEYS = new Set(DEFAULT_PAYMENT_METHODS.map((m) => m.key));
const KIND_OPTIONS: { value: PaymentMethodKind; label: string }[] = [
  { value: 'cash', label: 'Naqd pul' },
  { value: 'card', label: 'Karta (terminal)' },
  { value: 'online', label: 'Onlayn (Click, Payme, QR)' },
  { value: 'debt', label: 'Qarz (keyin to‘lanadi)' },
  { value: 'other', label: 'Boshqa' },
];
const LABEL_MAX = 40;
const FEE_MAX = 1_000_000;

/**
 * PATCH /settings tanasi — faqat shu panel boshqaradigan maydonlar. GET javobini butunligicha
 * qaytarib yubormaymiz: masalan zallar tartibi (hallOrder) "Stollar" bo'limida o'zgartiriladi,
 * eski nusxa uni bosib ketmasin.
 */
function patchBody(s: Settings, servicePct: number, sharePct: number, fee: number, methods: PaymentMethod[]) {
  return {
    restaurantName: s.restaurantName.trim() || 'DasturXon',
    telegramToken: s.telegramToken ?? '',
    telegramChatId: s.telegramChatId ?? '',
    dailyReportTime: s.dailyReportTime,
    serviceDineInPercent: servicePct,
    waiterSharePercent: sharePct,
    deliveryFeeDefault: fee,
    paymentMethods: methods.map((m) => ({ key: m.key, label: m.label.trim(), kind: m.kind, active: m.active })),
  };
}

/** Foiz matni -> 0..100 son */
const pctOf = (text: string) => Math.min(100, Math.max(0, parseDecimal(text)));
/** Saqlangan foiz -> maydon matni (0 bo'lsa bo'sh) */
const pctText = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
};
/** So'm: 15000 -> "15 000" (kiritish maydoni uchun) */
const groupDigits = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Lotin harflariga o'girib kalit yasash: "Xaqberdiga" -> "xaqberdiga", "Bank o‘tkazma" -> "bank_otkazma" */
function slugKey(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[‘’ʻʼ`']/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'usul';
  let key = base;
  let i = 2;
  while (taken.has(key)) key = `${base.slice(0, 21)}_${i++}`;
  return key;
}

/** To'lov usullari ro'yxatini tekshirish (server qoidasi bilan bir xil) — xato matni yoki null */
function methodsProblem(list: PaymentMethod[]): string | null {
  if (list.length === 0) return 'To‘lov turlari ro‘yxati bo‘sh';
  const keys = new Set<string>();
  for (const m of list) {
    if (!m.label.trim()) return 'To‘lov turi nomi kiritilmagan';
    if (m.label.trim().length > LABEL_MAX) return `To‘lov turi nomi juda uzun (${LABEL_MAX} belgigacha)`;
    if (keys.has(m.key)) return `To‘lov turi kaliti takrorlangan: «${m.key}»`;
    keys.add(m.key);
  }
  if (!list.some((m) => m.kind === 'cash' && m.active)) return 'Kamida bitta faol naqd to‘lov turi bo‘lishi kerak';
  return null;
}

// Restoran sozlamalari — nom, stolga xizmat haqi va ofitsiant ulushi, yetkazish narxi, to'lov turlari,
// Telegram bot tokeni, kunlik hisobot vaqti. embedded=true bo'lsa modal emas, oddiy panel (admin tab ichida).
export function SettingsPanel({
  onClose,
  embedded,
}: {
  onClose?: () => void;
  embedded?: boolean;
}) {
  const [s, setS] = useState<Settings>({
    restaurantName: 'DasturXon',
    telegramToken: '',
    telegramChatId: '',
    dailyReportTime: '23:59',
  });
  // Foiz matnlari alohida ("7," kabi oraliq yozuv yo'qolmasin)
  const [serviceText, setServiceText] = useState('');
  const [shareText, setShareText] = useState('');
  const [feeDigits, setFeeDigits] = useState('');
  const [methods, setMethods] = useState<PaymentMethod[]>(DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m })));
  const [newLabel, setNewLabel] = useState('');
  const [newKind, setNewKind] = useState<PaymentMethodKind>('other');
  // Sozlamalar yuklanmagan bo'lsa (ruxsat yo'q / tarmoq) — saqlash standart qiymatlar bilan
  // haqiqiy sozlamani bosib ketmasligi uchun bloklanadi
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [msg, setMsg] = useState('');
  const [msgTone, setMsgTone] = useState<'ok' | 'err' | 'info'>('info');
  const [busy, setBusy] = useState(false);
  // B35 — alohida saqlanadi (darhol PATCH), "Saqlash" tugmasiga bog'liq emas
  const [directorLocalOnly, setDirectorLocalOnly] = useState(true);
  const [isServerPc, setIsServerPc] = useState(false);
  const [dloBusy, setDloBusy] = useState(false);

  async function load() {
    setLoadError('');
    try {
      const data = await api.get<Settings>('/settings');
      setS({
        restaurantName: data?.restaurantName ?? 'DasturXon',
        telegramToken: data?.telegramToken ?? '',
        telegramChatId: data?.telegramChatId ?? '',
        dailyReportTime: data?.dailyReportTime || '23:59',
      });
      setServiceText(pctText(data?.serviceDineInPercent));
      setShareText(pctText(data?.waiterSharePercent));
      const fee = Math.max(0, Math.round(Number(data?.deliveryFeeDefault) || 0));
      setFeeDigits(fee > 0 ? String(fee) : '');
      const list = Array.isArray(data?.paymentMethods) && data!.paymentMethods!.length ? data!.paymentMethods! : DEFAULT_PAYMENT_METHODS;
      setMethods(list.map((m) => ({ key: m.key, label: m.label, kind: m.kind, active: m.active !== false })));
      setDirectorLocalOnly(data?.directorLocalOnly !== false);
      setIsServerPc(data?.localRequest === true);
      setLoaded(true);
    } catch (e) {
      setLoadError((e as Error)?.message || 'Sozlamalar yuklanmadi');
    }
  }

  useEffect(() => {
    load();
  }, []);

  const servicePct = pctOf(serviceText);
  const sharePct = pctOf(shareText);
  const fee = Math.min(FEE_MAX, Number(feeDigits) || 0);
  const problem = methodsProblem(methods);

  function show(text: string, tone: 'ok' | 'err' | 'info', ms: number) {
    setMsg(text);
    setMsgTone(tone);
    if (ms > 0) {
      window.setTimeout(() => setMsg((cur) => (cur === text ? '' : cur)), ms);
    }
  }

  // B35: "Direktor faqat server kompyuteridan kiradi" — faqat server kompyuterida o'zgartiriladi
  async function toggleDirectorLocalOnly() {
    if (!loaded || dloBusy || !isServerPc) return;
    const next = !directorLocalOnly;
    setDloBusy(true);
    try {
      const res = await api.patch<Settings>('/settings', { directorLocalOnly: next });
      setDirectorLocalOnly(res?.directorLocalOnly !== false);
      show(next ? 'Direktor endi faqat server kompyuteridan kiradi ✓' : 'Direktor boshqa kompyuterlardan ham kira oladi', 'ok', 4000);
    } catch (e) {
      show((e as Error).message, 'err', 6000);
    } finally {
      setDloBusy(false);
    }
  }

  async function save() {
    if (!loaded || busy) return;
    if (problem) {
      show(problem, 'err', 6000);
      return;
    }
    setBusy(true);
    try {
      await api.patch('/settings', patchBody(s, servicePct, sharePct, fee, methods));
      // Ofitsiant/kassa ekranlari yangi foizlar, yetkazish narxi va to'lov turlarini darrov olsin
      await refreshPosSettings();
      show('Saqlandi ✓', 'ok', 3000);
    } catch (e) {
      show((e as Error).message, 'err', 6000);
    } finally {
      setBusy(false);
    }
  }

  async function testTelegram() {
    if (!loaded) return;
    if (problem) {
      show(problem, 'err', 6000);
      return;
    }
    show('Telegram sinovi yuborilmoqda...', 'info', 0);
    try {
      await api.patch('/settings', patchBody(s, servicePct, sharePct, fee, methods)); // avval saqlaymiz
      const r = await api.post<{ ok: boolean }>('/settings/telegram-test');
      show(r.ok ? 'Telegram sinovi yuborildi ✓ (botni tekshiring)' : 'Yuborilmadi — token/chat id noto‘g‘ri', r.ok ? 'ok' : 'err', 5000);
    } catch (e) {
      show((e as Error).message, 'err', 5000);
    }
  }

  async function detectChat() {
    if (!loaded) return;
    show('Chat ID aniqlanmoqda... (avval botga /start yozing)', 'info', 0);
    try {
      const r = await api.post<{ chatId: string | null }>('/settings/telegram-detect', { token: s.telegramToken });
      if (r.chatId) {
        // Bir nechta admin — mavjud ro'yxatga qo'shib boramiz (takrorlamasdan)
        const list = (s.telegramChatId ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
        if (list.includes(r.chatId)) {
          show(`Bu ID allaqachon ro'yxatda: ${r.chatId}`, 'info', 6000);
        } else {
          const next = [...list, r.chatId].join(', ');
          setS({ ...s, telegramChatId: next });
          show(`Qo'shildi: ${r.chatId} ✓  (jami ${list.length + 1} ta admin) — "Saqlash"ni bosing`, 'ok', 6000);
        }
      } else {
        show('Topilmadi — avval botga Telegram\'da /start yozing, keyin qayta bosing', 'err', 6000);
      }
    } catch (e) {
      show((e as Error).message, 'err', 6000);
    }
  }

  async function sendReport() {
    show('Hisobot yuborilmoqda...', 'info', 0);
    try {
      const r = await api.post<{ ok?: boolean }>('/settings/telegram-report');
      // Server ok:false qaytarsa — hisobot hech kimga yetmadi (token/chat id yoki internet)
      if (r?.ok === false) show('Yuborilmadi — token/chat id yoki internetni tekshiring', 'err', 5000);
      else show('Kunlik hisobot yuborildi ✓', 'ok', 4000);
    } catch (e) {
      show((e as Error).message, 'err', 5000);
    }
  }

  // ---- To'lov turlari muharriri ----
  const patchMethod = (key: string, patch: Partial<PaymentMethod>) =>
    setMethods((list) => list.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  const moveMethod = (index: number, dir: -1 | 1) =>
    setMethods((list) => {
      const j = index + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  const removeMethod = (key: string) => setMethods((list) => list.filter((m) => m.key !== key));
  function addMethod() {
    const label = newLabel.trim();
    if (!label) return;
    const key = slugKey(label, new Set(methods.map((m) => m.key)));
    setMethods((list) => [...list, { key, label: label.slice(0, LABEL_MAX), kind: newKind, active: true }]);
    setNewLabel('');
    setNewKind('other');
  }

  const field = 'w-full h-11 px-3 rounded-lg bg-bg border border-border outline-none focus:border-primary disabled:opacity-60';
  const small = 'h-11 w-11 shrink-0 rounded-lg border border-border bg-surface text-text flex items-center justify-center hover:border-primary/60 disabled:opacity-30';

  const body = (
    <>
      {loadError && (
        <div role="alert" className="mb-4 bg-danger/10 border border-danger/50 text-danger rounded-xl px-3 py-2.5 text-sm font-semibold">
          Sozlamalar yuklanmadi: {loadError}{' '}
          <button type="button" onClick={load} className="underline font-bold">
            Qayta urinish
          </button>
        </div>
      )}

      <label className="block text-sm text-muted mb-1">Restoran nomi</label>
      <input
        value={s.restaurantName}
        disabled={!loaded}
        onChange={(e) => setS({ ...s, restaurantName: e.target.value })}
        className={`${field} mb-4`}
      />

      {/* Xizmat haqi (faqat stolga) va ofitsiant ulushi — yonma-yon */}
      <div className="grid grid-cols-2 gap-3 mb-1">
        <div>
          <label htmlFor="service-dine-in" className="block text-sm text-muted mb-1">
            Xizmat haqi (stolga), %
          </label>
          <div className="relative">
            <input
              id="service-dine-in"
              data-testid="settings-service-percent"
              inputMode="decimal"
              placeholder="0"
              value={serviceText}
              disabled={!loaded}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const clean = cleanDecimalInput(e.target.value, 2);
                setServiceText(parseDecimal(clean) > 100 ? '100' : clean);
              }}
              className={`${field} pr-9 text-lg font-bold`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted font-bold">%</span>
          </div>
        </div>
        <div>
          <label htmlFor="waiter-share" className="block text-sm text-muted mb-1">
            Ofitsiant ulushi, %
          </label>
          <div className="relative">
            <input
              id="waiter-share"
              data-testid="settings-waiter-share"
              inputMode="decimal"
              placeholder="0"
              value={shareText}
              disabled={!loaded}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const clean = cleanDecimalInput(e.target.value, 2);
                setShareText(parseDecimal(clean) > 100 ? '100' : clean);
              }}
              className={`${field} pr-9 text-lg font-bold`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted font-bold">%</span>
          </div>
        </div>
      </div>
      <div className="text-xs text-muted mb-4 leading-relaxed">
        Mijoz stolga buyurtmada xizmat haqi to‘laydi; shundan ofitsiantga — ulush foizi (hisobotda). Olib ketish va
        yetkazishda xizmat haqi olinmaydi. Zal bo‘yicha alohida foiz — “Stollar” bo‘limida.
      </div>

      {/* Yetkazish narxi (standart) */}
      <label htmlFor="delivery-fee-default" className="block text-sm text-muted mb-1">
        Yetkazish narxi (standart), so‘m
      </label>
      <div className="relative mb-1 max-w-[260px]">
        <input
          id="delivery-fee-default"
          data-testid="settings-delivery-fee"
          inputMode="numeric"
          placeholder="0"
          value={groupDigits(feeDigits)}
          disabled={!loaded}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const digits = cleanDigitsInput(e.target.value).replace(/^0+(?=\d)/, '').slice(0, 7);
            setFeeDigits(Number(digits) > FEE_MAX ? String(FEE_MAX) : digits);
          }}
          className={`${field} pr-14 text-lg font-bold tabular-nums`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted font-bold">so‘m</span>
      </div>
      <div className="text-xs text-muted mb-5 leading-relaxed">
        Yangi yetkazish buyurtmasiga avtomatik qo‘yiladi (0 — yo‘q); har bir buyurtmada o‘zgartirish mumkin.
      </div>

      {/* To'lov turlari (B30) */}
      <div className="border-t border-border pt-4 mb-2 font-bold">To‘lov turlari</div>
      <div className="text-xs text-muted mb-3 leading-relaxed">
        To‘lov oynasida shu tartibda chiqadi. Nomini o‘zgartiring, keraksizini o‘chiring (nofaol), yangisini qo‘shing
        (masalan “Xaqberdiga”). Kamida bitta faol naqd turi bo‘lishi shart.
      </div>
      <div className="space-y-2 mb-3" data-testid="settings-payment-methods">
        {methods.map((m, i) => (
          <div
            key={m.key}
            data-testid={`pm-row-${m.key}`}
            className={`rounded-xl border p-2 flex items-center gap-2 flex-wrap ${m.active ? 'border-border bg-bg' : 'border-border/60 bg-bg/40 opacity-75'}`}
          >
            <div className="flex gap-1">
              <button type="button" className={small} disabled={!loaded || i === 0} onClick={() => moveMethod(i, -1)} aria-label="Yuqoriga">
                <IconChevronUp className="w-4 h-4" />
              </button>
              <button type="button" className={small} disabled={!loaded || i === methods.length - 1} onClick={() => moveMethod(i, 1)} aria-label="Pastga">
                <IconChevronDown className="w-4 h-4" />
              </button>
            </div>
            <input
              value={m.label}
              disabled={!loaded}
              maxLength={LABEL_MAX}
              onChange={(e) => patchMethod(m.key, { label: e.target.value })}
              data-testid={`pm-label-${m.key}`}
              className="flex-1 min-w-[140px] h-11 px-3 rounded-lg bg-surface border border-border outline-none focus:border-primary font-semibold"
            />
            <Select
              value={m.kind}
              onChange={(v) => patchMethod(m.key, { kind: v as PaymentMethodKind })}
              options={KIND_OPTIONS}
              className="w-[170px]"
            />
            <button
              type="button"
              role="switch"
              aria-checked={m.active}
              disabled={!loaded}
              data-testid={`pm-active-${m.key}`}
              onClick={() => patchMethod(m.key, { active: !m.active })}
              className={`h-11 px-3 rounded-lg font-bold text-sm border-2 min-w-[92px] ${
                m.active ? 'bg-primary-hover border-primary-hover text-white' : 'bg-surface border-border text-muted'
              }`}
            >
              {m.active ? 'Yoqilgan' : 'O‘chiq'}
            </button>
            {!BUILTIN_KEYS.has(m.key) && (
              <button
                type="button"
                className={`${small} text-danger hover:border-danger`}
                disabled={!loaded}
                onClick={() => removeMethod(m.key)}
                aria-label={`${m.label} — o‘chirish`}
                title="O‘chirish"
              >
                <IconTrash className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap mb-1">
        <input
          value={newLabel}
          disabled={!loaded}
          maxLength={LABEL_MAX}
          placeholder="Yangi to‘lov turi nomi"
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addMethod();
          }}
          data-testid="pm-new-label"
          className="flex-1 min-w-[160px] h-11 px-3 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <Select value={newKind} onChange={(v) => setNewKind(v as PaymentMethodKind)} options={KIND_OPTIONS} className="w-[170px]" />
        <Button variant="ghost" onClick={addMethod} disabled={!loaded || !newLabel.trim()} className="h-11 inline-flex items-center gap-1.5" data-testid="pm-add">
          <IconPlus className="w-4 h-4" /> Qo‘shish
        </Button>
      </div>
      {problem && loaded && <div className="text-sm font-bold text-danger mt-1">{problem}</div>}

      <div className="border-t border-border pt-4 mt-5 mb-2 font-bold flex items-center gap-2">
        <span>🔒 Direktor kirishi</span>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <div className="font-semibold">Direktor faqat server kompyuteridan kiradi</div>
          <div className="text-xs text-muted leading-relaxed mt-0.5">
            {isServerPc
              ? 'Yoqilganda direktor monoblok va telefonlardan kira olmaydi — faqat shu (kassa) kompyuterdan.'
              : 'Bu sozlamani faqat server o‘rnatilgan kassa kompyuterida o‘zgartirish mumkin.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={directorLocalOnly}
          disabled={!loaded || dloBusy || !isServerPc}
          data-testid="settings-director-local-only"
          onClick={toggleDirectorLocalOnly}
          title={isServerPc ? undefined : 'Faqat server kompyuterida o‘zgartiriladi'}
          className={`h-12 px-4 rounded-lg font-bold text-sm border-2 min-w-[110px] disabled:opacity-60 disabled:cursor-not-allowed ${
            directorLocalOnly ? 'bg-primary-hover border-primary-hover text-white' : 'bg-surface border-border text-muted'
          }`}
        >
          {directorLocalOnly ? 'Yoqilgan' : 'O‘chiq'}
        </button>
      </div>

      <div className="border-t border-border pt-4 mt-5 mb-2 font-bold flex items-center gap-2">
        <span>📨 Telegram bot</span>
      </div>
      <div className="text-xs text-muted mb-3 leading-relaxed">
        1. Telegram'da <b>@BotFather</b> — <code>/newbot</code> → token oling.<br />
        2. Botga yozing, keyin <b>@userinfobot</b> orqali <b>chat id</b>ni oling.<br />
        3. Ikkalasini shu yerga qo'ying va "Sinov" bosing.
      </div>

      <label className="block text-sm text-muted mb-1">Bot token</label>
      <input
        value={s.telegramToken ?? ''}
        disabled={!loaded}
        onChange={(e) => setS({ ...s, telegramToken: e.target.value })}
        placeholder="123456:ABC-DEF..."
        className={`${field} mb-3 font-mono text-sm`}
      />
      <label className="block text-sm text-muted mb-1">Telegram ID (raqamli user id)</label>
      <div className="flex gap-2 mb-1">
        <input
          value={s.telegramChatId ?? ''}
          disabled={!loaded}
          onChange={(e) => setS({ ...s, telegramChatId: e.target.value })}
          placeholder="123456789  (bir nechta bo‘lsa vergul bilan)"
          className={`${field} font-mono text-sm`}
        />
        <Button variant="ghost" onClick={detectChat} disabled={!loaded} className="shrink-0">
          Avtomatik olish
        </Button>
      </div>
      <div className="text-xs text-muted mb-3 leading-relaxed">
        Odamning <b>raqamli Telegram ID</b>'sini yozing (masalan <b>123456789</b>). Bir
        nechta bo‘lsa <b>vergul bilan</b>: <span className="font-mono">123, 456</span>.
        ID'ni <b>@userinfobot</b>dan olasiz yoki "Avtomatik olish" bilan.<br />
        <b>Bir nechta admin:</b> har bir admin botga <b>/start</b> bossin, so'ng "Avtomatik
        olish"ni <b>ketma-ket</b> bosing — har biri ro'yxatga qo'shiladi. Hisobot hammasiga boradi.<br />
        <i>Muhim: o‘sha odam botga avval bir marta <b>/start</b> bosgan bo‘lishi shart —
        Telegram qoidasi (aks holda xabar yetmaydi). Kanal kerak bo‘lsa <b>@kanal_nomi</b>
        ham yozish mumkin.</i>
      </div>
      <label className="block text-sm text-muted mb-1">Kunlik hisobot vaqti</label>
      <input
        type="time"
        value={s.dailyReportTime}
        disabled={!loaded}
        onChange={(e) => setS({ ...s, dailyReportTime: e.target.value })}
        className={`${field} mb-4`}
      />

      <div className="flex gap-2 flex-wrap">
        <Button onClick={save} disabled={busy || !loaded} className="flex-1 h-12" data-testid="settings-save">
          {busy ? 'Saqlanmoqda...' : 'Saqlash'}
        </Button>
        <Button variant="ghost" onClick={testTelegram} disabled={!loaded} className="h-12">
          Sinov
        </Button>
        <Button variant="ghost" onClick={sendReport} disabled={!loaded} className="h-12">
          Hisobot yuborish
        </Button>
      </div>
      {msg && (
        <div
          role={msgTone === 'err' ? 'alert' : undefined}
          className={`mt-3 text-sm text-center font-semibold ${
            msgTone === 'ok' ? 'text-success' : msgTone === 'err' ? 'text-danger' : 'text-muted'
          }`}
        >
          {msg}
        </div>
      )}
    </>
  );

  if (embedded) return <div className="max-w-2xl">{body}</div>;
  return (
    <Modal title="⚙️ Restoran sozlamalari" onClose={onClose ?? (() => undefined)} wide>
      {body}
    </Modal>
  );
}
