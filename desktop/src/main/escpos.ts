// Minimal ESC/POS enkoder (tashqi kutubxonasiz) — TZ 6-bo'lim.
// Kassa printeri (Electron main) cheklari: mijoz cheki (to'lovdan keyin), hisob (schot, to'lovdan
// oldin) va zakas / bo'lim cheki. Chekni bayt buferiga aylantiradi (termal printerlar standarti).
//
// Joylashuv renderer'dagi ReceiptPreview (ekrandagi chek) va server/src/printing/tickets.ts
// (bo'lim cheklari) bilan bir xil:
//  • sarlavha buyurtma turi bo'yicha: stol — "Stol: 5" (+ zal, "Hisob 2", "Buyurtma №15");
//    olib ketish — katta "OLIB KETISH #12"; yetkazish — katta "YETKAZISH #5" + telefon + manzil;
//  • summalar (B5): Mahsulotlar / Chegirma / Xizmat haqi N% (saboy qatorlari bo'lsa — bazasi bilan) /
//    Yetkazish narxi / JAMI — JAMI to'lanadigan summa, ustiga xizmat haqi QAYTA qo'shilmaydi;
//  • har bir to'lov usul nomi bilan; qo'lda o'zgartirilgan narx "*" va asl narx bilan.
// Stol raqami "№"/"No" belgisisiz (D4). Main jarayon shared'dan faqat turlarni (type) oladi —
// qiymatlar (birlik, buyurtma turi, to'lov usuli nomlari) shu faylda satr sifatida berilgan.
import type { Order, OrderItem, Receipt, ReceiptLine } from '@hardweb-pos/shared';

// MenuUnit.Weight ('kg') va OrderType qiymatlari (shared enum qiymatlari bilan bir xil)
const UNIT_KG = 'kg';
const TYPE_TAKEAWAY = 'olib_ketish';
const TYPE_DELIVERY = 'yetkazish';
type TicketType = 'stol' | typeof TYPE_TAKEAWAY | typeof TYPE_DELIVERY;

/** Restoran nomi berilmagan bo'lsa chek sarlavhasi */
export const DEFAULT_RESTAURANT_NAME = 'DasturXon';

/** Stoldagi mehmon olib ketadigan (saboy) taomlar guruhi ajratgichi (server tickets.ts bilan bir xil) */
const TAKEAWAY_SEPARATOR = '--- OLIB KETISH (SABOY) ---';

// To'lov usullari nomlari (chekda payments[].label bo'lmasa — eski server/relay cheklari uchun).
// shared DEFAULT_PAYMENT_METHODS bilan bir xil.
const PAYMENT_LABELS: Record<string, string> = {
  naqd: 'Naqd',
  karta: 'Terminal (karta)',
  click: 'Click',
  payme: 'Payme',
  qr: 'QR',
  qarz: 'Qarzga',
};

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// ---------------------------------------------------------------------------------------------
// Matnni printer uchun ASCII'ga o'girish (server/src/printing/escpos.ts toPrintable bilan bir xil).
// Kod sahifasi tanlanmaydi — termal printerlar ASCII'ni ishonchli chiqaradi: o‘zbekcha tutuq belgilari
// -> ', kirill -> lotin ("Плов" -> "Plov", "Қовоқ" -> "Qovoq"), diakritika olib tashlanadi, emoji
// tushirib qoldiriladi, bo'shliq turlari (summalardagi NBSP) oddiy bo'shliq bo'ladi.
// ---------------------------------------------------------------------------------------------

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: "'", ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // o'zbekcha harflar
  ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h',
  // qo'shni tillar harflari (kam uchraydi, lekin "?" bo'lib chiqmasin)
  ә: 'a', ө: 'o', ү: 'u', ұ: 'u', ң: 'ng', һ: 'h', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
  ј: 'j', љ: 'lj', њ: 'nj', ђ: 'dj', ћ: 'c', џ: 'dz', ѓ: 'g', ќ: 'k', ѕ: 'dz',
};

const CYRILLIC_RE = /[Ѐ-ӿ]/;
const LETTER_RE = /\p{L}/u;
const VOWEL_RE = /[aeiouаеёиоуыэюяўәөүұіїє]/i;

function isLetter(ch: string): boolean {
  return ch !== '' && LETTER_RE.test(ch);
}

