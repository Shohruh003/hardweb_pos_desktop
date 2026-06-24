// Minimal ESC/POS enkoder (tashqi kutubxonasiz) — TZ 6-bo'lim.
// Chekni bayt buferiga aylantiradi. Termal printerlar uchun standart protokol.
import type { Receipt, ReceiptLine } from '@hardweb-pos/shared';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

class EscPosBuilder {
  private chunks: Buffer[] = [];
  // Qog'oz kengligi (belgilarda): 58mm ≈ 32, 80mm ≈ 48
  constructor(private width: number) {
    this.raw([ESC, 0x40]); // init
  }

  private raw(bytes: number[]) {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  // Lotin/raqamlardan tashqari belgilarni ASCII'ga moslab tozalash
  private encode(text: string): Buffer {
    const clean = text
      .replace(/[‘’ʻ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[—–]/g, '-')
      .replace(/[^\x00-\x7F]/g, '?'); // qolgan non-ASCII
    return Buffer.from(clean, 'ascii');
  }

  align(a: 'left' | 'center' | 'right') {
    return this.raw([ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0]);
  }

  bold(on: boolean) {
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  }

  // Matn o'lchami: 0 normal, 1 ikki barobar
  size(double: boolean) {
    const n = double ? 0x11 : 0x00; // kenglik+balandlik bitlari
    return this.raw([GS, 0x21, n]);
  }

  text(t: string) {
    this.chunks.push(this.encode(t));
    return this;
  }

  line(t = '') {
    this.text(t);
    return this.raw([LF]);
  }

  // Chap va o'ng matnni bitta qatorga joylash (narx jadvallari uchun)
  cols(left: string, right: string) {
    const space = Math.max(1, this.width - left.length - right.length);
    return this.line(left + ' '.repeat(space) + right);
  }

  divider(ch = '-') {
    return this.line(ch.repeat(this.width));
  }

  feed(n = 1) {
    return this.raw(new Array(n).fill(LF));
  }

  cut() {
    // Qog'ozni kesish (qisman kesish)
    return this.raw([GS, 0x56, 0x42, 0x00]);
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function money(n: number): string {
  return new Intl.NumberFormat('uz-UZ').format(n);
}

// Mijoz cheki (TZ F-6.3): restoran nomi, stol, ofitsiant, taomlar, jami, to'lov
export function buildReceiptBuffer(receipt: Receipt, width = 32): Buffer {
  const b = new EscPosBuilder(width);

  b.align('center').bold(true).size(true).line('HardWeb Restoran').size(false);
  b.bold(false).line('Toshkent sh.');
  b.divider();

  b.align('left');
  b.cols(`Stol: №${receipt.tableNumber ?? '-'}`, new Date(receipt.createdAt).toLocaleDateString('uz-UZ'));
  b.line(`Ofitsiant: ${receipt.waiterName ?? '-'}`);
  b.line(`Kassir: ${receipt.cashierName ?? '-'}`);
  b.divider();

  receipt.lines.forEach((l: ReceiptLine) => {
    b.line(l.name);
    b.cols(`  ${l.quantity} x ${money(l.price)}`, money(l.sum));
  });

  b.divider();
  b.cols('Jami', money(receipt.subtotal));
  if (receipt.discountAmount > 0) {
    b.cols(`Chegirma (${receipt.discountPercent}%)`, `-${money(receipt.discountAmount)}`);
  }
  if (receipt.serviceFeeAmount > 0) {
    b.cols(`Xizmat haqi (${receipt.serviceFeePercent}%)`, `+${money(receipt.serviceFeeAmount)}`);
  }
  b.bold(true).size(true).cols('JAMI', money(receipt.total)).size(false).bold(false);
  b.line(`To'lov: ${receipt.paymentType}`);

  // Fiskal QR uchun joy (2-bosqich — TZ F-6.7)
  b.feed(1).align('center').line('[ Fiskal QR uchun joy ]');

  b.feed(1).line('Rahmat! Yana keling').feed(3).cut();
  return b.build();
}
