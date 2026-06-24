import { useState } from 'react';
import { useAuth } from '../state/auth';
import { Button } from '../components/ui';
import { getServerUrl, setServerUrl } from '../lib/config';

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
