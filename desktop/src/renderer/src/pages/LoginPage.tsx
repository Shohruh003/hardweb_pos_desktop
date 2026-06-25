import { useState } from 'react';
import { useAuth } from '../state/auth';
import { useDemoNav } from '../state/demoNav';
import { Button } from '../components/ui';
import { MOCK } from '../lib/api';
import { getServerUrl, setServerUrl } from '../lib/config';

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
      <div className="text-primary font-extrabold text-3xl mb-1">HardWeb POS</div>
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
  const { login } = useAuth();
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(getServerUrl());
  const [showServer, setShowServer] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      setServerUrl(server);
      await login(loginName.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Mock rejimda — tez kirish ekrani
  if (MOCK) return <DemoEntry />;

  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <form
        onSubmit={onSubmit}
        className="w-[380px] bg-surface border border-border rounded-2xl p-8 shadow-xl"
      >
        <div className="text-center mb-6">
          <div className="text-primary font-bold text-2xl">HardWeb POS</div>
          <div className="text-muted text-sm mt-1">Terminal tizimga kirish</div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-danger/15 text-danger text-sm">
            {error}
          </div>
        )}

        <label className="block text-sm text-muted mb-1">Login</label>
        <input
          autoFocus
          value={loginName}
          onChange={(e) => setLoginName(e.target.value)}
          className="w-full mb-4 px-3 py-2.5 rounded-lg bg-bg border border-border text-text outline-none focus:border-primary"
          placeholder="masalan: ofitsiant"
        />

        <label className="block text-sm text-muted mb-1">Parol</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-5 px-3 py-2.5 rounded-lg bg-bg border border-border text-text outline-none focus:border-primary"
          placeholder="••••"
        />

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Kirilmoqda...' : 'Kirish'}
        </Button>

        <button
          type="button"
          onClick={() => setShowServer((s) => !s)}
          className="block w-full text-center text-xs text-muted mt-4 hover:text-text"
        >
          Server sozlamasi
        </button>
        {showServer && (
          <input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            className="w-full mt-2 px-3 py-2 rounded-lg bg-bg border border-border text-text text-sm outline-none focus:border-primary"
            placeholder="http://localhost:3000"
          />
        )}

        <div className="text-center text-xs text-muted mt-5">
          Sinov uchun: ofitsiant / oshpaz / kassir — parol: 1234
        </div>
      </form>
    </div>
  );
}
