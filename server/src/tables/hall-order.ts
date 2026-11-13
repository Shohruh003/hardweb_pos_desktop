// Zallar tartibi (settings.hallOrder) — stollar ro'yxati va ochiq buyurtmalarni saralash uchun.
// Renderer'dagi sortHalls() bilan bir xil qoida: ro'yxatdagilar o'sha tartibda, qolganlari
// (ro'yxatda yo'q yangi zallar) oxirida alifbo bo'yicha.

/** hallOrder qiymatini tozalash: faqat satrlar, chetidagi bo'shliqlarsiz, bo'shlarsiz, takrorlarsiz */
export function normalizeHallList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Ikki zal nomini sozlamadagi tartib bo'yicha solishtiruvchi funksiya */
export function hallComparator(
  hallOrder: readonly string[] | null | undefined,
): (a: string, b: string) => number {
  const pos = new Map<string, number>();
  (Array.isArray(hallOrder) ? hallOrder : []).forEach((h, i) => {
    if (typeof h === 'string' && !pos.has(h)) pos.set(h, i);
  });
  return (a, b) => {
    const pa = pos.get(a);
    const pb = pos.get(b);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return (a ?? '').localeCompare(b ?? '', 'uz');
  };
}
