import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { MenuTab } from './admin/MenuTab';
import { TablesTab } from './admin/TablesTab';
import { StaffTab } from './admin/StaffTab';
import { RolesTab } from './admin/RolesTab';
import { DevicesTab } from './admin/DevicesTab';
import { ReceiptsTab } from './admin/ReceiptsTab';

type Tab = 'receipts' | 'menu' | 'tables' | 'staff' | 'roles' | 'devices';

const NAV: { key: Tab; label: string; icon: string; hint: string }[] = [
  { key: 'receipts', label: 'Cheklar / Tarix', icon: '🧾', hint: 'Buyurtmalar va to‘lovlar tarixi' },
  { key: 'menu', label: 'Menyu', icon: '📋', hint: 'Taomlar va kategoriyalar' },
  { key: 'tables', label: 'Stollar', icon: '🪑', hint: 'Stollar va zallar' },
  { key: 'staff', label: 'Xodimlar', icon: '👥', hint: 'Xodimlar' },
  { key: 'roles', label: 'Rollar', icon: '🛡️', hint: 'Rollar va ruxsatlar' },
  { key: 'devices', label: 'Qurilmalar', icon: '🖨️', hint: 'Printer sozlamalari' },
];

// Administrator paneli (adminka) — chap yon menu (yig'iladigan) + full-width kontent
export function AdminPage() {
  const [tab, setTab] = useState<Tab>('receipts');
  const [collapsed, setCollapsed] = useState(false);
  const current = NAV.find((n) => n.key === tab)!;

  return (
    <AppShell title="Administrator paneli">
      <div className="h-full flex">
        {/* Chap yon menu */}
        <aside
          className={`${collapsed ? 'w-16' : 'w-60'} shrink-0 bg-surface border-r border-border flex flex-col transition-all duration-200`}
        >
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="h-12 flex items-center justify-center text-muted hover:text-text border-b border-border"
            title={collapsed ? 'Ochish' : 'Yig‘ish'}
          >
            {collapsed ? '»' : '«'}
          </button>
          <nav className="flex-1 p-2 space-y-1 overflow-auto">
            {NAV.map((n) => {
              const active = tab === n.key;
              return (
                <button
                  key={n.key}
                  onClick={() => setTab(n.key)}
                  title={collapsed ? n.label : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold transition-colors ${
                    active ? 'bg-primary text-white' : 'text-muted hover:text-text hover:bg-bg'
                  } ${collapsed ? 'justify-center' : ''}`}
                >
                  <span className="text-xl leading-none">{n.icon}</span>
                  {!collapsed && <span className="truncate">{n.label}</span>}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Kontent — butun kenglik */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-6 py-4 border-b border-border">
            <div className="text-xl font-bold flex items-center gap-2">
              <span>{current.icon}</span> {current.label}
            </div>
            <div className="text-sm text-muted">{current.hint}</div>
          </div>
          <div className="flex-1 overflow-auto p-6">
            {tab === 'receipts' && <ReceiptsTab />}
            {tab === 'menu' && <MenuTab />}
            {tab === 'tables' && <TablesTab />}
            {tab === 'staff' && <StaffTab />}
            {tab === 'roles' && <RolesTab />}
            {tab === 'devices' && <DevicesTab />}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
