import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MenuUnit,
  OrderStatus,
  OrderType,
  SOCKET_EVENTS,
  calcOrderTotals,
  hasCapability,
  lineSum,
  normalizeUzPhone,
  orderTypeOf,
  remainingAmount,
  roundSum,
  sumPayments,
} from '@hardweb-pos/shared';
import type { Order, OrderItem, Payment, PaymentMethod, Receipt, SplitOrderResult } from '@hardweb-pos/shared';
import { ApiError, api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { usePosSettings } from '../lib/posSettings';
import { useAuth } from '../state/auth';
import { useConfirm } from '../state/confirm';
import { formatSum, formatTime, minutesSince } from './ui';
import { ReceiptPreview } from './ReceiptPreview';
import DeliveryInfoModal, { type DeliveryInfo } from './DeliveryInfoModal';
import OrderActionsBar from './OrderActionsBar';
import VoidModal from './VoidModal';
import { PercentField } from './cashier/PercentField';
import {
  OrderTypeBadge,
  OrderTypeIcon,
  TYPE_STYLE,
  dailyNumber,
  deliveryFeeOf,
  displayPhone,
  equalParts,
  formatAge,
  formatPercent,
  groupDigits,
  moneyLines,
  orderTitle,
  serviceLabel,
} from './cashier/orderType';
import { KIND_TINT, MethodIcon, activeMethods, methodKind, methodLabel } from './cashier/payMethods';
import { useMediaQuery } from './cashier/hooks';
import {
  AlertIcon,
  BagIcon,
  BanIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CloseIcon,
  PencilIcon,
  PercentIcon,
  PhoneIcon,
  PinIcon,
  PlusIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
} from './cashier/icons';
import { NumPad, applyNumKey } from './waiter/NumPad';
import type { NumKey } from './waiter/NumPad';
import { anySheetOpen } from './waiter/Sheet';
import { KeyboardToggle, TouchKeyboard, useTouchKeyboardPref } from './waiter/TouchKeyboard';
import { SentLineSheet, SentPriceModal } from './waiter/SentLineActions';
import { qtyText } from './waiter/orderUi';

// To'lov oynasi (B30 — eski POS'dagi "To‘lash" oynasi kabi): tepada katta "Jami", "To‘lash kerak" va
// (naqd ortiqcha berilsa) "Qaytim"; chapda faol to'lov usullari (har birida kiritilgan summa va "+"
// — qolganini shu usulga), o'ngda katta raqam klaviaturasi. Bir nechta usul bilan birdaniga to'lash
// mumkin (20 000 naqd + 8 620 Click) — bitta so'rov: POST /orders/:id/pay-multi. "Qarzga" — mijoz
// ismi (va telefoni). Chegirma / xizmat haqi (yig'iladigan bo'lim), "Teng bo'lish" (2/3/4 kishi).
// Kassa ham, ofitsiant ekranidagi "To'lov" tugmasi ham (kassa ruxsati) shu oynani ochadi.
// O'zi mustaqil ishlaydi: to'lovlarni yuklaydi, socket orqali buyurtma o'zgarishini kuzatadi.
// Hisob amallari (B22): Turi / Stol / Ofitsiant / Chek / Bo'lish (OrderActionsBar), har qatorda 🚫
// otkaz va "Hisobni bekor qilish" — faqat 'void' ruxsati bilan.
// Pul hisobi — shared/money (calcOrderTotals): server, chek va demo bilan aynan bir xil, butun so'mda.

export interface PayResult {
  order: Order;
  receipt?: Receipt;
  fullyPaid: boolean;
  paidAmount: number;
  total: number;
  payments: Payment[];
}

export interface PaymentModalProps {
  order: Order;
  onClose: () => void;
  /** har bir muvaffaqiyatli to'lovdan keyin (qisman yoki to'liq) */
  onPaid?: (result: PayResult) => void;
  /** chek printerga chiqarilganda (kassadagi "chek chiqmadi" ro'yxatidan o'chirish uchun) */
  onReceiptPrinted?: (receipt: Receipt) => void;
  /** shu stoldagi boshqa ochiq hisoblar (bo'lish / butun stolni ko'chirish) — berilmasa oyna o'zi yuklaydi */
  siblings?: Order[];
  /** hisob o'zgardi (tur, stol, ofitsiant, otkaz, narx, bo'lish): yangi holat; null — hisob bekor qilindi */
  onChanged?: (order: Order | null) => void;
}

/** Bitta to'lov qatori — GET /orders/:id/payments va pay javobi */
interface PaymentRow {
  id: string;
  type: string;
  amount: number;
  createdAt?: string;
  label?: string;
  cashierName?: string | null;
  debtorName?: string | null;
}

/** Kiritiladigan summa chegarasi (999 999 999 so'm) */
const MAX_DIGITS = 9;
const DEBTOR_REQUIRED = 'Qarzga yozish uchun mijoz ismini kiriting';
const PHONE_INVALID = 'Telefon raqami noto‘g‘ri (masalan: 90 123 45 67)';
const HAS_PAYMENTS = 'Bu hisobda to‘lov bor — avval to‘lovlarni o‘chiring';
/** Chegirma uchun tez foizlar */
const DISCOUNT_CHIPS = [0, 5, 10, 15, 20];

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const onlyDigits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');

function toRows(list: unknown): PaymentRow[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p === 'object')
    .map((p) => {
      const r = p as Partial<PaymentRow>;
      return {
        id: String(r.id ?? ''),
        type: String(r.type ?? 'naqd'),
        amount: roundSum(r.amount),
        createdAt: r.createdAt,
        label: r.label,
        cashierName: r.cashierName ?? null,
        debtorName: r.debtorName ?? null,
      };
    });
}

/**
 * Serverdan kelgan (socket / GET) buyurtmani joriy nusxa bilan birlashtirish: ba'zi javoblarda
 * zal, ofitsiant ismi yoki stol raqami bo'lmaydi — eskisini saqlab qolamiz.
 */
function mergeOrder(prev: Order, next: Order | null | undefined): Order {
  if (!next || next.id !== prev.id) return prev;
  return {
    ...prev,
    ...next,
    items: Array.isArray(next.items) ? next.items : prev.items,
    hall: next.hall ?? prev.hall,
    waiterName: next.waiterName ?? prev.waiterName,
    tableNumber: next.tableNumber ?? prev.tableNumber,
    customerName: next.customerName ?? prev.customerName,
  };
}

/** Mahalliy telefon (9 raqam) -> "90 123 45 67" */
function groupLocalPhone(d: string): string {
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
}

