import { useEffect, useState } from 'react';
import { CAPABILITIES, User, UserRole, isFullAccessRole } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';
import { useAuth } from '../../state/auth';

const ROLE_LABEL: Record<string, string> = {
  [UserRole.Waiter]: 'Ofitsiant',
  [UserRole.Cook]: 'Oshpaz',
  [UserRole.Cashier]: 'Kassir',
  [UserRole.Admin]: 'Administrator',
  [UserRole.Director]: 'Direktor',
  [UserRole.SuperAdmin]: 'Super Admin',
};

interface StaffForm {
  id?: string;
  name: string;
  role: string;
  pin: string;
  active: boolean;
  permissions: string[];
}

function randomPin(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += Math.floor(Math.random() * 10);
  return s;
}

// Xodimlarni boshqarish — rol + aniq ruxsatlar (capabilities) beriladi.
// Direktor admin ham yarata oladi; admin faqat oddiy xodimlarni yaratadi.
export function StaffTab() {
  const confirm = useConfirm();
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState<StaffForm | null>(null);

  const currentIsDirector = isFullAccessRole(user?.role ?? '');
  // Kim qaysi rolni bera oladi: direktor — hammasini, admin — faqat oddiy xodimlar
  const assignableRoles = currentIsDirector
    ? [UserRole.Waiter, UserRole.Cook, UserRole.Cashier, UserRole.Admin, UserRole.Director]
    : [UserRole.Waiter, UserRole.Cook, UserRole.Cashier];

  async function load() {
    setUsers(await api.get<User[]>('/users'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  function openAdd() {
    setForm({ name: '', role: UserRole.Waiter, pin: randomPin(), active: true, permissions: [] });
  }
  function openEdit(u: User) {
    setForm({ id: u.id, name: u.name, role: u.role, pin: u.pin ?? '', active: u.active, permissions: u.permissions ?? [] });
  }

  function toggleCap(key: string) {
    if (!form) return;
    const has = form.permissions.includes(key);
    setForm({
      ...form,
      permissions: has ? form.permissions.filter((k) => k !== key) : [...form.permissions, key],
    });
  }

  // Shu PIN boshqa xodimга berilganmi? (o'zidan tashqari)
  const pinOwner =
    form && form.pin.length === 4
      ? users.find((u) => u.pin === form.pin && u.id !== form.id)
      : null;

  async function save() {
    if (!form || !form.name) return;
    if (pinOwner) return; // takroriy PIN — saqlashga yo'l qo'ymaymiz
    const permissions = isFullAccessRole(form.role) ? [] : form.permissions;
    try {
      if (form.id) {
        const patch: Record<string, unknown> = { name: form.name, role: form.role, active: form.active, permissions };
        if (form.pin && form.pin.length === 4) patch.pin = form.pin;
        await api.patch(`/users/${form.id}`, patch);
      } else {
        if (form.pin.length !== 4) return;
        await api.post('/users', { name: form.name, role: form.role, pin: form.pin, permissions });
      }
      setForm(null);
      await load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function toggleActive(u: User) {
    await api.patch(`/users/${u.id}`, { active: !u.active });
    await load();
  }
  async function remove(u: User) {
    if (!(await confirm({ title: 'Xodimni o‘chirish', message: `"${u.name}" o‘chirilsinmi?`, danger: true }))) return;
    await api.del(`/users/${u.id}`);
    await load();
  }

  const opsCaps = CAPABILITIES.filter((c) => c.group === 'ops');
  const manageCaps = CAPABILITIES.filter((c) => c.group === 'manage');
  const fullAccess = form ? isFullAccessRole(form.role) : false;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="text-muted">{users.length} ta xodim</div>
        <Button onClick={openAdd}>+ Yangi xodim</Button>
      </div>

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {users.length === 0 ? (
          <div className="p-6 text-muted text-center">Xodim yo‘q. “+ Yangi xodim” bilan qo‘shing.</div>
        ) : (
          users.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 shrink-0 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center">
                  {u.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{u.name}</div>
                  <div className="text-sm text-muted">
                    PIN: <span className="font-mono font-semibold text-text">{u.pin ?? '—'}</span> · {ROLE_LABEL[u.role] ?? u.role}
                    {!isFullAccessRole(u.role) && (u.permissions?.length ? ` · ${u.permissions.length} ruxsat` : ' · ruxsat yo‘q')}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => toggleActive(u)}
                  className={`px-3 py-1.5 rounded-md text-sm font-semibold ${u.active ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'}`}>
                  {u.active ? 'Faol' : 'Bloklangan'}
                </button>
                <button onClick={() => openEdit(u)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
                <button onClick={() => remove(u)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger">🗑️</button>
              </div>
            </div>
          ))
        )}
      </div>

      {form && (
        <Modal title={form.id ? 'Xodimni tahrirlash' : 'Yangi xodim'} onClose={() => setForm(null)}>
          <label className="block text-sm text-muted mb-1">To‘liq ism</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-sm text-muted mb-1">Rol</label>
              <Select value={form.role} onChange={(v) => setForm({ ...form, role: v })}
                options={assignableRoles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">PIN (4 xonali)</label>
              <div className="flex gap-1">
                <input value={form.pin} inputMode="numeric" maxLength={4}
                  onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  placeholder="1234"
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary font-mono text-lg tracking-widest" />
                <Button variant="ghost" onClick={() => setForm({ ...form, pin: randomPin() })}>🎲</Button>
              </div>
            </div>
          </div>
          {pinOwner ? (
            <div className="text-sm text-danger font-semibold mb-3 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
              ⚠️ Bunday PIN allaqachon mavjud — <b>{pinOwner.name}</b> ({ROLE_LABEL[pinOwner.role] ?? pinOwner.role})ga berilgan. Boshqa PIN tanlang.
            </div>
          ) : (
            <div className="text-xs text-muted mb-3">Bu PIN'ni xodimga ayting — u shu bilan tizimga kiradi.</div>
          )}

          {/* Ruxsatlar (capabilities) */}
          {fullAccess ? (
            <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 text-sm mb-3">
              ✅ Direktor/Super Admin — <b>barcha ruxsatlarga</b> ega (avtomatik).
            </div>
          ) : (
            <div className="mb-3">
              <div className="text-sm font-semibold mb-2">Ruxsatlar — nima qila oladi?</div>
              <div className="text-xs text-muted mb-1">Operatsion</div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                {opsCaps.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer select-none bg-bg border border-border rounded-lg px-2.5 py-2">
                    <input type="checkbox" checked={form.permissions.includes(c.key)} onChange={() => toggleCap(c.key)} className="w-4 h-4 accent-[#059669]" />
                    <span>{c.icon} {c.label}</span>
                  </label>
                ))}
              </div>
              <div className="text-xs text-muted mb-1">Boshqaruv</div>
              <div className="grid grid-cols-2 gap-2">
                {manageCaps.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer select-none bg-bg border border-border rounded-lg px-2.5 py-2">
                    <input type="checkbox" checked={form.permissions.includes(c.key)} onChange={() => toggleCap(c.key)} className="w-4 h-4 accent-[#059669]" />
                    <span>{c.icon} {c.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {form.id && (
            <label className="flex items-center gap-2 mb-4 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 accent-[#059669]" />
              Faol
            </label>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setForm(null)}>Bekor</Button>
            <Button className="flex-1" disabled={!!pinOwner} onClick={save}>{form.id ? 'Saqlash' : 'Qo‘shish'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
