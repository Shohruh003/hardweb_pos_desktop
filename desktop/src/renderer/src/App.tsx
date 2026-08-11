import { useCallback, useEffect, useState } from 'react';
import { hasCapability } from '@hardweb-pos/shared';
import { useAuth } from './state/auth';
import { useDemoNav } from './state/demoNav';
import { useAppNav } from './state/appNav';
import { MOCK } from './lib/api';
import { getServerUrl, setServerUrl } from './lib/config';
import { SplashScreen } from './components/SplashScreen';
import { ActivationScreen } from './pages/ActivationScreen';
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
  // Litsenziya holati (real rejim): 'checking' | 'active' | qulf holati (not_activated/suspended/...)
  const [license, setLicense] = useState<string>(MOCK ? 'active' : 'checking');
  const [editServer, setEditServer] = useState(false);
  const [serverInput, setServerInput] = useState(getServerUrl());

  const checkLicense = useCallback(async () => {
    if (MOCK) {
      setLicense('active');
      return;
    }
    // Ichki server ~15s ko'tariladi — ulanmasa bir necha marta kutib qayta urinamiz.
    for (let attempt = 0; attempt < 25; attempt++) {
      try {
        const r = await fetch(getServerUrl() + '/license/status');
        const data = await r.json();
        setLicense(data.locked ? data.status : 'active');
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
  if (!splashDone) return <SplashScreen onDone={() => setSplashDone(true)} />;

  // Server ishga tushmoqda / kassaga ulanmoqda (real rejim)
  if (!MOCK && license === 'checking') {
    return (
      <div className="h-full flex flex-col items-center justify-center app-bg text-muted gap-3 p-6">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <div>Serverga ulanmoqda, kuting...</div>
        {!editServer ? (
          <button onClick={() => setEditServer(true)} className="text-xs text-primary hover:underline mt-2">
            ⚙ Server manzili (kassa terminali bo'lsa)
          </button>
        ) : (
          <div className="w-full max-w-[320px] mt-2 text-center">
            <div className="text-xs mb-1">Kassa (server) kompyuteri manzili:</div>
            <input
              value={serverInput}
              onChange={(e) => setServerInput(e.target.value)}
              placeholder="http://192.168.1.10:3100"
              className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text text-sm outline-none focus:border-primary text-center"
            />
            <button
              onClick={() => {
                setServerUrl(serverInput.trim());
                setEditServer(false);
                setLicense('checking');
                checkLicense();
              }}
              className="mt-2 w-full py-2 rounded-lg bg-primary text-white text-sm font-bold"
            >
              Ulanish
            </button>
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
