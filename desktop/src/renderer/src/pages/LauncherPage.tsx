import { hasCapability } from '@hardweb-pos/shared';
import { useAuth } from '../state/auth';
import { useAppNav } from '../state/appNav';
import { useI18n } from '../state/i18n';
import { Button } from '../components/ui';
import { ThemeLangControls } from '../components/ThemeLangControls';

const MANAGE_CAPS = ['history', 'menu', 'tables', 'staff', 'devices', 'settings'];

// Kirgandan keyingi bosh sahifa — faqat ruxsat berilgan modullar plitka bo'lib chiqadi.
export function LauncherPage() {
  const { user, logout } = useAuth();
  const { open } = useAppNav();
  const { t } = useI18n();

  const tiles = [
    { key: 'waiter' as const, cap: 'waiter', label: 'Ofitsiant', desc: 'Zakaz qabul qilish', icon: '🧑‍🍳' },
    { key: 'kitchen' as const, cap: 'kitchen', label: 'Oshxona (KDS)', desc: 'Tayyorlash ekrani', icon: '🍳' },
    { key: 'cashier' as const, cap: 'cashier', label: 'Kassa', desc: 'To‘lov va chek', icon: '💵' },
    { key: 'reports' as const, cap: 'reports', label: 'Hisobotlar', desc: 'Tushum, atchotlar', icon: '📊' },
  ].filter((tile) => hasCapability(user, tile.cap));

  const canManage = MANAGE_CAPS.some((c) => hasCapability(user, c));

  const all = [
    ...tiles,
    ...(canManage
      ? [{ key: 'admin' as const, cap: 'admin', label: 'Boshqaruv', desc: 'Menyu, xodimlar, sozlamalar', icon: '🛠️' }]
      : []),
  ];

  return (
    <div className="h-full flex flex-col app-bg text-text">
      <header className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 glass border-b border-border">
        <span className="text-primary font-extrabold text-lg tracking-tight">DasturXon</span>
        <div className="flex items-center gap-2 sm:gap-4">
          <ThemeLangControls />
          <div className="text-right hidden sm:block">
            <div className="text-sm font-semibold">{user?.name}</div>
            <div className="text-xs text-muted">{t(`role.${user?.role ?? ''}`, user?.role)}</div>
          </div>
          <Button variant="ghost" onClick={logout} className="px-2 sm:px-4">
            <span className="hidden sm:inline">{t('common.logout')}</span>
            <span className="sm:hidden text-lg">⎋</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 flex flex-col items-center justify-center">
        <div className="text-2xl font-bold mb-1">Assalomu alaykum, {user?.name?.split(' ')[0]} 👋</div>
        <div className="text-muted mb-8">Kerakli bo‘limni tanlang</div>

        {all.length === 0 ? (
          <div className="text-muted text-center max-w-md">
            Sizga hali hech qanday ruxsat berilmagan. Administrator yoki direktorga murojaat qiling.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 w-full max-w-3xl">
            {all.map((tile) => (
              <button
                key={tile.key}
                onClick={() => open(tile.key)}
                className="glass border border-border rounded-2xl p-6 text-center hover:border-primary lift animate-card-in flex flex-col items-center gap-2"
              >
                <span className="text-5xl drop-shadow">{tile.icon}</span>
                <span className="text-lg font-bold">{tile.label}</span>
                <span className="text-xs text-muted">{tile.desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
