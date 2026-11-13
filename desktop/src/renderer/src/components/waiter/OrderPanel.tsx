// Buyurtma paneli (o'ng ustun; telefonda — pastdan chiqadigan "sheet"):
//  • sarlavha (tur, holat, kunlik raqam №15, ofitsiant) va ⋮ menyu (izoh, mijoz, hisobni bekor qilish);
//  • stol: hisoblar tablari "Hisob-1 | Hisob-2 | …" (B18) — bo'sh tab = shu raqamli yangi hisob;
//  • yetkazish: telefon, manzil, yetkazish narxi;
//  • yuborilgan taomlar — har birining ostida qo'shilgan sana/vaqt "13.11.2026 (18:56)" (eski POS'dagidek).
//    Otkaz huquqi yo'q xodimga faqat o'qish uchun (B19); kassir/direktor — 🚫 va narx;
//  • yangi taomlar — −/+ , kg, "💬 Izoh", saboy (🥡) belgisi; qator bosilsa — tahrirlash oynasi (B31);
//  • amallar qatori (Turi / Stol / Ofitsiant / Chek / Bo'lish / Otkaz), summalar va katta "Tasdiqlash".
// 1366×768 monoblokda (oyna ~600 px balandlik) ham bir necha qator ko'rinishi uchun ixcham.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { MenuUnit, Order, OrderItem, OrderTotals, OrderType, lineSum } from '@hardweb-pos/shared';
import { formatSum } from '../ui';
import { CartItem, isPriceChanged, qtyLabel } from './cart';
import { CheckTabs } from './CheckTabs';
import {
  IconBag,
  IconBan,
  IconCash,
  IconChat,
  IconCheck,
  IconClose,
  IconEdit,
  IconLock,
  IconMinus,
  IconMore,
  IconNote,
  IconPhone,
  IconPin,
  IconPlus,
  IconScooter,
  IconTrash,
  IconUser,
} from './icons';
import {
  OrderStatusChip,
  OrderTypeBadge,
  addedAtLabel,
  dailyNumberLabel,
  firstName,
  formatAmount,
  phoneLabel,
} from './orderUi';

export interface OrderPanelMenu {
  onNote: () => void;
  onCustomer: () => void;
  /** butun hisobni bekor qilish — faqat 'void' ruxsati bor xodim (aks holda berilmaydi) */
  onAnnul?: () => void;
}

export interface OrderPanelProps {
  type: OrderType;
  /** "Stol 5 · Zal" / "Olib ketish #12" / "Yangi buyurtma — Olib ketish" */
  title: string;
  /** tanlangan mavjud buyurtma (stolda — tanlangan hisob); yangi bo'lsa — null */
  order: Order | null;
  /** stol: shu stoldagi ochiq hisoblar (tablar uchun) */
  checks?: Order[];
  /** stol: tanlangan hisob raqami */
  selectedCheck?: number;
  onSelectCheck?: (checkNo: number) => void;
  cart: CartItem[];
  totals: OrderTotals;
  sending: boolean;
  /** kassa ruxsati — "To‘lov" tugmasi (faqat mavjud buyurtmada) */
  canPay: boolean;
  /** otkaz ruxsati — yuborilgan qatorlarda 🚫 va narx */
  canVoid: boolean;
  /** stol: "🥡 Olib ketish" rejimi (yangi qo'shiladigan taomlar saboy) */
  takeawayMode?: boolean;
  onToggleTakeawayMode?: () => void;
  /** tugagan (stop list) taomlar — savatda ogohlantirish */
  soldOutIds?: Set<string>;
  /** telefon: panel (sheet) ochiqmi */
  open: boolean;
  onCloseSheet: () => void;
  /** savat qatori kaliti (CartItem.key) bo'yicha */
  onChangeQty: (lineKey: string, delta: number) => void;
  /** qatorni tahrirlash oynasi (miqdor / narx / izoh); focusNote — izoh bo'limidan boshlash */
  onEditLine: (item: CartItem, focusNote?: boolean) => void;
  onRemoveLine: (lineKey: string) => void;
  onToggleLineTakeaway: (lineKey: string) => void;
  /** yuborilgan qator bosildi (faqat otkaz ruxsati bor xodimda chaqiriladi) */
  onSentLine: (item: OrderItem) => void;
  /** yuborilgan qatordagi 🚫 */
  onVoidLine: (item: OrderItem) => void;
  onSubmit: () => void;
  onPay: () => void;
  onEditDelivery: () => void;
  /** ⋮ menyu (faqat mavjud buyurtmada) */
  menu: OrderPanelMenu | null;
  /** mavjud buyurtma amallari qatori (OrderActionsBar) */
  actionsBar?: ReactNode;
}

