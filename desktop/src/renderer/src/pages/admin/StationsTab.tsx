import { useEffect, useState } from 'react';
import { Station } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

interface StationForm {
  id?: string;
  name: string;
  printerHost: string;
  printerPort: string;
  printerWidth: string;
}

// Tayyorlash bo'limlari (sexlar) — oshxona, bar, somsaxona, novvoyxona.
// Har bo'limning LAN printeri bo'lishi mumkin; taom sotilganda o'sha bo'lim chekи chiqadi.
export function StationsTab() {
  const confirm = useConfirm();
  const [stations, setStations] = useState<Station[]>([]);
  const [form, setForm] = useState<StationForm | null>(null);

  async function load() {
    setStations(await api.get<Station[]>('/stations'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  function openAdd() {
    setForm({ name: '', printerHost: '', printerPort: '9100', printerWidth: '48' });
  }
  function openEdit(s: Station) {
    setForm({
      id: s.id,
      name: s.name,
      printerHost: s.printerHost ?? '',
      printerPort: String(s.printerPort ?? 9100),
      printerWidth: String(s.printerWidth ?? 48),
    });
  }

  async function save() {
    if (!form || !form.name.trim()) return;
    const body = {
      name: form.name.trim(),
      printerHost: form.printerHost.trim(),
      printerPort: Number(form.printerPort) || 9100,
      printerWidth: Number(form.printerWidth) || 48,
    };
    if (form.id) await api.patch(`/stations/${form.id}`, body);
    else await api.post('/stations', body);
    setForm(null);
    await load();
  }

  async function remove(s: Station) {
    if (!(await confirm({ title: 'Bo‘limni o‘chirish', message: `"${s.name}" bo‘limi o‘chirilsinmi?`, danger: true }))) return;
    await api.del(`/stations/${s.id}`);
    await load();
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="text-muted">
          {stations.length} ta bo‘lim — taom qaysi bo‘limdan chiqishi menyuda tanlanadi
        </div>
        <Button onClick={openAdd}>+ Yangi bo‘lim</Button>
      </div>

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {stations.length === 0 ? (
          <div className="p-6 text-muted text-center">Bo‘lim yo‘q. "+ Yangi bo‘lim" bilan qo‘shing.</div>
        ) : (
          stations.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate flex items-center gap-2">
                  🏭 {s.name}
                </div>
                <div className="text-sm text-muted truncate">
                  {s.printerHost
                    ? `Printer: ${s.printerHost}:${s.printerPort} · ${s.printerWidth === 32 ? '58mm' : '80mm'}`
                    : 'Printer sozlanmagan — chek chiqmaydi'}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => openEdit(s)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
                <button onClick={() => remove(s)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger">🗑️</button>
              </div>
            </div>
          ))
        )}
      </div>

      {form && (
        <Modal title={form.id ? 'Bo‘limni tahrirlash' : 'Yangi bo‘lim'} onClose={() => setForm(null)}>
          <label className="block text-sm text-muted mb-1">Bo‘lim nomi</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Masalan: Oshxona / Bar / Somsaxona / Novvoyxona"
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />
          <div className="bg-bg/40 border border-border rounded-xl p-3">
            <div className="text-sm font-semibold mb-2">🖨 Bo‘lim printeri (LAN) — ixtiyoriy</div>
            <label className="block text-sm text-muted mb-1">Printer IP</label>
            <input
              value={form.printerHost}
              onChange={(e) => setForm({ ...form, printerHost: e.target.value })}
              placeholder="Masalan: 192.168.1.60 (bo‘sh bo‘lsa chek chiqmaydi)"
              className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary font-mono text-sm"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-muted mb-1">Port</label>
                <input
                  type="number"
                  value={form.printerPort}
                  onChange={(e) => setForm({ ...form, printerPort: e.target.value })}
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
          </div>
          <div className="flex gap-2 mt-4">
            <Button variant="ghost" className="flex-1" onClick={() => setForm(null)}>Bekor</Button>
            <Button className="flex-1" onClick={save}>{form.id ? 'Saqlash' : 'Qo‘shish'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
