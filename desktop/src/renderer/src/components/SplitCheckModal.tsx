import { useEffect, useMemo, useRef, useState } from 'react';
import { MenuUnit, OrderStatus, OrderType, calcOrderTotals, lineSum, orderTypeOf, roundSum } from '@hardweb-pos/shared';
import type { Order, OrderItem, SplitOrderResult } from '@hardweb-pos/shared';
import { api } from '../lib/api';
import { formatSum } from './ui';
import { cleanDecimalInput } from './numeric';
import { Sheet, SheetError, Spinner } from './waiter/Sheet';
import { IconBag, IconCheck, IconMinus, IconPlus, IconScissors } from './waiter/icons';
import { formatKg, orderFullName, qtyText } from './waiter/orderUi';
import { checkNumber } from './cashier/orderType';

// "✂ Hisobni bo‘lish" (B18): hisobdagi taomlardan (miqdori bilan) tanlab, shu stolda YANGI hisobga
// (Hisob 2, 3 …) yoki shu stoldagi boshqa ochiq hisobga ko'chirish — POST /orders/:id/split.
// Kassa ham, ofitsiant ekrani ham (OrderActionsBar) shu oynani ochadi. Tekshiruvlar server bilan
// bir xil: kamida bitta taom qolishi, dona — butun son, to'langan summadan kam qolmasligi.
// Oshxonaga chek chiqmaydi (taomlar allaqachon yuborilgan).
export interface SplitCheckModalProps {
  /** bo'linadigan hisob (faqat 'stol' turidagi ochiq buyurtma) */
  order: Order;
  /** shu stoldagi boshqa ochiq hisoblar — ko'chirish manzili sifatida tanlash uchun */
  siblings?: Order[];
  onClose: () => void;
  /** muvaffaqiyatli bo'lingandan keyin: qolgan hisob (source) va yangi/boshqa hisob (target) */
  onDone: (result: SplitOrderResult) => void;
}

const EPS = 1e-9;
/** kg: qo'lda kiritishda 3 xona; "Hammasi" — qatorning aniq miqdori */
const KG_DECIMALS = 3;

const isKg = (it: OrderItem) => it.unit === MenuUnit.Weight;
const roundQty = (n: number) => Math.round(n * 1e6) / 1e6;

function parseQty(text: string | undefined, kg: boolean): number {
  const s = String(text ?? '').trim();
  if (!s) return 0;
  const n = Number(kg ? cleanDecimalInput(s, 6) : s);
  return Number.isFinite(n) ? n : NaN;
}

const SPLIT_KEEP_ONE = 'Hisobda kamida bitta taom qolishi kerak';
const SPLIT_QTY_INVALID = 'Ko‘chiriladigan miqdor noto‘g‘ri';
const BELOW_PAID = 'Qolgan summa to‘langan summadan kam bo‘lib qoladi';