const READ_ONLY_HINT = 'Otkaz uchun kassirga murojaat qiling';

export function OrderPanel(p: OrderPanelProps) {
  const { type, title, order, cart, totals, sending, canPay, canVoid, open, menu } = p;
  const [moreOpen, setMoreOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<number | undefined>(undefined);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const dineIn = type === OrderType.DineIn;
  const isDelivery = type === OrderType.Delivery;
  const canSubmit = !sending && cart.length > 0;
  const daily = dineIn ? dailyNumberLabel(order) : null;
  const checkLabel = dineIn ? `Hisob-${p.selectedCheck ?? 1}` : null;

  // ⋮ menyu: tashqariga bosilganda yopiladi. Panel (aside) transform'li — ichidagi "fixed" qoplama
  // butun ekranni qoplamaydi, shuning uchun hujjat darajasida tinglaymiz.
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (moreBtnRef.current?.contains(t) || moreMenuRef.current?.contains(t)) return;
      setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);
  // Buyurtma almashsa (yoki yopilsa) menyu va eslatma yopiladi
  useEffect(() => {
    setMoreOpen(false);
    setHint(null);
  }, [order?.id]);
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  function showHint(text: string) {
    window.clearTimeout(hintTimer.current);
    setHint(text);
    hintTimer.current = window.setTimeout(() => setHint(null), 3500);
  }

  const menuAction = (fn?: () => void) => () => {
    setMoreOpen(false);
    fn?.();
  };

  const footHint =
    cart.length === 0
      ? ''
      : isDelivery && !order
        ? 'Keyingi qadam: telefon va manzil'
        : dineIn && !order
          ? `${checkLabel} ochiladi — bo‘limlarga yuboriladi`
          : 'Bo‘limlarga (oshxona, bar...) yuboriladi';

  return (
    <aside
      aria-label="Buyurtma"
      data-testid="order-panel"
      className={`bg-surface border-border flex flex-col
        fixed inset-x-0 bottom-0 z-40 max-h-[90vh] rounded-t-3xl border-t shadow-2xl transition-transform duration-300
        ${open ? 'translate-y-0' : 'translate-y-full'}
        md:static md:translate-y-0 md:w-[350px] xl:w-[400px] md:shrink-0 md:max-h-none md:rounded-none md:border-t-0 md:border-l md:shadow-none md:z-auto`}
    >
      {/* Telefon: "tortib yopish" belgisi */}
      <div className="md:hidden flex justify-center pt-2">
        <span className="w-10 h-1.5 rounded-full bg-border" />
      </div>

      {/* Sarlavha */}
      <div className="relative px-3 pt-1.5 pb-2 md:pt-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <OrderTypeBadge type={type} solid />
              {order && <OrderStatusChip status={order.status} />}
              {daily && (
                <span className="rounded-md bg-bg border border-border px-1.5 text-[11px] font-black leading-5 text-text" title="Kunlik buyurtma raqami">
                  {daily}
                </span>
              )}
              {order?.waiterName && (
                <span className="text-xs font-semibold text-muted flex items-center gap-1 min-w-0">
                  <IconUser className="w-3.5 h-3.5" />
                  <span className="truncate">{firstName(order.waiterName)}</span>
                </span>
              )}
            </div>
            <div data-testid="order-panel-title" title={title} className="mt-1 text-lg font-extrabold leading-tight truncate">
              {title}
            </div>
          </div>
          {menu && (
            <button
              ref={moreBtnRef}
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-label="Boshqa amallar"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              data-testid="order-more"
              className="w-12 h-12 rounded-xl border border-border hover:border-primary hover:bg-surface-hover flex items-center justify-center text-text shrink-0"
            >
              <IconMore className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            className="md:hidden w-12 h-12 rounded-xl text-muted hover:text-text hover:bg-bg flex items-center justify-center shrink-0"
            onClick={p.onCloseSheet}
            aria-label="Yopish"
          >
            <IconClose className="w-5 h-5" />
          </button>
        </div>

        {/* ⋮ menyu */}
        {moreOpen && menu && (
          <div
            ref={moreMenuRef}
            role="menu"
            className="absolute right-3 top-full mt-1 z-30 w-64 bg-surface border border-border rounded-2xl shadow-2xl py-1.5 animate-pop-in"
          >
            <MenuRow icon={<IconNote className="w-5 h-5" />} label="Chekka izoh" onClick={menuAction(menu.onNote)} />
            <MenuRow
              icon={<IconUser className="w-5 h-5" />}
              label={order?.customerName ? `Mijoz (${order.customerName})` : 'Mijoz biriktirish'}
              onClick={menuAction(menu.onCustomer)}
            />
            {menu.onAnnul && (
              <>
                <div className="border-t border-border my-1" />
                <MenuRow
                  icon={<IconBan className="w-5 h-5" />}
                  label={dineIn ? 'Hisobni bekor qilish' : 'Buyurtmani bekor qilish'}
                  danger
                  onClick={menuAction(menu.onAnnul)}
                  testId="order-annul"
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* Stol hisoblari: Hisob-1 | Hisob-2 | … */}
      {dineIn && p.checks && p.onSelectCheck && (
        <div className="px-3 py-2 border-b border-border">
          <CheckTabs checks={p.checks} selected={p.selectedCheck ?? 1} onSelect={p.onSelectCheck} />
        </div>
      )}

      <div className="flex-1 overflow-auto px-3 py-2.5 space-y-2.5 min-h-[96px]">
        {/* Yetkazish: telefon, manzil, yetkazish narxi */}
        {isDelivery && (
          <div className="rounded-2xl border-2 border-success/50 bg-success/10 p-2.5">
            {order ? (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2 font-extrabold text-text">
                    <IconPhone className="w-4 h-4 text-success" />
                    {order.phone ? phoneLabel(order.phone) : <span className="text-muted font-semibold">Telefon yo‘q</span>}
                  </div>
                  <div className="flex items-start gap-2 text-sm text-text font-semibold">
                    <IconPin className="w-4 h-4 mt-0.5 text-success shrink-0" />
                    <span className="break-words line-clamp-2">{order.address || <span className="text-muted">Manzil yo‘q</span>}</span>
                  </div>
                  {!!order.deliveryFee && (
                    <div className="flex items-center gap-2 text-xs font-bold text-muted">
                      <IconScooter className="w-4 h-4 text-success" /> Yetkazish narxi: {formatSum(order.deliveryFee)}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={p.onEditDelivery}
                  aria-label="Yetkazish ma'lumotini tahrirlash"
                  data-testid="edit-delivery"
                  className="w-12 h-12 rounded-xl border border-border bg-surface hover:border-primary flex items-center justify-center shrink-0"
                >
                  <IconEdit className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-sm text-text font-semibold">
                <IconPhone className="w-4 h-4 mt-0.5 text-success shrink-0" />
                <span>
                  Telefon, manzil va yetkazish narxi <b>«Tasdiqlash»</b> bosilganda so‘raladi.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Mijoz va izoh nishonlari (bosilsa — tahrirlash) */}
        {order?.customerName && (
          <button
            type="button"
            onClick={menu?.onCustomer}
            className="w-full min-h-[44px] text-left px-3 py-2 rounded-xl bg-primary/10 border border-primary/30 text-sm flex items-center gap-2"
          >
            <IconUser className="w-4 h-4 text-primary" />
            <span className="flex-1 font-semibold">{order.customerName}</span>
          </button>
        )}
        {order?.note && (
          <button
            type="button"
            onClick={menu?.onNote}
            className="w-full min-h-[44px] text-left px-3 py-2 rounded-xl bg-warning/10 border border-warning/50 text-sm flex items-start gap-2"
          >
            <IconNote className="w-4 h-4 mt-0.5 text-warning" />
            <span className="flex-1 break-words font-semibold">{order.note}</span>
          </button>
        )}

        {/* Oldin yuborilgan taomlar */}
        {order && order.items.length > 0 && (
          <div>
            <div className="text-xs font-extrabold text-success mb-1 flex items-center gap-1 uppercase tracking-wide">
              <IconCheck className="w-3.5 h-3.5" /> Yuborilgan ({order.items.length})
              {!canVoid && <IconLock className="w-3.5 h-3.5 ml-auto text-muted" title="Faqat ko‘rish" />}
            </div>
            <div className="rounded-2xl border border-success/30 bg-success/5 divide-y divide-success/15">
              {order.items.map((it) => (
                <SentLine
                  key={it.id}
                  item={it}
                  canVoid={canVoid}
                  onTap={() => (canVoid ? p.onSentLine(it) : showHint(READ_ONLY_HINT))}
                  onVoid={() => p.onVoidLine(it)}
                />
              ))}
            </div>
            {hint && (
              <div role="status" className="mt-1.5 rounded-lg bg-warning/15 text-warning px-2.5 py-1.5 text-xs font-extrabold flex items-center gap-1.5">
                <IconLock className="w-4 h-4" /> {hint}
              </div>
            )}
          </div>
        )}

        {/* Yangi qo'shilayotgan taomlar */}
        {cart.length > 0 ? (
          <div>
            <div className="text-xs font-extrabold text-primary mb-1 flex items-center gap-1 uppercase tracking-wide">
              <IconPlus className="w-3.5 h-3.5" /> {order ? 'Yangi qo‘shilgan' : 'Taomlar'} ({cart.length})
              {checkLabel && (
                <span className="ml-auto normal-case tracking-normal rounded-md bg-primary-hover text-white px-1.5 leading-5">→ {checkLabel}</span>
              )}
            </div>
            <div className="space-y-1.5">
              {cart.map((c) => (
                <CartLine
                  key={c.key}
                  item={c}
                  dineIn={dineIn}
                  soldOut={!!p.soldOutIds?.has(c.menuItemId)}
                  onChangeQty={p.onChangeQty}
                  onEdit={p.onEditLine}
                  onRemove={p.onRemoveLine}
                  onToggleTakeaway={p.onToggleLineTakeaway}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="text-muted text-sm text-center py-5 px-4 font-semibold">
            {order ? 'Yangi taom qo‘shish uchun menyudan tanlang' : 'Menyudan taom tanlang — bu yerda paydo bo‘ladi'}
          </div>
        )}
      </div>

      {/* Amallar, summalar va tugmalar */}
      <div className="border-t border-border px-3 pt-2 bg-surface" style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
        {p.actionsBar && <div className="mb-2">{p.actionsBar}</div>}
        <TotalRow label="Mahsulotlar" value={formatSum(totals.subtotal)} />
        {totals.discountAmount > 0 && (
          <TotalRow label={`Chegirma ${totals.discountPercent}%`} value={`− ${formatSum(totals.discountAmount)}`} />
        )}
        {totals.servicePercent > 0 && (
          <TotalRow
            label={`Xizmat haqi ${totals.servicePercent}%${
              totals.serviceBase !== totals.subtotal ? ` (${formatAmount(totals.serviceBase)} dan)` : ''
            }`}
            value={`+ ${formatSum(totals.serviceAmount)}`}
          />
        )}
        {(totals.deliveryFee > 0 || isDelivery) && (
          <TotalRow label="Yetkazish narxi" value={totals.deliveryFee > 0 ? `+ ${formatSum(totals.deliveryFee)}` : 'bepul'} />
        )}
        <div className="flex items-baseline justify-between pt-0.5">
          <span className="text-base font-extrabold text-text">Jami</span>
          <span data-testid="order-total" className="text-2xl font-black tabular-nums text-text">
            {formatSum(totals.total)}
          </span>
        </div>

        <div className="flex gap-2 pt-2">
          {dineIn && p.onToggleTakeawayMode && (
            <button
              type="button"
              onClick={p.onToggleTakeawayMode}
              aria-pressed={!!p.takeawayMode}
              data-testid="takeaway-toggle"
              title="Yangi qo‘shiladigan taomlar olib ketiladi (saboy) — xizmat haqi olinmaydi"
              className={`w-[76px] h-16 shrink-0 rounded-2xl border-2 font-extrabold text-[11px] leading-tight flex flex-col items-center justify-center gap-1 active:scale-[0.96] transition-[transform,background-color] ${
                p.takeawayMode
                  ? 'bg-warning text-black border-warning shadow-lg shadow-warning/25'
                  : 'bg-bg text-text border-border hover:border-warning'
              }`}
            >
              <IconBag className={`w-6 h-6 ${p.takeawayMode ? '' : 'text-warning'}`} />
              {p.takeawayMode ? 'Saboy: YOQIQ' : 'Olib ketish'}
            </button>
          )}
          {order && canPay && (
            <button
              type="button"
              onClick={p.onPay}
              disabled={sending}
              data-testid="pay-order"
              className="w-[76px] h-16 shrink-0 rounded-2xl bg-success text-black font-extrabold text-xs flex flex-col items-center justify-center gap-1 hover:brightness-105 active:scale-[0.96] transition-transform disabled:opacity-50 disabled:active:scale-100"
            >
              <IconCash className="w-6 h-6" />
              To‘lash
            </button>
          )}
          <button
            type="button"
            onClick={p.onSubmit}
            disabled={!canSubmit}
            data-testid="confirm-order"
            className="flex-1 min-w-0 h-16 rounded-2xl bg-primary-hover text-white text-xl font-black tracking-wide flex items-center justify-center gap-2 shadow-lg shadow-primary/25 hover:brightness-110 active:scale-[0.98] transition-[transform,filter,opacity] disabled:opacity-40 disabled:shadow-none disabled:active:scale-100"
          >
            {sending ? (
              <>
                <span className="w-6 h-6 rounded-full border-[3px] border-white border-t-transparent animate-spin" />
                <span className="truncate">Yuborilmoqda…</span>
              </>
            ) : (
              <>
                <IconCheck className="w-6 h-6" />
                Tasdiqlash
              </>
            )}
          </button>
        </div>
        {/* Izoh — balandligi yetarli ekranlarda (past monoblokda joy tejaladi) */}
        {footHint && !sending && (
          <div className="hidden [@media(min-height:820px)]:block text-center text-[11px] font-semibold text-muted mt-1.5">
            {footHint}
          </div>
        )}
      </div>
    </aside>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  danger,
  testId,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      data-testid={testId}
      className={`w-full min-h-[48px] text-left px-4 py-2.5 text-sm font-semibold flex items-center gap-3 ${
        danger ? 'text-danger hover:bg-danger/10' : 'text-text hover:bg-bg'
      }`}
    >
      <span className={danger ? 'text-danger' : 'text-muted'}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm leading-6">
      <span className="text-muted font-semibold truncate">{label}</span>
      <span className="font-bold tabular-nums text-text whitespace-nowrap">{value}</span>
    </div>
  );
}

/** Yuborilgan bitta qator: miqdor × nom, saboy / narx belgisi, izoh, qo'shilgan vaqt; kassirda — 🚫 */
function SentLine({
  item,
  canVoid,
  onTap,
  onVoid,
}: {
  item: OrderItem;
  canVoid: boolean;
  onTap: () => void;
  onVoid: () => void;
}) {
  const price = Number(item.price ?? 0);
  return (
    <div className="flex items-center gap-1.5 pl-3 pr-1 py-1 text-sm" data-testid="sent-line" data-item-id={item.id}>
      <button type="button" onClick={onTap} className="min-w-0 flex-1 text-left py-0.5">
        <span className="font-extrabold text-success">
          {qtyLabel(item.quantity, item.unit ?? MenuUnit.Piece)}
          {item.unit === MenuUnit.Weight ? '' : '×'}
        </span>{' '}
        <span className="font-bold text-text">{item.menuItemName}</span>
        {item.takeaway && (
          <span className="ml-1 inline-flex align-middle items-center gap-0.5 rounded bg-warning/20 text-warning px-1 text-[10px] font-black">
            <IconBag className="w-3 h-3" strokeWidth={2.6} /> saboy
          </span>
        )}
        {item.priceOverridden && (
          <span className="ml-1 text-[11px] font-bold text-warning" title="Narx o‘zgartirilgan">
            * {formatAmount(price)}
            {item.originalPrice != null && <span className="ml-1 line-through text-muted">{formatAmount(item.originalPrice)}</span>}
          </span>
        )}
        {item.note && <span className="block text-xs text-warning font-bold truncate">» {item.note}</span>}
        {item.createdAt && (
          <span className="block text-[11px] text-warning/90 font-semibold tabular-nums" data-testid="sent-line-time">
            {addedAtLabel(item.createdAt)}
          </span>
        )}
      </button>
      <span className="shrink-0 tabular-nums font-bold text-text">{formatSum(lineSum(price, item.quantity))}</span>
      {canVoid && (
        <button
          type="button"
          onClick={onVoid}
          aria-label={`${item.menuItemName ?? 'Taom'} — otkaz`}
          title="Otkaz"
          data-testid="sent-void"
          className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-danger border border-transparent hover:bg-danger/10 hover:border-danger active:scale-90 transition-transform"
        >
          <IconBan className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}

/** Savatdagi bitta qator: nom (bosilsa — tahrirlash), narx, miqdor (−/+ yoki kg), izoh, saboy */
function CartLine({
  item,
  dineIn,
  soldOut,
  onChangeQty,
  onEdit,
  onRemove,
  onToggleTakeaway,
}: {
  item: CartItem;
  dineIn: boolean;
  soldOut: boolean;
  onChangeQty: (lineKey: string, delta: number) => void;
  onEdit: (item: CartItem, focusNote?: boolean) => void;
  onRemove: (lineKey: string) => void;
  onToggleTakeaway: (lineKey: string) => void;
}) {
  const kg = item.unit === MenuUnit.Weight;
  const changed = isPriceChanged(item);
  return (
    <div
      className={`rounded-2xl bg-bg border px-2.5 py-2 ${soldOut ? 'border-danger' : 'border-border'}`}
      data-testid="cart-line"
      data-name={item.name}
      data-takeaway={item.takeaway ? '1' : undefined}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onEdit(item)}
          data-testid="line-edit"
          aria-label={`${item.name} — tahrirlash`}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block font-extrabold leading-tight line-clamp-2 break-words">
            {item.name}
            {soldOut && (
              <span className="ml-1.5 inline-block align-middle rounded bg-danger text-white px-1.5 text-[10px] font-black uppercase" data-testid="cart-line-soldout">
                Tugadi
              </span>
            )}
          </span>
          <span className="block text-xs text-muted font-semibold mt-0.5 tabular-nums truncate">
            {changed && <span className="text-warning font-extrabold">* </span>}
            {formatAmount(item.price)}
            {changed && <span className="ml-1 line-through">{formatAmount(item.menuPrice)}</span>}
            {kg ? ' / kg' : ` × ${item.quantity}`}
          </span>
        </button>
        {kg ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onEdit(item)}
              aria-label="Og‘irlikni o‘zgartirish"
              data-testid="kg-edit"
              className="h-12 px-3 rounded-xl bg-surface border border-border flex items-center gap-1.5 font-extrabold hover:border-primary active:scale-95 transition-transform tabular-nums"
            >
              <IconEdit className="w-4 h-4" />
              {qtyLabel(item.quantity, item.unit)}
            </button>
            <button
              type="button"
              onClick={() => onRemove(item.key)}
              aria-label="O‘chirish"
              className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center text-danger hover:border-danger active:scale-95 transition-transform"
            >
              <IconTrash className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onChangeQty(item.key, -1)}
              aria-label="Kamaytirish"
              data-testid="qty-minus"
              className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center active:scale-90 hover:border-danger hover:text-danger transition-transform"
            >
              <IconMinus className="w-5 h-5" />
            </button>
            <span className="w-9 text-center text-2xl font-black tabular-nums" data-testid="qty-value">
              {item.quantity}
            </span>
            <button
              type="button"
              onClick={() => onChangeQty(item.key, 1)}
              aria-label="Ko‘paytirish"
              data-testid="qty-plus"
              className="w-12 h-12 rounded-xl bg-primary-hover text-white flex items-center justify-center active:scale-90 hover:brightness-110 transition-transform"
            >
              <IconPlus className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <button
          type="button"
          onClick={() => onEdit(item, true)}
          data-testid="line-note"
          className={`min-h-[36px] min-w-0 max-w-[70%] px-2.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 border transition-colors ${
            item.note
              ? 'border-warning bg-warning/15 text-warning'
              : 'border-dashed border-border text-muted hover:text-text hover:border-primary'
          }`}
        >
          <IconChat className="w-4 h-4 shrink-0" />
          <span className="truncate">{item.note || 'Izoh'}</span>
        </button>
        {dineIn && (
          <button
            type="button"
            onClick={() => onToggleTakeaway(item.key)}
            aria-pressed={!!item.takeaway}
            data-testid="line-takeaway"
            title={item.takeaway ? 'Olib ketiladi (saboy) — bosib bekor qilish' : 'Olib ketishga (saboy) belgilash'}
            className={`h-9 px-2 rounded-lg border flex items-center gap-1 text-[11px] font-black shrink-0 transition-colors ${
              item.takeaway ? 'bg-warning text-black border-warning' : 'border-dashed border-border text-muted hover:text-warning hover:border-warning'
            }`}
          >
            <IconBag className="w-4 h-4" strokeWidth={2.4} />
            {item.takeaway ? 'Saboy ✓' : 'Saboy'}
          </button>
        )}
        <span className="ml-auto font-black text-base tabular-nums text-text whitespace-nowrap">
          {formatSum(lineSum(item.price, item.quantity))}
        </span>
      </div>
    </div>
  );
}
