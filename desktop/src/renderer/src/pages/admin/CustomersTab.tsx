import { useEffect, useState } from 'react';
import { Customer } from '@hardweb-pos/shared';
import { displayPhone, normalizePhone } from '../../components/cashier/orderType';
import { Button } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

interface Form {
  id?: string;
  name: string;
  phone: string;
  note: string;
}

const digits = (s: string) => s.replace(/\D/g, '');

// Mijozlar (CRM) — direktor 'customers' ruxsatini bergan xodim boshqaradi.
// Telefon "+998 90 123 45 67" ko'rinishida chiqadi va to'g'ri raqam bo'lsa yagona shaklda
// (+998901234567) saqlanadi — yetkazib berishda mijoz telefon orqali topiladi.
export function CustomersTab() {
  const confirm = useConfirm();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const list = await api.get<Customer[]>('/customers');
      setCustomers(Array.isArray(list) ? list : []);
      setError('');
    } catch (e) {
      setError((e as Error)?.message || 'Mijozlar yuklanmadi');
    }
  }
  useEffect(() => {
    load();
  }, []);

  function openAdd() {
    setFormError('');
    setForm({ name: '', phone: '', note: '' });
  }
  function openEdit(c: Customer) {
    setFormError('');
    setForm({ id: c.id, name: c.name, phone: c.phone ? displayPhone(c.phone) : '', note: c.note ?? '' });
  }
  async function save() {
    if (!form || saving) return;
    const name = form.name.trim();
    if (!name) {
      setFormError('Mijoz ismini kiriting');
      return;
    }
    const rawPhone = form.phone.trim();
    // To'g'ri O'zbekiston raqami — yagona shaklda; boshqa (xorijiy) raqam — yozilganicha
    const phone = rawPhone ? normalizePhone(rawPhone) ?? rawPhone : '';
    const body = { name, phone, note: form.note.trim() };
    setSaving(true);
    setFormError('');
    try {
      if (form.id) await api.patch(`/customers/${form.id}`, body);
      else await api.post('/customers', body);
      setForm(null);
      await load();
    } catch (e) {
      setFormError((e as Error)?.message || 'Saqlanmadi');
    } finally {
      setSaving(false);
    }
  }
  async function remove(c: Customer) {
    const ok = await confirm({ title: 'O‘chirish', message: `${c.name} — o‘chirilsinmi?`, danger: true });
    if (!ok) return;
    try {
      await api.del(`/customers/${c.id}`);
      await load();
    } catch (e) {
      setError((e as Error)?.message || 'O‘chirilmadi');
    }
  }

  const s = search.trim().toLowerCase();
  const sd = digits(s);
  const filtered = customers.filter(
    (c) => !s || c.name.toLowerCase().includes(s) || (sd.length > 0 && digits(c.phone ?? '').includes(sd)),
  );
  const phoneHint = form?.phone.trim() && !normalizePhone(form.phone) ? 'Raqam O‘zbekiston formatida emas — yozilganicha saqlanadi' : '';

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 Mijoz qidirish (ism yoki telefon)..."
          className="flex-1 min-w-[160px] h-11 px-4 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <Button onClick={openAdd} className="shrink-0 h-11">
          + Yangi mijoz
        </Button>
      </div>
      <div className="text-muted text-sm mb-4">{filtered.length} ta mijoz</div>

      {error && (
        <div role="alert" className="mb-3 flex items-start gap-2 bg-danger/10 border border-danger/50 text-danger rounded-xl px-3 py-2.5 text-sm font-semibold">
          <span className="flex-1">⚠️ {error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Yopish" className="font-bold">
            ✕
          </button>
        </div>
      )}

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-6 text-muted text-center">Mijoz yo‘q. "+ Yangi mijoz" bilan qo‘shing.</div>
        ) : (
          filtered.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate flex items-center gap-2 text-text">
                  <span className="w-8 h-8 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center shrink-0">
                    {c.name.charAt(0)}
                  </span>
                  {c.name}
                </div>
                <div className="text-sm text-muted truncate pl-10">
                  <span className="font-semibold text-text">{c.phone ? displayPhone(c.phone) : '—'}</span>
                  {c.note ? ` · ${c.note}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openEdit(c)}
                  aria-label="Tahrirlash"
                  className="w-11 h-11 rounded-lg bg-bg border border-border hover:border-primary"
                >
                  ✏️
                </button>
                <button
                  onClick={() => remove(c)}
                  aria-label="O‘chirish"
                  className="w-11 h-11 rounded-lg bg-bg border border-border hover:border-danger hover:text-danger"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {form && (
        <Modal title={form.id ? 'Mijozni tahrirlash' : 'Yangi mijoz'} onClose={() => !saving && setForm(null)}>
          <label className="block text-sm text-muted mb-1">Ismi</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Masalan: Aziz Karimov"
            autoFocus
            className="w-full mb-3 h-11 px-3 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />
          <label className="block text-sm text-muted mb-1">Telefon</label>
          <input
            value={form.phone}
            inputMode="tel"
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            onBlur={() => {
              // To'g'ri raqam — chiroyli ko'rinishga keltiramiz
              const n = normalizePhone(form.phone);
              if (n) setForm((f) => (f ? { ...f, phone: displayPhone(n) } : f));
            }}
            placeholder="+998 90 123 45 67"
            className="w-full mb-1 h-11 px-3 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />
          <div className="text-xs text-warning mb-3 min-h-[16px]">{phoneHint}</div>
          <label className="block text-sm text-muted mb-1">Izoh</label>
          <input
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="Ixtiyoriy (masalan: doimiy mijoz)"
            className="w-full mb-4 h-11 px-3 rounded-lg bg-bg border border-border outline-none focus:border-primary"
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
