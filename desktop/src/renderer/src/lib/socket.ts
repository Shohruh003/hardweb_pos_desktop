import { io, Socket } from 'socket.io-client';
import { getServerUrl } from './config';
import { getToken } from './api';

const MOCK = import.meta.env.VITE_MOCK === '1';
let socket: Socket | null = null;
/**
 * Oxirgi ulanish so'rovi (handshake) qaysi token bilan yuborilgan: undefined — hali yuborilmagan,
 * null — tokensiz (login ekrani). Token o'zgarganini aniqlash uchun (syncSocketAuth).
 */
let handshakeToken: string | null | undefined;

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

// Real-time ulanish (KDS, kassa, ofitsiant uchun yagona socket).
// Manzil ilova ishga tushganda olinadi; server manzili o'zgartirilsa oyna qayta yuklanadi
// (config.applyServerUrl), shuning uchun socket doim joriy manzilga ulanadi.
// Har (qayta) ulanishda joriy token yuboriladi: server faqat tokeni yaroqli ulanishga buyurtma, chek
// va printer hodisalarini yuboradi. Tokensiz ulanish (login ekrani) faqat aloqa holatini biladi.
export function getSocket(): Socket {
  if (MOCK) return mockSocket as unknown as Socket;
  if (!socket) {
    socket = io(getServerUrl(), {
      transports: ['websocket'],
      reconnection: true,
      auth: (cb) => {
        const token = getToken();
        handshakeToken = token;
        cb(token ? { token } : {});
      },
    });
  }
  return socket;
}

/**
 * Token o'zgargan bo'lsa (kirish, chiqish, sessiya tugashi) — socket yangi token bilan qayta ulanadi
 * va server uni qaytadan tekshiradi (xodim hodisalari faqat yaroqli tokenli ulanishga). Token
 * o'zgarmagan bo'lsa hech narsa qilmaydi — istalgancha chaqirish mumkin. Demo (mock) rejimida — yo'q.
 */
export function syncSocketAuth(): void {
  if (MOCK || !socket) return;
  // Ulanish so'rovi hali yuborilmagan — auth() joriy tokenni o'zi oladi
  if (handshakeToken === undefined) return;
  if (handshakeToken === getToken()) return;
  socket.disconnect().connect();
}
