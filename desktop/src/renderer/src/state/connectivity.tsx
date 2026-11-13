import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';
import { getSocket } from '../lib/socket';
import { flushPending, hasRetryablePending, onPendingChange } from '../lib/offlineQueue';

interface ConnectivityState {
  online: boolean; // serverga (socket) ulanganmi
  pending: number; // yuborilmagan buyurtmalar soni
  flushNow: () => Promise<void>;
}

const Ctx = createContext<ConnectivityState | null>(null);

/** Socket ulangan bo'lsa ham navbatni shu oraliqda tekshiramiz (qisqa uzilishda "connect" kelmaydi) */
const FLUSH_INTERVAL_MS = 15_000;

// Navbatni yuborish — bir vaqtda bitta jarayon (offlineQueue o'zi kafolatlaydi)
async function flushNow(): Promise<void> {
  try {
    await flushPending();
  } catch {
    /* keyingi urinishda */
  }
}

export function ConnectivityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => {
      setOnline(true);
      // Ulanish tiklandi — kutilayotgan buyurtmalarni yuborish (TZ F-1.10)
      void flushNow();
    };
    const onDisconnect = () => setOnline(false);
    // Qurilma tarmog'i qaytdi (Wi-Fi) — socket hali ulanmagan bo'lsa ham urinib ko'ramiz
    const onBrowserOnline = () => {
      if (hasRetryablePending()) void flushNow();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setOnline(socket.connected);
    window.addEventListener('online', onBrowserOnline);

    // Davriy tekshiruv: POST tarmoq xatosi bilan navbatga tushgan, lekin socket uzilmagan
    // (demak "connect" hodisasi kelmaydigan) holatlar uchun
    const timer = window.setInterval(() => {
      if (socket.connected && hasRetryablePending()) void flushNow();
    }, FLUSH_INTERVAL_MS);

    const unsub = onPendingChange(setPending);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      window.removeEventListener('online', onBrowserOnline);
      window.clearInterval(timer);
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