function isUpperLetter(ch: string): boolean {
  return isLetter(ch) && ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

function transliterateCyrillic(text: string): string {
  if (!CYRILLIC_RE.test(text)) return text; // tez yo'l: kirill yo'q
  const chars = Array.from(text);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const lower = ch.toLowerCase();
    const mapped = CYRILLIC[lower];
    if (mapped === undefined) {
      out += ch;
      continue;
    }
    const prev = i > 0 ? chars[i - 1] : '';
    const next = i + 1 < chars.length ? chars[i + 1] : '';
    let latin = mapped;
    // "е" so'z boshida, unli yoki ъ/ь dan keyin "ye" o'qiladi: "Ер" -> "Yer"
    if (lower === 'е' && (!isLetter(prev) || VOWEL_RE.test(prev) || /[ъь]/i.test(prev))) {
      latin = 'ye';
    }
    if (ch !== lower && latin) {
      // Katta harf: butun so'z katta harflarda bo'lsa — "SH", aks holda — "Sh"
      const allCaps = isUpperLetter(next) || (!isLetter(next) && isUpperLetter(prev));
      latin = allCaps ? latin.toUpperCase() : latin.charAt(0).toUpperCase() + latin.slice(1);
    }
    out += latin;
  }
  return out;
}

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[‘’ʻʼʹ´′]/g, "'"], // o‘zbekcha tutuq belgilari -> '
  [/[“”„«»″]/g, '"'],
  [/[—–‒―−]/g, '-'],
  [/№/g, 'No '],
  [/…/g, '...'],
  [/×/g, 'x'],
  [/•/g, '*'],
  [/·/g, '-'],
  [/©/g, '(c)'],
  [/®/g, '(R)'],
  [/™/g, 'TM'],
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/Æ/g, 'AE'],
  [/œ/g, 'oe'],
  [/Œ/g, 'OE'],
  [/ø/g, 'o'],
  [/Ø/g, 'O'],
  [/ł/g, 'l'],
  [/Ł/g, 'L'],
  [/đ/g, 'd'],
  [/Đ/g, 'D'],
  [/ı/g, 'i'],
  // Turli bo'shliqlar (NBSP — summalardagi guruh ajratgichi, tor bo'shliq...) -> oddiy bo'shliq
  [/[   -   　]/g, ' '],
  // Ko'rinmas belgilar (zero-width, variation selector) -> olib tashlanadi
  [/[​-‍⁠﻿︀-️]/g, ''],
];

/**
 * Matnni termal printer uchun xavfsiz ASCII'ga o'girish. Bo'shliqlar saqlanadi; boshqaruv belgilari
 * (ESC, \n...) bo'shliqqa almashtiriladi — foydalanuvchi matni printer buyrug'iga aylanib qolmasin.
 * ASCII matnga qayta qo'llansa o'zgarmaydi.
 */
export function toPrintable(value: unknown): string {
  let s = String(value ?? '');
  if (/^[\x20-\x7E]*$/.test(s)) return s; // tez yo'l: allaqachon toza ASCII
  s = transliterateCyrillic(s.normalize('NFC'));
  for (const [re, to] of REPLACEMENTS) s = s.replace(re, to);
  // Lotin diakritikasi: é -> e, ş -> s, ö -> o (NFD + birikuvchi belgilarni olib tashlash)
  s = transliterateCyrillic(s.normalize('NFD').replace(/\p{M}/gu, ''));
  // Emoji/piktogrammalar printerda baribir chiqmaydi — olib tashlaymiz
  s = s.replace(/\p{Extended_Pictographic}/gu, '').replace(/[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu, '');
  // Boshqaruv belgilari -> bo'shliq; qolgan har qanday ASCII bo'lmagan belgi -> '?'
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/[^\x20-\x7E]/g, '?');
}

/** Foydalanuvchi kiritgan qiymat (nom, zal, izoh, manzil): ASCII, ortiqcha bo'shliqlarsiz */
function clean(value: unknown): string {
  return toPrintable(value).replace(/ {2,}/g, ' ').trim();
}

/**
 * ASCII qatorni `width` belgidan oshmaydigan qatorlarga so'z chegarasida bo'lish (server wrapText
 * bilan bir xil). hangIndent — 2-qatordan boshlab chap chekinish; qator kengligining yarmidan katta
 * bo'lsa ishlatilmaydi. Bitta so'z butun qatordan uzun bo'lsa — bo'lib yuboriladi.
 */
export function wrapText(text: string, width: number, hangIndent = 0): string[] {
  const words = text.split(' ').filter(Boolean);
  if (words.length === 0) return [''];
  const w = Math.max(1, Math.floor(width));
  const indent = hangIndent > 0 && hangIndent <= w / 2 ? Math.floor(hangIndent) : 0;
  const lines: string[] = [];
  let cur = (/^ */.exec(text)?.[0] ?? '').slice(0, w - 1);
  const capacity = () => (lines.length === 0 ? w : w - indent);
  const flush = (s: string) => lines.push(lines.length === 0 ? s : ' '.repeat(indent) + s);

  for (const word of words) {
    let rest = word;
    while (rest) {
      const hasText = cur.trim() !== '';
      const room = capacity() - cur.length - (hasText ? 1 : 0);
      if (rest.length <= room) {
        cur = hasText ? `${cur} ${rest}` : cur + rest;
        rest = '';
      } else if (hasText) {
        flush(cur);
        cur = '';
      } else {
        const cap = capacity() - cur.length;
        flush(cur + rest.slice(0, cap));
        rest = rest.slice(cap);
        cur = '';
      }
    }
  }
  if (cur.trim()) flush(cur);
  return lines;
}

