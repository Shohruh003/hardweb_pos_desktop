import { useEffect, useState } from 'react';
import { Customer } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

interface Form {
  id?: string;
  name: string;
  phone: string;
  note: string;
}

// Mijozlar (CRM) — direktor 'customers' ruxsatini bergan xodim boshqaradi.
export function CustomersTab() {
  const confirm = useConfirm();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Form | null>(null);

  async function load() {
    setCustomers(await api.get<Customer[]>('/customers'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  function openAdd() {
    setForm({ name: '', phone: '', note: '' });
  }
  function openEdit(c: Customer) {
    setForm({ id: c.id, name: c.name, phone: c.phone, note: c.note ?? '' });
  }
  async function save() {
    if (!form || !form.name.trim()) return;
    const body = { name: form.name.trim(), phone: form.phone.trim(), note: form.note.trim() };
    if (form.id) await api.patch(`/customers/${form.id}`, body);
    else await api.post('/customers', body);
    setForm(null);
    load();
  }
  async function remove(c: Customer) {
    const ok = await confirm({ title: 'O‘chirish', message: `${c.name} — o‘chirilsinmi?`, danger: true });
    if (!ok) return;
    await api.del(`/customers/${c.id}`);
    load();
  }

  const s = search.trim().toLowerCase();
  const filtered = customers.filter(
    (c) => !s || c.name.toLowerCase().includes(s) || c.phone.includes(s),
  );

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 Mijoz qidirish (ism yoki telefon)..."
          className="flex-1 min-w-[160px] px-4 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <Button onClick={openAdd} className="shrink-0">+ Yangi mijoz</Button>
      </div>
      <div className="text-muted text-sm mb-4">{filtered.length} ta mijoz</div>

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-6 text-muted text-center">Mijoz yo‘q. "+ Yangi mijoz" bilan qo‘shing.</div>
        ) : (
          filtered.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center shrink-0">
                    {c.name.charAt(0)}
                  </span>
                  {c.name}
                </div>
                <div className="text-sm text-muted truncate pl-10">
                  {c.phone || '—'}
                  {c.note ? ` · ${c.note}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => openEdit(c)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
                <button onClick={() => remove(c)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger">🗑️</button>
              </div>
            </div>
          ))
        )}
      </div>

      {form && (
        <Modal title={form.id ? 'Mijozni tahrirlash' : 'Yangi mijoz'} onClose={() => setForm(null)}>
          <label className="block text-sm text-muted mb-1">Ismi</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Masalan: Aziz Karimov"
            autoFocus
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />
          <label className="block text-sm text-muted mb-1">Telefon</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+998 90 123 45 67"
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />
          <label className="block text-sm text-muted mb-1">Izoh</label>
          <input
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="Ixtiyoriy (masalan: doimiy mijoz)"
            className="w-full mb-4 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setForm(null)}>Bekor</Button>
            <Button className="flex-1" onClick={save}>{form.id ? 'Saqlash' : 'Qo‘shish'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
