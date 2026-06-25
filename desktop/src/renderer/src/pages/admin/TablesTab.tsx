import { useEffect, useState } from 'react';
import { Table, TableStatus } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

interface TableForm {
  id?: string;
  number: string;
  hall: string;
  capacity: string;
}

// Stollar va zallarni boshqarish (TZ F-4.2): "+ Yangi stol" modal orqali, to'liq CRUD
export function TablesTab() {
  const confirm = useConfirm();
  const [tables, setTables] = useState<Table[]>([]);
  const [form, setForm] = useState<TableForm | null>(null);

  async function load() {
    setTables(await api.get<Table[]>('/tables'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  const halls = Array.from(new Set(tables.map((t) => t.hall)));

  function openAdd() {
    setForm({ number: '', hall: halls[0] ?? '', capacity: '4' });
  }
  function openEdit(t: Table) {
    setForm({ id: t.id, number: String(t.number), hall: t.hall, capacity: String(t.capacity) });
  }

  async function save() {
    if (!form || !form.number || !form.hall) return;
    const body = { number: Number(form.number), hall: form.hall, capacity: Number(form.capacity) || 4 };
    if (form.id) await api.patch(`/tables/${form.id}`, body);
    else await api.post('/tables', body);
    setForm(null);
    await load();
  }

  async function remove(t: Table) {
    if (!(await confirm({ title: 'Stolni o‘chirish', message: `Stol №${t.number} o‘chirilsinmi?`, danger: true }))) return;
    await api.del(`/tables/${t.id}`);
    await load();
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="text-muted">{tables.length} ta stol · {halls.length} ta zal</div>
        <Button onClick={openAdd}>+ Yangi stol</Button>
      </div>

      <div className="space-y-6">
        {halls.length === 0 && <div className="text-muted">Stol yo‘q. “+ Yangi stol” bilan qo‘shing.</div>}
        {halls.map((h) => (
          <div key={h}>
            <div className="font-semibold mb-2 text-muted">{h}</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
              {tables.filter((t) => t.hall === h).map((t) => (
                <div key={t.id} className="bg-surface border border-border rounded-2xl p-3 text-center lift">
                  <div className="text-xl font-bold">№{t.number}</div>
                  <div className="text-xs text-muted">{t.capacity} kishi</div>
                  <div className={`text-xs mt-1 font-semibold ${t.status === TableStatus.Free ? 'text-success' : 'text-warning'}`}>
                    {t.status === TableStatus.Free ? 'Bo‘sh' : 'Band'}
                  </div>
                  <div className="flex gap-1.5 mt-2 justify-center">
                    <button onClick={() => openEdit(t)} className="px-2.5 py-1 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
                    <button onClick={() => remove(t)} className="px-2.5 py-1 rounded-md text-sm bg-bg border border-border hover:border-danger">🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {form && (
        <Modal title={form.id ? 'Stolni tahrirlash' : 'Yangi stol'} onClose={() => setForm(null)}>
          <label className="block text-sm text-muted mb-1">Stol raqami</label>
          <input type="number" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="block text-sm text-muted mb-1">Zal</label>
          <input value={form.hall} onChange={(e) => setForm({ ...form, hall: e.target.value })} list="halls-modal" placeholder="Zal nomi"
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <datalist id="halls-modal">{halls.map((h) => <option key={h} value={h} />)}</datalist>
          <label className="block text-sm text-muted mb-1">Sig‘imi (kishi)</label>
          <input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })}
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
