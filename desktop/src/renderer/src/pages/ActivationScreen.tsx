import { useState } from 'react';
import { getServerUrl } from '../lib/config';
import logo from '../assets/logo.png';

const MESSAGES: Record<string, { title: string; text: string; canActivate: boolean }> = {
  not_activated: {
    title: 'Qurilmani faollashtirish',
    text: 'Ushbu qurilmani ishlatish uchun 8 xonalik litsenziya kalitini kiriting.',
    canActivate: true,
  },
  suspended: {
    title: 'Litsenziya bloklangan',
    text: 'Ushbu restoran litsenziyasi vaqtincha to‘xtatilgan. Iltimos, ta’minotchi bilan bog‘laning.',
    canActivate: false,
  },
  grace_expired: {
    title: 'Internetga ulaning',
    text: 'Litsenziyani tekshirish uchun qurilma uzoq vaqt internetga ulanmadi. Internetni yoqing.',
    canActivate: false,
  },
  conflict: {
    title: 'Kalit boshqa qurilmada',
    text: 'Bu kalit boshqa kompyuterda faollashtirilgan. Ta’minotchi bilan bog‘laning.',
    canActivate: false,
  },
  invalid: {
    title: 'Kalit noto‘g‘ri',
    text: 'Litsenziya kaliti yaroqsiz. To‘g‘ri kalitni kiriting.',
    canActivate: true,
  },
};

export function ActivationScreen({ status, onActivated }: { status: string; onActivated: () => void }) {
  const info = MESSAGES[status] ?? MESSAGES.not_activated;
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function activate() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(getServerUrl() + '/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      });
      const data = await r.json();
      if (data.ok || data.status === 'active') {
        onActivated();
      } else {
        setError(
          data.status === 'conflict'
            ? 'Bu kalit boshqa qurilmada faollashtirilgan.'
            : data.status === 'suspended'
              ? 'Litsenziya bloklangan.'
              : data.message || 'Kalit noto‘g‘ri.',
        );
      }
    } catch {
      setError('Serverga ulanib bo‘lmadi. Internet/serverni tekshiring.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full flex flex-col items-center justify-center app-bg p-6">
      <img src={logo} alt="DasturXon" className="w-auto max-h-[18vh] object-contain mb-6 select-none" draggable={false} />
      <div className="w-full max-w-[380px] bg-surface border border-border rounded-2xl p-6 text-center">
        <div className="text-xl font-bold mb-1">{info.title}</div>
        <div className="text-sm text-muted mb-5">{info.text}</div>

        {info.canActivate && (
          <>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
              inputMode="numeric"
              autoFocus
              placeholder="8 xonalik kalit"
              onKeyDown={(e) => e.key === 'Enter' && key.length === 8 && activate()}
              className="w-full text-center text-2xl font-extrabold tracking-[6px] px-4 py-3 rounded-xl bg-bg border border-border outline-none focus:border-primary mb-3"
            />
            {error && <div className="text-danger text-sm mb-3">{error}</div>}
            <button
              onClick={activate}
              disabled={busy || key.length !== 8}
              className="w-full py-3 rounded-xl bg-primary text-white font-bold hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
            >
              {busy ? '...' : 'Faollashtirish'}
            </button>
          </>
        )}

        {!info.canActivate && (
          <>
            {error && <div className="text-danger text-sm mb-3">{error}</div>}
            <button
              onClick={onActivated}
              className="w-full py-3 rounded-xl bg-bg border border-border font-semibold hover:border-primary"
            >
              🔄 Qayta tekshirish
            </button>
          </>
        )}
      </div>
      <div className="text-xs text-muted mt-4">Server: {getServerUrl()}</div>
    </div>
  );
}
