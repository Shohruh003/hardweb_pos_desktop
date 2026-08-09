import { useEffect, useState } from 'react';
import { Button } from './ui';
import { Modal } from './Modal';
import { api } from '../lib/api';

interface Settings {
  restaurantName: string;
  telegramToken: string | null;
  telegramChatId: string | null;
  dailyReportTime: string;
}

// Restoran sozlamalari — Telegram bot tokeni, kunlik hisobot vaqti va h.k.
// embedded=true bo'lsa modal emas, oddiy panel sifatida (admin tab ichida) chiqadi.
export function SettingsPanel({
  onClose,
  embedded,
}: {
  onClose?: () => void;
  embedded?: boolean;
}) {
  const [s, setS] = useState<Settings>({
    restaurantName: 'DasturXon',
    telegramToken: '',
    telegramChatId: '',
    dailyReportTime: '23:59',
  });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Settings>('/settings').then(setS).catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    try {
      await api.patch('/settings', s);
      setMsg('Saqlandi ✓');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(''), 3000);
    }
  }

  async function testTelegram() {
    setMsg('Telegram sinovi yuborilmoqda...');
    try {
      await api.patch('/settings', s); // avval saqlaymiz
      const r = await api.post<{ ok: boolean }>('/settings/telegram-test');
      setMsg(r.ok ? 'Telegram sinovi yuborildi ✓ (botni tekshiring)' : 'Yuborilmadi — token/chat id noto‘g‘ri');
    } catch (e) {
      setMsg((e as Error).message);
    }
    setTimeout(() => setMsg(''), 5000);
  }

  async function detectChat() {
    setMsg('Chat ID aniqlanmoqda... (avval botga /start yozing)');
    try {
      const r = await api.post<{ chatId: string | null }>('/settings/telegram-detect', { token: s.telegramToken });
      if (r.chatId) {
        setS({ ...s, telegramChatId: r.chatId });
        setMsg(`Chat ID topildi: ${r.chatId} ✓`);
      } else {
        setMsg('Topilmadi — avval botga Telegram\'da /start yozing, keyin qayta bosing');
      }
    } catch (e) {
      setMsg((e as Error).message);
    }
    setTimeout(() => setMsg(''), 6000);
  }

  async function sendReport() {
    setMsg('Hisobot yuborilmoqda...');
    try {
      await api.post('/settings/telegram-report');
      setMsg('Kunlik hisobot yuborildi ✓');
    } catch (e) {
      setMsg((e as Error).message);
    }
    setTimeout(() => setMsg(''), 4000);
  }

  const field = 'w-full px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary';

  const body = (
    <>
      <label className="block text-sm text-muted mb-1">Restoran nomi</label>
      <input
        value={s.restaurantName}
        onChange={(e) => setS({ ...s, restaurantName: e.target.value })}
        className={`${field} mb-4`}
      />

      <div className="border-t border-border pt-4 mb-2 font-bold flex items-center gap-2">
        <span>📨 Telegram bot</span>
      </div>
      <div className="text-xs text-muted mb-3 leading-relaxed">
        1. Telegram'da <b>@BotFather</b> — <code>/newbot</code> → token oling.<br />
        2. Botga yozing, keyin <b>@userinfobot</b> orqali <b>chat id</b>ni oling.<br />
        3. Ikkalasini shu yerga qo'ying va "Sinov" bosing.
      </div>

      <label className="block text-sm text-muted mb-1">Bot token</label>
      <input
        value={s.telegramToken ?? ''}
        onChange={(e) => setS({ ...s, telegramToken: e.target.value })}
        placeholder="123456:ABC-DEF..."
        className={`${field} mb-3 font-mono text-sm`}
      />
      <label className="block text-sm text-muted mb-1">Telegram ID (raqamli user id)</label>
      <div className="flex gap-2 mb-1">
        <input
          value={s.telegramChatId ?? ''}
          onChange={(e) => setS({ ...s, telegramChatId: e.target.value })}
          placeholder="123456789  (bir nechta bo‘lsa vergul bilan)"
          className={`${field} font-mono text-sm`}
        />
        <Button variant="ghost" onClick={detectChat}>Avtomatik olish</Button>
      </div>
      <div className="text-xs text-muted mb-3 leading-relaxed">
        Odamning <b>raqamli Telegram ID</b>'sini yozing (masalan <b>123456789</b>). Bir
        nechta bo‘lsa <b>vergul bilan</b>: <span className="font-mono">123, 456</span>.
        ID'ni <b>@userinfobot</b>dan olasiz yoki "Avtomatik olish" bilan.<br />
        <i>Muhim: o‘sha odam botга avval bir marta <b>/start</b> bosган bo‘lishi shart —
        Telegram qoidasi (aks holda xabar yetmaydi). Kanal kerak bo‘lsa <b>@kanal_nomi</b>
        ham yozish mumkin.</i>
      </div>
      <label className="block text-sm text-muted mb-1">Kunlik hisobot vaqti</label>
      <input
        type="time"
        value={s.dailyReportTime}
        onChange={(e) => setS({ ...s, dailyReportTime: e.target.value })}
        className={`${field} mb-4`}
      />

      <div className="flex gap-2 flex-wrap">
        <Button onClick={save} disabled={busy} className="flex-1">
          {busy ? 'Saqlanmoqda...' : 'Saqlash'}
        </Button>
        <Button variant="ghost" onClick={testTelegram}>Sinov</Button>
        <Button variant="ghost" onClick={sendReport}>Hisobot yuborish</Button>
      </div>
      {msg && <div className="mt-3 text-sm text-center text-muted">{msg}</div>}
    </>
  );

  if (embedded) return <div className="max-w-xl">{body}</div>;
  return (
    <Modal title="⚙️ Restoran sozlamalari" onClose={onClose ?? (() => undefined)}>
      {body}
    </Modal>
  );
}