// ---------------------------------------------------------------------------------------------
// ESC/POS quruvchi
// ---------------------------------------------------------------------------------------------

interface WrapOptions {
  /** Ikki barobar (eni va bo'yi) shrift — qatorga width/2 belgi sig'adi */
  double?: boolean;
  /** 2-qatordan boshlab chekinish (belgilarda) */
  hang?: number;
}

class EscPosBuilder {
  private chunks: Buffer[] = [];
  readonly width: number;

  // Qog'oz kengligi (belgilarda): 58mm ≈ 32, 80mm ≈ 48. Noto'g'ri qiymat — 48.
  constructor(width: number) {
    const w = Math.floor(Number(width));
    this.width = Number.isFinite(w) && w >= 16 && w <= 80 ? w : 48;
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

  align(a: 'left' | 'center' | 'right') {
    return this.raw([ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0]);
  }

  bold(on: boolean) {
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  }

  // Matn o'lchami: false — oddiy, true — ikki barobar (eni+bo'yi)
  size(double: boolean) {
    return this.raw([GS, 0x21, double ? 0x11 : 0x00]);
  }

  text(t: string) {
    this.chunks.push(Buffer.from(toPrintable(t), 'ascii'));
    return this;
  }

  line(t = '') {
    this.text(t);
    return this.raw([LF]);
  }

  /** Matnni qog'oz kengligiga moslab (so'z chegarasida) bir yoki bir necha qatorda chiqarish */
  wrapped(t: string, opts: WrapOptions = {}) {
    const cols = opts.double ? Math.floor(this.width / 2) : this.width;
    const lines = wrapText(toPrintable(t), cols, opts.hang ?? 0);
    if (opts.double) this.size(true);
    for (const l of lines) this.line(l);
    if (opts.double) this.size(false);
    return this;
  }

  // Chap va o'ng matnni bitta qatorga joylash (narx jadvallari uchun).
  // scale=2 — ikki barobar o'lchamli matn uchun (qator kengligi yarmiga tushadi; o'lchamni chaqiruvchi
  // o'zi yoqadi). Sig'masa — chap matn o'z qator(lar)ida, o'ng qiymat keyingi qatorda o'ng chetda.
  cols(left: string, right: string, scale = 1) {
    const eff = Math.max(1, Math.floor(this.width / scale));
    const l = toPrintable(left);
    const r = toPrintable(right);
    if (l.length + 1 + r.length <= eff) {
      return this.line(l + ' '.repeat(eff - l.length - r.length) + r);
    }
    for (const part of wrapText(l, eff, 2)) this.line(part);
    return this.line(' '.repeat(Math.max(0, eff - r.length)) + r);
  }

  divider(ch = '-') {
    return this.line(ch.repeat(this.width));
  }

  feed(n = 1) {
    return this.raw(new Array(Math.max(0, n)).fill(LF));
  }

  // Native QR-kod chop etish (ESC/POS GS ( k) — fiskal QR uchun (TZ F-8.2)
  qr(data: string) {
    const store = Buffer.from(toPrintable(data), 'ascii');
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

// ---------------------------------------------------------------------------------------------
// Formatlash
// ---------------------------------------------------------------------------------------------

/** Summa: butun so'm, oddiy bo'shliq bilan guruhlangan ("1 234 567"). Intl ishlatilmaydi — u NBSP
 *  qo'yadi (qog'ozda "?" bo'lib chiqardi) va har kompyuterda bir xil natija bermaydi. */
function money(n: number | string | null | undefined): string {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return '0';
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return v < 0 ? `-${s}` : s;
}

/** Foiz: 6 -> "6", 7.5 -> "7.5" */
function percentText(p: number | string | null | undefined): string {
  const n = Number(p);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0';
}

/** Butun so'mga yaxlitlash (NaN -> 0) */
function whole(n: number | string | null | undefined): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? v : 0;
}

/** Qator summasi: narx × miqdor, butun so'mga yaxlitlangan (shared lineSum bilan bir xil) */
function lineSum(price: number | string | null | undefined, quantity: number | string | null | undefined): number {
  return whole(Number(price) * Number(quantity));
}

// Miqdorni birlik bilan ko'rsatish: dona -> "2", kg -> "1.5 kg" (ko'pi bilan 3 xona kasr:
// 1.106667 kg -> "1.107 kg" — summa bo'yicha kiritilgan og'irlik)
function qtyText(quantity: number | string, unit?: string | null): string {
  const q = Number(quantity);
  if (!Number.isFinite(q)) return '?';
  const n = String(Math.round(q * 1000) / 1000);
  return unit === UNIT_KG ? `${n} kg` : n;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Sana-vaqt (13.11.2026 18:56) — ekrandagi chek bilan bir xil; noto'g'ri sana — hozirgi vaqt */
function fmtDateTime(value: Date | string | null | undefined): string {
  let d = value instanceof Date ? value : new Date(String(value ?? ''));
  if (Number.isNaN(d.getTime())) d = new Date();
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Vaqt HH:MM */
function clockText(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Telefon: "+998901234567" -> "+998 90 123 45 67" (noto'g'ri bo'lsa — o'zi) */
function phoneText(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('998') ? digits.slice(3) : digits.length === 9 ? digits : '';
  if (!local) return String(phone ?? '').trim();
  return `+998 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5, 7)} ${local.slice(7, 9)}`;
}

/** Buyurtma turi (eski chek/buyurtmada tur bo'lmasa — stol) */
function typeOf(t: unknown): TicketType {
  return t === TYPE_TAKEAWAY || t === TYPE_DELIVERY ? t : 'stol';
}

/** Musbat butun son yoki null (kunlik raqam, hisob raqami) */
function positiveInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** To'lov usuli nomi: chekdagi label, aks holda ma'lum kalitlar nomi, aks holda kalitning o'zi */
function methodLabel(type: string | null | undefined, label?: string | null): string {
  const l = String(label ?? '').trim();
  if (l) return l;
  const key = String(type ?? '').trim();
  return PAYMENT_LABELS[key] ?? (key || "To'lov");
}

// ---------------------------------------------------------------------------------------------
// Chek bloklari (mijoz cheki va schot uchun umumiy)
// ---------------------------------------------------------------------------------------------

interface HeadInfo {
  orderType?: string | null;
  queueNumber?: number | null;
  tableNumber?: number | null;
  checkNo?: number | null;
  hall?: string | null;
  phone?: string | null;
  address?: string | null;
  at: Date | string;
}

/**
 * Buyurtma sarlavhasi turi bo'yicha (ekrandagi chek ko'rinishi bilan bir xil), keyin chiziq:
 *  stol        — katta "Stol: 5", ostida zal va (2-hisobdan) "Hisob 2";
 *  olib ketish — katta "OLIB KETISH #12";
 *  yetkazish   — katta "YETKAZISH #5", "Tel: +998 90 123 45 67", "Manzil: ...".
 */
function orderHead(b: EscPosBuilder, h: HeadInfo): void {
  const type = typeOf(h.orderType);
  const queue = positiveInt(h.queueNumber);
  b.align('center').bold(true);
  if (type === 'stol') {
    b.wrapped(`Stol: ${clean(h.tableNumber ?? '-') || '-'}`, { double: true }).bold(false);
    const hall = clean(h.hall);
    if (hall) b.wrapped(hall);
    const check = positiveInt(h.checkNo);
    if (check && check >= 2) b.bold(true).wrapped(`Hisob ${check}`).bold(false);
  } else {
    const title = type === TYPE_TAKEAWAY ? 'OLIB KETISH' : 'YETKAZISH';
    b.wrapped(`${title} #${queue ?? '?'}`, { double: true }).bold(false);
  }
  b.align('left');
  if (type === TYPE_DELIVERY) {
    if (clean(h.phone)) b.wrapped(`Tel: ${phoneText(h.phone)}`);
    const address = clean(h.address);
    if (address) b.wrapped(`Manzil: ${address}`, { hang: 8 });
  }
  b.divider();
}

/** Restoran nomi (katta) va ixtiyoriy sarlavha ("HISOB (SCHOT)") */
function brandHead(b: EscPosBuilder, restaurantName: string | null | undefined, title?: string): void {
  b.align('center').bold(true);
  b.wrapped(clean(restaurantName) || DEFAULT_RESTAURANT_NAME, { double: true });
  if (title) b.wrapped(title);
  b.bold(false);
  b.divider();
}

/**
 * Ma'lumot bloki: stolga buyurtmada "Buyurtma №15" (olib ketish/yetkazishda raqam sarlavhada),
 * "Sana: ...", "Ofitsiant: …", "Kassir: …", "Mijoz: …" (bo'sh qiymatlar chiqmaydi), keyin chiziq.
 */
function infoLines(b: EscPosBuilder, h: HeadInfo, rows: Array<[string, string | null | undefined]>): void {
  b.align('left');
  const queue = positiveInt(h.queueNumber);
  // Ixcham: "Buyurtma №15" va sana bitta qatorda
  if (typeOf(h.orderType) === 'stol' && queue) b.cols(`Buyurtma №${queue}`, fmtDateTime(h.at));
  else b.line(`Sana: ${fmtDateTime(h.at)}`);
  for (const [label, value] of rows) {
    const v = clean(value);
    if (v) b.wrapped(`${label}: ${v}`, { hang: label.length + 2 });
  }
  b.divider();
}

/** Chekdagi taom qatori (mijoz cheki va schot uchun) */
interface PaperLine {
  name: string;
  quantity: number;
  unit?: string | null;
  price: number;
  sum: number;
  takeaway?: boolean;
  priceOverridden?: boolean;
  originalPrice?: number | null;
}

/**
 * Bir xil taomlarni birlashtirish (0.3.2): ofitsiant choyni 3 marta qo'shgan bo'lsa — chekda bitta
 * "3x KO'K CHOY" qatori. Kalit: nom + birlik + narx + saboy + qo'lda o'zgartirilgan narx. Tartib —
 * birinchi qo'shilgan o'rnida.
 */
export function mergePaperLines(lines: PaperLine[]): PaperLine[] {
  const out: PaperLine[] = [];
  const idx = new Map<string, number>();
  for (const l of lines) {
    const key = [clean(l.name), l.unit ?? '', Number(l.price), l.takeaway ? 1 : 0, l.priceOverridden ? 1 : 0, l.originalPrice ?? ''].join('|');
    const at = idx.get(key);
    if (at === undefined) {
      idx.set(key, out.length);
      out.push({ ...l });
    } else {
      const m = out[at];
      m.quantity = Math.round((Number(m.quantity) + Number(l.quantity)) * 1e6) / 1e6;
      m.sum += l.sum;
    }
  }
  return out;
}

/**
 * Ixcham taom qatori (0.3.2 — qog'oz tejash): bitta qatorda "3x KO'K CHOY ......... 9 000";
 * miqdor 1 dan farq qilsa — bir dona narxi qavsda: "4x KRELISHKA (15 000)"; kg — "0.5 kg JIGAR (180 000/kg)".
 * Narxi qo'lda o'zgartirilgan bo'lsa — "*" va asl narx.
 */
function itemRow(b: EscPosBuilder, l: PaperLine): void {
  const kg = l.unit === UNIT_KG;
  const q = Number(l.quantity);
  const qty = kg ? `${qtyText(q, l.unit)} ` : `${qtyText(q, l.unit)}x `;
  const unitPrice = kg || q !== 1 ? ` (${money(l.price)}${kg ? '/kg' : ''}${l.priceOverridden ? '*' : ''})` : l.priceOverridden ? ' *' : '';
  b.cols(`${qty}${clean(l.name) || 'Taom'}${unitPrice}`, money(l.sum));
  if (l.priceOverridden && l.originalPrice != null && Number.isFinite(Number(l.originalPrice))) {
    b.line(`   (asl narx: ${money(l.originalPrice)})`);
  }
}

/**
 * Taomlar (mijoz cheki va schot): bir xillari birlashtiriladi. Stolda saboy (olib ketish) qatorlari
 * bo'lsa — ikki bo'lim: "ZALDA" + "Zal uchun" summasi va "OLIB KETISH (SABOY)" + "Saboy uchun" summasi.
 * Bo'limlar chiqarilgan bo'lsa true (summalar blokida "Mahsulotlar" qatori takrorlanmaydi).
 */
function itemLines(b: EscPosBuilder, raw: PaperLine[]): boolean {
  b.align('left');
  const lines = mergePaperLines(raw);
  const hall = lines.filter((l) => !l.takeaway);
  const saboy = lines.filter((l) => l.takeaway);
  if (hall.length === 0 || saboy.length === 0) {
    for (const l of lines) itemRow(b, l);
    return false;
  }
  b.bold(true).line('ZALDA').bold(false);
  for (const l of hall) itemRow(b, l);
  b.bold(true).cols('Zal uchun', money(hall.reduce((t, l) => t + l.sum, 0))).bold(false);
  b.divider();
  b.bold(true).line('OLIB KETISH (SABOY)').bold(false);
  for (const l of saboy) itemRow(b, l);
  b.bold(true).cols('Saboy uchun', money(saboy.reduce((t, l) => t + l.sum, 0))).bold(false);
  return true;
}

/** Narxi o'zgartirilgan qator bo'lsa — izoh ("* narx o'zgartirilgan") */
function overrideFootnote(b: EscPosBuilder, lines: PaperLine[]): void {
  if (lines.some((l) => l.priceOverridden)) b.align('left').line("* narx o'zgartirilgan");
}

interface PaperTotals {
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  servicePercent: number;
  serviceAmount: number;
  serviceBase: number; // xizmat haqi olingan summa (saboy qatorlarisiz)
  deliveryFee: number;
  total: number; // to'lanadigan yakuniy summa
}

/** Summalar bloki: Mahsulotlar / Chegirma / Xizmat haqi / Yetkazish narxi / katta JAMI */
function totalsBlock(b: EscPosBuilder, t: PaperTotals, sections = false): void {
  b.align('left');
  b.divider();
  // Zal/Saboy bo'limlari bo'lsa ularning summasi yuqorida; chegirma/xizmat bo'lmasa "Mahsulotlar" ortiqcha
  const extras = t.discountAmount > 0 || t.serviceAmount > 0 || t.deliveryFee > 0;
  if (!sections && extras) b.cols('Mahsulotlar', money(t.subtotal));
  if (t.discountAmount > 0) {
    b.cols(`Chegirma (${percentText(t.discountPercent)}%)`, `-${money(t.discountAmount)}`);
  }
  if (t.serviceAmount > 0) {
    // Saboy (olib ketiladigan) qatorlarga xizmat haqi olinmaydi — baza farq qilsa ko'rsatiladi
    const base = t.serviceBase !== t.subtotal ? ` (${money(t.serviceBase)} dan)` : '';
    b.cols(`Xizmat haqi ${percentText(t.servicePercent)}%${base}`, `+${money(t.serviceAmount)}`);
  }
  if (t.deliveryFee > 0) b.cols('Yetkazish narxi', `+${money(t.deliveryFee)}`);
  b.bold(true).size(true).cols('JAMI', money(t.total), 2).size(false).bold(false);
}

/** Izoh (buyurtma izohi) */
function noteLine(b: EscPosBuilder, note: string | null | undefined): void {
  const n = clean(note);
  if (n) b.align('left').wrapped(`Izoh: ${n}`, { hang: 6 });
}

/** Chek oxiri: rahmat, qog'ozni surish va (cutter yoqilgan bo'lsa) kesish */
function finish(b: EscPosBuilder, autoCut: boolean, footer: string[] = ['Rahmat! Yana keling']): Buffer {
  b.align('center');
  for (const f of footer) b.wrapped(f);
  // Cutter yoqilgan bo'lsa — kesamiz (pichoqqacha minimal surish); o'chiq bo'lsa yirtish chizig'igacha
  b.feed(autoCut ? 2 : 5);
  if (autoCut) b.cut();
  return b.build();
}

// ---------------------------------------------------------------------------------------------
// Mijoz cheki (TZ F-6.3) — to'lovdan keyin
// ---------------------------------------------------------------------------------------------

export function buildReceiptBuffer(receipt: Receipt, width = 32, autoCut = true): Buffer {
  const b = new EscPosBuilder(width);
  const type = typeOf(receipt.orderType);

  const head: HeadInfo = {
    orderType: type,
    queueNumber: receipt.queueNumber,
    tableNumber: receipt.tableNumber,
    checkNo: receipt.checkNo,
    hall: type === 'stol' ? receipt.hall : null,
    phone: receipt.phone,
    address: receipt.address,
    at: receipt.createdAt,
  };
  brandHead(b, receipt.restaurantName);
  orderHead(b, head);
  infoLines(b, head, [
    ['Ofitsiant', receipt.waiterName],
    ['Kassir', receipt.cashierName],
    ['Mijoz', receipt.customerName],
  ]);

  const lines: PaperLine[] = (receipt.lines || []).map((l: ReceiptLine) => ({
    name: l.name,
    quantity: Number(l.quantity),
    unit: l.unit ?? null,
    price: Number(l.price),
    sum: whole(l.sum ?? lineSum(l.price, l.quantity)),
    takeaway: !!l.takeaway,
    priceOverridden: !!l.priceOverridden,
    originalPrice: l.originalPrice ?? null,
  }));
  const sections = itemLines(b, lines);

  const subtotal = whole(receipt.subtotal);
  const serviceBase = lines.some((l) => l.takeaway)
    ? lines.reduce((s, l) => (l.takeaway ? s : s + l.sum), 0)
    : subtotal;
  totalsBlock(b, {
    subtotal,
    discountPercent: Number(receipt.discountPercent) || 0,
    discountAmount: whole(receipt.discountAmount),
    servicePercent: Number(receipt.serviceFeePercent) || 0,
    serviceAmount: whole(receipt.serviceFeeAmount),
    serviceBase,
    deliveryFee: type === TYPE_DELIVERY ? Math.max(0, whole(receipt.deliveryFee)) : 0,
    total: whole(receipt.total),
  }, sections);

  // To'lovlar — har biri usul nomi bilan (bo'lib to'langan bo'lsa hammasi)
  const pays =
    receipt.payments && receipt.payments.length > 0
      ? receipt.payments
      : [{ type: receipt.paymentType, amount: receipt.total, label: undefined as string | undefined }];
  b.align('left');
  if (pays.length === 1) {
    b.cols(`To'lov: ${methodLabel(pays[0].type, pays[0].label)}`, money(pays[0].amount));
  } else {
    b.line("To'lov (bo'lib):");
    for (const p of pays) b.cols(`  ${methodLabel(p.type, p.label)}`, money(p.amount));
  }
  overrideFootnote(b, lines);
  noteLine(b, receipt.note);
  // Fiskal hujjat raqami (QR hozircha o'chirilgan — keyinchalik yoqiladi)
  const fiscal = clean(receipt.fiscalNumber);
  if (fiscal) b.align('center').line(`Fiskal №${fiscal}`);
  return finish(b, autoCut);
}

// ---------------------------------------------------------------------------------------------
// Hisob (SCHOT) — to'lovdan oldin mijozga beriladigan hisob (fiskal emas)
// ---------------------------------------------------------------------------------------------

/** Schot uchun buyurtma: renderer restoran nomini qo'shib yuborishi mumkin (Order'da yo'q) */
export type BillOrder = Order & { restaurantName?: string | null };

/** Buyurtma summalari: server DTO'dagi qiymatlar (B5), yo'q bo'lsa — qatorlardan hisoblanadi */
function orderTotals(order: Order, lines: PaperLine[], type: TicketType): PaperTotals {
  const subtotalCalc = lines.reduce((s, l) => s + l.sum, 0);
  const serviceBase = lines.reduce((s, l) => (l.takeaway ? s : s + l.sum), 0);
  const discountPercent = Math.min(100, Math.max(0, Number(order.discountPercent) || 0));
  const servicePercent = Math.min(100, Math.max(0, Number(order.servicePercent) || 0));
  const fee = type === TYPE_DELIVERY ? Math.max(0, whole(order.deliveryFee)) : 0;
  // Server DTO: total — TO'LANADIGAN summa (chegirma/xizmat/yetkazish bilan). Xizmat haqi
  // ustiga yana qo'shilmaydi — qiymatlar serverdagidek olinadi.
  if (order.total != null && order.subtotal != null && Number.isFinite(Number(order.total))) {
    return {
      subtotal: whole(order.subtotal),
      discountPercent,
      discountAmount: whole(order.discountAmount),
      servicePercent,
      serviceAmount: whole(order.serviceAmount),
      serviceBase,
      deliveryFee: fee,
      total: whole(order.total),
    };
  }
  // Eski server javobi (summalarsiz) — shared calcOrderTotals bilan bir xil qoida
  const discountAmount = whole((subtotalCalc * discountPercent) / 100);
  const serviceAmount = whole((serviceBase * servicePercent) / 100);
  return {
    subtotal: subtotalCalc,
    discountPercent,
    discountAmount,
    servicePercent,
    serviceAmount,
    serviceBase,
    deliveryFee: fee,
    total: subtotalCalc - discountAmount + serviceAmount + fee,
  };
}

/** Buyurtma qatorlari -> chek qatorlari (qo'shilgan vaqti bo'yicha) */
function orderPaperLines(order: Order): PaperLine[] {
  const items = [...(order.items || [])].sort(
    (a: OrderItem, b: OrderItem) => (Date.parse(a.createdAt ?? '') || 0) - (Date.parse(b.createdAt ?? '') || 0),
  );
  return items.map((it) => {
    const price = Number(it.price) || 0;
    return {
      name: it.menuItemName ?? '',
      quantity: Number(it.quantity),
      unit: it.unit ?? null,
      price,
      sum: lineSum(price, it.quantity),
      takeaway: !!it.takeaway,
      priceOverridden: !!it.priceOverridden,
      originalPrice: it.originalPrice ?? null,
    };
  });
}

// Ofitsiant/kassa "Chek" (schot) tugmasini bosganda kassa printeridan chiqadi.
export function buildBillBuffer(order: BillOrder, width = 48, autoCut = true): Buffer {
  const b = new EscPosBuilder(width);
  const type = typeOf(order.type);

  const head: HeadInfo = {
    orderType: type,
    queueNumber: order.queueNumber,
    tableNumber: order.tableNumber,
    checkNo: order.checkNo,
    hall: type === 'stol' ? order.hall : null,
    phone: order.phone,
    address: order.address,
    at: new Date(),
  };
  brandHead(b, order.restaurantName, 'HISOB (SCHOT)');
  orderHead(b, head);
  infoLines(b, head, [
    ['Ofitsiant', order.waiterName],
    ['Mijoz', order.customerName],
  ]);

  const lines = orderPaperLines(order);
  const sections = itemLines(b, lines);
  const totals = orderTotals(order, lines, type);
  totalsBlock(b, totals, sections);

  // Qisman to'langan hisob — to'langan va qolgan summa
  const paid = whole(order.paidAmount);
  if (paid > 0) {
    b.align('left');
    b.cols("To'langan", money(paid));
    b.bold(true).cols('Qoldi', money(Math.max(0, totals.total - paid))).bold(false);
  }
  overrideFootnote(b, lines);
  noteLine(b, order.note);
  return finish(b, autoCut, ["* To'lov kutilmoqda *", 'Rahmat! Yana keling']);
}

// ---------------------------------------------------------------------------------------------
// Zakas / oshxona cheki — narxsiz, katta shrift (kassa printeridagi "zakas cheki" va Electron'dan
// bo'lim printeriga chiqariladigan chek). server/src/printing/tickets.ts buildStationTicket bilan bir xil.
// ---------------------------------------------------------------------------------------------

/** Chekning katta sarlavha qatori: "STOL 5" / "STOL 5 — HISOB 2" / "OLIB KETISH #12" / "YETKAZISH #5" */
export function ticketOrderTitle(order: Pick<Order, 'type' | 'queueNumber' | 'tableNumber' | 'checkNo'>): string {
  const type = typeOf(order.type);
  const queue = positiveInt(order.queueNumber);
  if (type === TYPE_TAKEAWAY) return `OLIB KETISH #${queue ?? '?'}`;
  if (type === TYPE_DELIVERY) return `YETKAZISH #${queue ?? '?'}`;
  const table = clean(order.tableNumber ?? '-') || '-';
  const check = positiveInt(order.checkNo);
  return check && check >= 2 ? `STOL ${table} — HISOB ${check}` : `STOL ${table}`;
}

/** Izohdagi vaqt ("⏰ 15:00 ga tayyor") -> "15:00" (server noteTime bilan bir xil); yo'q — null */
function noteTime(note: string | null | undefined): string | null {
  const m = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(String(note ?? ''));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

/** Oshxona chekidagi taom: "2 x OSH" (katta, qalin) + izoh ">> …" + izohda vaqt bo'lsa "VAQT: 15:00" */
function ticketItem(b: EscPosBuilder, it: OrderItem): void {
  const qty = `${qtyText(it.quantity, it.unit)} x `;
  b.bold(true).wrapped(`${qty}${clean(it.menuItemName) || 'Taom'}`, { double: true, hang: qty.length });
  const note = clean(it.note);
  if (note) {
    b.wrapped(`   >> ${note}`, { hang: 6 });
    const time = noteTime(note);
    if (time) b.wrapped(`  VAQT: ${time}`, { double: true });
  }
  b.bold(false);
}

export function buildKitchenTicketBuffer(
  order: Order,
  width = 48,
  autoCut = true,
  title = '* OSHXONA *',
): Buffer {
  const b = new EscPosBuilder(width);
  const type = typeOf(order.type);
  const dineIn = type === 'stol';

  b.align('center').bold(true);
  b.wrapped(clean(title) || '* OSHXONA *', { double: true });
  b.wrapped(ticketOrderTitle(order), { double: true });
  // Zal va "Buyurtma №15" — faqat stolga buyurtmada (olib ketish/yetkazishda raqam sarlavhada)
  const hall = dineIn ? clean(order.hall) : '';
  if (hall) b.wrapped(hall);
  b.bold(false);
  const queue = positiveInt(order.queueNumber);
  if (dineIn && queue) b.wrapped(`Buyurtma №${queue}`);
  const waiter = clean(order.waiterName);
  if (waiter) b.wrapped(`Ofitsiant: ${waiter}`);
  b.line(clockText(new Date()));
  b.divider();

  b.align('left');
  const items = [...(order.items || [])];
  // Stolga buyurtmada: avval zalda yeyiladigan taomlar, keyin "OLIB KETISH (SABOY)" guruhi
  const hallItems = dineIn ? items.filter((it) => !it.takeaway) : items;
  const takeawayItems = dineIn ? items.filter((it) => !!it.takeaway) : [];
  for (const it of hallItems) ticketItem(b, it);
  if (takeawayItems.length) {
    b.align('center').bold(true).wrapped(TAKEAWAY_SEPARATOR).bold(false).align('left');
    for (const it of takeawayItems) ticketItem(b, it);
  }
  b.divider();

  const orderNote = clean(order.note);
  if (orderNote) {
    b.bold(true).wrapped(`IZOH: ${orderNote}`, { hang: 6 }).bold(false);
    b.divider();
  }

  b.feed(autoCut ? 2 : 6);
  if (autoCut) b.cut();
  return b.build();
}
