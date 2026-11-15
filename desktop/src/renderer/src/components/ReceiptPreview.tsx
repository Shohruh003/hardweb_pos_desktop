import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { MenuUnit, OrderType, orderDisplayName, orderTypeOf, roundSum } from '@hardweb-pos/shared';
import type { Receipt, ReceiptLine } from '@hardweb-pos/shared';
import { Button, formatSum } from './ui';
import { formatQty } from './numeric';
import { api } from '../lib/api';
import { usePosSettings } from '../lib/posSettings';
import { readLocal, writeLocal } from './cashier/hooks';
import { dateTime, displayPhone, formatPercent, groupDigits } from './cashier/orderType';
import { methodLabel } from './cashier/payMethods';
import { CheckIcon, PrinterIcon } from './cashier/icons';

/** Shu qurilmada to'lovdan keyin chek avtomatik chop etilsinmi (kassir o'zi yoqadi) */
const AUTO_PRINT_KEY = 'receipt.autoPrint';

// Chekdagi summalar butun so'mda (server shared/money bilan hisoblaydi). Eski server yoki
// relay orqali kelgan chekda kasr qoldiq bo'lsa ham ekranda "37 032,963" chiqmasligi uchun
// ko'rsatishda yana bir bor butun so'mga keltiramiz.
const sum = (n: number | string | null | undefined) => formatSum(roundSum(n));
/** Qog'oz chekdagidek: "so‘m"siz, minglik bo'shliq bilan */
const amount = (n: number | string | null | undefined) => groupDigits(String(Math.abs(roundSum(n))));

/**
 * Chek sarlavhasi (bir qatorli matn — ro'yxat va tarix uchun): "Olib ketish #12" / "Yetkazish #5" /
 * "Stol 5 — Zal" / "Stol 5 · Hisob 2 — Zal". Stol raqami "№" belgisisiz (restoran egasi talabi).
 */
export function receiptHeadline(r: Pick<Receipt, 'orderType' | 'queueNumber' | 'tableNumber' | 'checkNo' | 'hall'>): string {
  const type = orderTypeOf({ type: r.orderType });
  if (type !== OrderType.DineIn) {
    return orderDisplayName({ type: r.orderType, queueNumber: r.queueNumber });
  }
  const table = orderDisplayName({ type: OrderType.DineIn, tableNumber: r.tableNumber, checkNo: r.checkNo });
  return r.hall ? `${table} — ${r.hall}` : table;
}

/**
 * Chek ko'rinishi (58/80mm termal printer uslubida, qog'ozdagi chek bilan bir xil tartib). TZ 6-bo'lim.
 * Chop etish: shu terminalda printer sozlangan bo'lsa — o'zi chiqaradi, aks holda chek kassa
 * printeriga yuboriladi (relay, POST /orders/print-receipt).
 *  • afterPayment — to'lovdan keyin ochilgan ("To‘lov qabul qilindi", ixtiyoriy avtomatik chop etish);
 *    aks holda — chek nusxasi (tarixdan qayta chop etish), avtomatik chop etilmaydi.
 *  • change > 0 — "Qaytim" katta ko'rsatiladi va chop etilgandan keyin ham oyna ochiq qoladi.
 *  • actions — pastki qatorga qo'shimcha tugmalar (masalan tarixda "Vozvrat").
 */
