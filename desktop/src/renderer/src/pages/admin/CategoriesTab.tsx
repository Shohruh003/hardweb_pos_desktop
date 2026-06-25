import { useEffect, useState } from 'react';
import { Category } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

// Kategoriyalar — alohida bo'lim, to'liq CRUD (TZ F-4.1)
export function CategoriesTab() {
  const confirm = useConfirm();
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<Category | null>(null);

  async function load() {
    setCategories(await api.get<Category[]>('/menu/categories'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.post('/menu/categories', { name: name.trim() });
    setName('');
    await load();
  }

  async function remove(c: Category) {
    if (!(await confirm({ title: 'Kategoriyani o‘chirish', message: `"${c.name}" o‘chirilsinmi?`, danger: true }))) return;
    await api.del(`/menu/categories/${c.id}`);
    await load();
  }

  async function saveEdit() {
    if (!edit) return;
    await api.patch(`/menu/categories/${edit.id}`, { name: edit.name });
    setEdit(null);
    await load();
  }

  return (
    <div className="w-full">
      <form onSubmit={add} className="flex gap-2 mb-5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Yangi kategoriya nomi"
          className="flex-1 px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <Button type="submit">+ Qo‘shish</Button>
      </form>

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {categories.length === 0 ? (
          <div className="p-4 text-muted">Kategoriya yo‘q</div>
        ) : (
          categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3">
              <span className="font-semibold">{c.name}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setEdit({ ...c })} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
                <button onClick={() => remove(c)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger">🗑️</button>
              </div>
            </div>
          ))
        )}
      </div>

      {edit && (
        <Modal title="Kategoriyani tahrirlash" onClose={() => setEdit(null)}>
          <label className="block text-sm text-muted mb-1">Nomi</label>
          <input
            value={edit.name}
            onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            className="w-full mb-4 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setEdit(null)}>Bekor</Button>
            <Button className="flex-1" onClick={saveEdit}>Saqlash</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
