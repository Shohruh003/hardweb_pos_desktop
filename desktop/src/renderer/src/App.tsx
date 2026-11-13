import { useCallback, useEffect, useRef, useState } from 'react';
import { hasCapability } from '@hardweb-pos/shared';
import { useAuth } from './state/auth';
import { useDemoNav } from './state/demoNav';
import { useAppNav } from './state/appNav';
import { MOCK } from './lib/api';
import { consumeSkipSplash, fetchLicenseStatus, getServerUrl } from './lib/config';
import { SplashScreen } from './components/SplashScreen';
import ChangePasswordModal from './components/ChangePasswordModal';
import { ActivationScreen } from './pages/ActivationScreen';
import { LoginPage, ServerAddressForm } from './pages/LoginPage';
import { LauncherPage } from './pages/LauncherPage';
import { WaiterPage } from './pages/WaiterPage';
import { KdsPage } from './pages/KdsPage';
import { CashierPage } from './pages/CashierPage';
import { AdminPage } from './pages/AdminPage';
import { DirectorPage } from './pages/DirectorPage';
import { QueueScreen } from './pages/QueueScreen';

// Kirgandan keyin bosh sahifa (Launcher), undan ruxsat berilgan modul ochiladi.
export function App() {
  const { user, logout, updateUser, refreshUser } = useAuth();
  const { queue } = useDemoNav();
  const { module, goHome } = useAppNav();
  // Server manzili saqlanib oyna qayta yuklanganda splash qayta ko'rsatilmaydi
  const [splashDone, setSplashDone] = useState(consumeSkipSplash);
  // Barqaror callback — App qayta chizilganda splash taymerlari qaytadan boshlanmaydi
  const finishSplash = useCallback(() => setSplashDone(true), []);
  // Litsenziya holati (real rejim): 'checking' | 'active' | qulf holati (not_activated/suspended/...)
  const [license, setLicense] = useState<string>(MOCK ? 'active' : 'checking');
  const [editServer, setEditServer] = useState(false);

  const checkLicense = useCallback(async () => {
    if (MOCK) {
      setLicense('active');
      return;
    }
    // Ichki server ~15s ko'tariladi — ulanmasa bir necha marta kutib qayta urinamiz.
    // Har urinish 4 s dan ortiq kutmaydi (noto'g'ri IP'da ham ekran tez javob beradi).
    for (let attempt = 0; attempt < 25; attempt++) {
      try {
        const info = await fetchLicenseStatus(getServerUrl(), 4000);
        setLicense(info.locked ? info.status : 'active');
        return;
      } catch {
        await new Promise((res) => setTimeout(res, 2000));
      }
    }
    // Baribir ulanmadi — ochiq qoldiramiz (server guard'i himoya qiladi)
    setLicense('active');
  }, []);
  useEffect(() => {
    checkLicense();
  }, [checkLicense]);

  // Server tayyor bo'lgach saqlangan sessiyani tekshiramiz (GET /auth/me): token muddati
  // tugagan yoki xodim bloklangan bo'lsa — login ekrani; ruxsatlar va parol talabi yangilanadi.
  const sessionChecked = useRef(false);
  useEffect(() => {
    if (license !== 'active' || sessionChecked.current) return;
    sessionChecked.current = true;
    void refreshUser();
  }, [license, refreshUser]);

  // Xodim chiqqanda (yoki boshqasi kirganda) tanlangan modul tozalanadi —
  // keyingi xodim oldingisining ekraniga emas, o'z bosh sahifasiga tushadi.
  const prevUserId = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    const id = user?.id ?? null;
    if (prevUserId.current && id !== prevUserId.current) goHome();
    prevUserId.current = id;
  }, [user, goHome]);

  // Sensorli qurilma (planshet/monoblok): matn maydoni bosilganda Windows
  // ekran klaviaturasini ochamiz. Oddiy kompyuterda (sichqoncha) ochilmaydi.
  useEffect(() => {
    if (typeof navigator === 'undefined' || navigator.maxTouchPoints <= 0) return;
    const NON_TEXT = ['button', 'checkbox', 'radio', 'submit', 'range', 'color', 'file', 'image', 'reset'];
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      const tag = el.tagName;
      const isText =
        tag === 'TEXTAREA' ||
        (tag === 'INPUT' && !NON_TEXT.includes((el as HTMLInputElement).type)) ||
        (el as HTMLElement).isContentEditable;
      if (isText) window.hardweb?.showKeyboard?.();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  // Ochilish animatsiyasi — faqat birinchi yuklanishda
  if (!splashDone) return <SplashScreen onDone={finishSplash} />;

  // Server ishga tushmoqda / kassaga ulanmoqda (real rejim)
  if (!MOCK && license === 'checking') {
    return (
      <div className="h-full flex flex-col items-center justify-center app-bg text-muted gap-3 p-6">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <div className="text-text font-semibold">Serverga ulanmoqda, kuting...</div>
        <div className="text-xs font-mono break-all text-center">{getServerUrl()}</div>
        {!editServer ? (
          <button onClick={() => setEditServer(true)} className="text-xs text-primary hover:underline mt-2">
            ⚙ Server manzili (kassa terminali bo‘lsa)
          </button>
        ) : (
          <div className="w-full max-w-[440px] mt-2">
            <div className="text-xs mb-1.5 text-center">Kassa (server) kompyuteri manzili:</div>
            <ServerAddressForm submitLabel="Ulanish" autoFocus />
          </div>
        )}
      </div>
    );
  }
  // Litsenziya faol emas — aktivatsiya/qulf ekrani (kalitsiz ishlamaydi)
  if (!MOCK && license !== 'active') {
    return (
      <ActivationScreen
        status={license}
        onActivated={() => {
          setLicense('checking');
          checkLicense();
        }}
      />
    );
  }

  // Demo: navbat ekrani (mijozlar tablosi) — login talab qilmaydi
  if (MOCK && queue) return <QueueScreen />;

  if (!user) return <LoginPage />;

  // Vaqtinchalik parol (birinchi kirish yoki rahbar o'rnatgan parol) — avval yangi parol
  // o'rnatilishi shart, qolgan ilova yopiq. Chiqish esa doim mumkin.
  // Faqat PIN bilan kiradigan xodimda (hasPassword=false) almashtiradigan parol yo'q — uni to'smaymiz.
  if (user.mustChangePassword && user.hasPassword !== false) {
    return (
      <div className="h-full app-bg text-text">
        <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center">
          <div className="text-primary font-extrabold text-2xl tracking-tight">DasturXon</div>
          <div className="text-lg font-bold">Parolni almashtirish talab qilinadi</div>
          <div className="max-w-[420px] text-sm text-muted">
            {user.name}, xavfsizlik uchun vaqtinchalik parolni o‘zingizning yangi parolingizga almashtiring.
          </div>
        </div>
        <ChangePasswordModal
          forced
          onChanged={(changed) => updateUser({ ...user, ...changed, mustChangePassword: false })}
        />
        {/* Modal ustida ham bosiladi (z-[100]) — boshqa xodim bo'lsa tizimdan chiqish mumkin */}
        <button
          onClick={logout}
          className="fixed top-3 right-3 z-[100] px-4 py-2 rounded-lg bg-surface border border-border text-sm font-semibold text-text shadow-lg hover:border-danger hover:text-danger transition-colors"
        >
          ⎋ Chiqish
        </button>
      </div>
    );
  }

  // Foydalanuvchiga ochiq modullar
  const manageCaps = ['history', 'menu', 'tables', 'staff', 'devices', 'terminals', 'settings'];
  const mods: string[] = [];
  if (hasCapability(user, 'waiter')) mods.push('waiter');
  if (hasCapability(user, 'kitchen')) mods.push('kitchen');
  if (hasCapability(user, 'cashier')) mods.push('cashier');
  if (hasCapability(user, 'reports')) mods.push('reports');
  if (manageCaps.some((c) => hasCapability(user, c))) mods.push('admin');

  // Tanlangan modul faqat foydalanuvchiga ruxsat berilgan bo'lsa ochiladi
  // (eski/stale modul holatida ruxsatsiz ekranga tushib qolmasligi uchun).
  // Bitta modul bo'lsa — to'g'ridan-to'g'ri o'sha ekran (launcher ko'rsatilmaydi).
  const validModule = module && mods.includes(module) ? module : null;
  const effective = validModule ?? (mods.length === 1 ? mods[0] : null);

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
