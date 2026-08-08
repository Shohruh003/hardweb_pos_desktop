import { useEffect, useState } from 'react';
import { Product, ProductUnit } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

const UNIT_OPTIONS = [
  { value: ProductUnit.Kg, label: 'kg (kilogramm)' },
  { value: ProductUnit.Gram, label: 'g (gramm)' },
  { value: ProductUnit.Litr, label: 'l (litr)' },
  { value: ProductUnit.Ml, label: 'ml (millilitr)' },
  { value: ProductUnit.Dona, label: 'dona' },
];

// Miqdorni chiroyli ko'rsatish (kasrlarni ortiqcha nol'siz)
function num(n: number): string {
  return Number(n).toLocaleString('uz-UZ', { maximumFractionDigits: 3 });
}

interface ProductForm {
  id?: string;
  name: string;
  unit: ProductUnit;
  stock: string;
  minStock: string;
}

// Sklad (ombor) — mahsulotlar va qoldiq. Taom sotilganda retsept bo'yicha ayiriladi.
export function SkladTab() {
  const confirm = useConfirm();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<ProductForm | null>(null);
  // Kirim/chiqim (ombor qoldig'ini o'zgartirish) modali
  const [adjust, setAdjust] = useState<{ product: Product; sign: 1 | -1 } | null>(null);
  const [adjustQty, setAdjustQty] = useState('');

  async function load() {
    setProducts(await api.get<Product[]>('/inventory/products'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  function openAdd() {
    setForm({ name: '', unit: ProductUnit.Kg, stock: '', minStock: '' });
  }
  function openEdit(p: Product) {
    setForm({ id: p.id, name: p.name, unit: p.unit, stock: String(p.stock), minStock: String(p.minStock) });
  }

  async function save() {
    if (!form || !form.name.trim()) return;
    const body = {
      name: form.name.trim(),
      unit: form.unit,
      stock: Number(form.stock) || 0,
      minStock: Number(form.minStock) || 0,
    };
    if (form.id) await api.patch(`/inventory/products/${form.id}`, body);
    else await api.post('/inventory/products', body);
    setForm(null);
    await load();
  }

  async function remove(p: Product) {
    if (!(await confirm({ title: 'Mahsulotni o‘chirish', message: `"${p.name}" o‘chirilsinmi? Unga bog‘liq retseptlar ham o‘chadi.`, danger: true }))) return;
    await api.del(`/inventory/products/${p.id}`);
    await load();
  }

  async function saveAdjust() {
    if (!adjust) return;
    const qty = Number(adjustQty);
    if (!(qty > 0)) return;
    await api.post(`/inventory/products/${adjust.product.id}/adjust`, { delta: adjust.sign * qty });
    setAdjust(null);
    setAdjustQty('');
    await load();
  }

  const s = search.trim().toLowerCase();
  const filtered = products.filter((p) => !s || p.name.toLowerCase().includes(s));
  const lowCount = products.filter((p) => p.stock <= p.minStock).length;

  return (
    <div className="w-full">
      {/* Tepa panel: qidiruv (o'rtada) + qo'shish tugmasi */}
      <div className="flex items-center gap-3 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 Mahsulot qidirish..."
          className="flex-1 px-4 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <Button onClick={openAdd} className="shrink-0">+ Yangi mahsulot</Button>
      </div>
      <div className="text-muted text-sm mb-4">
        {filtered.length} ta mahsulot
        {lowCount > 0 && (
          <span className="ml-2 text-danger font-semibold">· {lowCount} ta kam qoldi ⚠️</span>
        )}
      </div>

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-6 text-muted text-center">Mahsulot yo‘q. "+ Yangi mahsulot" bilan qo‘shing.</div>
        ) : (
          filtered.map((p) => {
            const low = p.stock <= p.minStock;
            return (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate flex items-center gap-2">
                    {p.name}
                    {low && <span className="text-xs font-bold text-danger bg-danger/15 rounded px-1.5 py-0.5">kam qoldi</span>}
                  </div>
                  <div className="text-sm text-muted">
                    Min: {num(p.minStock)} {p.unit}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className={`text-right ${low ? 'text-danger' : ''}`}>
                    <div className="text-lg font-extrabold leading-none">{num(p.stock)}</div>
                    <div className="text-xs text-muted">{p.unit}</div>
                  </div>
                  <button
                    onClick={() => { setAdjust({ product: p, sign: 1 }); setAdjustQty(''); }}
                    title="Kirim (qo‘shish)"
                    className="w-9 h-9 rounded-lg bg-success/15 text-success font-bold hover:bg-success/25"
                  >
                    ＋
                  </button>
                  <button
                    onClick={() => { setAdjust({ product: p, sign: -1 }); setAdjustQty(''); }}
                    title="Chiqim (ayirish)"
                    className="w-9 h-9 rounded-lg bg-danger/15 text-danger font-bold hover:bg-danger/25"
                  >
                    －
                  </button>
                  <button onClick={() => openEdit(p)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
                  <button onClick={() => remove(p)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger">🗑️</button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Qo'shish / tahrirlash modali */}
      {form && (
        <Modal title={form.id ? 'Mahsulotni tahrirlash' : 'Yangi mahsulot'} onClose={() => setForm(null)}>
          <label className="block text-sm text-muted mb-1">Nomi</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Masalan: Guruch"
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />
          <label className="block text-sm text-muted mb-1">O‘lchov birligi</label>
          <Select className="mb-3" value={form.unit} onChange={(v) => setForm({ ...form, unit: v as ProductUnit })} options={UNIT_OPTIONS} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted mb-1">Boshlang‘ich qoldiq</label>
              <input
                type="number"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                placeholder="0"
                className="w-full px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Minimal qoldiq</label>
              <input
                type="number"
                value={form.minStock}
                onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                placeholder="0"
                className="w-full px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button variant="ghost" className="flex-1" onClick={() => setForm(null)}>Bekor</Button>
            <Button className="flex-1" onClick={save}>{form.id ? 'Saqlash' : 'Qo‘shish'}</Button>
          </div>
        </Modal>
      )}

      {/* Kirim / chiqim modali */}
      {adjust && (
        <Modal
          title={`${adjust.product.name} — ${adjust.sign === 1 ? 'Kirim (qo‘shish)' : 'Chiqim (ayirish)'}`}
          onClose={() => setAdjust(null)}
        >
          <div className="text-sm text-muted mb-3">
            Hozirgi qoldiq: <span className="font-semibold text-text">{num(adjust.product.stock)} {adjust.product.unit}</span>
          </div>
          <label className="block text-sm text-muted mb-1">Miqdor ({adjust.product.unit})</label>
          <input
            autoFocus
            inputMode="decimal"
            value={adjustQty}
            onChange={(e) => setAdjustQty(e.target.value.replace(/[^0-9.]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && saveAdjust()}
            placeholder="Masalan: 10"
            className="w-full mb-1 px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary text-lg font-bold"
          />
          {Number(adjustQty) > 0 && (
            <div className="text-sm mb-2">
              Yangi qoldiq:{' '}
              <span className={`font-bold ${adjust.sign === 1 ? 'text-success' : 'text-danger'}`}>
                {num(adjust.product.stock + adjust.sign * Number(adjustQty))} {adjust.product.unit}
              </span>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <Button variant="ghost" className="flex-1" onClick={() => setAdjust(null)}>Bekor</Button>
            <Button className="flex-1" onClick={saveAdjust}>Saqlash</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
