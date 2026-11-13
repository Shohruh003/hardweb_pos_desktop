import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Category, MenuItem, MenuUnit, Product, RecipeItem, Station } from '@hardweb-pos/shared';
import { Button, formatSum } from '../../components/ui';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { DishThumb } from '../../components/admin/DishThumb';
import { PhotoField, type PhotoChange } from '../../components/admin/PhotoField';
import { ImageFileError, firstFile, resizeImageFile } from '../../components/admin/imageResize';
import { CameraIcon, CheckIcon, PencilIcon, TrashIcon } from '../../components/cashier/icons';
import { groupDigits } from '../../components/cashier/orderType';
import { cleanDecimalInput, cleanDigitsInput } from '../../components/numeric';
import { api, assetUrl } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

interface ItemForm {
  id?: string;
  name: string;
  price: string; // faqat raqamlar (butun so'm)
  categoryId: string;
  exciseRequired: boolean;
  ingredients: string;
  unit: MenuUnit;
  stationId: string;
  /** serverdagi joriy rasm (to'liq URL) */
  currentImage?: string;
}

// Retsept qatori (taomga ketadigan mahsulot)
interface RecipeRow {
  productId: string;
  amount: string;
}

/** Taomning rasmi: server manzili (imageUrl) yoki eski server/demo'dagi data URL */
function itemImage(it: MenuItem): string | undefined {
  return assetUrl(it.imageUrl) ?? (it.image || undefined);
}

