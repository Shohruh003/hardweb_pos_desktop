// Taom rasmlari: assets/menu/ papkasidagi rasmlarni yuklaydi (bo'lsa).
// Foydalanuvchi shu papkaga rasm tashlasa, avtomatik ko'rinadi. Asosiy manba — server
// (MenuItem.imageUrl, admin yuklagan rasm); bu papka faqat zaxira (demo / standart rasmlar).
const mods = import.meta.glob('../assets/menu/*.{jpg,jpeg,png,webp}', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const byKey: Record<string, string> = {};
for (const p in mods) {
  const base = p.split('/').pop()!.replace(/\.\w+$/, '').toLowerCase();
  byKey[base] = mods[p];
}

/** O'zbekcha apostrof turlari: ' ‘ ’ ` ʻ ʼ — taqqoslashda bir xil hisoblanadi (olib tashlanadi) */
const APOSTROPHES = /['‘’`ʻʼ]/g;

/** Qidiruv / taqqoslash uchun matn: kichik harf, apostrofsiz ("Go‘sht" = "go'sht" = "gosht") */
export function normalizeName(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .trim();
}

// Nomdan kalit (slug) yasash: "Lag‘mon" -> "lagmon", "Osh (palov)" -> "osh-palov"
function slug(name: string): string {
  return normalizeName(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Rasm bor bo'lsa URL, aks holda undefined
export function getMenuImage(name: string, key?: string): string | undefined {
  if (key && byKey[key]) return byKey[key];
  return byKey[slug(name)];
}

// Rasm bo'lmasa — taomga mos emoji. So'z boshidan qidiriladi ("kartoshka" ichidagi "osh" osh emas).
// Faqat eski (Windows 10 ham to'g'ri chizadigan) emojilar ishlatilgan.
const EMOJI_RULES: [RegExp, string][] = [
  [/\b(osh|palov|plov|guruch|rice)/, '🍚'],
  [/\b(lagmon|noodle|makaron|pasta|spagetti)/, '🍜'],
  [/\b(manti|chuchvara|xinkal|pelmen|dumpling)/, '🥟'],
  [/\b(somsa|samsa)/, '🥟'],
  [/\b(tabaka|tovuq|chicken|qanot|kfc)/, '🍗'],
  [/\b(kartoshka|kartofel|fri\b|free\b)/, '🍟'],
  [/\b(baliq|fish|losos|forel)/, '🐟'],
  [/\b(shashlik|kabob|kabab|kebab|gosht|steak|jiz|barbekyu|bbq|jigar|dumba|quyruq|farsh|buglama|qazi|lula|lyulya|beef)|\bmol\b/, '🍖'],
  [/\b(salat|salad|sezar|achchiq|chuchuk|vinegret)/, '🥗'],
  [/\b(shorva|bulyon|sup|soup|mastava|guja|kuza)/, '🍲'],
  [/\b(pishloq|ser|cheese)\b/, '🧀'],
  [/\b(idish|konteyner|paket|saboy)/, '🥡'],
  [/\b(kofe|coffee|kapuchino|latte|espresso)/, '☕'],
  [/\b(choy|tea)/, '🍵'],
  [/\b(cola|kola|fanta|sprite|pepsi|gaz|juice|sharbat|kompot|limonad|suv|water|ayron|moxito|mojito)/, '🥤'],
  [/\b(pivo|beer|vino|wine|aroq|vodka|konyak)/, '🍺'],
  [/\b(non|bread|patir|lavash|lepyoshka)/, '🥖'],
  [/\b(shirin|tort|cake|desert|pirog|pirojniy|chakchak|halva|pishiriq)/, '🍰'],
  [/\b(muzqaymoq|morojniy|ice)/, '🍨'],
  [/\b(meva|fruit|olma|uzum|tarvuz|qovun)/, '🍇'],
  [/\b(sigaret|sigareta|tamaki)/, '🚬'],
  [/\bkomir/, '🔥'],
];

export function emojiFor(name: string): string {
  const n = normalizeName(name);
  for (const [re, emoji] of EMOJI_RULES) if (re.test(n)) return emoji;
  return '🍽️';
}

// Yorqin gradient plitka tanlash (nom bo'yicha barqaror)
export function tileClass(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `tile-${(h % 6) + 1}`;
}
