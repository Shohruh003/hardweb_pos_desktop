import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../state/auth';
import { useDemoNav } from '../state/demoNav';
import { MOCK } from '../lib/api';
import { getServerUrl, setServerUrl } from '../lib/config';
import { useI18n } from '../state/i18n';
import { ThemeLangControls } from '../components/ThemeLangControls';
import logo from '../assets/logo.png';

// Mock/prezentatsiya uchun tez kirish ekrani — panel tanlash
function DemoEntry() {
  const { login } = useAuth();
  const { openQueue } = useDemoNav();
  const roles = [
    { login: 'ofitsiant', label: 'Ofitsiant', desc: 'Buyurtma qabul qilish' },
    { login: 'oshpaz', label: 'Oshxona (KDS)', desc: 'Tayyorlash ekrani' },
    { login: 'kassir', label: 'Kassa', desc: 'To‘lov va chek' },
    { login: 'admin', label: 'Administrator', desc: 'Menyu, stol, xodim' },
    { login: 'direktor', label: 'Direktor', desc: 'Hisobotlar' },
  ];
  return (
    <div className="h-full flex flex-col items-center justify-center bg-bg p-6">
      <div className="text-primary font-extrabold text-4xl mb-1 tracking-tight">DasturXon</div>
      <div className="text-muted mb-8">Demo — qaysi panelni ko‘rmoqchisiz?</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-3xl">
        {roles.map((r) => (
          <button
            key={r.login}
            onClick={() => login(r.login, '1234')}
            className="bg-surface border border-border rounded-2xl p-5 text-left hover:border-primary lift animate-card-in w-56"
          >
            <div className="text-lg font-bold">{r.label}</div>
            <div className="text-sm text-muted mt-1">{r.desc}</div>
          </button>
        ))}
        <button
          onClick={openQueue}
          className="bg-surface border border-border rounded-2xl p-5 text-left hover:border-primary transition-colors w-56"
        >
          <div className="text-lg font-bold">Navbat ekrani</div>
          <div className="text-sm text-muted mt-1">Mijozlar uchun tablo (TV)</div>
        </button>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { loginByPin } = useAuth();
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState(getServerUrl());
  const [showServer, setShowServer] = useState(false);
  const [logoClicks, setLogoClicks] = useState(0);

  const submit = useCallback(
    async (code: string) => {
      setBusy(true);
      setError('');
      try {
        setServerUrl(server);
        await loginByPin(code);
      } catch (err) {
        setError((err as Error).message || 'PIN noto‘g‘ri');
        setPin('');
      } finally {
        setBusy(false);
      }
    },
    [loginByPin, server],
  );

  function press(d: string) {
    if (busy) return;
    setError('');
    setPin((p) => {
      if (p.length >= 4) return p;
      const next = p + d;
      if (next.length === 4) submit(next);
      return next;
    });
  }

  const clear = () => setPin('');
  const backspace = () => setPin((p) => p.slice(0, -1));

  // Klaviaturadan ham kiritish (raqamlar, Backspace)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') backspace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // har renderda yangilanadi (press pin holatini biladi)

  if (MOCK) return <DemoEntry />;

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="h-full flex flex-col md:flex-row app-bg">
      {/* Chap yarim — logo (oq fon). Logoni 5 marta bossa — yashirin server sozlamasi */}
      <div className="md:w-1/2 bg-white flex items-center justify-center p-6 md:p-10 shrink-0">
        <img
          src={logo}
          alt="DasturXon"
          onClick={() => {
            const n = logoClicks + 1;
            setLogoClicks(n);
            if (n >= 5) setShowServer(true);
          }}
          className="w-auto max-w-[80%] max-h-[26vh] md:max-h-[70vh] object-contain select-none cursor-default"
          draggable={false}
        />
      </div>

      {/* O'ng yarim — PIN kiritish */}
      <div className="md:w-1/2 flex-1 flex flex-col items-center justify-center p-6 relative">
        <div className="absolute top-4 right-4">
          <ThemeLangControls />
        </div>

        <div className="text-primary font-extrabold text-2xl tracking-tight">DasturXon</div>
        <div className="text-muted text-sm mb-6">{t('common.password')} — PIN</div>

        {error && (
          <div className="mb-4 px-4 py-2 rounded-lg bg-danger/15 text-danger text-sm font-medium animate-pop-in">
            {error}
          </div>
        )}

        {/* PIN nuqtalari */}
        <div className="flex gap-4 mb-8">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`w-4 h-4 rounded-full transition-all duration-150 ${
                busy
                  ? 'bg-warning animate-pulse'
                  : pin.length > i
                    ? 'bg-primary scale-110'
                    : 'bg-border'
              }`}
            />
          ))}
        </div>

        {/* Raqamli klaviatura */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
          {keys.map((k) => (
            <button
              key={k}
              onClick={() => press(k)}
              disabled={busy}
              className="aspect-square rounded-2xl bg-surface border border-border text-2xl font-bold hover:border-primary hover:bg-surface-hover active:scale-95 transition-all disabled:opacity-50"
            >
              {k}
            </button>
          ))}
          <button
            onClick={clear}
            disabled={busy}
            className="aspect-square rounded-2xl bg-surface border border-border text-lg font-semibold text-muted hover:text-danger hover:border-danger active:scale-95 transition-all"
          >
            C
          </button>
          <button
            onClick={() => press('0')}
            disabled={busy}
            className="aspect-square rounded-2xl bg-surface border border-border text-2xl font-bold hover:border-primary hover:bg-surface-hover active:scale-95 transition-all disabled:opacity-50"
          >
            0
          </button>
          <button
            onClick={backspace}
            disabled={busy}
            className="aspect-square rounded-2xl bg-surface border border-border text-xl hover:border-primary active:scale-95 transition-all"
          >
            ⌫
          </button>
        </div>

        {/* Server sozlamasi — yashirin (logoni 5 marta bosganda ochiladi) */}
        {showServer && (
          <div className="mt-6 text-center">
            <div className="text-xs text-muted mb-1">Server manzili</div>
            <input
              value={server}
              onChange={(e) => setServer(e.target.value)}
              className="px-3 py-2 rounded-lg bg-surface border border-border text-text text-sm outline-none focus:border-primary w-64"
              placeholder="http://127.0.0.1:3100"
            />
          </div>
        )}
      </div>
    </div>
  );
}
