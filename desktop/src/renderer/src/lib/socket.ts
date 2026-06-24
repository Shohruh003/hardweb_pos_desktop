import { io, Socket } from 'socket.io-client';
import { getServerUrl } from './config';

let socket: Socket | null = null;

// Real-time ulanish (KDS, navbat, ofitsiant uchun yagona socket)
export function getSocket(): Socket {
  if (!socket) {
    socket = io(getServerUrl(), {
      transports: ['websocket'],
      reconnection: true,
    });
  }
  return socket;
}
