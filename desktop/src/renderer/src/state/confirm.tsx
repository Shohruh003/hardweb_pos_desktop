import React, { createContext, useContext, useRef, useState } from 'react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;
const Ctx = createContext<ConfirmFn | null>(null);

// Chiroyli tasdiqlash modali (native confirm() o'rniga)
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(v: boolean) => void>();

  const confirm: ConfirmFn = (o) => {
    setOpts(typeof o === 'string' ? { message: o } : o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  };

  function close(v: boolean) {
    resolver.current?.(v);
    setOpts(null);
  }

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {opts && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 animate-overlay-in p-4"
          onClick={() => close(false)}
        >
          <div
            className="bg-surface border border-border rounded-3xl w-[400px] p-7 text-center animate-pop-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`mx-auto mb-4 w-16 h-16 rounded-full flex items-center justify-center text-3xl animate-ring ${
                opts.danger ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning'
              }`}
            >
              {opts.danger ? '🗑️' : '❓'}
            </div>
            {opts.title && <div className="text-xl font-extrabold mb-1">{opts.title}</div>}
            <div className="text-muted mb-6">{opts.message}</div>
            <div className="flex gap-3">
              <button
                onClick={() => close(false)}
                className="flex-1 py-3 rounded-xl font-semibold bg-bg border border-border hover:border-text active:scale-[0.97] transition-all"
              >
                {opts.cancelText || 'Bekor qilish'}
              </button>
              <button
                onClick={() => close(true)}
                className={`flex-1 py-3 rounded-xl font-bold text-white active:scale-[0.97] transition-all hover:brightness-110 ${
                  opts.danger ? 'bg-danger' : 'bg-primary'
                }`}
              >
                {opts.confirmText || 'Ha'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConfirm ConfirmProvider ichida bo‘lishi kerak');
  return ctx;
}
