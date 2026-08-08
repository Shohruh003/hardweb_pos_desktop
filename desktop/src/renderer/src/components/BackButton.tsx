import { hasCapability } from '@hardweb-pos/shared';
import { useAuth } from '../state/auth';
import { useAppNav } from '../state/appNav';

// "← Orqaga" — bosh sahifaga (launcher) qaytaradi.
// Faqat bir nechta modulga ruxsati bor foydalanuvchida ko'rinadi
// (bitta modulli xodimda qaytadigan joy yo'q — ko'rsatilmaydi).
export function BackButton({ className = '' }: { className?: string }) {
  const { user } = useAuth();
  const { goHome } = useAppNav();

  const manageCaps = ['history', 'menu', 'tables', 'staff', 'devices', 'terminals', 'settings'];
  let count = 0;
  if (hasCapability(user, 'waiter')) count++;
  if (hasCapability(user, 'kitchen')) count++;
  if (hasCapability(user, 'cashier')) count++;
  if (hasCapability(user, 'reports')) count++;
  if (manageCaps.some((c) => hasCapability(user, c))) count++;

  if (count <= 1) return null;

  return (
    <button
      onClick={goHome}
      title="Bosh sahifaga qaytish"
      className={`shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-lg border border-border hover:border-primary hover:bg-surface-hover font-semibold ${className}`}
    >
      <span className="text-lg leading-none">←</span>
      <span className="text-sm">Orqaga</span>
    </button>
  );
}
