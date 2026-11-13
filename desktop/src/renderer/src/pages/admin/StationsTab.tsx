import { useEffect, useState } from 'react';
import { Station } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { FeedbackModal } from '../../components/FeedbackModal';
import { api, ApiError } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

interface StationForm {
  id?: string;
  name: string;
  printerHost: string;
  printerPort: string;
  printerWidth: string;
}

/** POST /stations/:id/test-print javobi (server StationPrintResult) */
interface StationTestResult {
  stationId: string;
  station: string;
  host: string;
  ok: boolean;
  message: string;
}

type TestState = { pending: true } | { pending: false; ok: boolean; message: string };

/** Sinov cheki: server printerga ulanadi (taymaut + qayta urinish bo'lishi mumkin) — uzoqroq kutamiz */
const TEST_TIMEOUT_MS = 25_000;

// Tayyorlash bo'limlari (sexlar) — oshxona, bar, somsaxona, novvoyxona.
// Har bo'limning LAN printeri bo'lishi mumkin; taom sotilganda o'sha bo'lim chekini
// SERVER (kassa kompyuteri) chop etadi — shuning uchun "Sinov" ham server orqali yuboriladi.
export function StationsTab() {
  const confirm = useConfirm();
  const [stations, setStations] = useState<Station[]>([]);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<StationForm | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ title: string; subtitle?: string } | null>(null);
  // Bo'lim bo'yicha "Sinov" natijasi
  const [tests, setTests] = useState<Record<string, TestState>>({});

  async function load() {
    try {
      setStations(await api.get<Station[]>('/stations'));
      setLoadError('');
    } catch (e) {
      setLoadError((e as Error)?.message || 'Bo‘limlar yuklanmadi');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function openAdd() {
    setFormError('');
    setForm({ name: '', printerHost: '', printerPort: '9100', printerWidth: '48' });
  }
  function openEdit(s: Station) {
    setFormError('');
    setForm({
      id: s.id,
      name: s.name,
      printerHost: s.printerHost ?? '',
      printerPort: String(s.printerPort ?? 9100),
      printerWidth: String(s.printerWidth ?? 48),
    });
  }

  async function save() {
    if (!form || saving) return;
    const name = form.name.trim();
    if (!name) {
      setFormError('Bo‘lim nomini kiriting');
      return;
    }
    const port = form.printerPort.trim() ? Number(form.printerPort) : 9100;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setFormError('Port 1–65535 oralig‘idagi butun son bo‘lishi kerak (odatda 9100)');
      return;
    }
    const body = {
      name,
      // Printer IP'dagi bo'shliqlar (nusxa olinganda qo'shilib qoladi) olib tashlanadi
      printerHost: form.printerHost.replace(/\s+/g, ''),
      printerPort: port,
      printerWidth: Number(form.printerWidth) || 48,
    };
    setSaving(true);
    setFormError('');
    try {
      if (form.id) await api.patch(`/stations/${form.id}`, body);
      else await api.post('/stations', body);
      // Printer manzili o'zgargan bo'lsa — eski sinov natijasi endi to'g'ri emas
      if (form.id) {
        const id = form.id;
        setTests((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
      setForm(null);
      await load();
    } catch (e) {
      setFormError((e as Error)?.message || 'Saqlanmadi');
    } finally {
      setSaving(false);
    }
  }

  async function remove(s: Station) {
    if (!(await confirm({ title: 'Bo‘limni o‘chirish', message: `"${s.name}" bo‘limi o‘chirilsinmi?`, danger: true }))) return;
    try {
      await api.del(`/stations/${s.id}`);
    } catch (e) {
      setNotice({ title: 'O‘chirilmadi', subtitle: (e as Error)?.message || 'Xato' });
    }
    await load();
  }

  // Sinov cheki — server shu bo'limning printeriga qisqa chek yuboradi va natijani qaytaradi
  async function testPrint(s: Station) {
    if (tests[s.id]?.pending) return;
    setTests((prev) => ({ ...prev, [s.id]: { pending: true } }));
    let result: TestState;
    try {
      const r = await api.post<StationTestResult>(`/stations/${s.id}/test-print`, undefined, {
        timeoutMs: TEST_TIMEOUT_MS,
      });
      result = {
        pending: false,
        ok: !!r?.ok,
        message: r?.message || (r?.ok ? 'Sinov cheki chiqdi' : 'Printer javob bermadi'),
      };
    } catch (e) {
      const message =
        e instanceof ApiError && e.status === 0
          ? 'Server javob bermadi — printer manzilini va kassa kompyuterini tekshiring'
          : (e as Error)?.message || 'Sinov yuborilmadi';
      result = { pending: false, ok: false, message };
    }
    setTests((prev) => ({ ...prev, [s.id]: result }));
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="text-muted">
          {stations.length} ta bo‘lim — taom qaysi bo‘limdan chiqishi menyuda tanlanadi
        </div>
        <Button onClick={openAdd}>+ Yangi bo‘lim</Button>
      </div>

      {loadError && (
        <div className="mb-3 flex items-center gap-3 bg-danger/10 border border-danger/40 rounded-xl px-4 py-3 text-sm">
          <span className="flex-1 font-semibold text-danger">⚠️ {loadError}</span>
          <Button variant="ghost" className="py-1.5" onClick={() => void load()}>
            Qayta urinish
          </Button>
        </div>
      )}

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {stations.length === 0 ? (
          <div className="p-6 text-muted text-center">Bo‘lim yo‘q. "+ Yangi bo‘lim" bilan qo‘shing.</div>
        ) : (
          stations.map((s) => {
            const test = tests[s.id];
            return (
              <div key={s.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate flex items-center gap-2">🏭 {s.name}</div>
                    <div className="text-sm text-muted truncate">
                      {s.printerHost
                        ? `Printer: ${s.printerHost}:${s.printerPort} · ${s.printerWidth === 32 ? '58mm' : '80mm'}`
                        : 'Printer sozlanmagan — chek chiqmaydi'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.printerHost && (
                      <button
                        onClick={() => testPrint(s)}
                        disabled={!!test?.pending}
                        title="Printerga sinov cheki yuborish"
                        className="px-3 py-1.5 rounded-md text-sm font-semibold bg-bg border border-border hover:border-primary hover:text-primary disabled:opacity-60 disabled:cursor-wait"
                      >
                        {test?.pending ? '⏳ Yuborilmoqda…' : '🖨️ Sinov'}
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(s)}
                      className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => remove(s)}
                      className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                {test && !test.pending && (
                  <div
                    role="status"
                    className={`mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-sm font-semibold border ${
                      test.ok
                        ? 'bg-success/10 border-success/40 text-success'
                        : 'bg-danger/10 border-danger/40 text-danger'
                    }`}
                  >
                    <span className="flex-1 break-words">
                      {test.ok ? '✓ ' : '⚠️ '}
                      {test.message}
                    </span>
                    <button
                      onClick={() =>
                        setTests((prev) => {
                          const next = { ...prev };
                          delete next[s.id];
                          return next;
                        })
                      }
                      aria-label="Yopish"
                      className="shrink-0 text-muted hover:text-text"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {form && (
        <Modal title={form.id ? 'Bo‘limni tahrirlash' : 'Yangi bo‘lim'} onClose={() => !saving && setForm(null)}>
          <label className="block text-sm text-muted mb-1">Bo‘lim nomi</label>
          <input
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
              setFormError('');
            }}
            placeholder="Masalan: Oshxona / Bar / Somsaxona / Novvoyxona"
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />
          <div className="bg-bg/40 border border-border rounded-xl p-3">
            <div className="text-sm font-semibold mb-2">🖨 Bo‘lim printeri (LAN) — ixtiyoriy</div>
            <label className="block text-sm text-muted mb-1">Printer IP</label>
            <input
              value={form.printerHost}
              onChange={(e) => {
                setForm({ ...form, printerHost: e.target.value });
                setFormError('');
              }}
              placeholder="Masalan: 192.168.1.60 (bo‘sh bo‘lsa chek chiqmaydi)"
              className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary font-mono text-sm"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-muted mb-1">Port</label>
                <input
                  type="number"
                  value={form.printerPort}
                  onChange={(e) => {
                    setForm({ ...form, printerPort: e.target.value });
                    setFormError('');
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">Qog‘oz</label>
                <select
                  value={form.printerWidth}
                  onChange={(e) => setForm({ ...form, printerWidth: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
                >
                  <option value="48">80 mm</option>
                  <option value="32">58 mm</option>
                </select>
              </div>
            </div>
            <div className="text-xs text-muted mt-2">
              Cheklarni kassa (server) kompyuteri chop etadi — u shu printerga tarmoq orqali yeta olishi kerak.
              Saqlagach «🖨️ Sinov» bilan tekshiring.
            </div>
          </div>
          {formError && (
            <div role="alert" className="mt-3 bg-danger/10 border border-danger/40 text-danger rounded-lg px-3 py-2 text-sm font-semibold">
              ⚠️ {formError}
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <Button variant="ghost" className="flex-1" disabled={saving} onClick={() => setForm(null)}>
              Bekor
            </Button>
            <Button className="flex-1" disabled={saving} onClick={save}>
              {saving ? 'Saqlanmoqda…' : form.id ? 'Saqlash' : 'Qo‘shish'}
            </Button>
          </div>
        </Modal>
      )}

      {notice && (
        <FeedbackModal variant="warning" title={notice.title} subtitle={notice.subtitle} onClose={() => setNotice(null)} />
      )}
    </div>
  );
}
