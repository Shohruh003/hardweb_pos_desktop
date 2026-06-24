import React, { createContext, useContext, useState } from 'react';
import { useAuth } from './auth';

// Demo/prezentatsiya navigatsiyasi: bitta tugma bilan barcha panellar o'rtasida o'tish.
// Faqat mock rejimda ko'rsatiladi (server kerak emas).
interface DemoNav {
  queue: boolean; // navbat ekrani ko'rsatilsinmi
  openQueue: () => void;
  openRole: (login: string) => void; // rol panelini ochish (avtomatik login)
}

const Ctx = createContext<DemoNav | null>(null);

export function DemoNavProvider({ children }: { children: React.ReactNode }) {
  const { login } = useAuth();
  const [queue, setQueue] = useState(false);

  function openQueue() {
    setQueue(true);
  }
  function openRole(loginName: string) {
    setQueue(false);
    // mock rejimda parol baribir 1234
    login(loginName, '1234').catch(() => {});
  }

  return (
    <Ctx.Provider value={{ queue, openQueue, openRole }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDemoNav(): DemoNav {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDemoNav DemoNavProvider ichida bo‘lishi kerak');
  return ctx;
}
