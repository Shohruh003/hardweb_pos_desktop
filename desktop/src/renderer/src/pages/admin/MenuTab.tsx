import { useEffect, useState } from 'react';
import { Category, MenuItem, MenuUnit, Product, RecipeItem, Station } from '@hardweb-pos/shared';
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
  ingredients: string;
  unit: MenuUnit;
  stationId: string;
}

// Retsept qatori (taomga ketadigan mahsulot)
interface RecipeRow {
  productId: string;
  amount: string;
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
  // Sklad mahsulotlari va tahrirlanayotgan taom retsepti
  const [products, setProducts] = useState<Product[]>([]);
  const [recipe, setRecipe] = useState<RecipeRow[]>([]);
  const [stations, setStations] = useState<Station[]>([]);

  async function load() {
    const [c, i, p, st] = await Promise.all([
      api.get<Category[]>('/menu/categories'),
      api.get<MenuItem[]>('/menu/all-items'),
      api.get<Product[]>('/inventory/products').catch(() => [] as Product[]),
      api.get<Station[]>('/stations').catch(() => [] as Station[]),
    ]);
    setCategories(c);
    setItems(i);
    setProducts(p);
    setStations(st);
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  function openAdd() {
    setRecipe([]);
    setForm({ name: '', price: '', categoryId: categories[0]?.id ?? '', exciseRequired: false, image: null, ingredients: '', unit: MenuUnit.Piece, stationId: stations[0]?.id ?? '' });
  }
  async function openEdit(it: MenuItem) {
    setRecipe([]);
    setForm({ id: it.id, name: it.name, price: String(it.price), categoryId: it.categoryId, exciseRequired: it.exciseRequired, image: it.image ?? null, ingredients: it.ingredients ?? '', unit: it.unit ?? MenuUnit.Piece, stationId: it.stationId ?? '' });
    // Mavjud retseptni yuklaymiz
    try {
      const rows = await api.get<RecipeItem[]>(`/inventory/recipe/${it.id}`);
      setRecipe(rows.map((r) => ({ productId: r.productId, amount: String(r.amount) })));
    } catch {
      /* retsept bo'lmasligi mumkin */
    }
  }

  function addRecipeRow() {
    setRecipe((r) => [...r, { productId: products[0]?.id ?? '', amount: '' }]);
  }
  function updateRecipeRow(i: number, patch: Partial<RecipeRow>) {
    setRecipe((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function removeRecipeRow(i: number) {
    setRecipe((r) => r.filter((_, idx) => idx !== i));
  }
  function unitOf(productId: string): string {
    return products.find((p) => p.id === productId)?.unit ?? '';
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
      ingredients: form.ingredients.trim() || null,
      unit: form.unit,
      stationId: form.stationId || null,
    };
    const saved = form.id
      ? await api.patch<MenuItem>(`/menu/items/${form.id}`, body)
      : await api.post<MenuItem>('/menu/items', body);
    // Retseptni saqlaymiz (mahsulot + miqdor) — sotilganda skladdan ayiriladi
    const menuItemId = saved?.id ?? form.id;
    if (menuItemId) {
      const items = recipe
        .filter((r) => r.productId && Number(r.amount) > 0)
        .map((r) => ({ productId: r.productId, amount: Number(r.amount) }));
      await api.put(`/inventory/recipe/${menuItemId}`, { items }).catch(() => {});
    }
    setForm(null);
    setRecipe([]);
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

  async function toggleFavorite(item: MenuItem) {
    await api.patch(`/menu/items/${item.id}`, { favorite: !item.favorite });
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
                    {it.unit === MenuUnit.Weight && <span className="ml-2 text-xs font-bold text-warning bg-warning/15 rounded px-1.5 py-0.5">kg</span>}
                    {it.exciseRequired && <span className="ml-2 text-xs text-warning">aksizli</span>}
                  </div>
                  <div className="text-sm text-muted">
                    {formatSum(Number(it.price))}{it.unit === MenuUnit.Weight ? '/kg' : ''} · {categories.find((c) => c.id === it.categoryId)?.name ?? '—'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => toggleAvailable(it)}
                  className={`px-3 py-1.5 rounded-md text-sm font-semibold ${it.available ? 'bg-success/20 text-success' : 'bg-muted/20 text-muted'}`}>
                  {it.available ? 'Mavjud' : 'Yo‘q'}
                </button>
                <button
                  onClick={() => toggleFavorite(it)}
                  title={it.favorite ? 'Sevimlidan olib tashlash' : 'Sevimlilarga qo‘shish'}
                  className={`px-3 py-1.5 rounded-md text-sm border ${it.favorite ? 'bg-warning/15 border-warning/40 text-warning' : 'bg-bg border-border hover:border-warning'}`}
                >
                  {it.favorite ? '⭐' : '☆'}
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
          {/* Sotuv birligi: dona yoki kilo */}
          <label className="block text-sm text-muted mb-1">Sotuv birligi</label>
          <div className="flex gap-2 mb-3">
            {[
              { v: MenuUnit.Piece, label: 'Dona' },
              { v: MenuUnit.Weight, label: 'Kilo (kg)' },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setForm({ ...form, unit: o.v })}
                className={`flex-1 py-2 rounded-lg font-semibold border ${
                  form.unit === o.v ? 'bg-primary text-white border-primary' : 'bg-bg border-border text-muted hover:text-text'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <label className="block text-sm text-muted mb-1">
            {form.unit === MenuUnit.Weight ? '1 kg narxi (so‘m)' : 'Narxi (so‘m)'}
          </label>
          <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="block text-sm text-muted mb-1">Kategoriya (birinchi/ikkinchi taom, salat, shirinlik...)</label>
          <Select className="mb-3" value={form.categoryId} onChange={(v) => setForm({ ...form, categoryId: v })} options={catOptions} placeholder="Kategoriya tanlang" />
          <label className="block text-sm text-muted mb-1">Bo‘lim (qaysi sexdan chiqadi)</label>
          <Select
            className="mb-3"
            value={form.stationId}
            onChange={(v) => setForm({ ...form, stationId: v })}
            options={[
              { value: '', label: 'Bo‘limsiz (chek chiqmaydi)' },
              ...stations.map((s) => ({ value: s.id, label: s.name })),
            ]}
            placeholder="Bo‘lim tanlang"
          />
          <label className="block text-sm text-muted mb-1">Ketadigan mahsulotlar (ingredientlar)</label>
          <textarea
            value={form.ingredients}
            onChange={(e) => setForm({ ...form, ingredients: e.target.value })}
            rows={3}
            placeholder="Masalan:&#10;Guruch 200g&#10;Go‘sht 150g&#10;Sabzi 100g"
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary text-sm"
          />
          {/* Retsept — skladdan ayiriladigan mahsulotlar (universal) */}
          <div className="mb-4 rounded-xl border border-border bg-bg/40 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">
                📦 Retsept — skladdan ayiriladigan mahsulotlar
              </div>
              <button
                type="button"
                onClick={addRecipeRow}
                disabled={products.length === 0}
                className="text-xs font-semibold text-primary hover:underline disabled:text-muted disabled:no-underline"
              >
                + Mahsulot
              </button>
            </div>
            {products.length === 0 ? (
              <div className="text-xs text-muted">
                Avval "Sklad" bo‘limida mahsulot qo‘shing.
              </div>
            ) : recipe.length === 0 ? (
              <div className="text-xs text-muted">
                Hali mahsulot biriktirilmagan. {form.unit === MenuUnit.Weight ? '1 kg' : '1 dona'} taomga qancha ketishini kiriting.
              </div>
            ) : (
              <div className="space-y-2">
                {recipe.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <Select
                        value={row.productId}
                        onChange={(v) => updateRecipeRow(i, { productId: v })}
                        options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.unit})` }))}
                      />
                    </div>
                    <input
                      type="number"
                      value={row.amount}
                      onChange={(e) => updateRecipeRow(i, { amount: e.target.value })}
                      placeholder="miqdor"
                      className="w-24 px-2.5 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary text-sm"
                    />
                    <span className="w-8 text-xs text-muted">{unitOf(row.productId)}</span>
                    <button
                      type="button"
                      onClick={() => removeRecipeRow(i)}
                      className="shrink-0 w-8 h-8 rounded-lg border border-border text-danger hover:bg-danger/10"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="text-[11px] text-muted">
                  Miqdor — {form.unit === MenuUnit.Weight ? '1 kg' : '1 dona/porsiya'} taomga. Taom sotilganda avtomatik ayiriladi.
                </div>
              </div>
            )}
          </div>

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
