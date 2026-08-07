import { useEffect, useState } from 'react';
import { Category } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

// Kategoriyalar — to'liq CRUD, "+ Yangi kategoriya" modal orqali (TZ F-4.1)
export function CategoriesTab() {
  const confirm = useConfirm();
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<{ id?: string; name: string } | null>(null);

  async function load() {
    setCategories(await api.get<Category[]>('/menu/categories'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function save() {
    if (!form || !form.name.trim()) return;
    try {
      if (form.id) await api.patch(`/menu/categories/${form.id}`, { name: form.name.trim() });
      else await api.post('/menu/categories', { name: form.name.trim() });
      setForm(null);
      await load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function remove(c: Category) {
    if (!(await confirm({ title: 'Kategoriyani o‘chirish', message: `"${c.name}" o‘chirilsinmi?`, danger: true }))) return;
    await api.del(`/menu/categories/${c.id}`);
    await load();
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="text-muted">{categories.length} ta kategoriya</div>
        <Button onClick={() => setForm({ name: '' })}>+ Yangi kategoriya</Button>
      </div>

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {categories.length === 0 ? (
          <div className="p-6 text-muted text-center">Kategoriya yo‘q. “+ Yangi kategoriya” bilan qo‘shing.</div>
        ) : (
          categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3">
              <span className="font-semibold">{c.name}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setForm({ id: c.id, name: c.name })} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
                <button onClick={() => remove(c)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger">🗑️</button>
              </div>
            </div>
          ))
        )}
      </div>

      {form && (
        <Modal title={form.id ? 'Kategoriyani tahrirlash' : 'Yangi kategoriya'} onClose={() => setForm(null)}>
          <label className="block text-sm text-muted mb-1">Kategoriya nomi</label>
          <input
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="Masalan: Issiq taomlar"
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
