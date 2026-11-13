// Minimal ESC/POS enkoder (tashqi kutubxonasiz) — server tomonida bo'lim (oshxona/bar...)
// printerlari uchun. desktop/src/main/escpos.ts dagi EscPosBuilder'ning server nusxasi:
// buyruqlar (ESC @, ESC a, ESC E, GS !, GS V) va qog'ozdagi ko'rinish bir xil.
//
// Kod sahifasi tanlanmaydi — termal printerlar ASCII'ni ishonchli chiqaradi. Shuning uchun har
// qanday matn avval ASCII'ga o'giriladi: o‘zbekcha tutuq belgilari -> ', kirill -> lotin
// ("Плов" -> "Plov", "Қовоқ" -> "Qovoq"), lotin diakritikasi olib tashlanadi ("Crème" -> "Creme").

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// ---------------------------------------------------------------------------------------------
// Matnni printer uchun ASCII'ga o'girish
// ---------------------------------------------------------------------------------------------

// Kirill -> lotin. O'zbek lotin imlosi asosida (x, j, ts, sh...), rus so'zlari ham o'qiladi:
// "Шашлык" -> "Shashlik", "Борщ" -> "Borsh", "Ўрик" -> "O'rik", "Ғалла" -> "G'alla".
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
    // "е" so'z boshida, unli yoki ъ/ь dan keyin "ye" o'qiladi: "Ер" -> "Yer", "Объект" -> "Ob'yekt"
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

// Kirill transliteratsiyasidan keyingi almashtirishlar (tartib muhim emas — hammasi ASCII beradi)
const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[‘’ʻʼʹ´′]/g, "'"], // o‘zbekcha tutuq belgilari (o‘, g‘, ʻ, ʼ) -> '
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
  // Turli bo'shliqlar (NBSP, tor bo'shliq...) -> oddiy bo'shliq
  [/[  -   　]/g, ' '],
  // Ko'rinmas belgilar (zero-width, variation selector) -> olib tashlanadi
  [/[​-‍⁠﻿︀-️]/g, ''],
];

/**
 * Matnni termal printer uchun xavfsiz ASCII'ga o'girish.
 * Bo'shliqlar saqlanadi (qator ichidagi chekinishlar buzilmasin); boshqaruv belgilari (ESC, \n...)
 * bo'shliqqa almashtiriladi — foydalanuvchi matni printer buyrug'iga aylanib qolmasligi uchun.
 * ASCII matnga qayta qo'llansa o'zgarmaydi.
 */
export function toPrintable(value: unknown): string {
  let s = String(value ?? '');
  if (/^[\x20-\x7E]*$/.test(s)) return s; // tez yo'l: allaqachon toza ASCII
  s = transliterateCyrillic(s.normalize('NFC'));
  for (const [re, to] of REPLACEMENTS) s = s.replace(re, to);
  // Lotin diakritikasi: é -> e, ş -> s, ö -> o (NFD + birikuvchi belgilarni olib tashlash).
  // NFD'dan keyin ochilib qolgan kirill asoslari (masalan ѝ -> и) yana o'giriladi.
  s = transliterateCyrillic(s.normalize('NFD').replace(/\p{M}/gu, ''));
  // Emoji/piktogrammalar printerda baribir chiqmaydi — olib tashlaymiz
  s = s.replace(/\p{Extended_Pictographic}/gu, '').replace(/[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu, '');
  // Boshqaruv belgilari -> bo'shliq; qolgan har qanday ASCII bo'lmagan belgi -> '?'
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/[^\x20-\x7E]/g, '?');
}

/**
 * ASCII qatorni `width` belgidan oshmaydigan qatorlarga so'z chegarasida bo'lish.
 * Boshidagi chekinish (masalan "   >> izoh") birinchi qatorda saqlanadi.
 * hangIndent — 2-qatordan boshlab chap chekinish (masalan "2 x " dan keyingi nom ostidan davom etish);
 * chekinish qator kengligining yarmidan katta bo'lsa ishlatilmaydi.
 * Bitta so'z butun qatordan uzun bo'lsa — bo'lib yuboriladi.
 */
export function wrapText(text: string, width: number, hangIndent = 0): string[] {
  const words = text.split(' ').filter(Boolean);
  if (words.length === 0) return [''];
  const w = Math.max(1, Math.floor(width));
  const indent = hangIndent > 0 && hangIndent <= w / 2 ? Math.floor(hangIndent) : 0;
  const lines: string[] = [];
  // Birinchi qatorning chekinishi (kamida 1 ta belgiga joy qoladi)
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
        // joriy qator to'ldi — so'zni yangi qatorga o'tkazamiz
        flush(cur);
        cur = '';
      } else {
        // so'z butun qatordan uzun — qator kengligida kesamiz
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

export type Align = 'left' | 'center' | 'right';

export interface WrapOptions {
  /** Ikki barobar (eni va bo'yi) shrift — qatorga width/2 belgi sig'adi */
  double?: boolean;
  /** 2-qatordan boshlab chekinish (belgilarda, shu shrift o'lchamida) */
  hang?: number;
}

export class EscPosBuilder {
  private readonly chunks: Buffer[] = [];

  /** width — qog'oz kengligi belgilarda: 58 mm ≈ 32, 80 mm ≈ 48 */
  constructor(readonly width: number) {
    this.raw([ESC, 0x40]); // ESC @ — printerni boshlang'ich holatga keltirish
  }

  private raw(bytes: number[]): this {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  align(a: Align): this {
    return this.raw([ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0]);
  }

  bold(on: boolean): this {
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  }

  /** Matn o'lchami: false — oddiy, true — ikki barobar (eni+bo'yi) */
  size(double: boolean): this {
    return this.raw([GS, 0x21, double ? 0x11 : 0x00]);
  }

  text(t: string): this {
    this.chunks.push(Buffer.from(toPrintable(t), 'ascii'));
    return this;
  }

  line(t = ''): this {
    return this.text(t).raw([LF]);
  }

  /**
   * Matnni qog'oz kengligiga moslab (so'z chegarasida) bir yoki bir necha qatorda chiqarish.
   * Printerning o'zi so'z o'rtasidan bo'lib yubormasligi uchun qatorlarni oldindan bo'lamiz.
   */
  wrapped(t: string, opts: WrapOptions = {}): this {
    const cols = opts.double ? Math.floor(this.width / 2) : this.width;
    const lines = wrapText(toPrintable(t), cols, opts.hang ?? 0);
    if (opts.double) this.size(true);
    for (const l of lines) this.line(l);
    if (opts.double) this.size(false);
    return this;
  }

  divider(ch = '-'): this {
    return this.line(ch.repeat(this.width));
  }

  feed(n = 1): this {
    return this.raw(new Array(Math.max(0, n)).fill(LF));
  }

  /** Qog'ozni kesish joyigacha surib, qisman kesish (GS V 66 0) */
  cut(): this {
    return this.raw([GS, 0x56, 0x42, 0x00]);
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
