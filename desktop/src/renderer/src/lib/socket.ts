import { io, Socket } from 'socket.io-client';
import { getServerUrl } from './config';

const MOCK = import.meta.env.VITE_MOCK === '1';
let socket: Socket | null = null;

// ---- Demo (mock) rejim uchun soxta socket — ilova ichidagi hodisalar shinasi ----
// Mock server (lib/mock.ts) hodisalarni mockEmit() orqali yuboradi. Real buildda bu qism
// ishlatilmaydi (MOCK=false), shuning uchun bundledan tushib qoladi.
type Listener = (payload: unknown) => void;
const mockListeners: Record<string, Set<Listener>> = {};
const mockSocket = {
  connected: true,
  on(ev: string, cb: Listener) {
    (mockListeners[ev] ??= new Set()).add(cb);
    return mockSocket;
  },
  off(ev: string, cb: Listener) {
    mockListeners[ev]?.delete(cb);
    return mockSocket;
  },
  emit() {
    return mockSocket;
  },
};

/** Mock server hodisasi (order:created/updated/closed, print:*) — barcha tinglovchilarga */
export function mockEmit(ev: string, payload: unknown): void {
  mockListeners[ev]?.forEach((cb) => {
    try {
      cb(payload);
    } catch (e) {
      // Real serverdagi kabi: tinglovchi xatosi API javobiga ta'sir qilmaydi
      console.error(`[mock] "${ev}" tinglovchisida xato:`, e);
    }
  });
}

// Real-time ulanish (KDS, navbat, ofitsiant uchun yagona socket).
// Manzil ilova ishga tushganda olinadi; server manzili o'zgartirilsa oyna qayta yuklanadi
// (config.applyServerUrl), shuning uchun socket doim joriy manzilga ulanadi.
export function getSocket(): Socket {
  if (MOCK) return mockSocket as unknown as Socket;
  if (!socket) {
    socket = io(getServerUrl(), {
      transports: ['websocket'],
      reconnection: true,
    });
  }
  return socket;
}
