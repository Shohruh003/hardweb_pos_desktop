import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { getSocket } from '../lib/socket';
import { flushPending, onPendingChange } from '../lib/offlineQueue';

interface ConnectivityState {
  online: boolean; // serverga (socket) ulanganmi
  pending: number; // yuborilmagan buyurtmalar soni
  flushNow: () => Promise<void>;
}

const Ctx = createContext<ConnectivityState | null>(null);

export function ConnectivityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState(0);
  const flushing = useRef(false);

  async function flushNow() {
    if (flushing.current) return;
    flushing.current = true;
    try {
      await flushPending();
    } finally {
      flushing.current = false;
    }
  }

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => {
      setOnline(true);
      // Ulanish tiklandi — kutilayotgan buyurtmalarni yuborish (TZ F-1.10)
      flushNow();
    };
    const onDisconnect = () => setOnline(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setOnline(socket.connected);

    const unsub = onPendingChange(setPending);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      unsub();
    };
  }, []);

  return (
    <Ctx.Provider value={{ online, pending, flushNow }}>
      {children}
    </Ctx.Provider>
  );
}

export function useConnectivity(): ConnectivityState {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error('useConnectivity ConnectivityProvider ichida bo‘lishi kerak');
  return ctx;
}
