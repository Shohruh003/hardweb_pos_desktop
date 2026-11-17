import { createContext, useContext, useState, ReactNode } from 'react';
import type { OrderType } from '@hardweb-pos/shared';

// Qaysi modul ochilgan (launcher = null). AppShell 'Bosh sahifa' tugmasi shu orqali.
type ModuleKey = 'waiter' | 'kitchen' | 'cashier' | 'reports' | 'admin' | null;

/** Ofitsiant (POS) ekranini aniq joyda ochish: kassadan "✏️ O'zgartirish" / stol xaritasidan */
export interface WaiterTarget {
  /** shu buyurtmani (hisobni) ochish — stol hisobi bo'lsa o'sha stol + hisob tanlanadi */
  orderId?: string;
  /** shu stolni ochish (bo'sh bo'lsa — yangi buyurtma) */
  tableId?: string;
}

export interface OpenModuleOptions {
  /** Ofitsiant ekrani qaysi rejimda ochilsin (kassadagi "+ Yangi buyurtma" — olib ketish / yetkazish) */
  waiterMode?: OrderType;
  /** Ofitsiant ekranida darhol ochiladigan stol/buyurtma */
  waiterTarget?: WaiterTarget;
}

interface NavCtx {
  module: ModuleKey;
  /**
   * Xodim bosh sahifani (launcher) o'zi tanladi ("← Orqaga"). Kassir kirganda tanlov oynasisiz
   * kassa (POS) ekraniga tushadi — faqat "Orqaga" bosgandagina launcher ko'rinadi.
   */
  home: boolean;
  /**
   * Ofitsiant ekrani ochilganda tanlanadigan rejim (open('waiter', {waiterMode}) bilan beriladi).
   * WaiterPage uni bir marta o'qiydi (mount'da) va consumeWaiterMode() bilan tozalaydi.
   */
  waiterMode: OrderType | null;
  /** Ofitsiant ekranida darhol ochiladigan stol/buyurtma (bir marta o'qiladi: consumeWaiterTarget) */
  waiterTarget: WaiterTarget | null;
  open: (m: ModuleKey, opts?: OpenModuleOptions) => void;
  consumeWaiterMode: () => OrderType | null;
  consumeWaiterTarget: () => WaiterTarget | null;
  goHome: () => void;
  /** Xodim almashganda (chiqish / boshqa xodim kirishi): boshlang'ich holat — modul ham, "home" ham yo'q */
  resetNav: () => void;
}

const Ctx = createContext<NavCtx | null>(null);

export function AppNavProvider({ children }: { children: ReactNode }) {
  const [module, setModule] = useState<ModuleKey>(null);
  const [home, setHome] = useState(false);
  const [waiterMode, setWaiterMode] = useState<OrderType | null>(null);
  const [waiterTarget, setWaiterTarget] = useState<WaiterTarget | null>(null);
  const value: NavCtx = {
    module,
    home,
    waiterMode,
    waiterTarget,
    open: (m, opts) => {
      setWaiterMode(opts?.waiterMode ?? null);
      setWaiterTarget(opts?.waiterTarget ?? null);
      setModule(m);
      setHome(m === null);
    },
    consumeWaiterMode: () => {
      const m = waiterMode;
      if (m) setWaiterMode(null);
      return m;
    },
    consumeWaiterTarget: () => {
      const t = waiterTarget;
      if (t) setWaiterTarget(null);
      return t;
    },
    goHome: () => {
      setWaiterMode(null);
      setWaiterTarget(null);
      setModule(null);
      setHome(true);
    },
    resetNav: () => {
      setWaiterMode(null);
      setWaiterTarget(null);
      setModule(null);
      setHome(false);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppNav(): NavCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppNav AppNavProvider ichida ishlatilishi kerak');
  return ctx;
}
