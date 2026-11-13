import { useEffect, useMemo, useRef, useState } from 'react';
import { MenuUnit, OrderStatus, calcOrderTotals, lineSum, roundSum } from '@hardweb-pos/shared';
import type { Order, OrderItem } from '@hardweb-pos/shared';
import { api } from '../lib/api';
import { formatSum } from './ui';
import { cleanDecimalInput } from './numeric';
import { Sheet, SheetError, Spinner } from './waiter/Sheet';
import { KeyboardToggle, TouchKeyboard, useTouchKeyboardPref } from './waiter/TouchKeyboard';
import { IconBag, IconBan, IconMinus, IconPlus } from './waiter/icons';
import { formatKg, orderFullName, qtyText } from './waiter/orderUi';
import { deliveryFeeOf } from './cashier/orderType';

// "🚫 Otkaz" (B19): yuborilgan taom(lar)ni — qisman miqdor bilan — yoki butun hisobni bekor qilish.
// Faqat 'void' ruxsati bor xodim (kassir / administrator / direktor) ochadi; server ham tekshiradi.
// Sabab majburiy (tayyor tugmalar yoki matn) — otkazlar jurnaliga, oshxona OTKAZ chekiga va
// direktorning Telegram xabariga yoziladi.
//  • itemIds berilsa — o'sha qator(lar) to'liq miqdor bilan tanlangan holda ochiladi (miqdorni kamaytirish mumkin);
//  • wholeOrder — butun hisob (to'lov bo'lsa mumkin emas — sababi ko'rsatiladi);
//  • aks holda — hisobdagi barcha taomlar ro'yxati, keraklisi tanlanadi.
// Serverga: POST /orders/:id/remove-items {items:[{orderItemId, quantity}], reason}
// yoki (hamma taom bekor bo'lsa) POST /orders/:id/cancel {reason}.
export interface VoidModalProps {
  order: Order;
  /** oldindan tanlangan qatorlar (qatordagi 🚫 bosilganda); berilmasa — ro'yxatdan tanlanadi */
  itemIds?: string[];
  /** butun hisobni bekor qilish rejimi (to'lov bo'lsa — mumkin emas, sababi ko'rsatiladi) */
  wholeOrder?: boolean;
  onClose: () => void;
  /** muvaffaqiyatli otkazdan keyin: yangilangan buyurtma (butun hisob bekor qilinsa — null) */
  onDone: (order: Order | null) => void;
}

/** Tayyor sabablar (egasining ro'yxati) */
export const VOID_REASONS = ['Mijoz voz kechdi', 'Xato kiritildi', 'Uzoq kutdi', 'Taom tugagan', 'Sifat yoqmadi'];

/** Sabab uzunligi chegarasi (server bilan bir xil) */
const REASON_MAX = 200;
/** kg miqdori: qo'lda kiritishda 3 xona (ekrandagidek); "Hammasi" — qatorning aniq miqdori */
const KG_DECIMALS = 3;
const EPS = 1e-9;

const HAS_PAYMENTS = 'Bu hisobda to‘lov bor — avval to‘lovlarni o‘chiring';
const BELOW_PAID = 'Qolgan summa to‘langan summadan kam bo‘lib qoladi';

const isKg = (it: OrderItem) => it.unit === MenuUnit.Weight;

/** Miqdorni 6 xonagacha yaxlitlash (ayirishdagi 0.30000000000000004 kabi qoldiqlarsiz) */
const roundQty = (n: number) => Math.round(n * 1e6) / 1e6;

/** Kiritilgan otkaz miqdori (matn) -> son; noto'g'ri -> NaN */
function parseQty(text: string | undefined, kg: boolean): number {
  const s = String(text ?? '').trim();
  if (!s) return 0;
  const n = Number(kg ? cleanDecimalInput(s, 6) : s);
  return Number.isFinite(n) ? n : NaN;
}

