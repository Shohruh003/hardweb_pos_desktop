// "Turi" — buyurtma turini o'zgartirish (B22c, eski POS'dagidek): Stolga / Olib ketish / Yetkazib berish.
//  • Stolga — stol tanlanadi (band stol — u yerda yangi hisob), xizmat haqi qo'shiladi;
//  • Olib ketish — stol bo'shaydi (boshqa hisob bo'lmasa), xizmat haqi olinmaydi;
//  • Yetkazib berish — telefon + manzil (DeliveryInfoModal), yetkazish narxi.
// Oshxonaga chek chiqmaydi. Server xatosi (masalan to'lov bor va summa kamayib qoladi) shu yerda ko'rinadi.
import { useState } from 'react';
import {
  ORDER_TYPES,
  ORDER_TYPE_LABELS,
  Order,
  OrderType,
  Table,
  hallServicePercentFor,
  orderTypeOf,
} from '@hardweb-pos/shared';
import { api } from '../../lib/api';
import { usePosSettings } from '../../lib/posSettings';
import { useConfirm } from '../../state/confirm';
import DeliveryInfoModal, { type DeliveryInfo } from '../DeliveryInfoModal';
import { Sheet, SheetError, Spinner } from '../waiter/Sheet';
import { IconCheck, IconRepeat } from '../waiter/icons';
import { ORDER_TYPE_ICON, ORDER_TYPE_TONE, apiPhone, orderFullName } from '../waiter/orderUi';
import { TablePicker } from './TablePicker';

const HINT: Record<OrderType, string> = {
  [OrderType.DineIn]: 'Stol tanlanadi, xizmat haqi qo‘shiladi',
  [OrderType.Takeaway]: 'Stolsiz, xizmat haqisiz — kunlik raqam bilan',
  [OrderType.Delivery]: 'Telefon va manzil kiritiladi',
};