export default function SplitCheckModal({ order, siblings, onClose, onDone }: SplitCheckModalProps) {
  const [cur, setCur] = useState<Order>(order);
  const [paid, setPaid] = useState(() => roundSum(order.paidAmount ?? 0));
  const [qty, setQty] = useState<Record<string, string>>({});
  // '' — yangi hisob; aks holda shu stoldagi boshqa ochiq hisob id'si
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Eng yangi taomlar va to'langan summa (ofitsiant taom qo'shgan / qisman to'langan bo'lishi mumkin)
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
        /* props'dagi nusxa bilan davom etamiz — server baribir tekshiradi */
      });
    return () => {
      off = true;
    };
  }, [order.id]);

  const items = cur.items ?? [];
  const dineIn = orderTypeOf(cur) === OrderType.DineIn && !!cur.tableId;
  const closed = cur.status === OrderStatus.Closed;
  // Shu stoldagi boshqa OCHIQ hisoblar (raqami bo'yicha)
  const others = useMemo(
    () =>
      (siblings ?? [])
        .filter((s) => s.id !== cur.id && s.status !== OrderStatus.Closed && orderTypeOf(s) === OrderType.DineIn && s.tableId === cur.tableId)
        .sort((a, b) => checkNumber(a) - checkNumber(b)),
    [siblings, cur.id, cur.tableId],
  );
  // Yangi hisob raqami — server qoidasi: stoldagi ochiq hisoblarning eng kattasi + 1
  const newCheckNo = Math.max(checkNumber(cur), ...others.map(checkNumber)) + 1;
  const targetOrder = others.find((o) => o.id === target) ?? null;
  // Tanlangan hisob boshqa joyda yopilsa — yangi hisobga qaytamiz
  useEffect(() => {
    if (target && !others.some((o) => o.id === target)) setTarget('');
  }, [others, target]);

  const plan = useMemo(() => {
    let invalid = false;
    const moved: { it: OrderItem; q: number; full: boolean }[] = [];
    const left: { price: number; quantity: number; takeaway: boolean }[] = [];
    for (const it of items) {
      const lineQty = Number(it.quantity) || 0;
      const q = parseQty(qty[it.id], isKg(it));
      if (!Number.isFinite(q) || q < 0 || q > lineQty + EPS || (!isKg(it) && !Number.isInteger(q))) {
        invalid = true;
        left.push({ price: Number(it.price ?? 0), quantity: lineQty, takeaway: !!it.takeaway });
        continue;
      }
      if (q > 0) moved.push({ it, q: Math.min(q, lineQty), full: Math.abs(q - lineQty) < EPS });
      const rest = roundQty(lineQty - q);
      if (rest > EPS) left.push({ price: Number(it.price ?? 0), quantity: rest, takeaway: !!it.takeaway });
    }
    const movedLines = moved.map((m) => ({ price: Number(m.it.price ?? 0), quantity: m.q, takeaway: !!m.it.takeaway }));
    // Qoladigan hisob — o'z foizlari bilan
    const sourceAfter = calcOrderTotals(left, cur.discountPercent, cur.servicePercent).total;
    // Ko'chadigan taomlar — qabul qiluvchi hisob foizlari bilan (yangi hisob manbadan meros oladi)
    const tgt = targetOrder ?? cur;
    const movedTotal = calcOrderTotals(movedLines, tgt.discountPercent, tgt.servicePercent).total;
    const targetAfter = targetOrder
      ? calcOrderTotals(
          [
            ...(targetOrder.items ?? []).map((it) => ({ price: Number(it.price ?? 0), quantity: Number(it.quantity) || 0, takeaway: !!it.takeaway })),
            ...movedLines,
          ],
          targetOrder.discountPercent,
          targetOrder.servicePercent,
        ).total
      : movedTotal;
    return { invalid, moved, left, sourceAfter, movedTotal, targetAfter };
  }, [items, qty, cur, targetOrder]);

  // Server bilan bir xil qoidalar
  let block = '';
  if (!dineIn) block = 'Faqat stol hisobini bo‘lish mumkin';
  else if (closed) block = 'Buyurtma yopilgan';
  else if (plan.invalid) block = SPLIT_QTY_INVALID;
  else if (plan.moved.length > 0 && plan.left.length === 0) block = SPLIT_KEEP_ONE;
  else if (plan.moved.length > 0 && paid > 0 && plan.sourceAfter < paid) block = BELOW_PAID;
  const hint = !block && plan.moved.length === 0 ? 'Ko‘chiriladigan taomni tanlang' : '';

  function setLine(it: OrderItem, value: string) {
    setError('');
    setQty((prev) => ({ ...prev, [it.id]: value }));
  }
  function step(it: OrderItem, delta: number) {
    const lineQty = Number(it.quantity) || 0;
    const v = parseQty(qty[it.id], false);
    const next = Math.min(lineQty, Math.max(0, Math.round((Number.isFinite(v) ? v : 0) + delta)));
    setLine(it, next > 0 ? String(next) : '');
  }
  function toggleAll(it: OrderItem) {
    const lineQty = roundQty(Number(it.quantity) || 0);
    const v = parseQty(qty[it.id], isKg(it));
    setLine(it, Math.abs(v - lineQty) < EPS ? '' : String(lineQty));
  }

  async function submit() {
    if (busy || block) return;
    if (hint) {
      setError(hint);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body: { items: { orderItemId: string; quantity: number }[]; targetOrderId?: string } = {
        items: plan.moved.map((m) => ({
          orderItemId: m.it.id,
          // To'liq qator — aniq miqdor (kg 6 xonali bo'lishi mumkin), qisman — kiritilgan
          quantity: m.full ? Number(m.it.quantity) : roundQty(m.q),
        })),
      };
      if (targetOrder) body.targetOrderId = targetOrder.id;
      const res = await api.post<SplitOrderResult>(`/orders/${cur.id}/split`, body);
      if (!alive.current) return;
      if (!res || !res.source || !res.target) throw new Error('Server javobi noto‘g‘ri');
      onDone(res);
    } catch (e) {
      if (alive.current) setError((e as Error)?.message || 'Hisob bo‘linmadi');
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  // Jismoniy klaviatura: Enter — "Ajratish" (matn maydonida emas)
  const live = useRef(submit);
  live.current = submit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      void live.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const movedCount = plan.moved.length;
  const targetName = targetOrder ? `Hisob ${checkNumber(targetOrder)}` : `Hisob ${newCheckNo}`;

  return (
    <Sheet
      title="Hisobni bo‘lish"
      subtitle={`${orderFullName(cur)} · ${formatSum(roundSum(cur.total ?? 0))}`}
      icon={<IconScissors className="w-6 h-6" />}
      iconTone="bg-primary/15 text-primary"
      size="xl"
      busy={busy}
      onClose={onClose}
      testId="split-modal"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-14 px-5 rounded-2xl bg-bg border border-border font-bold text-text hover:border-text disabled:opacity-50"
          >
            Bekor
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !!block}
            aria-disabled={!!hint || undefined}
            title={block || hint || undefined}
            data-testid="split-confirm"
            className={`flex-1 min-w-0 h-14 rounded-2xl bg-primary-hover text-white text-lg font-black flex items-center justify-center gap-2 shadow-lg shadow-primary/25 hover:brightness-110 active:scale-[0.98] transition-[transform,filter,opacity] disabled:opacity-40 disabled:shadow-none disabled:active:scale-100 ${
              hint ? 'opacity-60' : ''
            }`}
          >
            {busy ? <Spinner /> : <IconScissors className="w-6 h-6" />}
            <span className="truncate">
              Ajratish{movedCount > 0 ? ` → ${targetName}` : ''}
            </span>
          </button>
        </div>
      }
    >
      <div className="md:grid md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:gap-5 space-y-4 md:space-y-0">
        {/* Chap: taomlar va ko'chiriladigan miqdor */}
        <div className="min-w-0">
          <div className="text-sm font-extrabold uppercase tracking-wider text-muted mb-2">
            Ko‘chiriladigan taomlarni tanlang
          </div>
          {items.length === 0 ? (
            <div className="rounded-2xl border border-border bg-bg p-4 text-center text-muted">Hisobda taom yo‘q</div>
          ) : (
            <div className="rounded-2xl border border-border bg-bg divide-y divide-border overflow-hidden">
              {items.map((it) => (
                <SplitLine
                  key={it.id}
                  item={it}
                  value={qty[it.id] ?? ''}
                  onStep={(d) => step(it, d)}
                  onAll={() => toggleAll(it)}
                  onType={(v) => setLine(it, cleanDecimalInput(v, KG_DECIMALS))}
                  disabled={busy || closed}
                />
              ))}
            </div>
          )}
        </div>

        {/* O'ng: qayerga, natija */}
        <div className="min-w-0 space-y-3">
          <div>
            <div className="text-sm font-extrabold uppercase tracking-wider text-muted mb-2">Qaysi hisobga</div>
            <div role="radiogroup" aria-label="Qaysi hisobga" data-testid="split-target" className="grid gap-2">
              <TargetOption
                on={!targetOrder}
                testId="split-target-new"
                title={`Yangi hisob — Hisob ${newCheckNo}`}
                note="shu stolda alohida hisob ochiladi"
                onPick={() => setTarget('')}
                disabled={busy}
              />
              {others.map((o) => (
                <TargetOption
                  key={o.id}
                  on={targetOrder?.id === o.id}
                  testId={`split-target-check-${checkNumber(o)}`}
                  title={`Hisob ${checkNumber(o)}`}
                  note={`${(o.items ?? []).length} ta taom · ${formatSum(roundSum(o.total ?? 0))}`}
                  onPick={() => setTarget(o.id)}
                  disabled={busy}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl border border-border bg-bg px-3.5 py-2.5">
              <div className="text-xs font-extrabold uppercase tracking-wider text-muted">Qoladi</div>
              <div className="text-xl sm:text-2xl font-black text-text tabular-nums" data-testid="split-left-total">
                {formatSum(plan.sourceAfter)}
              </div>
              <div className="text-xs font-semibold text-muted">Hisob {checkNumber(cur)}</div>
            </div>
            <div
              className={`rounded-2xl border-2 px-3.5 py-2.5 transition-colors ${
                movedCount > 0 ? 'border-primary bg-primary/10' : 'border-border bg-bg'
              }`}
            >
              <div className={`text-xs font-extrabold uppercase tracking-wider ${movedCount > 0 ? 'text-primary' : 'text-muted'}`}>
                Ko‘chadi
              </div>
              <div className="text-xl sm:text-2xl font-black text-text tabular-nums" data-testid="split-moved-total">
                {formatSum(plan.movedTotal)}
              </div>
              <div className="text-xs font-semibold text-muted">
                {movedCount} ta taom → {targetName}
              </div>
            </div>
          </div>
          {targetOrder && movedCount > 0 && (
            <div className="text-sm font-semibold text-muted">
              {targetName} jami: {formatSum(roundSum(targetOrder.total ?? 0))} →{' '}
              <span className="text-text font-extrabold">{formatSum(plan.targetAfter)}</span>
            </div>
          )}
          {paid > 0 && (
            <div className="text-sm font-semibold text-muted">
              Bu hisobda to‘langan: <span className="text-success font-extrabold">{formatSum(paid)}</span> — qoladigan summa
              undan kam bo‘lmasligi kerak
            </div>
          )}
          <SheetError>{block || (error && error !== block ? error : '')}</SheetError>
          {!block && !error && (
            <div className="text-xs text-muted">Oshxonaga chek chiqmaydi — taomlar faqat hisoblar orasida ko‘chadi.</div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function TargetOption({
  on,
  title,
  note,
  onPick,
  testId,
  disabled,
}: {
  on: boolean;
  title: string;
  note: string;
  onPick: () => void;
  testId: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      disabled={disabled}
      data-testid={testId}
      className={`min-h-[56px] w-full rounded-2xl border-2 px-3.5 py-2 flex items-center gap-3 text-left transition-colors active:scale-[0.99] disabled:opacity-50 ${
        on ? 'bg-primary-hover border-primary-hover text-white' : 'bg-bg border-border text-text hover:border-primary'
      }`}
    >
      <span
        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
          on ? 'border-white bg-white text-primary-hover' : 'border-border'
        }`}
        aria-hidden
      >
        {on && <IconCheck className="w-4 h-4" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block font-extrabold leading-tight">{title}</span>
        <span className={`block text-xs font-semibold ${on ? 'text-white/85' : 'text-muted'}`}>{note}</span>
      </span>
    </button>
  );
}

/** Bitta taom qatori: nom, miqdor × narx, ko'chiriladigan miqdor (dona — −/+; kg — maydon), "Hammasi" */
function SplitLine({
  item,
  value,
  onStep,
  onAll,
  onType,
  disabled,
}: {
  item: OrderItem;
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
      data-testid={`split-line-${item.id}`}
      data-selected={on ? 'true' : 'false'}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 transition-colors ${on ? 'bg-primary/10' : ''}`}
    >
      <div className="min-w-0 flex-1 basis-[170px]">
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
      <div className="flex items-center gap-1.5">
        {kg ? (
          <label className="flex items-center gap-1">
            <input
              value={value}
              inputMode="decimal"
              disabled={disabled}
              onChange={(e) => onType(e.target.value)}
              placeholder="0"
              aria-label="Ko‘chiriladigan miqdor (kg)"
              data-testid={`split-qty-${item.id}`}
              className="w-24 h-12 px-2 rounded-xl bg-surface border-2 border-border focus:border-primary outline-none text-center text-lg font-extrabold text-text tabular-nums"
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
              data-testid={`split-minus-${item.id}`}
              className="w-12 h-12 rounded-xl border border-border bg-surface flex items-center justify-center text-text active:scale-90 disabled:opacity-35"
            >
              <IconMinus className="w-5 h-5" />
            </button>
            <span
              className={`min-w-[52px] text-center text-xl font-black tabular-nums ${on ? 'text-primary' : 'text-muted'}`}
              data-testid={`split-qty-${item.id}`}
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
              data-testid={`split-plus-${item.id}`}
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
          data-testid={`split-all-${item.id}`}
          className={`h-12 px-3 rounded-xl border-2 text-sm font-extrabold active:scale-95 disabled:opacity-40 ${
            full ? 'bg-primary-hover text-white border-primary-hover' : 'bg-bg text-text border-border hover:border-primary'
          }`}
        >
          {kg && full ? `${formatKg(lineQty)} kg` : 'Hammasi'}
        </button>
      </div>
    </div>
  );
}
