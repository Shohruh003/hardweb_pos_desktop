// Taom rasmlari: assets/menu/ papkasidagi rasmlarni yuklaydi (bo'lsa).
// Foydalanuvchi shu papkaga rasm tashlasa, avtomatik ko'rinadi.
const mods = import.meta.glob('../assets/menu/*.{jpg,jpeg,png,webp}', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const byKey: Record<string, string> = {};
for (const p in mods) {
  const base = p.split('/').pop()!.replace(/\.\w+$/, '').toLowerCase();
  byKey[base] = mods[p];
}

// Nomdan kalit (slug) yasash: "Lag'mon" -> "lagmon"
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Rasm bor bo'lsa URL, aks holda undefined
export function getMenuImage(name: string, key?: string): string | undefined {
  if (key && byKey[key]) return byKey[key];
  return byKey[slug(name)];
}

// Rasm bo'lmasa — taomga mos emoji
export function emojiFor(name: string): string {
  const n = name.toLowerCase();
  if (/(osh|palov|plov|guruch|rice)/.test(n)) return '🍚';
  if (/(lag|noodle|makaron|past)/.test(n)) return '🍜';
  if (/(shashlik|kabob|kebab|go['’]?sht|steak|jiz)/.test(n)) return '🍖';
  if (/(salat|salad|sezar|achchiq|chuchuk)/.test(n)) return '🥗';
  if (/(choy|tea|kofe|coffee)/.test(n)) return '🍵';
  if (/(cola|fanta|sprite|gaz|juice|sharbat|suv|water)/.test(n)) return '🥤';
  if (/(pivo|beer|vino|wine|aroq)/.test(n)) return '🍺';
  if (/(non|bread|somsa|patir)/.test(n)) return '🥖';
  if (/(shirin|tort|cake|desert|muz)/.test(n)) return '🍰';
  if (/(sho['’]?rva|sup|soup|mast)/.test(n)) return '🍲';
  return '🍽️';
}

// Yorqin gradient plitka tanlash (nom bo'yicha barqaror)
export function tileClass(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `tile-${(h % 6) + 1}`;
}
