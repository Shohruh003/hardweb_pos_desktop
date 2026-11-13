import { useEffect, useMemo, useState } from 'react';
import { Category, MenuItem } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, TrashIcon } from '../../components/cashier/icons';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

// Kategoriyalar — to'liq CRUD, "+ Yangi kategoriya" modal orqali (TZ F-4.1).
// Tartib ↑ / ↓ bilan o'zgartiriladi (ofitsiant va kassa menyusida shu tartibda chiqadi);
// har kategoriyada nechta taom borligi ko'rsatiladi.
export function CategoriesTab() {
  const confirm = useConfirm();
  const [categories, setCategories] = useState<Category[]>([]);
  // Taomlar soni (yuklanmasa — null: sonlar ko'rsatilmaydi)
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [form, setForm] = useState<{ id?: string; name: string } | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const list = await api.get<Category[]>('/menu/categories');
      setCategories(Array.isArray(list) ? list : []);
      setError('');
    } catch (e) {
      setError((e as Error)?.message || 'Kategoriyalar yuklanmadi');
    }
    api
      .get<MenuItem[]>('/menu/all-items')
      .then((list) => setItems(Array.isArray(list) ? list : []))
      .catch(() => setItems(null));
  }
  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => {
    if (!items) return null;
    const m = new Map<string, number>();
    for (const it of items) m.set(it.categoryId, (m.get(it.categoryId) ?? 0) + 1);
    return m;
  }, [items]);

  async function save() {
    if (!form || saving) return;
    const name = form.name.trim();
    if (!name) {
      setFormError('Kategoriya nomini kiriting');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (form.id) await api.patch(`/menu/categories/${form.id}`, { name });
      else {
        // Yangi kategoriya ro'yxat oxiriga qo'shiladi
        const maxOrder = categories.reduce((m, c) => Math.max(m, Number(c.sortOrder) || 0), 0);
        await api.post('/menu/categories', { name, sortOrder: Math.max(maxOrder, categories.length) + 1 });
      }
      setForm(null);
      await load();
    } catch (e) {
      setFormError((e as Error)?.message || 'Saqlanmadi');
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Category) {
    const n = counts?.get(c.id) ?? 0;
    if (n > 0) {
      // Taomli kategoriya o'chirilsa, taomlar menyuda ko'rinmay qoladi — avval ko'chirish kerak
      setError(`“${c.name}” kategoriyasida ${n} ta taom bor — avval taomlarni boshqa kategoriyaga o‘tkazing (Menyu bo‘limida).`);
      return;
    }
    if (!(await confirm({ title: 'Kategoriyani o‘chirish', message: `"${c.name}" o‘chirilsinmi?`, danger: true }))) return;
    setError('');
    try {
      await api.del(`/menu/categories/${c.id}`);
      await load();
    } catch (e) {
      setError((e as Error)?.message || 'O‘chirilmadi');
    }
  }

  // ↑ / ↓ — joyini almashtirib, butun tartibni serverga yuboramiz (xato bo'lsa — eski tartib qaytadi)
  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (moving || j < 0 || j >= categories.length) return;
    const prev = categories;
    const next = [...prev];
    [next[index], next[j]] = [next[j], next[index]];
    setCategories(next.map((c, i) => ({ ...c, sortOrder: i + 1 })));
    setMoving(true);
    setError('');
    try {
      await api.put('/menu/categories/order', { ids: next.map((c) => c.id) });
    } catch (e) {
      setCategories(prev);
      setError((e as Error)?.message || 'Tartib saqlanmadi');
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="w-full max-w-3xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-muted">
          {categories.length} ta kategoriya
          <span className="hidden sm:inline text-xs"> · tartibni ↑ / ↓ bilan o‘zgartiring</span>
        </div>
        <Button
          onClick={() => {
            setFormError('');
            setForm({ name: '' });
          }}
          className="h-11"
        >
          + Yangi kategoriya
        </Button>
      </div>

      {error && (
        <div role="alert" className="mb-3 flex items-start gap-2 bg-danger/10 border border-danger/50 text-danger rounded-xl px-3 py-2.5 text-sm font-semibold">
          <span className="flex-1">⚠️ {error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Yopish" className="font-bold">
            ✕
          </button>
        </div>
      )}

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {categories.length === 0 ? (
          <div className="p-6 text-muted text-center">Kategoriya yo‘q. “+ Yangi kategoriya” bilan qo‘shing.</div>
        ) : (
          categories.map((c, i) => {
            const n = counts?.get(c.id);
            return (
              <div key={c.id} className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2" data-testid={`category-row-${i + 1}`}>
                <span className="w-8 text-center text-sm font-bold text-muted shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-text truncate">{c.name}</div>
                  {counts && (
                    <div className={`text-xs ${n ? 'text-muted' : 'text-warning'}`}>{n ? `${n} ta taom` : 'Taom yo‘q'}</div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={moving || i === 0}
                    aria-label="Yuqoriga"
                    data-testid={`category-up-${i + 1}`}
                    className="w-11 h-11 rounded-lg bg-bg border border-border hover:border-primary flex items-center justify-center text-text disabled:opacity-30"
                  >
                    <ArrowUpIcon className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={moving || i === categories.length - 1}
                    aria-label="Pastga"
                    data-testid={`category-down-${i + 1}`}
                    className="w-11 h-11 rounded-lg bg-bg border border-border hover:border-primary flex items-center justify-center text-text disabled:opacity-30"
                  >
                    <ArrowDownIcon className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormError('');
                      setForm({ id: c.id, name: c.name });
                    }}
                    aria-label="Nomini o‘zgartirish"
                    className="w-11 h-11 rounded-lg bg-bg border border-border hover:border-primary flex items-center justify-center text-text"
                  >
                    <PencilIcon className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    aria-label="O‘chirish"
                    className="w-11 h-11 rounded-lg bg-bg border border-border hover:border-danger hover:text-danger flex items-center justify-center text-muted"
                  >
                    <TrashIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {form && (
        <Modal title={form.id ? 'Kategoriyani tahrirlash' : 'Yangi kategoriya'} onClose={() => !saving && setForm(null)}>
          <label className="block text-sm text-muted mb-1">Kategoriya nomi</label>
          <input
            autoFocus
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
              setFormError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="Masalan: Issiq taomlar"
            className="w-full mb-3 h-11 px-3 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />
          {formError && (
            <div role="alert" className="mb-3 bg-danger/10 border border-danger/50 text-danger rounded-xl px-3 py-2 text-sm font-semibold">
              {formError}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1 h-12" onClick={() => setForm(null)} disabled={saving}>
              Bekor
            </Button>
            <Button className="flex-1 h-12" onClick={save} disabled={saving}>
              {saving ? 'Saqlanmoqda…' : form.id ? 'Saqlash' : 'Qo‘shish'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
