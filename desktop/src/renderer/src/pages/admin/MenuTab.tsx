import { useEffect, useState } from 'react';
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

interface ItemForm {
  id?: string;
  name: string;
  price: string;
  categoryId: string;
  exciseRequired: boolean;
  image: string | null;
}

// Taomlarni boshqarish (TZ F-4.1): "+ Yangi taom" modal orqali, to'liq CRUD + rasm
export function MenuTab() {
  const confirm = useConfirm();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [form, setForm] = useState<ItemForm | null>(null);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  async function load() {
    const [c, i] = await Promise.all([
      api.get<Category[]>('/menu/categories'),
      api.get<MenuItem[]>('/menu/all-items'),
    ]);
    setCategories(c);
    setItems(i);
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  function openAdd() {
    setForm({ name: '', price: '', categoryId: categories[0]?.id ?? '', exciseRequired: false, image: null });
  }
  function openEdit(it: MenuItem) {
    setForm({ id: it.id, name: it.name, price: String(it.price), categoryId: it.categoryId, exciseRequired: it.exciseRequired, image: it.image ?? null });
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f && form) setForm({ ...form, image: await fileToDataUrl(f) });
  }

  async function save() {
    if (!form || !form.name || !form.price || !form.categoryId) return;
    const body = {
      name: form.name,
      price: Number(form.price),
      categoryId: form.categoryId,
      exciseRequired: form.exciseRequired,
      image: form.image ?? null,
    };
    if (form.id) await api.patch(`/menu/items/${form.id}`, body);
    else await api.post('/menu/items', body);
    setForm(null);
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

  const catOptions = categories.map((c) => ({ value: c.id, label: c.name }));

  const search2 = search.trim().toLowerCase();
  const filtered = items.filter((it) => {
    if (catFilter && it.categoryId !== catFilter) return false;
    if (statusFilter === 'available' && !it.available) return false;
    if (statusFilter === 'unavailable' && it.available) return false;
    if (search2 && !it.name.toLowerCase().includes(search2)) return false;
    return true;
  });

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="text-muted">{filtered.length} ta taom</div>
        <Button onClick={openAdd}>+ Yangi taom</Button>
      </div>

      {/* Filtrlar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom bo‘yicha qidirish..."
          className="px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
        <Select value={catFilter} onChange={setCatFilter}
          options={[{ value: '', label: 'Barcha kategoriyalar' }, ...catOptions]} />
        <Select value={statusFilter} onChange={setStatusFilter}
          options={[{ value: '', label: 'Barcha holatlar' }, { value: 'available', label: 'Mavjud' }, { value: 'unavailable', label: 'Mavjud emas' }]} />
      </div>

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-6 text-muted text-center">Taom topilmadi.</div>
        ) : (
          filtered.map((it) => (
            <div key={it.id} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-14 h-14 shrink-0">
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
                <button onClick={() => openEdit(it)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
                <button onClick={() => deleteItem(it)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger">🗑️</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Qo'shish / tahrirlash modali */}
      {form && (
        <Modal title={form.id ? 'Taomni tahrirlash' : 'Yangi taom'} onClose={() => setForm(null)}>
          <div className="mb-3">
            <div onClick={() => document.getElementById('item-file')?.click()}
              className="aspect-[4/3] rounded-xl border-2 border-dashed border-border hover:border-primary cursor-pointer overflow-hidden flex items-center justify-center text-muted">
              {form.image ? <img src={form.image} className="w-full h-full object-cover" /> : <span>📷 Rasm tanlash</span>}
            </div>
            <input id="item-file" type="file" accept="image/*" className="hidden" onChange={pickImage} />
            {form.image && <button type="button" onClick={() => setForm({ ...form, image: null })} className="text-xs text-danger mt-1">Rasmni olib tashlash</button>}
          </div>
          <label className="block text-sm text-muted mb-1">Nomi</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="block text-sm text-muted mb-1">Narxi (so‘m)</label>
          <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="block text-sm text-muted mb-1">Kategoriya</label>
          <Select className="mb-3" value={form.categoryId} onChange={(v) => setForm({ ...form, categoryId: v })} options={catOptions} placeholder="Kategoriya tanlang" />
          <label className="flex items-center gap-2 mb-4 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={form.exciseRequired} onChange={(e) => setForm({ ...form, exciseRequired: e.target.checked })} className="w-4 h-4 accent-[#059669]" />
            Aksizli mahsulot (kassada kod skanerlanadi)
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setForm(null)}>Bekor</Button>
            <Button className="flex-1" onClick={save}>{form.id ? 'Saqlash' : 'Qo‘shish'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