export function ChangeTypeModal({
  order,
  onClose,
  onDone,
}: {
  order: Order;
  onClose: () => void;
  onDone: (order: Order) => void;
}) {
  const pos = usePosSettings();
  const confirm = useConfirm();
  const current = orderTypeOf(order);
  const [choice, setChoice] = useState<OrderType | null>(null);
  const [delivery, setDelivery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(body: Record<string, unknown>): Promise<Order> {
    const updated = await api.post<Order>(`/orders/${order.id}/change-type`, body);
    return updated ?? { ...order, type: body.type as OrderType };
  }

  async function toTable(table: Table, checks: Order[]) {
    if (busy) return;
    if (checks.length > 0) {
      const ok = await confirm({
        title: `Stol ${table.number} band`,
        message: `Buyurtma Stol ${table.number} ga qo‘shimcha hisob bo‘lib qo‘shiladi. Davom etilsinmi?`,
        confirmText: 'Ha, o‘tkazish',
        cancelText: 'Yo‘q',
      });
      if (!ok) return;
    }
    setBusy(true);
    setError('');
    try {
      onDone(await send({ type: OrderType.DineIn, tableId: table.id }));
    } catch (e) {
      setError((e as Error)?.message || 'Turi o‘zgarmadi');
    } finally {
      setBusy(false);
    }
  }

  async function toTakeaway() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      onDone(await send({ type: OrderType.Takeaway }));
    } catch (e) {
      setError((e as Error)?.message || 'Turi o‘zgarmadi');
    } finally {
      setBusy(false);
    }
  }

  // Yetkazish: DeliveryInfoModal ichida chaqiriladi — xato bo'lsa oyna o'zi ko'rsatadi (throw)
  async function toDelivery(info: DeliveryInfo) {
    setError('');
    let updated = await send({ type: OrderType.Delivery, phone: apiPhone(info.phone), address: info.address });
    // Yetkazish narxi (server standart narxni qo'yadi) va izoh boshqacha kiritilgan bo'lsa — saqlaymiz
    const patch: Record<string, unknown> = {};
    if (info.deliveryFee !== (updated.deliveryFee ?? pos.deliveryFeeDefault)) patch.deliveryFee = info.deliveryFee;
    if (info.note && info.note !== (updated.note ?? '')) patch.note = info.note;
    if (Object.keys(patch).length) {
      try {
        const again = await api.patch<Order>(`/orders/${order.id}/delivery`, patch);
        if (again?.id) updated = again;
      } catch {
        /* turi o'zgardi — narx/izohni keyin "Manzil" orqali tahrirlash mumkin */
      }
    }
    setDelivery(false);
    onDone(updated);
  }

  const servicePreview = (hall?: string | null) => hallServicePercentFor(pos, hall);

  return (
    <>
      <Sheet
        title="Buyurtma turini o‘zgartirish"
        subtitle={orderFullName(order)}
        icon={<IconRepeat className="w-6 h-6" />}
        size="lg"
        busy={busy}
        onClose={onClose}
        testId="change-type-modal"
        footer={
          <div className="flex items-center gap-3">
            <span className="flex-1 min-w-0 text-sm font-semibold text-muted truncate">
              {busy ? (
                <span className="flex items-center gap-2 text-text">
                  <Spinner className="w-5 h-5 border-primary" /> Saqlanmoqda…
                </span>
              ) : choice === OrderType.DineIn ? (
                'Stolni tanlang'
              ) : (
                'Oshxonaga yangi chek chiqmaydi'
              )}
            </span>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-12 px-5 rounded-xl bg-bg border border-border font-bold hover:border-text disabled:opacity-50"
            >
              Bekor
            </button>
            {choice === OrderType.Takeaway && (
              <button
                type="button"
                onClick={() => void toTakeaway()}
                disabled={busy}
                data-testid="change-type-confirm"
                className="h-12 px-6 rounded-xl bg-warning text-black font-extrabold flex items-center gap-2 hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
              >
                <IconCheck className="w-5 h-5" /> Olib ketishga o‘tkazish
              </button>
            )}
            {choice === OrderType.Delivery && (
              <button
                type="button"
                onClick={() => setDelivery(true)}
                disabled={busy}
                data-testid="change-type-confirm"
                className="h-12 px-6 rounded-xl bg-success text-black font-extrabold flex items-center gap-2 hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
              >
                Telefon va manzil →
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Buyurtma turi">
            {ORDER_TYPES.map((t) => {
              const Icon = ORDER_TYPE_ICON[t];
              const isCurrent = t === current;
              const on = t === choice;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={isCurrent || busy}
                  onClick={() => {
                    setError('');
                    setChoice(t);
                  }}
                  data-testid={`change-type-${t}`}
                  className={`min-h-[76px] rounded-2xl border-2 px-3 py-2.5 text-left flex items-center gap-3 transition-colors ${
                    on
                      ? `${ORDER_TYPE_TONE[t].solid} border-transparent shadow-lg`
                      : isCurrent
                        ? 'bg-bg border-border opacity-60 cursor-default'
                        : 'bg-bg border-border hover:border-primary'
                  }`}
                >
                  <span
                    className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                      on ? 'bg-black/15' : ORDER_TYPE_TONE[t].chip
                    }`}
                  >
                    <Icon className="w-6 h-6" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-extrabold leading-tight">{ORDER_TYPE_LABELS[t]}</span>
                    <span className={`block text-xs font-semibold mt-0.5 ${on ? 'opacity-90' : 'text-muted'}`}>
                      {isCurrent ? 'hozirgi turi' : HINT[t]}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <SheetError>{error}</SheetError>

          {choice === OrderType.DineIn && (
            <div>
              <div className="text-sm font-semibold text-muted mb-2">
                Xizmat haqi: zal foizi bo‘yicha (umumiy {servicePreview(null)}%). Band stol tanlansa — yangi hisob ochiladi.
              </div>
              <TablePicker excludeTableId={order.tableId} disabled={busy} onPick={(t, c) => void toTable(t, c)} />
            </div>
          )}
          {choice === OrderType.Takeaway && (
            <div className="rounded-2xl border-2 border-warning/50 bg-warning/10 p-4 text-sm font-semibold text-text space-y-1">
              <div>• Buyurtma «Olib ketish» bo‘ladi va kunlik raqam oladi.</div>
              {current === OrderType.DineIn && <div>• Xizmat haqi olib tashlanadi; stolda boshqa hisob bo‘lmasa — stol bo‘shaydi.</div>}
            </div>
          )}
          {choice === OrderType.Delivery && (
            <div className="rounded-2xl border-2 border-success/50 bg-success/10 p-4 text-sm font-semibold text-text space-y-1">
              <div>• Mijoz telefoni va yetkazish manzili kiritiladi.</div>
              {current === OrderType.DineIn && <div>• Xizmat haqi olib tashlanadi; stolda boshqa hisob bo‘lmasa — stol bo‘shaydi.</div>}
            </div>
          )}
          {!choice && <div className="text-sm text-muted font-semibold">Yangi turini tanlang.</div>}
        </div>
      </Sheet>
      {delivery && (
        <DeliveryInfoModal
          title={`${orderFullName(order)} → Yetkazib berish`}
          initial={{ phone: order.phone ?? '', address: order.address ?? '', note: order.note ?? '' }}
          onSave={toDelivery}
          onClose={() => setDelivery(false)}
        />
      )}
    </>
  );
}
