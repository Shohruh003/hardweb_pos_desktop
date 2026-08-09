import { useState } from 'react';
import { hasCapability } from '@hardweb-pos/shared';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../state/auth';
import { useI18n } from '../state/i18n';
import { useAppNav } from '../state/appNav';
import { MenuTab } from './admin/MenuTab';
import { SkladTab } from './admin/SkladTab';
import { StationsTab } from './admin/StationsTab';
import { CategoriesTab } from './admin/CategoriesTab';
import { TablesTab } from './admin/TablesTab';
import { StaffTab } from './admin/StaffTab';
import { RolesTab } from './admin/RolesTab';
import { DevicesTab } from './admin/DevicesTab';
import { ReceiptsTab } from './admin/ReceiptsTab';
import { TerminalsTab } from './admin/TerminalsTab';
import { SettingsPanel } from '../components/SettingsPanel';

type Tab = 'receipts' | 'menu' | 'inventory' | 'stations' | 'categories' | 'tables' | 'staff' | 'roles' | 'devices' | 'terminals' | 'settings';

// Har tab qaysi ruxsat (capability)ga bog'liq — ruxsat yo'q bo'lsa ko'rinmaydi
const NAV: { key: Tab; tkey: string; icon: string; hint: string; cap: string }[] = [
  { key: 'receipts', tkey: 'admin.receipts', icon: '🧾', hint: 'Buyurtmalar va to‘lovlar tarixi', cap: 'history' },
  { key: 'menu', tkey: 'admin.menu', icon: '📋', hint: 'Taomlar ro‘yxati', cap: 'menu' },
  { key: 'inventory', tkey: 'admin.inventory', icon: '📦', hint: 'Ombor: mahsulotlar va qoldiq', cap: 'inventory' },
  { key: 'stations', tkey: 'admin.stations', icon: '🏭', hint: 'Bo‘limlar (oshxona/bar/somsaxona) va printerlari', cap: 'stations' },
  { key: 'categories', tkey: 'admin.categories', icon: '🗂️', hint: 'Menyu kategoriyalari', cap: 'menu' },
  { key: 'tables', tkey: 'admin.tables', icon: '🪑', hint: 'Stollar va zallar', cap: 'tables' },
  { key: 'staff', tkey: 'admin.staff', icon: '👥', hint: 'Xodimlar', cap: 'staff' },
  { key: 'roles', tkey: 'admin.roles', icon: '🛡️', hint: 'Rollar va ruxsatlar', cap: 'staff' },
  { key: 'devices', tkey: 'admin.devices', icon: '🖨️', hint: 'Server va printer', cap: 'devices' },
  { key: 'terminals', tkey: 'admin.terminals', icon: '🖥️', hint: 'Terminallar (bloklar)', cap: 'terminals' },
  { key: 'settings', tkey: 'admin.settings', icon: '⚙️', hint: 'Telegram, restoran sozlamalari', cap: 'settings' },
];

// Administrator paneli (adminka) — chap yon menu (yig'iladigan) + full-width kontent
export function AdminPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { goHome } = useAppNav();
  // Faqat ruxsat berilgan tablar
  const nav = NAV.filter((n) => hasCapability(user, n.cap));
  const [tab, setTab] = useState<Tab>(nav[0]?.key ?? 'settings');
  const [drawerOpen, setDrawerOpen] = useState(false); // mobil hamburger
  const current = nav.find((n) => n.key === tab) ?? nav[0];
  if (!current) {
    return (
      <AppShell title={t('title.admin')} hideHome>
        <div className="p-8 text-muted text-center">Sizga boshqaruv ruxsati berilmagan.</div>
      </AppShell>
    );
  }

  // Yon menu ichi (desktop sidebar va mobil drawer uchun umumiy)
  const NavBody = ({ onPick }: { onPick?: () => void }) => (
    <>
      <nav className="flex-1 p-2 space-y-1 overflow-auto">
        {nav.map((n) => {
          const active = tab === n.key;
          return (
            <button
              key={n.key}
              onClick={() => {
                setTab(n.key);
                onPick?.();
              }}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl font-semibold transition-colors ${
                active ? 'bg-primary text-white' : 'text-muted hover:text-text hover:bg-bg'
              }`}
            >
              <span className="text-xl leading-none">{n.icon}</span>
              <span className="truncate">{t(n.tkey)}</span>
            </button>
          );
        })}
      </nav>
      {/* Bosh sahifa — yon menu tagida */}
      <div className="p-2 border-t border-border">
        <button
          onClick={goHome}
          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl font-semibold text-primary hover:bg-primary/10 transition-colors"
        >
          <span className="text-xl leading-none">←</span>
          <span className="truncate">Orqaga</span>
        </button>
      </div>
    </>
  );

  return (
    <AppShell title={t('title.admin')} hideHome>
      <div className="h-full flex">
        {/* Desktop yon menu */}
        <aside className="hidden md:flex w-60 shrink-0 bg-surface border-r border-border flex-col">
          <NavBody />
        </aside>

        {/* Mobil drawer (hamburger) */}
        {drawerOpen && (
          <div className="md:hidden fixed inset-0 z-40">
            <div
              className="absolute inset-0 bg-black/60 animate-overlay-in"
              onClick={() => setDrawerOpen(false)}
            />
            <aside className="absolute left-0 top-0 bottom-0 w-64 max-w-[82%] bg-surface border-r border-border flex flex-col animate-card-in">
              <div className="h-12 flex items-center justify-between px-3 border-b border-border font-bold">
                <span>Menyu</span>
                <button onClick={() => setDrawerOpen(false)} className="text-muted hover:text-text text-xl">
                  ✕
                </button>
              </div>
              <NavBody onPick={() => setDrawerOpen(false)} />
            </aside>
          </div>
        )}

        {/* Kontent */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-3 px-3 sm:px-6 py-3 sm:py-4 border-b border-border">
            <button
              onClick={() => setDrawerOpen(true)}
              className="md:hidden shrink-0 w-10 h-10 rounded-lg border border-border hover:border-primary flex items-center justify-center text-xl"
            >
              ☰
            </button>
            <div className="min-w-0">
              <div className="text-lg sm:text-xl font-bold flex items-center gap-2">
                <span>{current.icon}</span> <span className="truncate">{t(current.tkey)}</span>
              </div>
              <div className="text-sm text-muted hidden sm:block">{current.hint}</div>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-3 sm:p-6">
            {tab === 'receipts' && <ReceiptsTab />}
            {tab === 'menu' && <MenuTab />}
            {tab === 'inventory' && <SkladTab />}
            {tab === 'stations' && <StationsTab />}
            {tab === 'categories' && <CategoriesTab />}
            {tab === 'tables' && <TablesTab />}
            {tab === 'staff' && <StaffTab />}
            {tab === 'roles' && <RolesTab />}
            {tab === 'devices' && <DevicesTab />}
            {tab === 'terminals' && <TerminalsTab />}
            {tab === 'settings' && <SettingsPanel embedded />}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
