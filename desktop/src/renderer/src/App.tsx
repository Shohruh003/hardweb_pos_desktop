import { useAuth } from './state/auth';
import { UserRole } from '@hardweb-pos/shared';
import { LoginPage } from './pages/LoginPage';
import { WaiterPage } from './pages/WaiterPage';
import { KdsPage } from './pages/KdsPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

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
      return (
        <PlaceholderPage
          title="Kassa"
          bosqich="3-bosqich"
          tavsif="Hisob-kitob, to'lov turlari (naqd/karta/QR), chegirma va chek printeri (ESC/POS)."
        />
      );
    case UserRole.Admin:
      return (
        <PlaceholderPage
          title="Administrator paneli"
          bosqich="4-bosqich"
          tavsif="Menyu, stollar/zallar, xodimlar va qurilmalarni boshqarish."
        />
      );
    case UserRole.Director:
      return (
        <PlaceholderPage
          title="Direktor hisobotlari"
          bosqich="5-bosqich"
          tavsif="Bulut subdomeni orqali tushum, statistika va reytinglar (masofadan)."
        />
      );
    default:
      return <LoginPage />;
  }
}
