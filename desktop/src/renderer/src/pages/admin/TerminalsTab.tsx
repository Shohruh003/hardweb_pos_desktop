import { useEffect, useState } from 'react';
import { Button } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

interface Terminal {
  id: string;
  name: string;
  hall: string | null;
  note: string | null;
}

// Terminallar (bloklar) — restorandagi POS ish joylari
export function TerminalsTab() {
  const confirm = useConfirm();
  const [items, setItems] = useState<Terminal[]>([]);
  const [form, setForm] = useState<{ id?: string; name: string; hall: string; note: string } | null>(null);

  async function load() {
    setItems(await api.get<Terminal[]>('/terminals'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function save() {
    if (!form || !form.name.trim()) return;
    const body = { name: form.name.trim(), hall: form.hall.trim() || undefined, note: form.note.trim() || undefined };
    if (form.id) await api.patch(`/terminals/${form.id}`, body);
    else await api.post('/terminals', body);
    setForm(null);
    await load();
  }

  async function remove(t: Terminal) {
    if (!(await confirm({ title: 'Terminalni o‘chirish', message: `"${t.name}" o‘chirilsinmi?`, danger: true }))) return;
    await api.del(`/terminals/${t.id}`);
    await load();
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="text-muted">{items.length} ta terminal (blok)</div>
        <Button onClick={() => setForm({ name: '', hall: '', note: '' })}>+ Terminal qo‘shish</Button>
      </div>

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {items.length === 0 ? (
          <div className="p-6 text-muted text-center">Terminal yo‘q. “+ Terminal qo‘shish” bilan qo‘shing.</div>
        ) : (
          items.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-2xl">🖥️</span>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{t.name}</div>
                  <div className="text-sm text-muted">
                    {t.hall ? `${t.hall}` : 'Zal ko‘rsatilmagan'}{t.note ? ` · ${t.note}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setForm({ id: t.id, name: t.name, hall: t.hall ?? '', note: t.note ?? '' })}
                  className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
                <button onClick={() => remove(t)}
                  className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger">🗑️</button>
              </div>
            </div>
          ))
        )}
      </div>

      {form && (
        <Modal title={form.id ? 'Terminalni tahrirlash' : 'Yangi terminal'} onClose={() => setForm(null)}>
          <label className="block text-sm text-muted mb-1">Terminal nomi</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Masalan: Kassa 1"
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="block text-sm text-muted mb-1">Zal (ixtiyoriy)</label>
          <input value={form.hall} onChange={(e) => setForm({ ...form, hall: e.target.value })}
            placeholder="Masalan: VIP zal"
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="block text-sm text-muted mb-1">Izoh (ixtiyoriy)</label>
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="w-full mb-4 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setForm(null)}>Bekor</Button>
            <Button className="flex-1" onClick={save}>{form.id ? 'Saqlash' : 'Qo‘shish'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
