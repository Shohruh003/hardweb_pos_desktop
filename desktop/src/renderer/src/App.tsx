import { useState } from 'react';
import { hasCapability } from '@hardweb-pos/shared';
import { useAuth } from './state/auth';
import { useDemoNav } from './state/demoNav';
import { useAppNav } from './state/appNav';
import { MOCK } from './lib/api';
import { SplashScreen } from './components/SplashScreen';
import { LoginPage } from './pages/LoginPage';
import { LauncherPage } from './pages/LauncherPage';
import { WaiterPage } from './pages/WaiterPage';
import { KdsPage } from './pages/KdsPage';
import { CashierPage } from './pages/CashierPage';
import { AdminPage } from './pages/AdminPage';
import { DirectorPage } from './pages/DirectorPage';
import { QueueScreen } from './pages/QueueScreen';

// Kirgandan keyin bosh sahifa (Launcher), undan ruxsat berilgan modul ochiladi.
export function App() {
  const { user } = useAuth();
  const { queue } = useDemoNav();
  const { module } = useAppNav();
  const [splashDone, setSplashDone] = useState(false);

  // Ochilish animatsiyasi — faqat birinchi yuklanishda
  if (!splashDone) return <SplashScreen onDone={() => setSplashDone(true)} />;

  // Demo: navbat ekrani (mijozlar tablosi) — login talab qilmaydi
  if (MOCK && queue) return <QueueScreen />;

  if (!user) return <LoginPage />;

  // Foydalanuvchiga ochiq modullar
  const manageCaps = ['history', 'menu', 'tables', 'staff', 'devices', 'terminals', 'settings'];
  const mods: string[] = [];
  if (hasCapability(user, 'waiter')) mods.push('waiter');
  if (hasCapability(user, 'kitchen')) mods.push('kitchen');
  if (hasCapability(user, 'cashier')) mods.push('cashier');
  if (hasCapability(user, 'reports')) mods.push('reports');
  if (manageCaps.some((c) => hasCapability(user, c))) mods.push('admin');

  // Bitta modul bo'lsa — to'g'ridan-to'g'ri o'sha ekran (launcher ko'rsatilmaydi)
  const effective = module ?? (mods.length === 1 ? mods[0] : null);

  switch (effective) {
    case 'waiter':
      return <WaiterPage />;
    case 'kitchen':
      return <KdsPage />;
    case 'cashier':
      return <CashierPage />;
    case 'reports':
      return <DirectorPage />;
    case 'admin':
      return <AdminPage />;
    default:
      return <LauncherPage />;
  }
}
