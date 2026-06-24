import { useAuth } from './state/auth';
import { useDemoNav } from './state/demoNav';
import { UserRole } from '@hardweb-pos/shared';
import { MOCK } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { WaiterPage } from './pages/WaiterPage';
import { KdsPage } from './pages/KdsPage';
import { CashierPage } from './pages/CashierPage';
import { AdminPage } from './pages/AdminPage';
import { DirectorPage } from './pages/DirectorPage';
import { QueueScreen } from './pages/QueueScreen';

// Login qilingan foydalanuvchi roliga qarab kerakli ekran ochiladi (TZ: bitta ilova, rolga qarab)
export function App() {
  const { user } = useAuth();
  const { queue } = useDemoNav();

  // Demo: navbat ekrani (mijozlar tablosi) — login talab qilmaydi
  if (MOCK && queue) return <QueueScreen />;

  if (!user) return <LoginPage />;

  switch (user.role) {
    case UserRole.Waiter:
      return <WaiterPage />;
    case UserRole.Cook:
      return <KdsPage />;
    case UserRole.Cashier:
      return <CashierPage />;
    case UserRole.Admin:
      return <AdminPage />;
    case UserRole.Director:
      return <DirectorPage />;
    default:
      return <LoginPage />;
  }
}
