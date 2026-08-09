import { useEffect, useState } from 'react';
import { Product, ProductUnit, Purchase } from '@hardweb-pos/shared';
import { Button, formatSum } from '../../components/ui';
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

// Sklad (ombor) — mahsulotlar, kirim (ta'minot) va qoldiq.
// Taom sotilganda retsept bo'yicha avtomatik ayiriladi; ortiqcha sotib bo'lmaydi.
export function SkladTab() {
  const confirm = useConfirm();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<ProductForm | null>(null);
  // Kirim (ta'minotchidan qabul qilish) modali
  const [purchaseFor, setPurchaseFor] = useState<Product | null>(null);
  const [supplier, setSupplier] = useState('');
  const [purQty, setPurQty] = useState('');
  const [purPrice, setPurPrice] = useState('');
  const [purNote, setPurNote] = useState('');
  // Chiqim (hisobdan chiqarish) modali
  const [writeOff, setWriteOff] = useState<Product | null>(null);
  const [woQty, setWoQty] = useState('');
  // Kirimlar tarixi
  const [showPurchases, setShowPurchases] = useState(false);
  const [purchases, setPurchases] = useState<Purchase[]>([]);

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

  // --- Kirim (ta'minot) ---
  function openPurchase(p: Product) {
    setPurchaseFor(p);
    setSupplier('');
    setPurQty('');
    setPurPrice('');
    setPurNote('');
  }
  const purTotal = (Number(purQty) || 0) * (Number(purPrice) || 0);
  async function savePurchase() {
    if (!purchaseFor) return;
    if (!(Number(purQty) > 0)) return;
    await api.post('/inventory/purchases', {
      productId: purchaseFor.id,
      supplier: supplier.trim(),
      quantity: Number(purQty),
      unitPrice: Number(purPrice) || 0,
      note: purNote.trim() || undefined,
    });
    setPurchaseFor(null);
    await load();
  }

  // --- Chiqim (hisobdan chiqarish) ---
  async function saveWriteOff() {
    if (!writeOff) return;
    const qty = Number(woQty);
    if (!(qty > 0)) return;
    await api.post(`/inventory/products/${writeOff.id}/adjust`, { delta: -qty });
    setWriteOff(null);
    setWoQty('');
    await load();
  }

  async function openPurchaseHistory() {
    setShowPurchases(true);
    try {
      setPurchases(await api.get<Purchase[]>('/inventory/purchases'));
    } catch {
      setPurchases([]);
    }
  }

  const s = search.trim().toLowerCase();
  const filtered = products.filter((p) => !s || p.name.toLowerCase().includes(s));
  const lowCount = products.filter((p) => p.stock <= p.minStock).length;

  // --- Kirimlar tarixi sahifasi ---
  if (showPurchases) {
    return (
      <div className="w-full">
        <div className="flex items-center justify-between mb-4 gap-2">
          <div className="text-lg font-bold">🧾 Kirimlar tarixi (ta'minot)</div>
          <button
            onClick={() => setShowPurchases(false)}
            className="flex items-center gap-1.5 px-3 h-9 rounded-lg border border-border hover:border-primary hover:bg-surface-hover font-semibold"
          >
            <span className="text-lg leading-none">←</span> Orqaga
          </button>
        </div>
        <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
          {purchases.length === 0 ? (
            <div className="p-6 text-muted text-center">Hali kirim qilinmagan.</div>
          ) : (
            purchases.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">
                    {p.productName} — <span className="text-primary">{num(p.quantity)} {p.unit}</span>
                  </div>
                  <div className="text-sm text-muted truncate">
                    {p.supplier ? `Ta'minotchi: ${p.supplier} · ` : ''}
                    {new Date(p.createdAt).toLocaleString('uz-UZ')}
                    {p.note ? ` · ${p.note}` : ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold">{formatSum(p.total)}</div>
                  <div className="text-xs text-muted">{formatSum(p.unitPrice)}/{p.unit}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Tepa panel: qidiruv (o'rtada) + kirimlar tarixi + qo'shish */}
      <div className="flex items-center gap-3 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 Mahsulot qidirish..."
          className="flex-1 px-4 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <Button variant="ghost" onClick={openPurchaseHistory} className="shrink-0">🧾 Kirimlar tarixi</Button>
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
                <div className="flex items-center gap-2 shrink-0">
                  <div className={`text-right mr-1 ${low ? 'text-danger' : ''}`}>
                    <div className="text-lg font-extrabold leading-none">{num(p.stock)}</div>
                    <div className="text-xs text-muted">{p.unit}</div>
                  </div>
                  <button
                    onClick={() => openPurchase(p)}
                    title="Kirim (ta'minotdan qabul qilish)"
                    className="px-2.5 h-9 rounded-lg bg-success/15 text-success font-semibold hover:bg-success/25 text-sm"
                  >
                    ＋ Kirim
                  </button>
                  <button
                    onClick={() => { setWriteOff(p); setWoQty(''); }}
                    title="Chiqim (hisobdan chiqarish)"
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

      {/* Kirim (ta'minot) modali — kimdan/qayerdan, qancha, narxi */}
      {purchaseFor && (
        <Modal title={`Kirim — ${purchaseFor.name}`} onClose={() => setPurchaseFor(null)}>
          <div className="text-sm text-muted mb-3">
            Hozirgi qoldiq: <span className="font-semibold text-text">{num(purchaseFor.stock)} {purchaseFor.unit}</span>
          </div>
          <label className="block text-sm text-muted mb-1">Ta'minotchi (kim / qayerdan)</label>
          <input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="Masalan: Bahtiyor aka / Optom bozor"
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted mb-1">Miqdor ({purchaseFor.unit})</label>
              <input
                autoFocus
                inputMode="decimal"
                value={purQty}
                onChange={(e) => setPurQty(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="Masalan: 20"
                className="w-full px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary text-lg font-bold"
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Birlik narxi (so‘m)</label>
              <input
                inputMode="numeric"
                value={purPrice}
                onChange={(e) => setPurPrice(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Masalan: 8000"
                className="w-full px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary text-lg font-bold"
              />
            </div>
          </div>
          <input
            value={purNote}
            onChange={(e) => setPurNote(e.target.value)}
            placeholder="Izoh (ixtiyoriy)"
            className="w-full mt-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary text-sm"
          />
          <div className="mt-3 flex justify-between text-sm">
            <span className="text-muted">Umumiy summa</span>
            <span className="font-bold text-primary">{formatSum(purTotal)}</span>
          </div>
          {Number(purQty) > 0 && (
            <div className="text-sm mt-1">
              Yangi qoldiq:{' '}
              <span className="font-bold text-success">
                {num(purchaseFor.stock + Number(purQty))} {purchaseFor.unit}
              </span>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <Button variant="ghost" className="flex-1" onClick={() => setPurchaseFor(null)}>Bekor</Button>
            <Button className="flex-1" disabled={!(Number(purQty) > 0)} onClick={savePurchase}>Kirim qilish</Button>
          </div>
        </Modal>
      )}

      {/* Chiqim (hisobdan chiqarish) modali */}
      {writeOff && (
        <Modal title={`Chiqim — ${writeOff.name}`} onClose={() => setWriteOff(null)}>
          <div className="text-sm text-muted mb-3">
            Hozirgi qoldiq: <span className="font-semibold text-text">{num(writeOff.stock)} {writeOff.unit}</span>
          </div>
          <label className="block text-sm text-muted mb-1">Chiqim miqdori ({writeOff.unit})</label>
          <input
            autoFocus
            inputMode="decimal"
            value={woQty}
            onChange={(e) => setWoQty(e.target.value.replace(/[^0-9.]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && saveWriteOff()}
            placeholder="Masalan: 2"
            className="w-full mb-1 px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary text-lg font-bold"
          />
          {Number(woQty) > 0 && (
            <div className="text-sm mb-2">
              Yangi qoldiq:{' '}
              <span className="font-bold text-danger">
                {num(writeOff.stock - Number(woQty))} {writeOff.unit}
              </span>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <Button variant="ghost" className="flex-1" onClick={() => setWriteOff(null)}>Bekor</Button>
            <Button className="flex-1" onClick={saveWriteOff}>Chiqim qilish</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