export function ReceiptPreview({
  receipt,
  onClose,
  onPrinted,
  change = 0,
  afterPayment = false,
  title,
  actions,
}: {
  receipt: Receipt;
  onClose: () => void;
  onPrinted?: () => void; // chek muvaffaqiyatli chiqarilganda (ro'yxatdan o'chirish uchun)
  change?: number; // naqd to'lovda qaytim (so'm)
  afterPayment?: boolean; // to'lovdan keyin (kassa) — aks holda chek nusxasi (tarix)
  title?: string;
  actions?: ReactNode;
}) {
  const pos = usePosSettings();
  const [printMsg, setPrintMsg] = useState('');
  // Chop etish davomida tugma bloklanadi — ikki marta bosilsa chek ikki marta chiqmasin
  const [printing, setPrinting] = useState(false);
  const [autoPrint, setAutoPrint] = useState(() => readLocal(AUTO_PRINT_KEY) === '1');
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const closedRef = useRef(false);
  const autoStartedRef = useRef(false);
  // Avtomatik chop etish va Esc bir marta (mount'da) ulanadi — callback'larning eng yangisini ref orqali olamiz
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onPrintedRef = useRef(onPrinted);
  onPrintedRef.current = onPrinted;
  const hasChange = roundSum(change) > 0;

  function close() {
    if (closedRef.current) return;
    closedRef.current = true;
    onCloseRef.current();
  }

  // Muvaffaqiyatli chop etildi: to'lovdan keyin (qaytimsiz) oyna yopiladi; qaytim yoki nusxa — ochiq qoladi
  function finished(msg: string, delayMs: number) {
    setPrintMsg(msg);
    if (hasChange || !afterPayment) return;
    if (delayMs > 0) {
      window.setTimeout(() => {
        if (aliveRef.current) close();
      }, delayMs);
    } else {
      close();
    }
  }

  async function print() {
    if (busyRef.current) return;
    busyRef.current = true;
    setPrinting(true);
    setPrintMsg('Chop etilmoqda...');
    try {
      // Shu terminalda printer bormi?
      const cfg = await window.hardweb?.printer?.getConfig?.().catch(() => null);
      const hasLocalPrinter = !!cfg && cfg.type !== 'none';

      if (hasLocalPrinter) {
        const res = await window.hardweb!.printer.printReceipt(receipt);
        if (!aliveRef.current) return;
        if (res?.ok) {
          onPrintedRef.current?.();
          finished('✓ Chek chop etildi', 0);
          return;
        }
        setPrintMsg(`⚠️ ${res?.message || 'Printer xatosi'}`);
        return;
      }

      // Printer yo'q (masalan zal terminali yoki telefon) — chekni kassa printeriga yuboramiz
      await api.post('/orders/print-receipt', receipt);
      // Kassaga yuborildi — oyna yopilgan bo'lsa ham ro'yxatdan o'chiriladi (chek kassada chiqadi)
      onPrintedRef.current?.();
      if (!aliveRef.current) return;
      finished('✓ Chek kassa printeriga yuborildi', 900);
    } catch (e) {
      if (aliveRef.current) {
        setPrintMsg(`⚠️ Chek yuborilmadi: ${(e as Error)?.message || 'xato'}. Qayta urinib ko‘ring.`);
      }
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setPrinting(false);
    }
  }

  useEffect(() => {
    aliveRef.current = true;
    // Avtomatik chop etish (faqat to'lovdan keyin, yoqilgan bo'lsa) — oyna ochilishi bilan (bir marta)
    if (afterPayment && autoPrint && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void print();
    }
    return () => {
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc — yopish (chop etish davomida emas)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const type = orderTypeOf({ type: receipt.orderType });
  const dineIn = type === OrderType.DineIn;
  const payments =
    receipt.payments && receipt.payments.length > 0
      ? receipt.payments
      : [{ type: receipt.paymentType, amount: receipt.total, label: undefined as string | undefined }];
  // Bir xil taomlar bitta qatorda (qog'oz chek bilan bir xil — 0.3.2)
  const lines = mergeReceiptLines(receipt.lines ?? []);
  const hallLines = lines.filter((l) => !l.takeaway);
  const saboyLines = lines.filter((l) => l.takeaway);
  const sections = hallLines.length > 0 && saboyLines.length > 0;
  // Xizmat haqi qaysi summadan: saboy (olib ketiladigan) qatorlarsiz
  const serviceBase = lines.reduce((s, l) => (l.takeaway ? s : s + roundSum(l.sum)), 0);
  const subtotal = roundSum(receipt.subtotal);
  const fee = roundSum(receipt.deliveryFee ?? 0);
  const checkNo = Number(receipt.checkNo) || 0;
  const restaurant = receipt.restaurantName || pos.restaurantName;

  return (
    <div
      data-testid="receipt-preview"
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-3 sm:p-4 animate-overlay-in"
    >
      <div className="bg-surface border border-border rounded-2xl w-full max-w-[400px] max-h-full flex flex-col shadow-2xl animate-pop-in">
        <div className="px-5 py-3 border-b border-border font-bold flex items-center justify-between gap-3">
          <span className="text-lg">{title ?? (afterPayment ? 'Chek' : 'Chek nusxasi')}</span>
          {afterPayment && (
            <span className="inline-flex items-center gap-1 text-success text-sm font-bold">
              <CheckIcon className="w-4 h-4" /> To‘lov qabul qilindi
            </span>
          )}
        </div>

        <div className="p-4 overflow-auto min-h-0">
          {hasChange && (
            <div className="mb-4 rounded-2xl bg-success text-black px-4 py-3 text-center">
              <div className="text-xs font-extrabold uppercase tracking-wider">Qaytim</div>
              <div className="text-4xl font-black leading-tight tabular-nums" data-testid="receipt-change">
                {formatSum(roundSum(change))}
              </div>
            </div>
          )}

          {/* Chek qog'ozi — printerdagi chek bilan bir xil tartib */}
          <div className="bg-white text-black rounded-md p-4 font-mono text-[13px] leading-snug" data-testid="receipt-paper">
            <div className="text-center font-bold text-base break-words">{restaurant}</div>
            <Dash />
            {dineIn ? (
              <div className="text-center">
                <div className="font-black text-[22px] leading-tight" data-testid="receipt-headline">
                  Stol: {receipt.tableNumber ?? '?'}
                </div>
                {receipt.hall && <div className="text-[12px] break-words">{receipt.hall}</div>}
                {checkNo >= 2 && <div className="font-bold text-[14px]">Hisob {checkNo}</div>}
              </div>
            ) : (
              <div className="text-center font-black text-[20px] leading-tight break-words" data-testid="receipt-headline">
                {type === OrderType.Takeaway ? 'OLIB KETISH' : 'YETKAZISH'} #{receipt.queueNumber ?? '?'}
              </div>
            )}
            {type === OrderType.Delivery && (
              <div className="mt-1 text-[12px] space-y-0.5">
                {receipt.phone && <div>Tel: {displayPhone(receipt.phone)}</div>}
                {receipt.address && <div className="break-words">Manzil: {receipt.address}</div>}
              </div>
            )}
            <Dash />
            <div className="text-[11px] space-y-0.5">
              {dineIn && receipt.queueNumber ? <div>Buyurtma №{receipt.queueNumber}</div> : null}
              <div>Sana: {dateTime(receipt.createdAt)}</div>
              {receipt.waiterName && <div>Ofitsiant: {receipt.waiterName}</div>}
              {receipt.cashierName && <div>Kassir: {receipt.cashierName}</div>}
              {receipt.customerName && <div>Mijoz: {receipt.customerName}</div>}
            </div>
            <Dash />

            {sections ? (
              <>
                <div className="font-bold">ZALDA</div>
                {hallLines.map((l, i) => <ReceiptRow key={'h' + i} l={l} amount={amount} />)}
                <Row label="Zal uchun" value={amount(hallLines.reduce((t, l) => t + roundSum(l.sum), 0))} />
                <Dash />
                <div className="font-bold">OLIB KETISH (SABOY)</div>
                {saboyLines.map((l, i) => <ReceiptRow key={'s' + i} l={l} amount={amount} />)}
                <Row label="Saboy uchun" value={amount(saboyLines.reduce((t, l) => t + roundSum(l.sum), 0))} />
              </>
            ) : (
              lines.map((l, i) => <ReceiptRow key={i} l={l} amount={amount} />)
            )}

            <Dash />
            {!sections && <Row label="Mahsulotlar" value={amount(subtotal)} />}
            {roundSum(receipt.discountAmount) > 0 && (
              <Row label={`Chegirma (${formatPercent(receipt.discountPercent)}%)`} value={`- ${amount(receipt.discountAmount)}`} />
            )}
            {roundSum(receipt.serviceFeeAmount) > 0 && (
              <Row
                label={`Xizmat haqi ${formatPercent(receipt.serviceFeePercent)}%${
                  serviceBase < subtotal ? ` (${amount(serviceBase)} dan)` : ''
                }`}
                value={`+ ${amount(receipt.serviceFeeAmount)}`}
              />
            )}
            {fee > 0 && <Row label="Yetkazish narxi" value={`+ ${amount(fee)}`} />}
            <div className="border-t border-black/60 my-1" />
            <div className="flex justify-between font-black text-[16px]">
              <span>JAMI</span>
              <span>{sum(receipt.total)}</span>
            </div>
            <div className="text-[12px] mt-1.5">
              <div className="mb-0.5">{payments.length > 1 ? 'To‘lov (bo‘lib):' : 'To‘lov:'}</div>
              {payments.map((p, i) => (
                <div key={i} className="flex justify-between pl-2">
                  <span>{p.label || methodLabel(pos.paymentMethods, p.type)}</span>
                  <span>{amount(p.amount)}</span>
                </div>
              ))}
            </div>
            {lines.some((l) => l.priceOverridden) && (
              <div className="text-[10px] mt-1">* narx o‘zgartirilgan</div>
            )}
            {receipt.note && (
              <div className="text-[11px] mt-1 border-t border-dashed border-black/40 pt-1 break-words">Izoh: {receipt.note}</div>
            )}
            {receipt.fiscalNumber && <div className="text-[10px] mt-1 text-center">Fiskal №{receipt.fiscalNumber}</div>}

            {/* Fiskal QR hozircha o'chirilgan */}
            <div className="text-center text-[11px] mt-3">Rahmat! Yana keling</div>
          </div>
        </div>

        <div
          className={`px-4 pt-2 text-center text-sm min-h-[22px] font-semibold ${
            printMsg.startsWith('⚠️') ? 'text-danger' : printMsg.startsWith('✓') ? 'text-success' : 'text-muted'
          }`}
          role={printMsg.startsWith('⚠️') ? 'alert' : undefined}
        >
          {printMsg}
        </div>
        {afterPayment && (
          <label className="mx-4 mt-1 flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={(e) => {
                setAutoPrint(e.target.checked);
                writeLocal(AUTO_PRINT_KEY, e.target.checked ? '1' : null);
              }}
              className="w-4 h-4 accent-primary"
            />
            To‘lovdan keyin chekni avtomatik chop etish (shu qurilmada)
          </label>
        )}
        <div className="p-4 flex flex-wrap gap-2">
          {actions}
          <Button
            variant="ghost"
            className="flex-1 h-12 flex items-center justify-center gap-2"
            onClick={print}
            disabled={printing}
            data-testid="receipt-print"
          >
            <PrinterIcon className="w-5 h-5" />
            {printing ? 'Chop etilmoqda…' : afterPayment ? 'Chop etish' : 'Qayta chop etish'}
          </Button>
          <Button className="flex-1 h-12" onClick={close} data-testid="receipt-close">
            Yopish
          </Button>
        </div>
      </div>
    </div>
  );
}

function Dash() {
  return <div className="border-t border-dashed border-black/40 my-2" />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 text-[12px]">
      <span>{label}</span>
      <span className="whitespace-nowrap">{value}</span>
    </div>
  );
}

