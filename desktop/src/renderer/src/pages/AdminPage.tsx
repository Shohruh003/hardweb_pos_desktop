import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { MenuTab } from './admin/MenuTab';
import { TablesTab } from './admin/TablesTab';
import { StaffTab } from './admin/StaffTab';
import { RolesTab } from './admin/RolesTab';
import { DevicesTab } from './admin/DevicesTab';
import { ReceiptsTab } from './admin/ReceiptsTab';

type Tab = 'receipts' | 'menu' | 'tables' | 'staff' | 'roles' | 'devices';

const TABS: { key: Tab; label: string }[] = [
  { key: 'receipts', label: 'Cheklar / Tarix' },
  { key: 'menu', label: 'Menyu' },
  { key: 'tables', label: 'Stollar' },
  { key: 'staff', label: 'Xodimlar' },
  { key: 'roles', label: 'Rollar' },
  { key: 'devices', label: 'Qurilmalar' },
];

// Administrator paneli (TZ 5.4) — universal: cheklar tarixi, menyu, stol, xodim, rol, qurilma
export function AdminPage() {
  const [tab, setTab] = useState<Tab>('receipts');

  return (
    <AppShell title="Administrator paneli">
      <div className="h-full flex flex-col">
        <div className="flex gap-1 px-6 pt-4 border-b border-border overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 font-semibold rounded-t-lg whitespace-nowrap ${
                tab === t.key ? 'bg-surface text-primary border-b-2 border-primary' : 'text-muted hover:text-text'
              }`}
            >
              {t.label}
            </button>
          ))}
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
    </AppShell>
  );
}
