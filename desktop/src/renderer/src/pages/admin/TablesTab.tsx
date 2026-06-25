import { useEffect, useState } from 'react';
import { Table, TableStatus } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';

// Stollar va zallarni to'liq boshqarish (TZ F-4.2)
export function TablesTab() {
  const [tables, setTables] = useState<Table[]>([]);
  const [number, setNumber] = useState('');
  const [hall, setHall] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [edit, setEdit] = useState<Table | null>(null);

  async function load() {
    setTables(await api.get<Table[]>('/tables'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function addTable(e: React.FormEvent) {
    e.preventDefault();
    if (!number || !hall) return;
    await api.post('/tables', { number: Number(number), hall, capacity: Number(capacity) || 4 });
    setNumber('');
    await load();
  }

  async function remove(id: string) {
    if (!confirm('Stol o‘chirilsinmi?')) return;
    await api.del(`/tables/${id}`);
    await load();
  }

  async function saveEdit() {
    if (!edit) return;
    await api.patch(`/tables/${edit.id}`, { number: Number(edit.number), hall: edit.hall, capacity: Number(edit.capacity) });
    setEdit(null);
    await load();
  }

  const halls = Array.from(new Set(tables.map((t) => t.hall)));

  return (
    <div className="grid grid-cols-3 gap-6">
      <form onSubmit={addTable} className="bg-surface border border-border rounded-2xl p-4 h-fit">
        <div className="font-bold mb-3">Yangi stol</div>
        <input value={number} onChange={(e) => setNumber(e.target.value)} type="number" placeholder="Stol raqami"
          className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
        <input value={hall} onChange={(e) => setHall(e.target.value)} placeholder="Zal nomi" list="halls"
          className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
        <datalist id="halls">{halls.map((h) => <option key={h} value={h} />)}</datalist>
        <input value={capacity} onChange={(e) => setCapacity(e.target.value)} type="number" placeholder="Sig'imi"
          className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
        <Button type="submit" className="w-full">Qo‘shish</Button>
      </form>

      <div className="col-span-2 space-y-5">
        {halls.map((h) => (
          <div key={h}>
            <div className="font-semibold mb-2 text-muted">{h}</div>
            <div className="grid grid-cols-3 gap-3">
              {tables.filter((t) => t.hall === h).map((t) => (
                <div key={t.id} className="bg-surface border border-border rounded-2xl p-3 text-center lift">
                  <div className="text-xl font-bold">№{t.number}</div>
                  <div className="text-xs text-muted">{t.capacity} kishi</div>
                  <div className={`text-xs mt-1 font-semibold ${t.status === TableStatus.Free ? 'text-success' : 'text-warning'}`}>
                    {t.status === TableStatus.Free ? 'Bo‘sh' : 'Band'}
                  </div>
                  <div className="flex gap-1.5 mt-2 justify-center">
                    <button onClick={() => setEdit({ ...t })} className="px-2.5 py-1 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
                    <button onClick={() => remove(t.id)} className="px-2.5 py-1 rounded-md text-sm bg-bg border border-border hover:border-danger">🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {edit && (
        <Modal title={`Stol №${edit.number} ni tahrirlash`} onClose={() => setEdit(null)}>
          <label className="block text-sm text-muted mb-1">Raqami</label>
          <input type="number" value={edit.number} onChange={(e) => setEdit({ ...edit, number: Number(e.target.value) })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="block text-sm text-muted mb-1">Zal</label>
          <input value={edit.hall} onChange={(e) => setEdit({ ...edit, hall: e.target.value })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="block text-sm text-muted mb-1">Sig'imi</label>
          <input type="number" value={edit.capacity} onChange={(e) => setEdit({ ...edit, capacity: Number(e.target.value) })}
            className="w-full mb-4 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setEdit(null)}>Bekor</Button>
            <Button className="flex-1" onClick={saveEdit}>Saqlash</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
