// Minimal ESC/POS enkoder (tashqi kutubxonasiz) — TZ 6-bo'lim.
// Chekni bayt buferiga aylantiradi. Termal printerlar uchun standart protokol.
import type { Order, Receipt, ReceiptLine } from '@hardweb-pos/shared';

// MenuUnit.Weight qiymati ('kg') — main jarayon shared'dan faqat type oladi,
// shuning uchun bu yerda string literal bilan solishtiramiz.
const UNIT_KG = 'kg';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// Lotin/raqamlardan tashqari belgilarni ASCII'ga moslash (№ -> "No " kabi).
// Bu funksiya ustun kengligini to'g'ri hisoblash uchun ham ishlatiladi.
function sanitize(text: string): string {
  return text
    .replace(/[‘’ʻ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/№/g, 'No ')
    .replace(/[^\x00-\x7F]/g, '?');
}

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

  // Tayyor bayt buferini qo'shish (masalan raster rasm)
  rawBuffer(buf: Buffer) {
    this.chunks.push(buf);
    return this;
  }

  // Lotin/raqamlardan tashqari belgilarni ASCII'ga moslab tozalash
  private encode(text: string): Buffer {
    return Buffer.from(sanitize(text), 'ascii');
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

  // Chap va o'ng matnni bitta qatorga joylash (narx jadvallari uchun).
  // scale=2 — ikki barobar o'lchamli matn uchun (qator kengligi yarmiga tushadi).
  // Uzunlik sanitizatsiyadan keyin hisoblanadi (№ -> "No " kabi kengayishlarni hisobga oladi).
  cols(left: string, right: string, scale = 1) {
    const effWidth = Math.floor(this.width / scale);
    const space = Math.max(
      1,
      effWidth - sanitize(left).length - sanitize(right).length,
    );
    return this.line(left + ' '.repeat(space) + right);
  }

  divider(ch = '-') {
    return this.line(ch.repeat(this.width));
  }

  feed(n = 1) {
    return this.raw(new Array(n).fill(LF));
  }

  // Native QR-kod chop etish (ESC/POS GS ( k) — fiskal QR uchun (TZ F-8.2)
  qr(data: string) {
    const store = Buffer.from(data, 'ascii');
    const len = store.length + 3;
    const pL = len & 0xff;
    const pH = (len >> 8) & 0xff;
    // Model: QR Model 2
    this.raw([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    // Modul o'lchami
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]);
    // Xato tuzatish darajasi
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]);
    // Ma'lumotni saqlash
    this.raw([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]);
    this.chunks.push(store);
    // Chop etish
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
    return this;
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

// Miqdorni birlik bilan ko'rsatish: dona -> "2", kg -> "2 kg" / "1.5 kg"
function qtyText(quantity: number, unit?: string): string {
  const q = Number(quantity);
  if (unit === UNIT_KG) return `${q} kg`;
  return String(q);
}

// Sana-vaqtni chek uchun barqaror formatlash (2026-08-08 12:43)
function fmtDateTime(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

// Mijoz cheki (TZ F-6.3): restoran nomi, stol, ofitsiant, taomlar, jami, to'lov
export function buildReceiptBuffer(receipt: Receipt, width = 32, autoCut = true): Buffer {
  const b = new EscPosBuilder(width);

  b.align('center').bold(true).size(true).line('DasturXon').size(false);
  b.bold(false).line('Toshkent sh.');
  b.divider();

  b.align('left');
  b.cols(`Stol: №${receipt.tableNumber ?? '-'}`, fmtDateTime(new Date(receipt.createdAt)));
  if (receipt.hall) b.line(`Zal: ${receipt.hall}`);
  b.line(`Ofitsiant: ${receipt.waiterName ?? '-'}`);
  b.line(`Kassir: ${receipt.cashierName ?? '-'}`);
  b.divider();

  receipt.lines.forEach((l: ReceiptLine) => {
    b.line(l.name);
    b.cols(`  ${qtyText(l.quantity, l.unit)} x ${money(l.price)}`, money(l.sum));
  });

  b.divider();
  b.cols('Jami', money(receipt.subtotal));
  if (receipt.discountAmount > 0) {
    b.cols(`Chegirma (${receipt.discountPercent}%)`, `-${money(receipt.discountAmount)}`);
  }
  if (receipt.serviceFeeAmount > 0) {
    b.cols(`Xizmat haqi (${receipt.serviceFeePercent}%)`, `+${money(receipt.serviceFeeAmount)}`);
  }
  b.bold(true).size(true).cols('JAMI', money(receipt.total), 2).size(false).bold(false);
  b.line(`To'lov: ${receipt.paymentType}`);

  // Fiskal QR hozircha o'chirilgan (keyinchalik yoqiladi)
  b.align('center');

  // Cutter yoqilgan bo'lsa — kesamiz; o'chiq bo'lsa qog'ozni yirtish chizig'igacha suramiz
  b.feed(1).line('Rahmat! Yana keling');
  b.feed(autoCut ? 2 : 6);
  if (autoCut) b.cut();
  return b.build();
}

// Hisob (SCHOT) — to'lovdan oldin mijozga beriladigan hisob. Fiskal emas.
// Ofitsiant/kassa "Schot" tugmasini bosганda kassa printeridan chiqadi.
export function buildBillBuffer(order: Order, width = 48, autoCut = true): Buffer {
  const b = new EscPosBuilder(width);

  b.align('center').bold(true).size(true).line('DasturXon').size(false);
  b.bold(true).line('HISOB (SCHOT)').bold(false);
  b.divider();

  b.align('left');
  b.cols(`Stol: №${order.tableNumber ?? '-'}`, fmtDateTime(new Date()));
  if (order.hall) b.line(`Zal: ${order.hall}`);
  if (order.waiterName) b.line(`Ofitsiant: ${order.waiterName}`);
  b.divider();

  let subtotal = 0;
  (order.items || []).forEach((it) => {
    const price = Number(it.price) || 0;
    const sum = price * Number(it.quantity);
    subtotal += sum;
    b.line(it.menuItemName ?? '');
    b.cols(`  ${qtyText(it.quantity, it.unit)} x ${money(price)}`, money(sum));
  });

  b.divider();
  b.bold(true).size(true).cols('JAMI', money(subtotal), 2).size(false).bold(false);
  b.feed(1).align('center');
  b.line("* To'lov kutilmoqda *");
  b.feed(1).line('Rahmat! Yana keling');
  b.feed(autoCut ? 2 : 6);
  if (autoCut) b.cut();
  return b.build();
}

// Oshxona cheki (KDS/oshpaz uchun) — narxsiz, katta shrift: stol, vaqt, taomlar.
// Oshxonaga qo'yilgan LAN printerlarga yuboriladi.
export function buildKitchenTicketBuffer(
  order: Order,
  width = 48,
  autoCut = true,
  title = '* OSHXONA *',
): Buffer {
  const b = new EscPosBuilder(width);

  b.align('center').bold(true).size(true).line(title).size(false);
  b.bold(true).size(true).line(`STOL №${order.tableNumber ?? '-'}`).size(false);
  if (order.hall) b.bold(true).line(order.hall).bold(false);
  b.bold(false).line(new Date(order.openedAt).toLocaleTimeString('uz-UZ'));
  b.divider();

  b.align('left');
  (order.items || []).forEach((it) => {
    b.bold(true).size(true).line(`${qtyText(it.quantity, it.unit)} x ${it.menuItemName}`).size(false).bold(false);
    if (it.note) b.line(`   >> ${it.note}`);
  });

  b.divider();
  b.feed(autoCut ? 2 : 6);
  if (autoCut) b.cut();
  return b.build();
}
