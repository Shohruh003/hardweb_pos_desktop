import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { MenuTab } from './admin/MenuTab';
import { TablesTab } from './admin/TablesTab';
import { StaffTab } from './admin/StaffTab';

type Tab = 'menu' | 'tables' | 'staff';

const TABS: { key: Tab; label: string }[] = [
  { key: 'menu', label: 'Menyu' },
  { key: 'tables', label: 'Stollar' },
  { key: 'staff', label: 'Xodimlar' },
];

// Administrator paneli (TZ 5.4)
export function AdminPage() {
  const [tab, setTab] = useState<Tab>('menu');

  return (
    <AppShell title="Administrator paneli">
      <div className="h-full flex flex-col">
        <div className="flex gap-2 px-6 pt-4 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 font-semibold rounded-t-lg ${
                tab === t.key
                  ? 'bg-surface text-primary border-b-2 border-primary'
                  : 'text-muted hover:text-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto p-6">
          {tab === 'menu' && <MenuTab />}
          {tab === 'tables' && <TablesTab />}
          {tab === 'staff' && <StaffTab />}
        </div>
      </div>
    </AppShell>
  );
}
