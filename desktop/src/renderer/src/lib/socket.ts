import { io, Socket } from 'socket.io-client';
import { getServerUrl } from './config';
import { mockSocket } from './mock';

const MOCK = import.meta.env.VITE_MOCK === '1';
let socket: Socket | null = null;

// Real-time ulanish (KDS, navbat, ofitsiant uchun yagona socket)
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
