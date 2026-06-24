import { useAuth } from './state/auth';
import { UserRole } from '@hardweb-pos/shared';
import { LoginPage } from './pages/LoginPage';
import { WaiterPage } from './pages/WaiterPage';
import { KdsPage } from './pages/KdsPage';
import { CashierPage } from './pages/CashierPage';
import { AdminPage } from './pages/AdminPage';
import { DirectorPage } from './pages/DirectorPage';

// Login qilingan foydalanuvchi roliga qarab kerakli ekran ochiladi (TZ: bitta ilova, rolga qarab)
export function App() {
  const { user } = useAuth();

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
