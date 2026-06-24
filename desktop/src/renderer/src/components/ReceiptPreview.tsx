import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Receipt, PaymentType } from '@hardweb-pos/shared';
import { Button, formatSum } from './ui';

const PAYMENT_LABEL: Record<PaymentType, string> = {
  [PaymentType.Cash]: 'Naqd',
  [PaymentType.Card]: 'Karta',
  [PaymentType.QR]: 'QR / To‘lov ilovasi',
};

// Chek ko'rinishi (58/80mm termal printer uslubida). TZ 6-bo'lim.
export function ReceiptPreview({
  receipt,
  onClose,
}: {
  receipt: Receipt;
  onClose: () => void;
}) {
  const [printMsg, setPrintMsg] = useState('');
  const [qrImg, setQrImg] = useState('');

  // Fiskal QR ma'lumotidan QR rasm yaratish (TZ F-8.2)
  useEffect(() => {
    if (receipt.fiscalQr) {
      QRCode.toDataURL(receipt.fiscalQr, { margin: 1, width: 120 })
        .then(setQrImg)
        .catch(() => setQrImg(''));
    }
  }, [receipt.fiscalQr]);

  async function print() {
    setPrintMsg('Chop etilmoqda...');
    try {
      const res = await window.hardweb.printer.printReceipt(receipt);
      setPrintMsg(res.message);
      // Printer sozlanmagan bo'lsa — brauzer chopiga tushamiz
      if (!res.ok && res.message.includes('sozlanmagan')) {
        window.print();
      }
    } catch {
      window.print(); // Electron tashqarisida yoki xato bo'lsa
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-2xl w-[380px] max-h-full flex flex-col">
        <div className="px-5 py-3 border-b border-border font-bold flex items-center justify-between">
          <span>Chek</span>
          <span className="text-success text-sm">To‘lov qabul qilindi ✓</span>
        </div>

        {/* Chek qog'ozi */}
        <div className="p-4 overflow-auto">
          <div className="bg-white text-black rounded-md p-4 font-mono text-[13px] leading-snug">
            <div className="text-center font-bold text-base">HardWeb Restoran</div>
            <div className="text-center text-[11px] mb-2">
              Manzil: Toshkent sh.
            </div>
            <div className="border-t border-dashed border-black/40 my-2" />
            <div className="flex justify-between text-[11px]">
              <span>Stol: №{receipt.tableNumber ?? '—'}</span>
              <span>{new Date(receipt.createdAt).toLocaleString('uz-UZ')}</span>
            </div>
            <div className="text-[11px]">Ofitsiant: {receipt.waiterName ?? '—'}</div>
            <div className="text-[11px]">Kassir: {receipt.cashierName ?? '—'}</div>
            <div className="border-t border-dashed border-black/40 my-2" />

            {receipt.lines.map((l, i) => (
              <div key={i} className="mb-1">
                <div>{l.name}</div>
                <div className="flex justify-between">
                  <span>
                    {l.quantity} x {formatSum(l.price)}
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
            <div className="text-[11px] mt-1">
              To‘lov turi: {PAYMENT_LABEL[receipt.paymentType]}
            </div>

            {/* Fiskal QR (TZ F-8.2) — yoqilgan bo'lsa haqiqiy QR */}
            {receipt.fiscalNumber && (
              <div className="mt-3 flex flex-col items-center">
                {qrImg && <img src={qrImg} alt="Fiskal QR" className="w-24 h-24" />}
                <div className="text-[10px] mt-1">
                  Fiskal chek № {receipt.fiscalNumber}
                </div>
              </div>
            )}
            {receipt.fiscalQrPlaceholder && (
              <div className="mt-3 flex flex-col items-center">
                <div className="w-20 h-20 border-2 border-dashed border-black/40 flex items-center justify-center text-[9px] text-center text-black/50">
                  Fiskal QR
                  <br />
                  (o‘chirilgan)
                </div>
              </div>
            )}
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
