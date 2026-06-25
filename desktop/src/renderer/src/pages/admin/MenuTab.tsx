import { useEffect, useRef, useState } from 'react';
import { Category, MenuItem } from '@hardweb-pos/shared';
import { Button, formatSum } from '../../components/ui';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { MenuTile } from '../../components/MenuTile';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// Menyuni to'liq boshqarish (TZ F-4.1): kategoriya va taom CRUD + rasm biriktirish
export function MenuTab() {
  const confirm = useConfirm();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [excise, setExcise] = useState(false);
  const [image, setImage] = useState('');
  const [newCat, setNewCat] = useState('');
  const [edit, setEdit] = useState<MenuItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [c, i] = await Promise.all([
      api.get<Category[]>('/menu/categories'),
      api.get<MenuItem[]>('/menu/all-items'),
    ]);
    setCategories(c);
    setItems(i);
    if (!categoryId && c[0]) setCategoryId(c[0].id);
  }
  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>, setter: (s: string) => void) {
    const f = e.target.files?.[0];
    if (f) setter(await fileToDataUrl(f));
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !price || !categoryId) return;
    await api.post('/menu/items', { name, price: Number(price), categoryId, exciseRequired: excise, image: image || undefined });
    setName(''); setPrice(''); setExcise(false); setImage('');
    if (fileRef.current) fileRef.current.value = '';
    await load();
  }

  async function addCategory() {
    if (!newCat.trim()) return;
    await api.post('/menu/categories', { name: newCat.trim() });
    setNewCat('');
    await load();
  }

  async function deleteCategory(c: Category) {
    if (!(await confirm({ title: 'Kategoriyani o‘chirish', message: `"${c.name}" o‘chirilsinmi?`, danger: true }))) return;
    await api.del(`/menu/categories/${c.id}`);
    await load();
  }

  async function deleteItem(it: MenuItem) {
    if (!(await confirm({ title: 'Taomni o‘chirish', message: `"${it.name}" o‘chirilsinmi?`, danger: true }))) return;
    await api.del(`/menu/items/${it.id}`);
    await load();
  }

  async function toggleAvailable(item: MenuItem) {
    await api.patch(`/menu/items/${item.id}`, { available: !item.available });
    await load();
  }

  async function saveEdit() {
    if (!edit) return;
    await api.patch(`/menu/items/${edit.id}`, {
      name: edit.name, price: Number(edit.price), categoryId: edit.categoryId,
      exciseRequired: edit.exciseRequired, image: edit.image ?? null,
    });
    setEdit(null);
    await load();
  }

  const catOptions = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="space-y-6">
      {/* Kategoriyalar */}
      <div className="bg-surface border border-border rounded-2xl p-4">
        <div className="font-bold mb-3">Kategoriyalar</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {categories.map((c) => (
            <span key={c.id} className="flex items-center gap-2 bg-bg border border-border rounded-lg px-3 py-1.5">
              {c.name}
              <button onClick={() => deleteCategory(c)} className="text-muted hover:text-danger">✕</button>
            </span>
          ))}
          {categories.length === 0 && <span className="text-muted text-sm">Kategoriya yo‘q</span>}
        </div>
        <div className="flex gap-2">
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCategory()}
            placeholder="Yangi kategoriya nomi" className="flex-1 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <Button variant="ghost" onClick={addCategory}>+ Kategoriya</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Yangi taom */}
        <form onSubmit={addItem} className="bg-surface border border-border rounded-2xl p-4 h-fit">
          <div className="font-bold mb-3">Yangi taom</div>

          {/* Rasm biriktirish */}
          <div className="mb-3">
            <div onClick={() => fileRef.current?.click()}
              className="aspect-[4/3] rounded-xl border-2 border-dashed border-border hover:border-primary cursor-pointer overflow-hidden flex items-center justify-center text-muted">
              {image ? <img src={image} className="w-full h-full object-cover" /> : <span>📷 Rasm tanlash</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e, setImage)} />
            {image && <button type="button" onClick={() => setImage('')} className="text-xs text-danger mt-1">Rasmni olib tashlash</button>}
          </div>

          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Taom nomi"
            className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" placeholder="Narx (so'm)"
            className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <Select className="mb-2" value={categoryId} onChange={setCategoryId} options={catOptions} placeholder="Kategoriya" />
          <label className="flex items-center gap-2 mb-3 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={excise} onChange={(e) => setExcise(e.target.checked)} className="w-4 h-4 accent-[#059669]" />
            Aksizli mahsulot
          </label>
          <Button type="submit" className="w-full">Qo‘shish</Button>
        </form>

        {/* Taomlar ro'yxati */}
        <div className="col-span-2 bg-surface border border-border rounded-2xl divide-y divide-border">
          {items.length === 0 ? (
            <div className="p-4 text-muted">Taom yo‘q</div>
          ) : (
            items.map((it) => (
              <div key={it.id} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 shrink-0">
                    <MenuTile name={it.name} image={it.image} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">
                      {it.name}
                      {it.exciseRequired && <span className="ml-2 text-xs text-warning">aksizli</span>}
                    </div>
                    <div className="text-sm text-muted">
                      {formatSum(Number(it.price))} · {categories.find((c) => c.id === it.categoryId)?.name ?? '—'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => toggleAvailable(it)}
                    className={`px-3 py-1.5 rounded-md text-sm font-semibold ${it.available ? 'bg-success/20 text-success' : 'bg-muted/20 text-muted'}`}>
                    {it.available ? 'Mavjud' : 'Yo‘q'}
                  </button>
                  <button onClick={() => setEdit({ ...it })} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
                  <button onClick={() => deleteItem(it)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger">🗑️</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Tahrirlash modali */}
      {edit && (
        <Modal title="Taomni tahrirlash" onClose={() => setEdit(null)}>
          <div className="mb-3">
            <div onClick={() => document.getElementById('edit-file')?.click()}
              className="aspect-[4/3] rounded-xl border-2 border-dashed border-border hover:border-primary cursor-pointer overflow-hidden flex items-center justify-center text-muted">
              {edit.image ? <img src={edit.image} className="w-full h-full object-cover" /> : <span>📷 Rasm tanlash</span>}
            </div>
            <input id="edit-file" type="file" accept="image/*" className="hidden"
              onChange={(e) => pickImage(e, (v) => setEdit({ ...edit, image: v }))} />
            {edit.image && <button type="button" onClick={() => setEdit({ ...edit, image: null })} className="text-xs text-danger mt-1">Rasmni olib tashlash</button>}
          </div>
          <label className="block text-sm text-muted mb-1">Nomi</label>
          <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="block text-sm text-muted mb-1">Narxi</label>
          <input type="number" value={edit.price} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="block text-sm text-muted mb-1">Kategoriya</label>
          <Select className="mb-3" value={edit.categoryId} onChange={(v) => setEdit({ ...edit, categoryId: v })} options={catOptions} />
          <label className="flex items-center gap-2 mb-4 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={edit.exciseRequired} onChange={(e) => setEdit({ ...edit, exciseRequired: e.target.checked })} className="w-4 h-4 accent-[#059669]" />
            Aksizli mahsulot
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setEdit(null)}>Bekor</Button>
            <Button className="flex-1" onClick={saveEdit}>Saqlash</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
