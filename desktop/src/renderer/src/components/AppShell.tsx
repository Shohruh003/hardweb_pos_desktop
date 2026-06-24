import React from 'react';
import { useAuth } from '../state/auth';
import { Button } from './ui';

const ROLE_LABEL: Record<string, string> = {
  ofitsiant: 'Ofitsiant',
  oshpaz: 'Oshxona (KDS)',
  kassir: 'Kassa',
  administrator: 'Administrator',
  direktor: 'Direktor',
};

// Barcha ekranlar uchun umumiy ramka: yuqori panel + kontent
export function AppShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  return (
    <div className="h-full flex flex-col bg-bg text-text">
      <header className="flex items-center justify-between px-6 py-3 bg-surface border-b border-border">
        <div className="flex items-center gap-3">
          <span className="text-primary font-bold text-lg">HardWeb POS</span>
          <span className="text-muted">/</span>
          <span className="font-semibold">{title}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-sm font-semibold">{user?.name}</div>
            <div className="text-xs text-muted">
              {ROLE_LABEL[user?.role ?? ''] ?? user?.role}
            </div>
          </div>
          <Button variant="ghost" onClick={logout}>
            Chiqish
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