/** Qidiruv: kichik harf, o'zbekcha apostroflarsiz ("Go‘sht" = "gosht") */
function norm(s: string): string {
  return s.toLowerCase().replace(/['‘’`ʻʼ]/g, '').trim();
}

const errText = (e: unknown, fallback: string) =>
  e instanceof ImageFileError ? e.message : (e as Error)?.message || fallback;

// Taomlarni boshqarish (TZ F-4.1): "+ Yangi taom" modal orqali, to'liq CRUD + rasm.
// Rasm: brauzerning o'zida 640 px gacha kichraytiriladi (JPEG) va faqat o'zgarganda yuboriladi.
// Har qatorda "📷" — formani ochmasdan tez rasm yuklash (149 taomni tez suratga olish uchun).
export function MenuTab() {
  const confirm = useConfirm();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<ItemForm | null>(null);
  const [photo, setPhoto] = useState<PhotoChange>(undefined);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // Sklad mahsulotlari va tahrirlanayotgan taom retsepti
  const [products, setProducts] = useState<Product[]>([]);
  const [recipe, setRecipe] = useState<RecipeRow[]>([]);
  // Retsept serverdan yuklandimi — yuklanmagan retsept saqlashda o'chib ketmasin
  const [recipeLoaded, setRecipeLoaded] = useState(true);
  const [stations, setStations] = useState<Station[]>([]);
  const [purchases, setPurchases] = useState<{ productId: string; total: number; quantity: number }[]>([]);
  // Qatordagi tez amallar (rasm, mavjud, sevimli) holati va xabarlari
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState('');
  const [actionOk, setActionOk] = useState('');
  const quickInputRef = useRef<HTMLInputElement>(null);
  const quickTargetRef = useRef<MenuItem | null>(null);
  const okTimer = useRef<number | undefined>(undefined);

  async function load() {
    try {
      const [c, i, p, st, pur] = await Promise.all([
        api.get<Category[]>('/menu/categories'),
        api.get<MenuItem[]>('/menu/all-items'),
        api.get<Product[]>('/inventory/products').catch(() => [] as Product[]),
        api.get<Station[]>('/stations').catch(() => [] as Station[]),
        api.get<{ productId: string; total: number; quantity: number }[]>('/inventory/purchases').catch(() => []),
      ]);
      setCategories(c);
      setItems(i);
      setProducts(p);
      setStations(st);
      setPurchases(pur);
      setLoadError('');
    } catch (e) {
      setLoadError((e as Error)?.message || 'Menyu yuklanmadi');
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Electron'da rasm sudrab tashlash zonadan tashqariga tushsa, oyna o'sha faylni ochib yuboradi
  // (ilova sahifasi yo'qoladi) — shu bo'lim ochiq turganda buning oldini olamiz
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
      window.clearTimeout(okTimer.current);
    };
  }, []);

  // O'rtacha tannarx (себестоимость ср.) — kirimlardan og'irlashgan o'rtacha narx
  const avgCost = useMemo(() => {
    const agg = new Map<string, { sum: number; qty: number }>();
    for (const pr of purchases) {
      const a = agg.get(pr.productId) || { sum: 0, qty: 0 };
      a.sum += Number(pr.total);
      a.qty += Number(pr.quantity);
      agg.set(pr.productId, a);
    }
    const m = new Map<string, number>();
    for (const [pid, a] of agg) m.set(pid, a.qty > 0 ? a.sum / a.qty : 0);
    return m;
  }, [purchases]);

  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name] as const)), [categories]);

  function flashOk(text: string) {
    setActionOk(text);
    window.clearTimeout(okTimer.current);
    okTimer.current = window.setTimeout(() => setActionOk(''), 2500);
  }

  function openAdd() {
    setRecipe([]);
    setRecipeLoaded(true);
    setPhoto(undefined);
    setFormError('');
    setForm({
      name: '',
      price: '',
      categoryId: catFilter || categories[0]?.id || '',
      exciseRequired: false,
      ingredients: '',
      unit: MenuUnit.Piece,
      stationId: stations[0]?.id ?? '',
    });
  }

  const openEdit = useCallback(async (it: MenuItem) => {
    setRecipe([]);
    setRecipeLoaded(false);
    setPhoto(undefined);
    setFormError('');
    setForm({
      id: it.id,
      name: it.name,
      price: String(Math.round(Number(it.price) || 0)),
      categoryId: it.categoryId,
      exciseRequired: it.exciseRequired,
      ingredients: it.ingredients ?? '',
      unit: it.unit ?? MenuUnit.Piece,
      stationId: it.stationId ?? '',
      currentImage: itemImage(it),
    });
    // Mavjud retseptni yuklaymiz
    try {
      const rows = await api.get<RecipeItem[]>(`/inventory/recipe/${it.id}`);
      setRecipe(rows.map((r) => ({ productId: r.productId, amount: String(r.amount) })));
      setRecipeLoaded(true);
    } catch {
      /* retsept yuklanmadi — saqlashda retseptga tegilmaydi */
    }
  }, []);

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

  async function save() {
    if (!form || saving) return;
    const name = form.name.trim();
    if (!name || !form.price || !form.categoryId) {
      setFormError('Nomi, narxi va kategoriyasini kiriting');
      return;
    }
    const body: Record<string, unknown> = {
      name,
      price: Number(form.price),
      categoryId: form.categoryId,
      exciseRequired: form.exciseRequired,
      ingredients: form.ingredients.trim() || null,
      unit: form.unit,
      stationId: form.stationId || null,
    };
    // Rasm faqat o'zgarganda: yangi data URL yoki '' (o'chirish)
    if (photo !== undefined && (form.id || photo)) body.image = photo;
    setSaving(true);
    setFormError('');
    try {
      const saved = form.id
        ? await api.patch<MenuItem>(`/menu/items/${form.id}`, body)
        : await api.post<MenuItem>('/menu/items', body);
      // Retseptni saqlaymiz (mahsulot + miqdor) — sotilganda skladdan ayiriladi.
      // Mavjud retsept yuklanmagan bo'lsa — unga tegmaymiz (o'chib ketmasin).
      const menuItemId = saved?.id ?? form.id;
      if (menuItemId && recipeLoaded) {
        const rows = recipe
          .filter((r) => r.productId && Number(r.amount) > 0)
          .map((r) => ({ productId: r.productId, amount: Number(r.amount) }));
        await api.put(`/inventory/recipe/${menuItemId}`, { items: rows }).catch(() => {
          flashOk('Taom saqlandi, lekin retsept saqlanmadi — qayta urinib ko‘ring');
        });
      }
      setForm(null);
      setRecipe([]);
      setPhoto(undefined);
      flashOk(`"${name}" saqlandi ✓`);
      await load();
    } catch (e) {
      setFormError(errText(e, 'Saqlanmadi'));
    } finally {
      setSaving(false);
    }
  }

  const deleteItem = useCallback(
    async (it: MenuItem) => {
      if (!(await confirm({ title: 'Taomni o‘chirish', message: `"${it.name}" o‘chirilsinmi?`, danger: true }))) return;
      setActionError('');
      try {
        await api.del(`/menu/items/${it.id}`);
        setItems((list) => list.filter((x) => x.id !== it.id));
      } catch (e) {
        setActionError(`"${it.name}": ${errText(e, 'o‘chirilmadi')}`);
      }
    },
    [confirm],
  );

  // Qisman yangilash (mavjud / sevimli) — javob kelguncha ro'yxatda darrov ko'rinadi
  const patchItem = useCallback(async (it: MenuItem, patch: Partial<MenuItem>) => {
    setActionError('');
    setItems((list) => list.map((x) => (x.id === it.id ? { ...x, ...patch } : x)));
    try {
      const saved = await api.patch<MenuItem>(`/menu/items/${it.id}`, patch);
      if (saved && saved.id === it.id) setItems((list) => list.map((x) => (x.id === it.id ? { ...x, ...saved } : x)));
    } catch (e) {
      setItems((list) => list.map((x) => (x.id === it.id ? it : x)));
      setActionError(`"${it.name}": ${errText(e, 'saqlanmadi')}`);
    }
  }, []);

  const toggleAvailable = useCallback((it: MenuItem) => patchItem(it, { available: !it.available }), [patchItem]);
  const toggleFavorite = useCallback((it: MenuItem) => patchItem(it, { favorite: !it.favorite }), [patchItem]);

  // Tez rasm yuklash: tanlash -> kichraytirish -> PATCH { image }
  const uploadPhoto = useCallback(async (it: MenuItem, file: File | null) => {
    if (!file) return;
    setUploading((u) => ({ ...u, [it.id]: true }));
    setActionError('');
    try {
      const dataUrl = await resizeImageFile(file);
      const saved = await api.patch<MenuItem>(`/menu/items/${it.id}`, { image: dataUrl });
      setItems((list) =>
        list.map((x) => {
          if (x.id !== it.id) return x;
          const next = { ...x, ...(saved && saved.id === it.id ? saved : {}) };
          // Server rasm manzilini qaytarmasa (eski server) — ko'rsatish uchun yangi rasmni o'zida saqlaymiz
          if (!next.imageUrl && !next.image) next.image = dataUrl;
          return next;
        }),
      );
      flashOk(`"${it.name}" — rasm saqlandi ✓`);
    } catch (e) {
      setActionError(`"${it.name}": ${errText(e, 'rasm saqlanmadi')}`);
    } finally {
      setUploading((u) => {
        const next = { ...u };
        delete next[it.id];
        return next;
      });
    }
  }, []);

  const startQuickPhoto = useCallback((it: MenuItem) => {
    quickTargetRef.current = it;
    quickInputRef.current?.click();
  }, []);

  const catOptions = categories.map((c) => ({ value: c.id, label: c.name }));

  const filtered = useMemo(() => {
    const q = norm(search);
    return items.filter((it) => {
      if (catFilter && it.categoryId !== catFilter) return false;
      if (statusFilter === 'available' && !it.available) return false;
      if (statusFilter === 'unavailable' && it.available) return false;
      if (statusFilter === 'nophoto' && itemImage(it)) return false;
      if (statusFilter === 'photo' && !itemImage(it)) return false;
      if (q && !norm(it.name).includes(q)) return false;
      return true;
    });
  }, [items, search, catFilter, statusFilter]);

  const withPhoto = useMemo(() => items.filter((it) => itemImage(it)).length, [items]);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="text-muted">
          {filtered.length} ta taom
          <span className="ml-2 text-xs">
            · rasmli {withPhoto} / {items.length}
          </span>
        </div>
        <Button onClick={openAdd} className="h-11">
          + Yangi taom
        </Button>
      </div>

      {/* Filtrlar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nom bo‘yicha qidirish..."
          className="h-11 px-3 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <Select value={catFilter} onChange={setCatFilter} options={[{ value: '', label: 'Barcha kategoriyalar' }, ...catOptions]} />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: '', label: 'Barcha holatlar' },
            { value: 'available', label: 'Mavjud' },
            { value: 'unavailable', label: 'Mavjud emas' },
            { value: 'nophoto', label: 'Rasmsiz taomlar' },
            { value: 'photo', label: 'Rasmli taomlar' },
          ]}
        />
      </div>

      {loadError && (
        <div role="alert" className="mb-3 bg-danger/10 border border-danger/50 text-danger rounded-xl px-3 py-2.5 text-sm font-semibold">
          Menyu yuklanmadi: {loadError}{' '}
          <button type="button" onClick={load} className="underline font-bold">
            Qayta urinish
          </button>
        </div>
      )}
      {actionError && (
        <div role="alert" className="mb-3 flex items-start gap-2 bg-danger/10 border border-danger/50 text-danger rounded-xl px-3 py-2.5 text-sm font-semibold">
          <span className="flex-1">⚠️ {actionError}</span>
          <button type="button" onClick={() => setActionError('')} className="font-bold" aria-label="Yopish">
            ✕
          </button>
        </div>
      )}
      {actionOk && !actionError && (
        <div className="mb-3 flex items-center gap-2 bg-success/10 border border-success/50 text-success rounded-xl px-3 py-2.5 text-sm font-bold">
          <CheckIcon className="w-4 h-4" /> {actionOk}
        </div>
      )}

      {/* Tez rasm yuklash uchun yashirin tanlagich (qatordagi kamera tugmasi ochadi) */}
      <input
        ref={quickInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="menu-photo-quick-input"
        onChange={(e) => {
          const target = quickTargetRef.current;
          const file = firstFile(e.target.files);
          e.target.value = '';
          if (target) void uploadPhoto(target, file);
        }}
      />

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-6 text-muted text-center">Taom topilmadi.</div>
        ) : (
          filtered.map((it) => (
            <MenuRow
              key={it.id}
              item={it}
              categoryName={categoryName.get(it.categoryId) ?? '—'}
              uploading={!!uploading[it.id]}
              onPhoto={startQuickPhoto}
              onDropPhoto={uploadPhoto}
              onToggleAvailable={toggleAvailable}
              onToggleFavorite={toggleFavorite}
              onEdit={openEdit}
              onDelete={deleteItem}
            />
          ))
        )}
      </div>

      {/* Qo'shish / tahrirlash modali */}
      {form && (
        <Modal title={form.id ? 'Taomni tahrirlash' : 'Yangi taom'} onClose={() => !saving && setForm(null)}>
          <div className="mb-4">
            <PhotoField name={form.name} currentSrc={form.currentImage} value={photo} onChange={setPhoto} disabled={saving} />
          </div>
          <label className="block text-sm text-muted mb-1">Nomi</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full mb-3 h-11 px-3 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />
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
                className={`flex-1 h-11 rounded-lg font-semibold border ${
                  form.unit === o.v ? 'bg-primary text-white border-primary' : 'bg-bg border-border text-muted hover:text-text'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <label className="block text-sm text-muted mb-1">{form.unit === MenuUnit.Weight ? '1 kg narxi (so‘m)' : 'Narxi (so‘m)'}</label>
          <input
            inputMode="numeric"
            value={form.price ? groupDigits(form.price) : ''}
            onChange={(e) => setForm({ ...form, price: cleanDigitsInput(e.target.value).slice(0, 10) })}
            placeholder="Masalan: 35 000"
            className="w-full mb-3 h-11 px-3 rounded-lg bg-bg border border-border outline-none focus:border-primary font-semibold"
          />
          <label className="block text-sm text-muted mb-1">Kategoriya (birinchi/ikkinchi taom, salat, shirinlik...)</label>
          <Select
            className="mb-3"
            value={form.categoryId}
            onChange={(v) => setForm({ ...form, categoryId: v })}
            options={catOptions}
            placeholder="Kategoriya tanlang"
          />
          <label className="block text-sm text-muted mb-1">Bo‘lim (qaysi sexdan chiqadi)</label>
          <Select
            className="mb-3"
            value={form.stationId}
            onChange={(v) => setForm({ ...form, stationId: v })}
            options={[{ value: '', label: 'Bo‘limsiz (chek chiqmaydi)' }, ...stations.map((s) => ({ value: s.id, label: s.name }))]}
            placeholder="Bo‘lim tanlang"
          />
          {/* Retsept — skladdan ayiriladigan mahsulotlar (universal) */}
          <div className="mb-4 rounded-xl border border-border bg-bg/40 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">📦 Retsept — skladdan ayiriladigan mahsulotlar</div>
              <button
                type="button"
                onClick={addRecipeRow}
                disabled={products.length === 0 || !recipeLoaded}
                className="text-xs font-semibold text-primary hover:underline disabled:text-muted disabled:no-underline"
              >
                + Mahsulot
              </button>
            </div>
            {!recipeLoaded ? (
              <div className="text-xs text-muted">Retsept yuklanmoqda… (yuklanmasa — saqlashda retsept o‘zgarmaydi)</div>
            ) : products.length === 0 ? (
              <div className="text-xs text-muted">Avval "Sklad" bo‘limida mahsulot qo‘shing.</div>
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
                      inputMode="decimal"
                      value={row.amount}
                      onChange={(e) => updateRecipeRow(i, { amount: cleanDecimalInput(e.target.value, 3) })}
                      placeholder="miqdor"
                      className="w-24 h-10 px-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary text-sm"
                    />
                    <span className="w-8 text-xs text-muted">{unitOf(row.productId)}</span>
                    <button
                      type="button"
                      onClick={() => removeRecipeRow(i)}
                      aria-label="Qatorni o‘chirish"
                      className="shrink-0 w-10 h-10 rounded-lg border border-border text-danger hover:bg-danger/10"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="text-[11px] text-muted">
                  Miqdor — {form.unit === MenuUnit.Weight ? '1 kg' : '1 dona/porsiya'} taomga. Taom sotilganda avtomatik ayiriladi.
                </div>
                {(() => {
                  const cost = recipe.reduce((sm, r) => sm + Number(r.amount || 0) * (avgCost.get(r.productId) || 0), 0);
                  if (cost <= 0) return null;
                  const price = Number(form.price) || 0;
                  const markup = price - cost;
                  return (
                    <div className="mt-1 pt-2 border-t border-border text-xs flex flex-wrap gap-x-3 gap-y-1">
                      <span>
                        Taom tannarxi: <span className="font-bold">{formatSum(Math.round(cost))}</span>
                      </span>
                      {price > 0 && (
                        <span className={markup >= 0 ? 'text-success' : 'text-danger'}>
                          Ustama: <span className="font-bold">{formatSum(Math.round(markup))}</span>
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 mb-4 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.exciseRequired}
              onChange={(e) => setForm({ ...form, exciseRequired: e.target.checked })}
              className="w-4 h-4 accent-primary"
            />
            Aksizli mahsulot (kassada kod skanerlanadi)
          </label>
          {formError && (
            <div role="alert" className="mb-3 bg-danger/10 border border-danger/50 text-danger rounded-xl px-3 py-2.5 text-sm font-semibold">
              {formError}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1 h-12" onClick={() => setForm(null)} disabled={saving}>
              Bekor
            </Button>
            <Button className="flex-1 h-12" onClick={save} disabled={saving} data-testid="menu-item-save">
              {saving ? 'Saqlanmoqda…' : form.id ? 'Saqlash' : 'Qo‘shish'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Bitta taom qatori — memo: qidiruv/filtr yoki boshqa qatordagi o'zgarish uni qayta chizmaydi
const MenuRow = memo(function MenuRow({
  item: it,
  categoryName,
  uploading,
  onPhoto,
  onDropPhoto,
  onToggleAvailable,
  onToggleFavorite,
  onEdit,
  onDelete,
}: {
  item: MenuItem;
  categoryName: string;
  uploading: boolean;
  onPhoto: (it: MenuItem) => void;
  onDropPhoto: (it: MenuItem, file: File | null) => void;
  onToggleAvailable: (it: MenuItem) => void;
  onToggleFavorite: (it: MenuItem) => void;
  onEdit: (it: MenuItem) => void;
  onDelete: (it: MenuItem) => void;
}) {
  const [drag, setDrag] = useState(false);
  const src = itemImage(it);
  return (
    // Telefonda tugmalar ikkinchi qatorga tushadi (nom kesilib qolmaydi)
    <div className="flex flex-wrap items-center justify-between px-3 sm:px-4 py-2.5 gap-x-3 gap-y-2">
      <div className="flex items-center gap-3 min-w-0 flex-1 basis-[220px]">
        {/* Rasm: bosilsa — tez yuklash; ustiga fayl sudrab tashlash ham mumkin */}
        <button
          type="button"
          onClick={() => onPhoto(it)}
          disabled={uploading}
          title={src ? 'Rasmni almashtirish' : 'Rasm yuklash'}
          aria-label={`${it.name} — ${src ? 'rasmni almashtirish' : 'rasm yuklash'}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (!drag) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDrag(false);
            onDropPhoto(it, firstFile(e.dataTransfer.files));
          }}
          className={`relative shrink-0 rounded-xl ${drag ? 'ring-2 ring-primary' : ''}`}
        >
          <DishThumb name={it.name} src={src} />
          {uploading && (
            <span className="absolute inset-0 rounded-xl bg-bg/75 flex items-center justify-center">
              <span className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </span>
          )}
        </button>
        <div className="min-w-0">
          <div className="font-semibold truncate text-text">
            {it.name}
            {it.unit === MenuUnit.Weight && (
              <span className="ml-2 text-xs font-bold text-warning bg-warning/15 rounded px-1.5 py-0.5">kg</span>
            )}
            {it.exciseRequired && <span className="ml-2 text-xs text-warning">aksizli</span>}
          </div>
          <div className="text-sm text-muted truncate">
            {formatSum(Number(it.price))}
            {it.unit === MenuUnit.Weight ? '/kg' : ''} · {categoryName}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
        <button
          type="button"
          onClick={() => onPhoto(it)}
          disabled={uploading}
          data-testid={`menu-photo-quick-${it.id}`}
          title={src ? 'Rasmni almashtirish' : 'Rasm yuklash'}
          aria-label="Rasm yuklash"
          className={`w-11 h-11 rounded-lg border flex items-center justify-center disabled:opacity-50 ${
            src ? 'bg-bg border-border text-muted hover:text-text hover:border-primary' : 'bg-primary/10 border-primary/40 text-primary hover:bg-primary/20'
          }`}
        >
          <CameraIcon className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => onToggleAvailable(it)}
          className={`h-11 px-3 rounded-lg text-sm font-semibold ${it.available ? 'bg-success/20 text-success' : 'bg-muted/20 text-muted'}`}
        >
          {it.available ? 'Mavjud' : 'Yo‘q'}
        </button>
        <button
          type="button"
          onClick={() => onToggleFavorite(it)}
          title={it.favorite ? 'Sevimlidan olib tashlash' : 'Sevimlilarga qo‘shish'}
          className={`flex w-11 h-11 rounded-lg text-base border items-center justify-center ${
            it.favorite ? 'bg-warning/15 border-warning/40 text-warning' : 'bg-bg border-border hover:border-warning'
          }`}
        >
          {it.favorite ? '⭐' : '☆'}
        </button>
        <button
          type="button"
          onClick={() => onEdit(it)}
          aria-label="Tahrirlash"
          className="w-11 h-11 rounded-lg bg-bg border border-border hover:border-primary flex items-center justify-center text-text"
        >
          <PencilIcon className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(it)}
          aria-label="O‘chirish"
          className="w-11 h-11 rounded-lg bg-bg border border-border hover:border-danger hover:text-danger flex items-center justify-center text-muted"
        >
          <TrashIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
});
