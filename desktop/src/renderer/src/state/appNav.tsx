import { createContext, useContext, useState, ReactNode } from 'react';

// Qaysi modul ochilgan (launcher = null). AppShell 'Bosh sahifa' tugmasi shu orqali.
type ModuleKey = 'waiter' | 'kitchen' | 'cashier' | 'reports' | 'admin' | null;

interface NavCtx {
  module: ModuleKey;
  open: (m: ModuleKey) => void;
  goHome: () => void;
}

const Ctx = createContext<NavCtx | null>(null);

export function AppNavProvider({ children }: { children: ReactNode }) {
  const [module, setModule] = useState<ModuleKey>(null);
  return (
    <Ctx.Provider
      value={{ module, open: (m) => setModule(m), goHome: () => setModule(null) }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAppNav(): NavCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppNav AppNavProvider ichida ishlatilishi kerak');
  return ctx;
}
