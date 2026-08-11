import { useState } from 'react';
import { MenuUnit, Receipt, PaymentType } from '@hardweb-pos/shared';
import { Button, formatSum } from './ui';
import { api } from '../lib/api';

const PAYMENT_LABEL: Record<PaymentType, string> = {
  [PaymentType.Cash]: 'Naqd',
  [PaymentType.Card]: 'Karta',
  [PaymentType.QR]: 'QR / To‘lov ilovasi',
};

// Chek ko'rinishi (58/80mm termal printer uslubida). TZ 6-bo'lim.
export function ReceiptPreview({
  receipt,
  onClose,
  onPrinted,
}: {
  receipt: Receipt;
  onClose: () => void;
  onPrinted?: () => void; // chek muvaffaqiyatli chiqarilganда (ro'yxatдан o'chirish uchun)
}) {
  const [printMsg, setPrintMsg] = useState('');

  async function print() {
    setPrintMsg('Chop etilmoqda...');
    try {
      // Shu terminalда printer bormi?
      const cfg = await window.hardweb?.printer?.getConfig?.().catch(() => null);
      const hasLocalPrinter = !!cfg && cfg.type !== 'none';

      if (hasLocalPrinter) {
        const res = await window.hardweb!.printer.printReceipt(receipt);
        if (res.ok) {
          onPrinted?.();
          onClose();
          return;
        }
        setPrintMsg(res.message || 'Printer xatosi');
        return;
      }

      // Printer yo'q (masalan zal terminali) — chekни kassa printeriga yuboramiz
      await api.post('/orders/print-receipt', receipt);
      onPrinted?.();
      setPrintMsg('✓ Chek kassa printeriga yuborildi');
      setTimeout(onClose, 900);
    } catch {
      setPrintMsg('⚠️ Chek yuborilmadi. Qayta urinib ko‘ring.');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-[380px] max-h-full flex flex-col">
        <div className="px-5 py-3 border-b border-border font-bold flex items-center justify-between">
          <span>Chek</span>
          <span className="text-success text-sm">To‘lov qabul qilindi ✓</span>
        </div>

        {/* Chek qog'ozi */}
        <div className="p-4 overflow-auto">
          <div className="bg-white text-black rounded-md p-4 font-mono text-[13px] leading-snug">
            <div className="text-center font-bold text-base">DasturXon</div>
            <div className="text-center text-[11px] mb-2">
              Manzil: Toshkent sh.
            </div>
            <div className="border-t border-dashed border-black/40 my-2" />
            <div className="flex justify-between text-[11px]">
              <span>Stol: №{receipt.tableNumber ?? '—'}</span>
              <span>{new Date(receipt.createdAt).toLocaleString('uz-UZ')}</span>
            </div>
            {receipt.hall && <div className="text-[11px]">Zal: {receipt.hall}</div>}
            <div className="text-[11px]">Ofitsiant: {receipt.waiterName ?? '—'}</div>
            <div className="text-[11px]">Kassir: {receipt.cashierName ?? '—'}</div>
            <div className="border-t border-dashed border-black/40 my-2" />

            {receipt.lines.map((l, i) => (
              <div key={i} className="mb-1">
                <div>{l.name}</div>
                <div className="flex justify-between">
                  <span>
                    {l.unit === MenuUnit.Weight ? `${l.quantity} kg` : l.quantity} x {formatSum(l.price)}
                  </span>
                  <span>{formatSum(l.sum)}</span>
                </div>
              </div>
            ))}

            <div className="border-t border-dashed border-black/40 my-2" />
            <Row label="Jami" value={formatSum(receipt.subtotal)} />
            {receipt.discountAmount > 0 && (
              <Row
                label={`Chegirma (${receipt.discountPercent}%)`}
                value={`- ${formatSum(receipt.discountAmount)}`}
              />
            )}
            {receipt.serviceFeeAmount > 0 && (
              <Row
                label={`Xizmat haqi (${receipt.serviceFeePercent}%)`}
                value={`+ ${formatSum(receipt.serviceFeeAmount)}`}
              />
            )}
            <div className="border-t border-black/60 my-1" />
            <div className="flex justify-between font-bold text-[15px]">
              <span>TO‘LANDI</span>
              <span>{formatSum(receipt.total)}</span>
            </div>
            {receipt.payments && receipt.payments.length > 1 ? (
              <div className="text-[11px] mt-1">
                <div className="mb-0.5">To‘lov (bo‘lib):</div>
                {receipt.payments.map((p, i) => (
                  <div key={i} className="flex justify-between pl-2">
                    <span>{PAYMENT_LABEL[p.type]}</span>
                    <span>{formatSum(p.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] mt-1">
                To‘lov turi: {PAYMENT_LABEL[receipt.paymentType]}
              </div>
            )}
            {receipt.note && (
              <div className="text-[11px] mt-1 border-t border-dashed border-black/40 pt-1">
                📝 Izoh: {receipt.note}
              </div>
            )}

            {/* Fiskal QR hozircha o'chirilgan */}
            <div className="text-center text-[11px] mt-3">Rahmat! Yana keling 😊</div>
          </div>
        </div>

        <div className="px-4 pt-2 text-center text-sm text-muted min-h-[20px]">
          {printMsg}
        </div>
        <div className="p-4 border-t border-border flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={print}>
            Chop etish
          </Button>
          <Button className="flex-1" onClick={onClose}>
            Yopish
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[12px]">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
