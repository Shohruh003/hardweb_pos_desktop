import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../state/auth';
import { useConnectivity } from '../state/connectivity';
import { MOCK } from '../lib/api';
import { DemoSwitcher } from './DemoSwitcher';
import { ThemeLangControls } from './ThemeLangControls';
import { useI18n } from '../state/i18n';
import { useAppNav } from '../state/appNav';

// Barcha ekranlar uchun umumiy ramka: yuqori panel + kontent
export function AppShell({
  title,
  children,
  hideHome,
}: {
  title: string;
  children: React.ReactNode;
  hideHome?: boolean; // admin panelida bosh sahifa yon menu tagida bo'ladi
}) {
  const { user, logout } = useAuth();
  const { online, pending } = useConnectivity();
  const { t } = useI18n();
  const { goHome } = useAppNav();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  return (
    <div className="h-full flex flex-col app-bg text-text">
      <header className="flex items-center justify-between gap-2 px-3 sm:px-6 py-2.5 glass border-b border-border">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {!hideHome && (
            <button
              onClick={goHome}
              title="Bosh sahifaga qaytish"
              className="shrink-0 flex items-center gap-1.5 px-2.5 sm:px-3 h-9 rounded-lg border border-border hover:border-primary hover:bg-surface-hover font-semibold"
            >
              <span className="text-lg leading-none">←</span>
              <span className="hidden sm:inline text-sm">Bosh sahifa</span>
              <span className="sm:hidden text-lg leading-none">🏠</span>
            </button>
          )}
          <span className="text-primary font-extrabold text-lg tracking-tight shrink-0 hidden lg:inline">
            DasturXon
          </span>
          <span className="text-muted hidden lg:inline">/</span>
          <span className="font-semibold truncate">{title}</span>
        </div>

        {/* Demo: panel almashtirgich (faqat mock rejimda) */}
        {MOCK && <DemoSwitcher />}

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Ulanish holati — mobilda faqat nuqta */}
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-success' : 'bg-danger'}`}
              title={online ? t('common.online') : t('common.offline')}
            />
            <span className="text-sm text-muted hidden md:inline">
              {online ? t('common.online') : t('common.offline')}
            </span>
            {pending > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-warning/20 text-warning text-xs font-semibold">
                {pending}
              </span>
            )}
          </div>
          <ThemeLangControls />

          {/* Foydalanuvchi menyusi — ism/avatar bosilganda Chiqish chiqadi */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg border border-border hover:border-primary hover:bg-surface-hover pl-1.5 pr-1 sm:pr-2 py-1 transition-colors"
            >
              <span className="w-7 h-7 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-sm shrink-0">
                {user?.name?.charAt(0) ?? '?'}
              </span>
              <span className="text-right hidden lg:block leading-tight">
                <span className="block text-sm font-semibold">{user?.name}</span>
                <span className="block text-xs text-muted">
                  {t(`role.${user?.role ?? ''}`, user?.role)}
                </span>
              </span>
              <span className={`text-muted text-xs transition-transform ${menuOpen ? 'rotate-180' : ''}`}>▾</span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-card-in">
                <div className="px-4 py-3 border-b border-border lg:hidden">
                  <div className="font-semibold truncate">{user?.name}</div>
                  <div className="text-xs text-muted">{t(`role.${user?.role ?? ''}`, user?.role)}</div>
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-danger font-semibold hover:bg-danger/10 transition-colors"
                >
                  <span className="text-lg leading-none">⎋</span>
                  {t('common.logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
