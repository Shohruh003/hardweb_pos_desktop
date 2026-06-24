import { useEffect, useState } from 'react';
import { Category, MenuItem } from '@hardweb-pos/shared';
import { Button, formatSum } from '../../components/ui';
import { api } from '../../lib/api';

// Menyuni boshqarish (TZ F-4.1): taom qo'shish, narx/nom tahrirlash, mavjudligini almashtirish
export function MenuTab() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');

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

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !price || !categoryId) return;
    await api.post('/menu/items', {
      name,
      price: Number(price),
      categoryId,
    });
    setName('');
    setPrice('');
    await load();
  }

  async function toggleAvailable(item: MenuItem) {
    await api.patch(`/menu/items/${item.id}`, { available: !item.available });
    await load();
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Yangi taom */}
      <form
        onSubmit={addItem}
        className="bg-surface border border-border rounded-xl p-4 h-fit"
      >
        <div className="font-bold mb-3">Yangi taom</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Taom nomi"
          className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          type="number"
          placeholder="Narx (so'm)"
          className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button type="submit" className="w-full">
          Qo‘shish
        </Button>
      </form>

      {/* Taomlar ro'yxati */}
      <div className="col-span-2 bg-surface border border-border rounded-xl divide-y divide-border">
        {items.length === 0 ? (
          <div className="p-4 text-muted">Taom yo‘q</div>
        ) : (
          items.map((it) => (
            <div key={it.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-semibold">{it.name}</div>
                <div className="text-sm text-muted">
                  {formatSum(Number(it.price))} ·{' '}
                  {categories.find((c) => c.id === it.categoryId)?.name ?? '—'}
                </div>
              </div>
              <button
                onClick={() => toggleAvailable(it)}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold ${
                  it.available
                    ? 'bg-success/20 text-success'
                    : 'bg-muted/20 text-muted'
                }`}
              >
                {it.available ? 'Mavjud' : 'Yo‘q'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
