import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../state/auth';
import { useConnectivity } from '../state/connectivity';
import { ThemeLangControls } from './ThemeLangControls';
import { useI18n } from '../state/i18n';

// Barcha ekranlar uchun umumiy ramka: yuqori panel + kontent
export function AppShell({
  title,
  children,
  hideHome,
  hideMobileControls,
  mobileDrawer,
  mobileDrawerTitle,
}: {
  title: string;
  children: React.ReactNode;
  hideHome?: boolean; // admin panelida bosh sahifa yon menu tagida bo'ladi
  hideMobileControls?: boolean; // mobil: til/tema/akkaunt pastki "Profil" bo'limiga ko'chirilgan
  // mobil: o'ng yuqoridagi hamburger bosilganda o'ngdan chiqadigan yon menu (zallar/kategoriyalar)
  mobileDrawer?: (close: () => void) => React.ReactNode;
  mobileDrawerTitle?: string;
}) {
  const { user, logout } = useAuth();
  const { online, pending } = useConnectivity();
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useLayoutEffect(() => {
    if (!menuOpen || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onScroll = () => setMenuOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [menuOpen]);

  return (
    <div className="h-full flex flex-col app-bg text-text">
      <header className="relative z-50 flex items-center justify-between gap-2 px-3 sm:px-6 py-2.5 glass border-b border-border">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-primary font-extrabold text-lg tracking-tight shrink-0">
            DasturXon
          </span>
          <span className="text-muted hidden lg:inline">/</span>
          <span className="font-semibold truncate hidden lg:inline">{title}</span>
        </div>

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
          <div className={`items-center gap-2 sm:gap-3 ${hideMobileControls ? 'hidden md:flex' : 'flex'}`}>
          <ThemeLangControls />

          {/* Foydalanuvchi menyusi — ism/avatar bosilganda Chiqish chiqadi */}
          <div className="relative">
            <button
              ref={btnRef}
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

            {menuOpen &&
              createPortal(
                <div
                  ref={menuRef}
                  style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 1000 }}
                  className="w-52 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden animate-card-in"
                >
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
                </div>,
                document.body,
              )}
          </div>
          </div>

          {/* Mobil: o'ng yuqoridagi hamburger — yon menuni ochadi */}
          {mobileDrawer && (
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Menyu"
              className="md:hidden w-10 h-10 rounded-lg border border-border hover:border-primary flex items-center justify-center gap-[3px] flex-col"
            >
              <span className="block w-5 h-0.5 bg-text rounded-full" />
              <span className="block w-5 h-0.5 bg-text rounded-full" />
              <span className="block w-5 h-0.5 bg-text rounded-full" />
            </button>
          )}
        </div>
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>

      {/* Mobil: o'ngdan chiqadigan yon menu (drawer) */}
      {mobileDrawer && drawerOpen && (
        <div className="md:hidden fixed inset-0 z-[70]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-72 max-w-[85vw] bg-surface border-l border-border shadow-2xl flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-border shrink-0">
              <span className="font-bold text-lg">{mobileDrawerTitle ?? 'Menyu'}</span>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Yopish"
                className="w-9 h-9 rounded-lg hover:bg-bg flex items-center justify-center text-xl text-muted hover:text-text"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3">{mobileDrawer(() => setDrawerOpen(false))}</div>
          </div>
        </div>
      )}
    </div>
  );
}
