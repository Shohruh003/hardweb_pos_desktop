// Offline navbat (TZ F-1.10, NF-3): tarmoq uzilganda buyurtmalar localStorage'da
// saqlanadi va ulanish tiklanganda serverga yuboriladi.
import { api } from './api';

export interface PendingOrder {
  localId: string; // lokal id (vaqt asosida)
  tableId: string;
  tableNumber?: number;
  waiterId?: string;
  items: { menuItemId: string; quantity: number; note?: string }[];
  createdAt: number;
}

const KEY = 'pending_orders';
type Listener = (count: number) => void;
const listeners = new Set<Listener>();

function read(): PendingOrder[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function write(list: PendingOrder[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  listeners.forEach((l) => l(list.length));
}

export function pendingCount(): number {
  return read().length;
}

export function onPendingChange(l: Listener): () => void {
  listeners.add(l);
  l(read().length);
  return () => listeners.delete(l);
}

export function enqueue(order: Omit<PendingOrder, 'localId' | 'createdAt'>): void {
  const list = read();
  // Math.random ishlatmaymiz — vaqt + uzunlik yetarli noyob
  const createdAt = Date.now();
  list.push({ ...order, localId: `local-${createdAt}-${list.length}`, createdAt });
  write(list);
}

// Navbatdagi barcha buyurtmalarni serverga yuborishga urinish.
// Muvaffaqiyatlilar navbatdan o'chiriladi; xato bo'lsa keyingi urinishga qoladi.
export async function flushPending(): Promise<number> {
  let list = read();
  if (list.length === 0) return 0;

  let sent = 0;
  const remaining: PendingOrder[] = [];
  for (const p of list) {
    try {
      await api.post('/orders', {
        tableId: p.tableId,
        waiterId: p.waiterId,
        items: p.items,
      });
      sent++;
    } catch {
      remaining.push(p); // hali yuborilmadi
    }
  }
  write(remaining);
  return sent;
}