/** Bir xil taomlarni birlashtirish (nom + birlik + narx + saboy + o'zgartirilgan narx) — qog'oz chek bilan bir xil */
function mergeReceiptLines(lines: ReceiptLine[]): ReceiptLine[] {
  const out: ReceiptLine[] = [];
  const idx = new Map<string, number>();
  for (const l of lines) {
    const key = [l.name, l.unit ?? '', Number(l.price), l.takeaway ? 1 : 0, l.priceOverridden ? 1 : 0, l.originalPrice ?? ''].join('|');
    const at = idx.get(key);
    if (at === undefined) {
      idx.set(key, out.length);
      out.push({ ...l });
    } else {
      const m = out[at];
      m.quantity = Math.round((Number(m.quantity) + Number(l.quantity)) * 1e6) / 1e6;
      m.sum = roundSum(m.sum) + roundSum(l.sum);
    }
  }
  return out;
}

/** Ixcham chek qatori: "3x KO'K CHOY (3 000) ....... 9 000" */
function ReceiptRow({ l, amount }: { l: ReceiptLine; amount: (n: number | string | null | undefined) => string }) {
  const kg = l.unit === MenuUnit.Weight;
  const q = Number(l.quantity);
  return (
    <div className="flex justify-between gap-2 mb-0.5">
      <span className="break-words min-w-0">
        {kg ? `${formatQty(q)} kg ` : `${formatQty(q)}x `}
        {l.name}
        {(kg || q !== 1) && (
          <span className="opacity-70">
            {' '}({amount(l.price)}{kg ? '/kg' : ''}{l.priceOverridden ? '*' : ''})
          </span>
        )}
        {l.priceOverridden && l.originalPrice != null && (
          <span className="ml-1 line-through opacity-60">{amount(l.originalPrice)}</span>
        )}
      </span>
      <span className="whitespace-nowrap">{amount(l.sum)}</span>
    </div>
  );
}
