import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Button, formatDateTime, formatTime } from './ui';
import { formatQty } from './numeric';
import {
  PendingOrder,
  discardPendingOrder,
  getPendingOrders,
  onPendingChange,
  retryPendingOrder,
} from '../lib/offlineQueue';
import { useConnectivity } from '../state/connectivity';
import { useConfirm } from '../state/confirm';

/** offlineQueue'dagi "yuborilmoqda" belgisi shu vaqtdan keyin eskirgan hisoblanadi (u yerdagi CLAIM_TTL_MS) */
const SENDING_TTL_MS = 45_000;

/** Navbatdagi buyurtmalar ro'yxati — har o'zgarishda (boshqa oynada ham) yangilanadi */
export function usePendingOrders(): PendingOrder[] {
  const [list, setList] = useState<PendingOrder[]>(getPendingOrders);
  useEffect(() => {
    const unsubscribe = onPendingChange(() => setList(getPendingOrders()));
    return () => {
      unsubscribe();
    };
  }, []);
  return list;
}

function isSending(p: PendingOrder): boolean {
  return !!p.sendingAt && Date.now() - p.sendingAt < SENDING_TTL_MS;
}

// Taom nomi: WaiterPage navbatga qo'shganda ko'rsatish uchun nomni ham saqlaydi
// (server bu qo'shimcha maydonni e'tiborsiz qoldiradi). Eski yozuvlarda nom bo'lmasligi mumkin.
function itemsLabel(p: PendingOrder): string {
  const named = p.items.map((it) => {
    const name = (it as { name?: unknown }).name;
    return typeof name === 'string' && name.trim() ? `${name.trim()} ×${formatQty(it.quantity)}` : null;
  });
  if (named.every((x): x is string => !!x)) return named.join(', ');
  return `${p.items.length} ta taom`;
}

function whenLabel(createdAt: number): string {
  const iso = new Date(createdAt).toISOString();
  const sameDay = new Date(createdAt).toDateString() === new Date().toDateString();
  return sameDay ? formatTime(iso) : formatDateTime(iso);
}

// Yuborilmagan (oflayn saqlangan) buyurtmalar — AppShell'dagi sariq son bosilganda ochiladi.
// Server rad etgan buyurtmalar avtomatik qayta yuborilmaydi: xodim sababini ko'rib,
// "Qayta yuborish" yoki "O‘chirish"ni tanlaydi.
export function PendingOrdersModal({ onClose }: { onClose: () => void }) {
  const confirm = useConfirm();
  const { online, flushNow } = useConnectivity();
  const list = usePendingOrders();
  const [flushing, setFlushing] = useState(false);
  // Har 5 soniyada qayta chizamiz — "yuborilmoqda" belgisi eskirganda tugmalar ochilsin
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 5000);
    return () => window.clearInterval(t);
  }, []);

  async function sendNow() {
    if (flushing) return;
    setFlushing(true);
    try {
      await flushNow();
    } finally {
      setFlushing(false);
    }
  }

  // Rad etish belgisi olinadi: aloqa bo'lsa — darhol, bo'lmasa — aloqa tiklanganda o'zi yuboriladi
  async function retry(p: PendingOrder) {
    retryPendingOrder(p.localId);
    if (online) await sendNow();
  }

  async function remove(p: PendingOrder) {
    const ok = await confirm({
      title: 'Buyurtmani o‘chirish',
      message: `Stol №${p.tableNumber ?? '—'} uchun yuborilmagan buyurtma o‘chirilsinmi? U oshxonaga bormaydi va qaytarib bo‘lmaydi.`,
      confirmText: 'O‘chirish',
      danger: true,
    });
    if (ok) discardPendingOrder(p.localId);
  }

  const waiting = list.filter((p) => !p.failed);

  return (
    <Modal title="📤 Yuborilmagan buyurtmalar" onClose={onClose} wide>
      <div className="text-sm text-muted mb-4 leading-relaxed">
        Bu buyurtmalar server bilan aloqa yo‘qligida shu qurilmada saqlangan. Aloqa tiklanganda o‘zi yuboriladi.
        Server <b className="text-danger">rad etganlari</b> avtomatik yuborilmaydi — sababini ko‘rib, qayta yuboring
        yoki o‘chiring.
      </div>

      {list.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">✅</div>
          <div className="font-bold text-success">Navbat bo‘sh — barcha buyurtmalar yuborilgan</div>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[55vh] overflow-auto">
          {list.map((p) => {
            const sending = isSending(p);
            return (
              <div
                key={p.localId}
                className={`rounded-xl border-2 p-3 ${
                  p.failed ? 'border-danger/60 bg-danger/5' : 'border-warning/50 bg-warning/5'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-extrabold text-lg leading-tight">
                      Stol №{p.tableNumber ?? '—'}
                      <span className="text-sm font-semibold text-muted"> · {whenLabel(p.createdAt)}</span>
                    </div>
                    <div className="text-sm text-text mt-0.5 break-words">{itemsLabel(p)}</div>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-bold rounded-md px-2 py-1 ${
                      p.failed
                        ? 'bg-danger/15 text-danger'
                        : sending
                          ? 'bg-primary/15 text-primary'
                          : 'bg-warning/20 text-warning'
                    }`}
                  >
                    {p.failed ? 'Rad etildi' : sending ? 'Yuborilmoqda…' : 'Kutmoqda'}
                  </span>
                </div>

                {p.lastError && (
                  <div className={`text-sm mt-2 font-semibold ${p.failed ? 'text-danger' : 'text-text'}`}>
                    {p.failed ? '⚠️ Server javobi: ' : 'Oxirgi urinish: '}
                    {p.lastError}
                    {p.attempts ? <span className="text-muted font-normal"> ({p.attempts} marta urinildi)</span> : null}
                  </div>
                )}

                <div className="flex gap-2 mt-3">
                  {p.failed ? (
                    <Button className="flex-1 py-2.5" disabled={flushing} onClick={() => retry(p)}>
                      🔁 Qayta yuborish
                    </Button>
                  ) : (
                    // Socket uzilgan bo'lsa ham REST ishlashi mumkin — urinib ko'rishga ruxsat
                    <Button variant="ghost" className="flex-1 py-2.5" disabled={flushing || sending} onClick={sendNow}>
                      {sending || flushing ? 'Yuborilmoqda…' : '📤 Hozir yuborish'}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="py-2.5 !text-danger hover:!border-danger"
                    disabled={sending}
                    onClick={() => remove(p)}
                  >
                    🗑️ O‘chirish
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!online && list.length > 0 && (
        <div className="mt-3 text-sm font-semibold text-warning">
          Server bilan aloqa yo‘q — aloqa tiklanganda yuboriladi.
        </div>
      )}
      {waiting.length > 1 && (
        <Button className="w-full mt-3 py-3" disabled={flushing} onClick={sendNow}>
          {flushing ? 'Yuborilmoqda…' : `📤 Hammasini hozir yuborish (${waiting.length})`}
        </Button>
      )}
    </Modal>
  );
}