export default function VoidModal({ order, itemIds, wholeOrder, onClose, onDone }: VoidModalProps) {
  const kb = useTouchKeyboardPref();
  const [cur, setCur] = useState<Order>(order);
  // To'langan summa: avval DTO'dagi, keyin serverdan eng yangisi
  const [paid, setPaid] = useState(() => roundSum(order.paidAmount ?? 0));
  const preset = useMemo(() => new Set(itemIds ?? []), [itemIds]);
  const listMode = !wholeOrder && preset.size === 0;
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const it of order.items ?? []) {
      if (preset.has(it.id)) init[it.id] = String(roundQty(Number(it.quantity) || 0));
    }
    return init;
  });
  const [chip, setChip] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Eng yangi holat: taomlar (ofitsiant qo'shgan/boshqa kassa o'zgartirgan bo'lishi mumkin) va to'lovlar
  useEffect(() => {
    let off = false;
    api
      .get<Order>(`/orders/${order.id}`)
      .then((fresh) => {
        if (off || !alive.current || !fresh || fresh.id !== order.id) return;
        setCur((prev) => ({ ...prev, ...fresh, items: Array.isArray(fresh.items) ? fresh.items : prev.items }));
        if (typeof fresh.paidAmount === 'number') setPaid(roundSum(fresh.paidAmount));
      })
      .catch(() => {
        /* tarmoq xatosi — props'dagi nusxa bilan davom etamiz (server baribir tekshiradi) */
      });
    return () => {
      off = true;
    };
  }, [order.id]);

  const items = cur.items ?? [];
  const closed = cur.status === OrderStatus.Closed;
  // Ko'rsatiladigan qatorlar: butun hisob / ro'yxat — hammasi; aks holda — tanlanganlari
  const shown = wholeOrder || listMode ? items : items.filter((it) => preset.has(it.id));
  const missing = !wholeOrder && !listMode && shown.length < preset.size;

  // Har qator uchun otkaz miqdori (butun hisobda — to'liq miqdor)
  const plan = useMemo(() => {
    const rows = items.map((it) => {
      const lineQty = Number(it.quantity) || 0;
      const v = wholeOrder ? lineQty : parseQty(qty[it.id], isKg(it));
      return { it, lineQty, v };
    });
    let invalid = false;
    for (const r of rows) {
      if (r.v === 0) continue;
      if (!Number.isFinite(r.v) || r.v < 0 || r.v > r.lineQty + EPS) invalid = true;
      else if (!isKg(r.it) && !Number.isInteger(r.v)) invalid = true;
    }
    const chosen = rows.filter((r) => Number.isFinite(r.v) && r.v > 0);
    const voidSum = chosen.reduce((s, r) => s + lineSum(r.it.price ?? 0, Math.min(r.v, r.lineQty)), 0);
    // Qoladigan qatorlar (miqdori kamaygan yoki tegilmagan)
    const left = rows
      .map((r) => ({ price: r.it.price ?? 0, quantity: roundQty(r.lineQty - (Number.isFinite(r.v) && r.v > 0 ? r.v : 0)), takeaway: !!r.it.takeaway }))
      .filter((l) => l.quantity > EPS);
    const all = wholeOrder || (chosen.length > 0 && left.length === 0);
    const after = calcOrderTotals(left, cur.discountPercent, cur.servicePercent, deliveryFeeOf(cur)).total;
    return { chosen, voidSum, all, after, invalid };
  }, [items, qty, wholeOrder, cur]);

  const reason = [chip, text.trim()].filter(Boolean).join(' — ').slice(0, REASON_MAX);

  // Server qoidalari bilan bir xil tekshiruv — tugma bosilmasdan oldin sababi ko'rinadi.
  // block — qat'iy to'siq (tugma o'chiq, sababi qizil); hint — hali tanlanmagan narsa (bosilganda aytiladi).
  let block = '';
  if (closed) block = 'Buyurtma yopilgan';
  else if (missing) block = 'Taom qatori topilmadi — hisob o‘zgargan bo‘lishi mumkin';
  else if (plan.invalid) block = 'Otkaz miqdori noto‘g‘ri';
  else if (plan.all && paid > 0) block = HAS_PAYMENTS;
  else if (!plan.all && plan.chosen.length > 0 && paid > 0 && plan.after < paid) block = BELOW_PAID;
  let hint = '';
  if (!block) {
    if (!wholeOrder && plan.chosen.length === 0) hint = 'Otkaz qilinadigan taomni tanlang';
    else if (!reason) hint = 'Otkaz sababini tanlang yoki yozing';
  }

  function setLine(it: OrderItem, value: string) {
    setError('');
    setQty((prev) => ({ ...prev, [it.id]: value }));
  }

  function step(it: OrderItem, delta: number) {
    const lineQty = Number(it.quantity) || 0;
    const v = parseQty(qty[it.id], false);
    const base = Number.isFinite(v) ? v : 0;
    const next = Math.min(lineQty, Math.max(0, Math.round(base + delta)));
    setLine(it, next > 0 ? String(next) : '');
  }

  function toggleAll(it: OrderItem) {
    const lineQty = roundQty(Number(it.quantity) || 0);
    const v = parseQty(qty[it.id], isKg(it));
    setLine(it, Math.abs(v - lineQty) < EPS ? '' : String(lineQty));
  }

  async function confirm() {
    if (busy || block) return;
    if (hint) {
      setError(hint);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (plan.all) {
        // Hamma taom bekor — butun hisob (server ham remove-items'da shunday qiladi)
        await api.post(`/orders/${cur.id}/cancel`, { reason });
        if (alive.current) onDone(null);
      } else {
        const body = {
          items: plan.chosen.map((r) => ({
            orderItemId: r.it.id,
            // To'liq qator — aniq miqdor (kg 6 xonali bo'lishi mumkin), qisman — kiritilgan
            quantity: Math.abs(r.v - r.lineQty) < EPS ? r.lineQty : roundQty(r.v),
          })),
          reason,
        };
        const updated = await api.post<Order>(`/orders/${cur.id}/remove-items`, body);
        if (alive.current) onDone(updated && updated.id === cur.id ? updated : null);
      }
    } catch (e) {
      if (alive.current) setError((e as Error)?.message || 'Otkaz bajarilmadi');
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  // Jismoniy klaviatura: Enter — tasdiqlash (matn maydonida emas)
  const live = useRef(confirm);
  live.current = confirm;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'INPUT')) return;
      e.preventDefault();
      void live.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const title = wholeOrder ? 'Hisobni bekor qilish' : 'Otkaz';
  const confirmText = plan.all ? 'Hisobni bekor qilish' : 'Otkaz qilish';
  const touchNoSystemKb = kb.touch && kb.show;

  return (
    <Sheet
      title={title}
      subtitle={`${orderFullName(cur)} · ${formatSum(roundSum(cur.total ?? 0))}`}
      icon={<IconBan className="w-6 h-6" />}
      iconTone="bg-danger/15 text-danger"
      size="lg"
      busy={busy}
      onClose={onClose}
      testId="void-modal"
      footer={
        <div className="space-y-2.5">
          {kb.show && (
            <TouchKeyboard
              target={textRef}
              value={text}
              onChange={(v) => {
                setError('');
                setText(v.slice(0, REASON_MAX));
              }}
              maxLength={REASON_MAX}
              onEnter={() => void confirm()}
            />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-14 px-5 rounded-2xl bg-bg border border-border font-bold text-text hover:border-text disabled:opacity-50"
            >
              Orqaga
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || !!block}
              aria-disabled={!!hint || undefined}
              title={block || hint || undefined}
              data-testid="void-confirm"
              className={`flex-1 min-w-0 h-14 rounded-2xl bg-danger text-white text-lg font-black flex items-center justify-center gap-2 shadow-lg shadow-danger/25 hover:brightness-110 active:scale-[0.98] transition-[transform,filter,opacity] disabled:opacity-40 disabled:shadow-none disabled:active:scale-100 ${
                hint ? 'opacity-60' : ''
              }`}
            >
              {busy ? <Spinner /> : <IconBan className="w-6 h-6" />}
              <span className="truncate">
                {confirmText}
                {plan.voidSum > 0 ? ` — ${formatSum(plan.voidSum)}` : ''}
              </span>
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Taomlar */}
        <div>
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <div className="text-sm font-extrabold uppercase tracking-wider text-muted">
              {wholeOrder ? 'Bekor qilinadigan taomlar' : listMode ? 'Qaysi taom otkaz qilinadi?' : 'Otkaz qilinadigan taom'}
            </div>
            {paid > 0 && (
              <div className="text-xs font-bold text-success whitespace-nowrap">To‘langan: {formatSum(paid)}</div>
            )}
          </div>
          {shown.length === 0 ? (
            <div className="rounded-2xl border border-border bg-bg p-4 text-center text-muted">Hisobda taom yo‘q</div>
          ) : (
            <div className="rounded-2xl border border-border bg-bg divide-y divide-border overflow-hidden">
              {shown.map((it) => (
                <VoidLine
                  key={it.id}
                  item={it}
                  whole={!!wholeOrder}
                  value={wholeOrder ? String(it.quantity) : qty[it.id] ?? ''}
                  onStep={(d) => step(it, d)}
                  onAll={() => toggleAll(it)}
                  onType={(v) => setLine(it, cleanDecimalInput(v, KG_DECIMALS))}
                  disabled={busy || closed}
                />
              ))}
            </div>
          )}
        </div>

        {/* Natija: otkaz summasi va hisobda qoladigan summa */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl border-2 border-danger/60 bg-danger/10 px-4 py-2.5">
            <div className="text-xs font-extrabold uppercase tracking-wider text-danger">Otkaz summasi</div>
            <div className="text-2xl font-black text-text tabular-nums" data-testid="void-sum">
              {formatSum(plan.voidSum)}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-bg px-4 py-2.5">
            <div className="text-xs font-extrabold uppercase tracking-wider text-muted">Hisobda qoladi</div>
            <div className="text-2xl font-black text-text tabular-nums">{plan.all ? '—' : formatSum(plan.after)}</div>
          </div>
        </div>

        {block && <SheetError>{block}</SheetError>}

        {/* Sabab */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-sm font-extrabold uppercase tracking-wider text-muted">
              Sabab <span className="text-danger">*</span>
            </div>
            <KeyboardToggle show={kb.show} onToggle={() => kb.setShow(!kb.show)} />
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Otkaz sababi">
            {VOID_REASONS.map((r, i) => {
              const on = chip === r;
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-testid={`void-reason-${i + 1}`}
                  data-reason={r}
                  onClick={() => {
                    setError('');
                    setChip(on ? '' : r);
                  }}
                  className={`min-h-[48px] px-4 rounded-full border-2 text-base font-bold transition-[transform,background-color] active:scale-95 ${
                    on ? 'bg-danger text-white border-danger' : 'bg-bg text-text border-border hover:border-danger'
                  }`}
                >
                  {r}
                </button>
              );
            })}
          </div>
          <textarea
            ref={textRef}
            data-testid="void-reason-text"
            value={text}
            maxLength={REASON_MAX}
            rows={2}
            inputMode={touchNoSystemKb ? 'none' : undefined}
            onChange={(e) => {
              setError('');
              setText(e.target.value);
            }}
            placeholder="Boshqa sabab yoki izoh (ixtiyoriy)"
            className="mt-2.5 w-full px-4 py-3 rounded-2xl bg-bg border-2 border-border focus:border-danger outline-none resize-none text-base text-text placeholder:text-muted/60"
          />
          <div className="mt-1 text-xs text-muted">
            Oshxonaga <b className="text-text">OTKAZ</b> cheki chiqadi, otkaz jurnalga yoziladi va direktorga xabar boradi.
          </div>
        </div>

        {/* Server xatosi yoki bosilgandagi eslatma (tanlash/yozish bilan o'zi tozalanadi) */}
        {error && error !== block && <SheetError>{error}</SheetError>}
      </div>
    </Sheet>
  );
}

/** Bitta taom qatori: nom, miqdor × narx, otkaz miqdori (dona — −/+; kg — maydon) va "Hammasi" */
function VoidLine({
  item,
  whole,
  value,
  onStep,
  onAll,
  onType,
  disabled,
}: {
  item: OrderItem;
  whole: boolean;
  value: string;
  onStep: (delta: number) => void;
  onAll: () => void;
  onType: (v: string) => void;
  disabled?: boolean;
}) {
  const kg = isKg(item);
  const lineQty = Number(item.quantity) || 0;
  const v = parseQty(value, kg);
  const on = Number.isFinite(v) && v > 0;
  const full = on && Math.abs(v - lineQty) < EPS;
  const price = Number(item.price ?? 0);
  return (
    <div
      data-testid={`void-line-${item.id}`}
      data-selected={on || whole ? 'true' : 'false'}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 transition-colors ${on || whole ? 'bg-danger/10' : ''}`}
    >
      <div className="min-w-0 flex-1 basis-[180px]">
        <div className="font-bold text-text leading-tight flex items-center gap-1.5 min-w-0">
          <span className="truncate">{item.menuItemName ?? 'Taom'}</span>
          {item.takeaway && <IconBag className="w-4 h-4 text-warning" title="Olib ketish (saboy)" />}
        </div>
        <div className="text-sm text-muted tabular-nums">
          {qtyText(item.quantity, item.unit)}
          {kg ? '' : ' ×'} {formatSum(price)} = <span className="font-semibold text-text">{formatSum(lineSum(price, item.quantity))}</span>
        </div>
        {item.note && <div className="text-xs font-semibold text-warning truncate">» {item.note}</div>}
      </div>
      {whole ? (
        <div className="text-base font-extrabold text-danger tabular-nums" data-testid={`void-qty-${item.id}`}>
          {qtyText(item.quantity, item.unit)}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          {kg ? (
            <label className="flex items-center gap-1">
              <input
                value={value}
                inputMode="decimal"
                disabled={disabled}
                onChange={(e) => onType(e.target.value)}
                placeholder="0"
                aria-label="Otkaz miqdori (kg)"
                data-testid={`void-qty-${item.id}`}
                className="w-24 h-12 px-2 rounded-xl bg-surface border-2 border-border focus:border-danger outline-none text-center text-lg font-extrabold text-text tabular-nums"
              />
              <span className="text-sm font-bold text-muted">kg</span>
            </label>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onStep(-1)}
                disabled={disabled || !on}
                aria-label="Kamaytirish"
                data-testid={`void-minus-${item.id}`}
                className="w-12 h-12 rounded-xl border border-border bg-surface flex items-center justify-center text-text active:scale-90 disabled:opacity-35"
              >
                <IconMinus className="w-5 h-5" />
              </button>
              <span
                className={`min-w-[52px] text-center text-xl font-black tabular-nums ${on ? 'text-danger' : 'text-muted'}`}
                data-testid={`void-qty-${item.id}`}
                aria-live="polite"
              >
                {on ? v : 0}
                <span className="text-xs font-bold text-muted">/{lineQty}</span>
              </span>
              <button
                type="button"
                onClick={() => onStep(1)}
                disabled={disabled || (Number.isFinite(v) && v >= lineQty)}
                aria-label="Ko‘paytirish"
                data-testid={`void-plus-${item.id}`}
                className="w-12 h-12 rounded-xl border border-border bg-surface flex items-center justify-center text-text active:scale-90 disabled:opacity-35"
              >
                <IconPlus className="w-5 h-5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onAll}
            disabled={disabled}
            aria-pressed={full}
            data-testid={`void-all-${item.id}`}
            className={`h-12 px-3 rounded-xl border-2 text-sm font-extrabold active:scale-95 disabled:opacity-40 ${
              full ? 'bg-danger text-white border-danger' : 'bg-bg text-text border-border hover:border-danger'
            }`}
          >
            {kg && full ? `${formatKg(lineQty)} kg` : 'Hammasi'}
          </button>
        </div>
      )}
    </div>
  );
}