export default function PaymentModal({ order, onClose, onPaid, onReceiptPrinted, siblings, onChanged }: PaymentModalProps) {
  const confirm = useConfirm();
  const { user } = useAuth();
  const pos = usePosSettings();
  const kb = useTouchKeyboardPref();
  const narrow = useMediaQuery('(max-width: 767px)');
  const canVoid = hasCapability(user, 'void');
  const orderId = order.id;

  const [cur, setCur] = useState<Order>(order);
  // null — to'lovlar hali yuklanmagan (to'lash tugmasi kutadi)
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [paymentsError, setPaymentsError] = useState('');
  const [discount, setDiscount] = useState(() => num(order.discountPercent));
  const [service, setService] = useState(() => num(order.servicePercent));
  // Kassir foizni o'zgartirdimi — o'zgartirmagan bo'lsa serverga yuborilmaydi (B4: saqlangani ishlatiladi)
  const [discountDirty, setDiscountDirty] = useState(false);
  const [serviceDirty, setServiceDirty] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  // ---- To'lov usullari va summalar ----
  const methods = useMemo(() => activeMethods(pos.paymentMethods), [pos.paymentMethods]);
  const defaultKey = methods.find((m) => m.kind === 'cash')?.key ?? methods[0]?.key ?? 'naqd';
  const [selected, setSelected] = useState(defaultKey);
  // Usul kaliti -> kiritilgan summa (faqat raqamlar, butun so'm)
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // Usul tanlangach (yoki "+" / teng bo'lishdan keyin) birinchi raqam eski summani almashtiradi
  const freshRef = useRef(true);
  // Telefon maydoni bosilgach birinchi raqam oldingi (masalan yetkazish buyurtmasidan olingan) raqamni almashtiradi
  const phoneFreshRef = useRef(false);
  // Raqam klaviaturasi nimani yozadi: tanlangan usul summasini yoki qarzdor telefonini
  const [keyTarget, setKeyTarget] = useState<'amount' | 'phone'>('amount');
  const [debtorName, setDebtorName] = useState(() => order.customerName ?? '');
  const [debtorPhone, setDebtorPhone] = useState(() => {
    const d = onlyDigits(order.phone);
    return d.length === 12 && d.startsWith('998') ? d.slice(3) : d.length === 9 ? d : '';
  });
  const [nameActive, setNameActive] = useState(false);

  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [notice, setNotice] = useState('');
  const [gone, setGone] = useState(false);
  const [done, setDone] = useState<{ receipt: Receipt; change: number } | null>(null);
  const [exciseInputs, setExciseInputs] = useState<Record<string, string>>({});
  const [savingExcise, setSavingExcise] = useState(false);
  const [editDelivery, setEditDelivery] = useState(false);
  const [voidReq, setVoidReq] = useState<{ itemIds?: string[]; whole?: boolean } | null>(null);
  const [lineSheet, setLineSheet] = useState<OrderItem | null>(null);
  const [priceItem, setPriceItem] = useState<OrderItem | null>(null);
  const [loadedSiblings, setLoadedSiblings] = useState<Order[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const aliveRef = useRef(true);
  const payingRef = useRef(false);
  const doneRef = useRef(false);
  const confirmingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const subtotalRef = useRef<number | null>(null);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const curRef = useRef(cur);
  curRef.current = cur;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Sozlamadagi usullar o'zgarsa (direktor o'chirdi) — tanlangan usul ro'yxatda qolsin
  useEffect(() => {
    if (!methods.some((m) => m.key === selected)) setSelected(defaultKey);
  }, [methods, selected, defaultKey]);

  // Ota komponent yangiroq nusxa bersa (ro'yxat yangilandi) — birlashtiramiz
  useEffect(() => {
    setCur((prev) => mergeOrder(prev, order));
  }, [order]);

  // Foizlar: kassir o'zgartirmagan bo'lsa — buyurtmada saqlangan qiymatni ko'rsatamiz
  useEffect(() => {
    if (!discountDirty) setDiscount(num(cur.discountPercent));
  }, [cur.discountPercent, discountDirty]);
  useEffect(() => {
    if (!serviceDirty) setService(num(cur.servicePercent));
  }, [cur.servicePercent, serviceDirty]);

  // "Ochilganiga N daq" — har 30 s
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const loadPayments = useCallback(async () => {
    try {
      const rows = await api.get<PaymentRow[]>(`/orders/${orderId}/payments`);
      if (!aliveRef.current) return;
      setPayments(toRows(rows));
      setPaymentsError('');
    } catch (e) {
      if (!aliveRef.current) return;
      setPaymentsError((e as Error)?.message || 'To‘lovlar yuklanmadi');
    }
  }, [orderId]);

  // Buyurtmaning eng yangi holati (taomlar, foizlar). Bekor qilingan (o'chirilgan) yoki boshqa
  // joyda yopilgan bo'lsa — to'lov qabul qilinmaydi.
  const reloadOrder = useCallback(async () => {
    try {
      const fresh = await api.get<Order>(`/orders/${orderId}`);
      if (!aliveRef.current || doneRef.current) return;
      if (fresh && fresh.status === OrderStatus.Closed && !payingRef.current) setGone(true);
      if (fresh && Array.isArray(fresh.items)) setCur((prev) => mergeOrder(prev, fresh));
    } catch (e) {
      if (!aliveRef.current || doneRef.current) return;
      if (e instanceof ApiError && e.status === 404 && !payingRef.current) setGone(true);
    }
  }, [orderId]);

  // Shu stoldagi boshqa ochiq hisoblar (ota bermagan bo'lsa) — bo'lish va "butun stol" ko'chirish uchun.
  // Ota har renderda yangi massiv berishi mumkin — bog'liqlik faqat "berilganmi" belgisiga (socket
  // obunalari har renderda qayta ulanmasin).
  const siblingsProvided = siblings !== undefined;
  const loadSiblings = useCallback(async () => {
    const c = curRef.current;
    if (siblingsProvided || orderTypeOf(c) !== OrderType.DineIn || !c.tableId) return;
    try {
      const list = await api.get<Order[]>('/orders?type=stol');
      if (!aliveRef.current) return;
      const tableId = curRef.current.tableId;
      setLoadedSiblings(
        (Array.isArray(list) ? list : []).filter(
          (o) => o.id !== orderId && o.tableId === tableId && o.status !== OrderStatus.Closed && orderTypeOf(o) === OrderType.DineIn,
        ),
      );
    } catch {
      /* ixtiyoriy ma'lumot — xato bo'lsa bo'lish faqat yangi hisobga */
    }
  }, [siblingsProvided, orderId]);

  useEffect(() => {
    loadPayments();
    reloadOrder();
  }, [loadPayments, reloadOrder]);

  useEffect(() => {
    void loadSiblings();
  }, [loadSiblings, cur.tableId, cur.type]);

  // Real-time: shu buyurtma o'zgarsa — qayta yuklaymiz; boshqa joyda yopilsa — ogohlantiramiz
  useEffect(() => {
    const socket = getSocket();
    let timer: number | undefined;
    let sibTimer: number | undefined;
    const sync = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (payingRef.current || doneRef.current) return;
        reloadOrder();
        loadPayments();
      }, 150);
    };
    const syncSiblings = (o: Order | undefined) => {
      if (!o || !curRef.current.tableId || o.tableId !== curRef.current.tableId || o.id === orderId) return;
      window.clearTimeout(sibTimer);
      sibTimer = window.setTimeout(() => void loadSiblings(), 250);
    };
    const onUpdated = (p: { orderId?: string; order?: Order } | undefined) => {
      const id = p?.order?.id ?? p?.orderId;
      if (id !== orderId) {
        syncSiblings(p?.order);
        return;
      }
      if (doneRef.current) return;
      if (p?.order && Array.isArray(p.order.items)) setCur((prev) => mergeOrder(prev, p.order));
      sync();
    };
    const onCreated = (p: { order?: Order } | undefined) => syncSiblings(p?.order);
    const onClosed = (p: { order?: Order } | undefined) => {
      if (p?.order?.id !== orderId) {
        syncSiblings(p?.order);
        return;
      }
      if (doneRef.current || payingRef.current) return;
      setGone(true);
    };
    const onConnect = () => {
      sync();
      void loadSiblings();
    };
    socket.on(SOCKET_EVENTS.ORDER_UPDATED, onUpdated);
    socket.on(SOCKET_EVENTS.ORDER_CREATED, onCreated);
    socket.on(SOCKET_EVENTS.ORDER_CLOSED, onClosed);
    socket.on('connect', onConnect);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(sibTimer);
      socket.off(SOCKET_EVENTS.ORDER_UPDATED, onUpdated);
      socket.off(SOCKET_EVENTS.ORDER_CREATED, onCreated);
      socket.off(SOCKET_EVENTS.ORDER_CLOSED, onClosed);
      socket.off('connect', onConnect);
    };
  }, [orderId, reloadOrder, loadPayments, loadSiblings]);

  // ---- Pul hisobi (shared/money — server bilan bir xil, butun so'm) ----
  const items = cur.items ?? [];
  const type = orderTypeOf(cur);
  const dineIn = type === OrderType.DineIn;
  const fee = deliveryFeeOf(cur);
  const totals = useMemo(
    () => calcOrderTotals(moneyLines(cur.items), discount, service, fee),
    [cur.items, discount, service, fee],
  );
  const paid = payments ? sumPayments(payments) : roundSum(cur.paidAmount ?? 0);
  const remaining = remainingAmount(totals.total, paid);
  const overpaid = paid > totals.total;
  const ready = payments !== null;
  const pendingExcise = items.filter((it) => it.exciseRequired && !it.exciseCode);
  const hasItems = items.length > 0;
  // Oldingi to'lovlar jami summani qoplagan (yoki hisob 0 so'm) — yangi to'lovsiz "Hisobni yopish"
  const canSettle = ready && !gone && hasItems && remaining <= 0 && !overpaid;
  const siblingList = siblings ?? loadedSiblings;

  // Kiritilgan summalar -> yuboriladigan to'lovlar. Hech narsa kiritilmagan bo'lsa — qolgan summa
  // to'liq tanlangan usul bilan (Enter bilan tez to'lash). Naqd ortiqcha berilsa — qaytim; karta /
  // onlayn summa qoldiqdan oshmasligi kerak (qaytim faqat naqddan beriladi).
  const calc = useMemo(() => {
    const entries = methods
      .map((m) => ({ m, amount: Math.max(0, Math.round(Number(amounts[m.key] || 0))) }))
      .filter((e) => e.amount > 0);
    const entered = entries.reduce((s, e) => s + e.amount, 0);
    const nonCash = entries.filter((e) => e.m.kind !== 'cash').reduce((s, e) => s + e.amount, 0);
    const implicit = entered === 0;
    const nonCashOver = nonCash > remaining;
    const change = !implicit && !nonCashOver ? Math.max(0, entered - remaining) : 0;
    let plan: { type: string; amount: number }[];
    if (implicit) {
      plan = remaining > 0 ? [{ type: selected, amount: remaining }] : [];
    } else {
      plan = entries.map((e) => ({ type: e.m.key, amount: e.amount }));
      // Qaytim naqd summadan ayriladi (serverga faqat qolgan summagacha yuboriladi)
      let excess = change;
      for (let i = plan.length - 1; i >= 0 && excess > 0; i--) {
        if (methods.find((m) => m.key === plan[i].type)?.kind !== 'cash') continue;
        const d = Math.min(excess, plan[i].amount);
        plan[i] = { ...plan[i], amount: plan[i].amount - d };
        excess -= d;
      }
      plan = plan.filter((p) => p.amount > 0);
    }
    const planSum = plan.reduce((s, p) => s + p.amount, 0);
    const toPay = Math.max(0, remaining - entered);
    const debt = plan.some((p) => methodKind(methods, p.type) === 'debt');
    return { entered, implicit, nonCashOver, change, plan, planSum, toPay, debt };
  }, [methods, amounts, remaining, selected]);

  const selectedMethod = methods.find((m) => m.key === selected) ?? methods[0];
  const showDebtor = calc.debt || selectedMethod?.kind === 'debt';
  const payDisabled =
    paying || !ready || gone || !hasItems || pendingExcise.length > 0 || remaining <= 0 || calc.planSum <= 0 || calc.nonCashOver;
  const shares = !canSettle && remaining > 0 ? [2, 3, 4].map((n) => ({ n, parts: equalParts(remaining, n) })).filter((s) => s.parts.length > 0) : [];

  // Qarzdor bo'limi yopilsa — klaviatura yana summani yozadi
  useEffect(() => {
    if (!showDebtor && keyTarget === 'phone') setKeyTarget('amount');
  }, [showDebtor, keyTarget]);

  // Ofitsiant taom qo'shdi/olib tashladi — summa o'zgarganini bildiramiz (o'z amallarimizda emas)
  useEffect(() => {
    const prev = subtotalRef.current;
    subtotalRef.current = totals.subtotal;
    if (prev !== null && prev !== totals.subtotal && !payingRef.current && !doneRef.current) {
      setNotice(`Buyurtma o‘zgardi — summa yangilandi (${formatSum(totals.subtotal)})`);
    }
  }, [totals.subtotal]);

  /** O'zimiz qilgan o'zgarish (otkaz, narx, bo'lish, tur…) — "buyurtma o'zgardi" ogohlantirishisiz qo'llash */
  function applyOwn(next: Order) {
    if (!next || next.id !== orderId) return;
    subtotalRef.current = calcOrderTotals(moneyLines(next.items)).subtotal;
    setCur((prev) => mergeOrder(prev, next));
    setNotice('');
  }

  function close() {
    if (payingRef.current) return;
    onCloseRef.current();
  }

  // ---- Raqam klaviaturasi ----
  function pressKey(k: NumKey) {
    if (paying || gone) return;
    setError('');
    setFlash('');
    if (keyTarget === 'phone') {
      const replace = phoneFreshRef.current && k !== 'back';
      phoneFreshRef.current = false;
      setDebtorPhone((p) => {
        if (k === 'back') return p.slice(0, -1);
        if (k === ',') return p;
        return ((replace ? '' : p) + k).replace(/\D/g, '').slice(0, 9);
      });
      return;
    }
    // Birinchi raqam eski summani almashtiradi (o'chirish tugmasi esa oxirgi raqamni o'chiradi)
    const isFresh = freshRef.current && k !== 'back';
    freshRef.current = false;
    const key = selected;
    setAmounts((prev) => {
      const base = isFresh ? '' : prev[key] ?? '';
      const next = applyNumKey(base, k, { maxDigits: MAX_DIGITS });
      return { ...prev, [key]: next === '0' ? '' : next };
    });
  }

  function clearSelected() {
    setError('');
    if (keyTarget === 'phone') {
      setDebtorPhone('');
      return;
    }
    freshRef.current = true;
    setAmounts((prev) => ({ ...prev, [selected]: '' }));
  }

  function selectMethod(m: PaymentMethod) {
    setSelected(m.key);
    setKeyTarget('amount');
    setNameActive(false);
    freshRef.current = true;
    setError('');
  }

  // "+" — qolgan summani (boshqa usullarga kiritilgandan keyin) shu usulga
  function fillMethod(m: PaymentMethod) {
    selectMethod(m);
    const others = methods.filter((x) => x.key !== m.key).reduce((s, x) => s + (Number(amounts[x.key]) || 0), 0);
    const need = Math.max(0, remaining - others);
    setAmounts((prev) => ({ ...prev, [m.key]: need > 0 ? String(need) : '' }));
  }

  // Teng bo'lish: tanlangan usulga bitta ulush (boshqa usullardagi summalar tozalanadi)
  function applyShare(amount: number) {
    setKeyTarget('amount');
    freshRef.current = true;
    setError('');
    setAmounts({ [selected]: String(amount) });
  }

  function percentsBody() {
    return {
      ...(discountDirty ? { discountPercent: discount } : {}),
      ...(serviceDirty ? { serviceFeePercent: service } : {}),
    };
  }

  /** Qarzdor ma'lumoti — tekshiruv (server bilan bir xil); xato bo'lsa matn */
  function debtorProblem(): string {
    if (!calc.debt) return '';
    if (!debtorName.trim()) return DEBTOR_REQUIRED;
    if (debtorPhone && !normalizeUzPhone(debtorPhone)) return PHONE_INVALID;
    return '';
  }

  async function submit() {
    if (payDisabled || payingRef.current) return;
    const problem = debtorProblem();
    if (problem) {
      setError(problem);
      if (problem === DEBTOR_REQUIRED) {
        setNameActive(true);
        window.setTimeout(() => nameRef.current?.focus(), 0);
      } else setKeyTarget('phone');
      return;
    }
    const plan = calc.plan;
    const changeGiven = calc.change;
    payingRef.current = true;
    setPaying(true);
    setError('');
    setFlash('');
    setNotice('');
    const debtor = calc.debt
      ? { name: debtorName.trim(), ...(debtorPhone ? { phone: normalizeUzPhone(debtorPhone) ?? debtorPhone } : {}) }
      : undefined;
    const labels = plan.map((p) => methodLabel(methods, p.type)).join(' + ');
    const sum = plan.reduce((s, p) => s + p.amount, 0);
    try {
      let res: PayResult;
      try {
        res = await api.post<PayResult>(`/orders/${orderId}/pay-multi`, {
          payments: plan,
          ...percentsBody(),
          ...(debtor ? { debtor } : {}),
        });
      } catch (e) {
        // Eski server (pay-multi yo'q) — bitta usul bo'lsa oddiy to'lov yo'li
        if (e instanceof ApiError && e.status === 404 && plan.length === 1 && /cannot|not found/i.test(e.message)) {
          res = await api.post<PayResult>(`/orders/${orderId}/pay`, {
            type: plan[0].type,
            amount: plan[0].amount,
            ...percentsBody(),
            ...(debtor ? { debtor } : {}),
          });
        } else throw e;
      }
      applyResult(res, changeGiven, `✓ ${formatSum(sum)} qabul qilindi — ${labels}`);
    } catch (e) {
      if (aliveRef.current) setError((e as Error)?.message || 'To‘lov o‘tmadi');
      // Hisob holati o'zgargan bo'lishi mumkin (boshqa joyda to'langan / taom qo'shilgan)
      payingRef.current = false;
      reloadOrder();
      loadPayments();
    } finally {
      payingRef.current = false;
      if (aliveRef.current) setPaying(false);
    }
  }

  // Hisobni yangi to'lovsiz yopish: oldingi to'lovlar jami summani qoplagan yoki to'lanadigan
  // summa 0 so'm (100% chegirma). Server hisobni yopadi va chekni oldingi to'lovlar bilan qaytaradi.
  async function settle() {
    if (!canSettle || payingRef.current || pendingExcise.length > 0) return;
    payingRef.current = true;
    setPaying(true);
    setError('');
    setFlash('');
    try {
      const res = await api.post<PayResult>(`/orders/${orderId}/pay-multi`, { payments: [], ...percentsBody() });
      applyResult(res, 0, '');
    } catch (e) {
      if (aliveRef.current) setError((e as Error)?.message || 'Hisob yopilmadi');
      payingRef.current = false;
      reloadOrder();
      loadPayments();
    } finally {
      payingRef.current = false;
      if (aliveRef.current) setPaying(false);
    }
  }

  // To'lov javobi: to'liq — chek oynasi; qisman — hisob ochiq qoladi, yangi holat ko'rsatiladi
  function applyResult(res: PayResult, changeGiven: number, flashText: string) {
    try {
      onPaidRef.current?.(res);
    } catch {
      /* ota komponent xatosi to'lov oqimini buzmasin */
    }
    if (!aliveRef.current) return;
    if (res?.fullyPaid) {
      doneRef.current = true;
      if (res.receipt) setDone({ receipt: res.receipt, change: changeGiven });
      else onCloseRef.current();
      return;
    }
    if (Array.isArray(res?.payments)) setPayments(toRows(res.payments));
    else loadPayments();
    if (res?.order && Array.isArray(res.order.items)) applyOwn(res.order);
    setDiscountDirty(false);
    setServiceDirty(false);
    setAmounts({});
    freshRef.current = true;
    setKeyTarget('amount');
    if (flashText) setFlash(flashText);
  }

  async function removePayment(p: PaymentRow) {
    if (payingRef.current) return;
    confirmingRef.current = true;
    let ok = false;
    try {
      ok = await confirm({
        title: 'To‘lovni o‘chirish',
        message: `${p.label || methodLabel(methods, p.type)} — ${formatSum(p.amount)} to‘lovi o‘chirilsinmi? Summa qoldiqqa qaytadi.`,
        confirmText: 'O‘chirish',
        danger: true,
      });
    } finally {
      confirmingRef.current = false;
    }
    if (!ok || !aliveRef.current) return;
    setError('');
    setFlash('');
    try {
      await api.del(`/orders/${orderId}/payments/${p.id}`);
    } catch (e) {
      if (aliveRef.current) setError((e as Error)?.message || 'To‘lov o‘chirilmadi');
    }
    loadPayments();
    reloadOrder();
  }

  async function saveExcise() {
    const codes = pendingExcise
      .map((it) => ({ orderItemId: it.id, code: (exciseInputs[it.id] || '').trim() }))
      .filter((c) => c.code.length > 0);
    if (codes.length === 0 || savingExcise) return;
    setSavingExcise(true);
    setError('');
    try {
      const updated = await api.post<Order>(`/orders/${orderId}/excise`, { codes });
      if (!aliveRef.current) return;
      if (updated && Array.isArray(updated.items)) setCur((prev) => mergeOrder(prev, updated));
      setExciseInputs({});
    } catch (e) {
      if (aliveRef.current) setError((e as Error)?.message || 'Aksiz kodlari saqlanmadi');
    } finally {
      if (aliveRef.current) setSavingExcise(false);
    }
  }

  // Yetkazish: telefon/manzil/izoh/yetkazish narxi (PATCH /orders/:id/delivery). Xato bo'lsa —
  // oyna ochiq qoladi va xabar ko'rsatadi (xato DeliveryInfoModal'ga qaytariladi).
  async function saveDelivery(info: DeliveryInfo) {
    const updated = await api.patch<Order>(`/orders/${orderId}/delivery`, {
      phone: info.phone,
      address: info.address,
      note: info.note,
      deliveryFee: info.deliveryFee,
    });
    if (!aliveRef.current) return;
    if (updated && updated.id === orderId) {
      applyOwn(updated);
      onChangedRef.current?.(updated);
    }
    setEditDelivery(false);
  }

  // Hisob amallari natijasi (OrderActionsBar, otkaz, narx): null — hisob bekor qilindi (oyna yopiladi)
  function handleChanged(next: Order | null) {
    try {
      onChangedRef.current?.(next);
    } catch {
      /* ota komponent xatosi oynani buzmasin */
    }
    if (!aliveRef.current) return;
    if (!next) {
      doneRef.current = true;
      onCloseRef.current();
      return;
    }
    applyOwn(next);
    loadPayments();
    void loadSiblings();
  }

  function handleSplit(r: SplitOrderResult) {
    try {
      onChangedRef.current?.(r.source);
    } catch {
      /* e'tiborsiz */
    }
    if (!aliveRef.current) return;
    applyOwn(r.source);
    setFlash(`✓ Hisob bo‘lindi — ajratilgan taomlar: Hisob ${r.target?.checkNo ?? ''}`.trim());
    loadPayments();
    void loadSiblings();
  }

  function askWholeCancel() {
    if (paid > 0) {
      setError(HAS_PAYMENTS);
      return;
    }
    setVoidReq({ whole: true });
  }

  // Klaviatura: raqamlar / ⌫ / Delete — klaviatura; Enter — to'lash (yoki "Hisobni yopish"); Esc — yopish.
  // Ichki oyna (otkaz, bo'lish, tur…) ochiq bo'lsa — hech narsa qilinmaydi.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || doneRef.current || editDelivery || confirmingRef.current || anySheetOpen()) return;
      if (voidReq || lineSheet || priceItem) return;
      if (e.key === 'Escape') {
        close();
        return;
      }
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName ?? '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (t && t !== document.body && panelRef.current && !panelRef.current.contains(t)) return;
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          pressKey(e.key as NumKey);
          return;
        }
        if (e.key === 'Backspace') {
          e.preventDefault();
          pressKey('back');
          return;
        }
        if (e.key === 'Delete') {
          e.preventDefault();
          clearSelected();
          return;
        }
      }
      if (e.key !== 'Enter' || e.isComposing) return;
      // Tugma fokusda bo'lsa — Enter o'sha tugmani bosadi; aksiz maydoni o'zi saqlaydi
      if (tag === 'BUTTON' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'A') return;
      if (t?.dataset?.excise) return;
      e.preventDefault();
      if (canSettle) void settle();
      else void submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- To'liq to'landi — chek (va naqdda qaytim) ----
  if (done) {
    return createPortal(
      <ReceiptPreview
        receipt={done.receipt}
        change={done.change}
        afterPayment
        onPrinted={() => onReceiptPrinted?.(done.receipt)}
        onClose={() => onCloseRef.current()}
      />,
      document.body,
    );
  }

  const style = TYPE_STYLE[type];
  const minutes = minutesSince(cur.openedAt, now);
  const showDelivery = type === OrderType.Delivery;
  const no = dineIn ? dailyNumber(cur) : null;
  const submitLabel = calc.implicit
    ? `To‘lash — ${formatSum(remaining)}`
    : calc.planSum < remaining
      ? `Qisman to‘lash — ${formatSum(calc.planSum)}`
      : `To‘lash — ${formatSum(calc.planSum)}`;
  const submitHint =
    calc.plan.length === 1
      ? methodLabel(methods, calc.plan[0].type)
      : calc.plan.length > 1
        ? `${calc.plan.length} usul`
        : '';
  const touchNoSystemKb = kb.touch && kb.show;

  // ---- Chap ustun: buyurtma (taomlar, aksiz, summalar, amallar) ----
  const orderSection = (
    <section className="order-2 md:order-1 md:w-[42%] md:min-h-0 md:overflow-y-auto md:flex md:flex-col md:border-r border-border">
      <div className="px-4 sm:px-5 pt-3 pb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-extrabold uppercase tracking-wider text-muted">Buyurtma · {items.length} ta taom</span>
        {canVoid && hasItems && !gone && (
          <span className="text-[11px] font-semibold text-muted">qatorni bosing — otkaz / narx</span>
        )}
      </div>
      <div className="mx-4 sm:mx-5 max-h-[40vh] md:max-h-none md:flex-1 md:min-h-[120px] overflow-y-auto rounded-xl border border-border bg-bg divide-y divide-border">
        {items.length === 0 ? (
          <div className="p-4 text-sm text-muted text-center">Buyurtmada taom yo‘q</div>
        ) : (
          items.map((it) => (
            <PayLine
              key={it.id}
              item={it}
              canVoid={canVoid && !gone && !paying}
              onOpen={() => setLineSheet(it)}
              onVoid={() => setVoidReq({ itemIds: [it.id] })}
            />
          ))
        )}
      </div>

      <div className="px-4 sm:px-5 py-3 space-y-2.5 md:shrink-0">
        {/* Aksiz kodlarini skanerlash (TZ F-8.5/8.6) */}
        {pendingExcise.length > 0 && (
          <div className="bg-warning/10 border border-warning/40 rounded-xl p-3">
            <div className="font-bold text-warning mb-2">Aksiz kodi skanerlanishi kerak</div>
            <div className="space-y-2">
              {pendingExcise.map((it, idx) => (
                <div key={it.id} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-text">{it.menuItemName}</span>
                  <input
                    autoFocus={idx === 0}
                    data-excise="1"
                    value={exciseInputs[it.id] || ''}
                    onChange={(e) => setExciseInputs((p) => ({ ...p, [it.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        saveExcise();
                      }
                    }}
                    placeholder="Kodni skanerlang"
                    className="flex-[2] min-w-0 h-11 px-3 rounded-lg bg-bg border border-border outline-none focus:border-primary"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={saveExcise}
              disabled={savingExcise}
              className="mt-2 h-11 px-4 rounded-lg bg-surface border border-border font-semibold hover:border-primary disabled:opacity-50"
            >
              {savingExcise ? 'Saqlanmoqda…' : 'Aksiz kodlarini saqlash'}
            </button>
          </div>
        )}

        <div className="rounded-xl border border-border bg-bg px-3 py-2.5 space-y-1">
          <SumRow label="Mahsulotlar" value={formatSum(totals.subtotal)} />
          {totals.discountAmount > 0 && (
            <SumRow label={`Chegirma ${formatPercent(totals.discountPercent)}%`} value={`− ${formatSum(totals.discountAmount)}`} tone="text-danger" />
          )}
          {totals.serviceAmount > 0 && <SumRow label={serviceLabel(totals)} value={`+ ${formatSum(totals.serviceAmount)}`} />}
          {totals.deliveryFee > 0 && <SumRow label="Yetkazish narxi" value={`+ ${formatSum(totals.deliveryFee)}`} />}
          <div className="flex justify-between gap-3 pt-1 border-t border-border">
            <span className="font-extrabold text-text">Jami</span>
            <span className="font-black text-text tabular-nums">{formatSum(totals.total)}</span>
          </div>
        </div>

        {!gone && (
          <OrderActionsBar
            order={cur}
            siblings={siblingList}
            compact
            hide={['void']}
            blocked={paying ? 'To‘lov yuborilmoqda — biroz kuting' : null}
            onChanged={handleChanged}
            onSplit={handleSplit}
          />
        )}
        {canVoid && !gone && hasItems && (
          <button
            type="button"
            onClick={askWholeCancel}
            disabled={paying}
            aria-disabled={paid > 0 || undefined}
            title={paid > 0 ? HAS_PAYMENTS : 'Butun hisobni bekor qilish (otkaz)'}
            data-testid="pay-cancel-order"
            className={`w-full h-12 rounded-xl border-2 border-danger/70 text-danger font-extrabold flex items-center justify-center gap-2 hover:bg-danger/10 active:scale-[0.98] disabled:opacity-50 ${
              paid > 0 ? 'opacity-50' : ''
            }`}
          >
            <BanIcon className="w-5 h-5" /> Hisobni bekor qilish
          </button>
        )}
      </div>
    </section>
  );

  // ---- O'ng ustun: to'lov ----
  const paySection = (
    <section className="order-1 md:order-2 md:flex-1 md:min-h-0 md:overflow-y-auto px-4 sm:px-5 pb-4 pt-3 space-y-3">
      {/* Jami / To'lash kerak / Qaytim */}
      <div className={`grid gap-2 ${calc.change > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="rounded-2xl border border-border bg-bg px-3 py-2.5 min-w-0">
          <div className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wider text-muted">Jami</div>
          <div className="text-2xl sm:text-3xl font-black text-text tabular-nums truncate" data-testid="pay-total">
            {formatSum(totals.total)}
          </div>
          {paid > 0 && (
            <div className="text-xs font-bold text-success truncate">To‘langan: {formatSum(paid)}</div>
          )}
        </div>
        <div
          className={`rounded-2xl border-2 px-3 py-2.5 min-w-0 ${
            remaining <= 0 || calc.toPay === 0 ? 'border-success bg-success/10' : 'border-primary bg-primary/10'
          }`}
        >
          <div className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wider text-muted">To‘lash kerak</div>
          <div className="text-2xl sm:text-3xl font-black text-text tabular-nums truncate" data-testid="pay-due">
            {formatSum(calc.implicit ? remaining : calc.toPay)}
          </div>
          {paid > 0 && (
            <div className="text-xs font-bold text-muted truncate" data-testid="pay-remaining">
              Qoldiq: {formatSum(remaining)}
            </div>
          )}
        </div>
        {calc.change > 0 && (
          <div className="rounded-2xl bg-success text-black px-3 py-2.5 min-w-0 animate-pop-in">
            <div className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wider">Qaytim</div>
            <div className="text-2xl sm:text-3xl font-black tabular-nums truncate" data-testid="pay-change">
              {formatSum(calc.change)}
            </div>
          </div>
        )}
      </div>
      {!ready && (
        <div className="text-xs text-muted">
          {paymentsError ? (
            <span className="text-danger font-semibold">
              To‘lovlar yuklanmadi: {paymentsError}{' '}
              <button type="button" onClick={loadPayments} className="underline font-bold">
                Qayta urinish
              </button>
            </span>
          ) : (
            'To‘lovlar yuklanmoqda…'
          )}
        </div>
      )}

      {/* Oldingi (qisman) to'lovlar */}
      {payments && payments.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="pay-history">
          {payments.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 rounded-xl border border-success/40 bg-success/10 pl-2.5 pr-0.5 h-11 text-sm"
            >
              <MethodIcon kind={methodKind(methods, p.type)} className={`w-4 h-4 ${KIND_TINT[methodKind(methods, p.type)]}`} />
              <span className="font-bold text-text">{p.label || methodLabel(methods, p.type)}</span>
              {p.debtorName && <span className="text-xs font-semibold text-muted truncate max-w-[110px]">({p.debtorName})</span>}
              <span className="font-extrabold text-text tabular-nums">{formatSum(p.amount)}</span>
              {p.createdAt && <span className="text-[11px] text-muted">{formatTime(p.createdAt)}</span>}
              <button
                type="button"
                onClick={() => removePayment(p)}
                disabled={paying || gone}
                aria-label="To‘lovni o‘chirish"
                className="w-10 h-10 rounded-lg text-muted hover:text-danger hover:bg-danger/10 flex items-center justify-center disabled:opacity-40"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </span>
          ))}
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-sm font-semibold text-text">
          <AlertIcon className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Yopish" className="text-muted hover:text-text">
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {canSettle ? (
        /* Hisob to'liq qoplangan (yoki 0 so'm) — yangi to'lov kerak emas, faqat yopish */
        <div className="rounded-2xl border-2 border-success/60 bg-success/10 p-4 text-center animate-pop-in">
          <div className="text-lg font-extrabold text-success">
            {paid > 0 ? 'Hisob to‘liq to‘langan' : 'To‘lanadigan summa 0 so‘m'}
          </div>
          <div className="text-sm text-text mt-1">
            {paid > 0 ? 'Yangi to‘lov kerak emas — hisobni yoping, chek chiqadi.' : 'Hisob to‘lovsiz yopiladi — chek chiqadi.'}
          </div>
        </div>
      ) : (
        !gone && (
          <>
            {/* Usullar + klaviatura */}
            <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <div className="space-y-1.5" role="radiogroup" aria-label="To‘lov usuli">
                {methods.map((m) => (
                  <MethodRow
                    key={m.key}
                    method={m}
                    selected={selected === m.key && keyTarget === 'amount'}
                    current={selected === m.key}
                    amount={Number(amounts[m.key] || 0)}
                    hint={calc.implicit && selected === m.key ? remaining : 0}
                    disabled={paying}
                    onSelect={() => selectMethod(m)}
                    onFill={() => fillMethod(m)}
                  />
                ))}
              </div>
              <div className="space-y-2">
                <NumPad onKey={pressKey} disabled={paying} compact={narrow} testIdPrefix="pay-key" />
                <button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={clearSelected}
                  disabled={paying}
                  data-testid="pay-key-ac"
                  className="w-full h-12 rounded-2xl border border-danger/50 bg-danger/10 text-danger font-extrabold text-lg hover:bg-danger/20 active:scale-[0.98] disabled:opacity-40"
                >
                  AC
                </button>
              </div>
            </div>

            {calc.nonCashOver && (
              <div role="alert" className="rounded-xl border border-danger/60 bg-danger/10 px-3 py-2 text-sm font-bold text-danger">
                Karta / onlayn to‘lov qoldiqdan ({formatSum(remaining)}) oshmasligi kerak — qaytim faqat naqddan beriladi.
              </div>
            )}

            {/* Qarzga — mijoz ismi (majburiy) va telefoni */}
            {showDebtor && (
              <div className="rounded-2xl border-2 border-danger/50 bg-danger/5 p-3 space-y-2" data-testid="pay-debtor">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-extrabold text-danger">Qarzga yoziladi — kim qarzdor?</div>
                  <KeyboardToggle show={kb.show} onToggle={() => kb.setShow(!kb.show)} />
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  <label className="block min-w-0">
                    <span className="text-xs font-bold text-muted">
                      Mijoz ismi <span className="text-danger">*</span>
                    </span>
                    <input
                      ref={nameRef}
                      value={debtorName}
                      maxLength={100}
                      inputMode={touchNoSystemKb ? 'none' : undefined}
                      onFocus={() => {
                        setNameActive(true);
                        setKeyTarget('amount');
                      }}
                      onChange={(e) => {
                        setError('');
                        setDebtorName(e.target.value);
                      }}
                      placeholder="Masalan: Xaqberdi aka"
                      data-testid="pay-debtor-name"
                      className={`mt-1 w-full h-12 px-3 rounded-xl bg-bg border-2 outline-none text-base font-bold text-text placeholder:font-normal placeholder:text-muted/60 ${
                        nameActive ? 'border-primary' : 'border-border'
                      }`}
                    />
                  </label>
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-muted">Telefon (ixtiyoriy)</span>
                    <button
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setKeyTarget('phone');
                        phoneFreshRef.current = true;
                        setNameActive(false);
                        nameRef.current?.blur();
                      }}
                      data-testid="pay-debtor-phone"
                      className={`mt-1 w-full h-12 px-3 rounded-xl bg-bg border-2 text-left flex items-center gap-1.5 ${
                        keyTarget === 'phone' ? 'border-primary' : 'border-border'
                      }`}
                    >
                      <PhoneIcon className="w-4 h-4 text-muted shrink-0" />
                      <span className="text-muted font-bold">+998</span>
                      <span className={`font-bold tabular-nums ${debtorPhone ? 'text-text' : 'text-muted/60'}`}>
                        {debtorPhone ? groupLocalPhone(debtorPhone) : '90 123 45 67'}
                      </span>
                    </button>
                    {keyTarget === 'phone' && (
                      <div className="mt-0.5 text-[11px] font-semibold text-primary">Raqamni klaviaturada tering</div>
                    )}
                  </div>
                </div>
                {nameActive && kb.show && (
                  <TouchKeyboard
                    target={nameRef}
                    value={debtorName}
                    onChange={(v) => {
                      setError('');
                      setDebtorName(v.slice(0, 100));
                    }}
                    maxLength={100}
                    onEnter={() => {
                      setNameActive(false);
                      nameRef.current?.blur();
                    }}
                  />
                )}
              </div>
            )}

            {/* Teng bo'lish + Chegirma / Xizmat haqi */}
            <div className="flex flex-wrap items-stretch gap-2">
              {shares.length > 0 && (
                <div className="flex-1 min-w-[220px]" data-testid="pay-split">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted mb-1">
                    <UsersIcon className="w-4 h-4" /> Teng bo‘lish
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {shares.map((s) => {
                      const amount = s.parts[0];
                      const on = !calc.implicit && Number(amounts[selected] || 0) === amount && calc.entered === amount;
                      const last = s.parts[s.parts.length - 1];
                      return (
                        <button
                          key={s.n}
                          type="button"
                          onPointerDown={(e) => e.preventDefault()}
                          onClick={() => applyShare(amount)}
                          disabled={paying}
                          data-testid={`pay-split-${s.n}`}
                          title={last !== amount ? `${s.n} kishiga: ${groupDigits(String(amount))} (oxirgisi ${groupDigits(String(last))})` : undefined}
                          className={`min-h-[48px] px-1 rounded-xl border-2 text-sm font-extrabold leading-tight tabular-nums disabled:opacity-50 ${
                            on ? 'border-primary-hover bg-primary-hover text-white' : 'border-border bg-bg text-text hover:border-primary'
                          }`}
                        >
                          <span className={`block text-[11px] font-bold ${on ? 'text-white/85' : 'text-muted'}`}>{s.n} kishiga</span>
                          {groupDigits(String(amount))}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => setAdjustOpen((v) => !v)}
                aria-expanded={adjustOpen}
                data-testid="pay-adjust-toggle"
                className={`min-h-[48px] self-end px-3 rounded-xl border-2 text-sm font-bold flex items-center gap-1.5 ${
                  adjustOpen || discountDirty || serviceDirty ? 'border-primary text-text bg-primary/10' : 'border-border text-text bg-bg hover:border-primary'
                }`}
              >
                <PercentIcon className="w-4 h-4 text-primary" />
                <span className="text-left leading-tight">
                  Chegirma / Xizmat
                  <span className="block text-[11px] font-semibold text-muted">
                    {formatPercent(discount)}% · {formatPercent(service)}%
                  </span>
                </span>
                <ChevronDownIcon className={`w-4 h-4 transition-transform ${adjustOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {adjustOpen && (
              <div className="rounded-2xl border border-border bg-bg p-3 space-y-2.5 animate-pop-in" data-testid="pay-adjust">
                <div className="grid grid-cols-2 gap-3">
                  <PercentField
                    label="Chegirma"
                    value={discount}
                    disabled={paying}
                    testId="pay-discount"
                    onChange={(n) => {
                      setDiscount(n);
                      setDiscountDirty(true);
                      setError('');
                    }}
                  />
                  <PercentField
                    label="Xizmat haqi"
                    value={service}
                    disabled={paying}
                    testId="pay-service"
                    onChange={(n) => {
                      setService(n);
                      setServiceDirty(true);
                      setError('');
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DISCOUNT_CHIPS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setDiscount(p);
                        setDiscountDirty(true);
                        setError('');
                      }}
                      disabled={paying}
                      className={`h-10 px-3 rounded-lg border text-sm font-bold disabled:opacity-50 ${
                        discount === p ? 'bg-primary-hover text-white border-primary-hover' : 'bg-surface text-text border-border hover:border-primary'
                      }`}
                    >
                      {p === 0 ? 'Chegirmasiz' : `−${p}%`}
                    </button>
                  ))}
                </div>
                {(discountDirty || serviceDirty) && (
                  <div className="text-xs font-semibold text-muted">Yangi foizlar to‘lov bilan birga saqlanadi.</div>
                )}
              </div>
            )}

            {pendingExcise.length > 0 && (
              <div className="text-sm text-danger font-semibold text-center">Avval aksiz kodini skanerlang</div>
            )}
          </>
        )
      )}

      {/* To'lovlar jami summadan oshib ketgan (chegirma oshirildi) — nega to'lab bo'lmaydi */}
      {!gone && overpaid && (
        <div className="rounded-xl border border-warning/50 bg-warning/10 px-3 py-2.5 text-sm font-semibold text-text">
          To‘langan summa jami summadan {formatSum(paid - totals.total)} ko‘p — chegirma/xizmat haqini tekshiring yoki ortiqcha
          to‘lovni o‘chiring.
        </div>
      )}

      {flash && !error && (
        <div className="flex items-center gap-2 rounded-xl border border-success/50 bg-success/10 px-3 py-2.5 text-sm font-bold text-success animate-pop-in">
          <CheckIcon className="w-5 h-5" /> {flash}
        </div>
      )}
      {error && (
        <div
          role="alert"
          data-testid="pay-error"
          className="flex items-start gap-2 bg-danger/10 border border-danger/50 text-danger rounded-xl px-3.5 py-2.5 text-sm font-semibold"
        >
          <AlertIcon className="w-5 h-5 shrink-0" />
          <span className="flex-1">{error}</span>
        </div>
      )}
    </section>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center bg-black/60 animate-overlay-in md:p-3"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${orderTitle(cur)} — to‘lov`}
        data-testid="payment-modal"
        data-order-id={cur.id}
        className="relative flex flex-col w-full md:max-w-[1240px] h-full md:h-auto md:max-h-[96vh] bg-surface md:border md:border-border md:rounded-2xl shadow-2xl overflow-hidden animate-pop-in"
      >
        {/* Sarlavha: nom + tur + №, vaqt, ofitsiant; (yetkazish) telefon/manzil */}
        <div className="flex items-start gap-3 px-4 sm:px-5 py-2.5 border-b border-border">
          <div className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${style.soft} ${style.text}`}>
            <OrderTypeIcon type={type} className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
              <span className="text-xl sm:text-2xl font-extrabold leading-tight text-text" data-testid="pay-title">
                {orderTitle(cur)}
              </span>
              <OrderTypeBadge type={type} />
              {no && (
                <span className="rounded-md bg-text text-bg px-1.5 text-xs font-black leading-5" data-testid="pay-number">
                  {no}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-sm text-muted">
              <span className="inline-flex items-center gap-1">
                <ClockIcon className="w-4 h-4" /> {formatTime(cur.openedAt)} · {formatAge(minutes)}
              </span>
              {cur.waiterName && (
                <span className="inline-flex items-center gap-1">
                  <UserIcon className="w-4 h-4" /> {cur.waiterName}
                </span>
              )}
              {cur.customerName && <span className="font-semibold text-text">{cur.customerName}</span>}
            </div>
            {showDelivery && (
              <div className="mt-1 flex items-start gap-2 flex-wrap text-sm">
                <span className="inline-flex items-center gap-1 font-bold text-text">
                  <PhoneIcon className="w-4 h-4 text-success" />
                  {cur.phone ? displayPhone(cur.phone) : 'Telefon yo‘q'}
                </span>
                <span className="inline-flex items-start gap-1 text-text min-w-0">
                  <PinIcon className="w-4 h-4 text-success shrink-0 mt-0.5" />
                  <span className="break-words">{cur.address || 'Manzil kiritilmagan'}</span>
                </span>
                {!gone && (
                  <button
                    type="button"
                    onClick={() => setEditDelivery(true)}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-success/50 text-success text-xs font-bold hover:bg-success/10"
                  >
                    <PencilIcon className="w-3.5 h-3.5" /> Manzil
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            disabled={paying}
            aria-label="Yopish"
            className="shrink-0 w-12 h-12 -mr-1 rounded-xl text-muted hover:text-text hover:bg-surface-hover flex items-center justify-center disabled:opacity-50"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        {gone && (
          <div
            role="alert"
            className="mx-4 sm:mx-5 mt-3 flex items-start gap-2 bg-warning/10 border-2 border-warning/60 rounded-xl p-3 text-sm font-semibold text-text"
          >
            <AlertIcon className="w-5 h-5 text-warning shrink-0" />
            Bu hisob boshqa joyda yopildi yoki bekor qilindi — to‘lov qabul qilinmaydi. Cheklar tarixini tekshiring.
          </div>
        )}

        {/* Tana: chapda buyurtma, o'ngda to'lov (telefonda — avval to'lov) */}
        <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden flex flex-col md:flex-row">
          {orderSection}
          {paySection}
        </div>

        {/* Pastki panel: asosiy amal doim ko'rinadi */}
        <div className="border-t border-border p-3 sm:px-5 flex gap-3 bg-surface">
          <button
            type="button"
            onClick={close}
            disabled={paying}
            data-testid="pay-back"
            className="h-14 px-5 rounded-xl border border-border bg-bg font-bold text-text hover:border-text disabled:opacity-50"
          >
            Orqaga
          </button>
          {gone ? null : canSettle ? (
            <button
              type="button"
              onClick={settle}
              disabled={paying || pendingExcise.length > 0}
              data-testid="pay-settle"
              className="flex-1 h-14 rounded-xl bg-success text-black text-lg sm:text-xl font-black shadow-lg hover:brightness-105 active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <CheckIcon className="w-6 h-6" />
              {paying ? 'Yopilmoqda…' : 'Hisobni yopish'}
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={payDisabled}
              data-testid="pay-submit"
              className="flex-1 min-w-0 h-14 rounded-xl bg-success text-black text-lg sm:text-xl font-black shadow-lg shadow-success/25 hover:brightness-105 active:scale-[0.98] transition-transform disabled:opacity-45 disabled:shadow-none flex items-center justify-center gap-2"
            >
              {paying ? (
                <>
                  <span className="w-5 h-5 rounded-full border-[3px] border-black border-t-transparent animate-spin" />
                  To‘lanmoqda…
                </>
              ) : (
                <>
                  <CheckIcon className="w-6 h-6 shrink-0" />
                  <span className="truncate">{submitLabel}</span>
                  {submitHint && (
                    <span className="hidden sm:inline shrink-0 rounded-lg bg-black/15 px-2 py-0.5 text-sm font-extrabold">{submitHint}</span>
                  )}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {editDelivery && (
        <DeliveryInfoModal
          title={`${orderTitle(cur)} — mijoz ma‘lumotlari`}
          initial={{ phone: cur.phone ?? '', address: cur.address ?? '', note: cur.note ?? '', deliveryFee: cur.deliveryFee ?? 0 }}
          onSave={saveDelivery}
          onClose={() => setEditDelivery(false)}
        />
      )}
      {lineSheet && (
        <SentLineSheet
          order={cur}
          item={lineSheet}
          canPrice={canVoid}
          onVoid={() => {
            setVoidReq({ itemIds: [lineSheet.id] });
            setLineSheet(null);
          }}
          onPrice={() => {
            setPriceItem(lineSheet);
            setLineSheet(null);
          }}
          onClose={() => setLineSheet(null)}
        />
      )}
      {priceItem && (
        <SentPriceModal
          order={cur}
          item={priceItem}
          onClose={() => setPriceItem(null)}
          onDone={(o) => {
            setPriceItem(null);
            handleChanged(o);
            setFlash('✓ Narx o‘zgartirildi');
          }}
        />
      )}
      {voidReq && (
        <VoidModal
          order={cur}
          itemIds={voidReq.itemIds}
          wholeOrder={voidReq.whole}
          onClose={() => setVoidReq(null)}
          onDone={(o) => {
            setVoidReq(null);
            handleChanged(o);
            if (o) setFlash('✓ Otkaz qilindi — oshxonaga OTKAZ cheki yuboriladi');
          }}
        />
      )}
    </div>,
    document.body,
  );
}

/** Bitta taom qatori: miqdor, nom, saboy belgisi, izoh, qo'lda o'zgartirilgan narx, summa, 🚫 */
function PayLine({
  item,
  canVoid,
  onOpen,
  onVoid,
}: {
  item: OrderItem;
  canVoid: boolean;
  onOpen: () => void;
  onVoid: () => void;
}) {
  const price = Number(item.price ?? 0);
  const body = (
    <>
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="text-primary font-extrabold tabular-nums shrink-0">
          {qtyText(item.quantity, item.unit)}
          {item.unit === MenuUnit.Weight ? '' : '×'}
        </span>
        <span className="text-text font-semibold min-w-0 break-words">{item.menuItemName}</span>
        {item.takeaway && (
          <span className="inline-flex items-center gap-0.5 rounded bg-warning text-black px-1 text-[10px] font-black shrink-0 self-center">
            <BagIcon className="w-3 h-3" /> saboy
          </span>
        )}
      </div>
      {item.note && <div className="text-xs font-semibold text-warning break-words">» {item.note}</div>}
      {item.priceOverridden && (
        <div className="text-xs font-semibold">
          <span className="text-warning">* {formatSum(price)}</span>
          {item.originalPrice != null && <span className="ml-1.5 text-muted line-through">{formatSum(Number(item.originalPrice))}</span>}
        </div>
      )}
    </>
  );
  return (
    <div className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5" data-testid="pay-line" data-item-id={item.id}>
      {canVoid ? (
        <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left py-1 rounded-lg hover:bg-surface-hover/60">
          {body}
        </button>
      ) : (
        <div className="flex-1 min-w-0 py-1">{body}</div>
      )}
      <span className="font-bold whitespace-nowrap text-text tabular-nums">{formatSum(lineSum(price, item.quantity))}</span>
      {canVoid && (
        <button
          type="button"
          onClick={onVoid}
          aria-label={`${item.menuItemName ?? 'Taom'} — otkaz`}
          title="Otkaz"
          data-testid={`pay-void-${item.id}`}
          className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-danger border border-transparent hover:bg-danger/10 hover:border-danger active:scale-90 transition-transform"
        >
          <BanIcon className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}

/** To'lov usuli qatori: belgi, nom, kiritilgan summa; "+" — qolgan summani shu usulga */
function MethodRow({
  method,
  selected,
  current,
  amount,
  hint,
  disabled,
  onSelect,
  onFill,
}: {
  method: PaymentMethod;
  /** tanlangan va klaviatura shu summani yozmoqda */
  selected: boolean;
  /** tanlangan (klaviatura hozir telefonga yozayotgan bo'lishi mumkin) */
  current: boolean;
  amount: number;
  /** hech narsa kiritilmagan bo'lsa — shu usulga ketadigan summa (xira ko'rsatiladi) */
  hint: number;
  disabled?: boolean;
  onSelect: () => void;
  onFill: () => void;
}) {
  const has = amount > 0;
  const tone = selected
    ? 'bg-primary-hover border-primary-hover text-white shadow-lg shadow-primary/20'
    : current || has
      ? 'bg-primary/10 border-primary text-text'
      : 'bg-bg border-border text-text hover:border-primary/60';
  return (
    <div className={`flex items-stretch rounded-xl border-2 overflow-hidden transition-colors ${tone}`}>
      <button
        type="button"
        role="radio"
        aria-checked={current}
        onPointerDown={(e) => e.preventDefault()}
        onClick={onSelect}
        disabled={disabled}
        data-testid={`pay-method-${method.key}`}
        data-kind={method.kind}
        className="flex-1 min-w-0 min-h-[52px] pl-3 pr-2 flex items-center gap-2.5 text-left disabled:opacity-60"
      >
        <span className={selected ? 'text-white' : KIND_TINT[method.kind]}>
          <MethodIcon kind={method.kind} className="w-6 h-6" />
        </span>
        <span className="flex-1 min-w-0 font-extrabold truncate">{method.label}</span>
        <span
          className={`font-black tabular-nums text-lg ${has ? '' : selected ? 'text-white/60' : 'text-muted/70'}`}
          data-testid={`pay-method-${method.key}-amount`}
        >
          {has ? groupDigits(String(amount)) : hint > 0 ? groupDigits(String(hint)) : '0'}
        </span>
      </button>
      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onClick={onFill}
        disabled={disabled}
        aria-label={`${method.label} — qolgan summani qo‘yish`}
        title="Qolgan summani shu usulga"
        data-testid={`pay-fill-${method.key}`}
        className={`w-12 shrink-0 flex items-center justify-center border-l-2 disabled:opacity-60 ${
          selected ? 'border-white/30 hover:bg-white/15' : 'border-border hover:bg-primary/15 text-primary'
        }`}
      >
        <PlusIcon className="w-5 h-5" />
      </button>
    </div>
  );
}

function SumRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className={`font-semibold tabular-nums ${tone ?? 'text-text'}`}>{value}</span>
    </div>
  );
}
