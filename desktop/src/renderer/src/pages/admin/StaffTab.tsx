import { useEffect, useState } from 'react';
import { User, UserRole } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

const ROLE_OPTIONS = [
  { value: UserRole.Waiter, label: 'Ofitsiant' },
  { value: UserRole.Cook, label: 'Oshpaz' },
  { value: UserRole.Cashier, label: 'Kassir' },
  { value: UserRole.Admin, label: 'Administrator' },
  { value: UserRole.Director, label: 'Direktor' },
];
const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label])) as Record<string, string>;

interface StaffForm {
  id?: string;
  name: string;
  login: string;
  role: string;
  password: string;
  active: boolean;
}

// Xodimlarni boshqarish (TZ F-4.3): "+ Yangi xodim" modal orqali, to'liq CRUD
export function StaffTab() {
  const confirm = useConfirm();
  const [users, setUsers] = useState<User[]>([]);
  const [roleDefs, setRoleDefs] = useState<{ value: string; label: string }[]>(ROLE_OPTIONS);
  const [form, setForm] = useState<StaffForm | null>(null);

  async function load() {
    setUsers(await api.get<User[]>('/users'));
    try {
      const roles = await api.get<{ key: string; label: string }[]>('/roles');
      if (roles?.length) setRoleDefs(roles.map((r) => ({ value: r.key, label: r.label })));
    } catch {
      /* real server'da /roles bo'lmasligi mumkin */
    }
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  const roleLabel = (key: string) => roleDefs.find((r) => r.value === key)?.label ?? ROLE_LABEL[key] ?? key;

  function openAdd() {
    setForm({ name: '', login: '', role: UserRole.Waiter, password: '', active: true });
  }
  function openEdit(u: User) {
    setForm({ id: u.id, name: u.name, login: u.login, role: u.role, password: '', active: u.active });
  }

  async function save() {
    if (!form || !form.name) return;
    if (form.id) {
      const patch: Record<string, unknown> = { name: form.name, role: form.role, active: form.active };
      if (form.password && form.password.length >= 3) patch.password = form.password;
      await api.patch(`/users/${form.id}`, patch);
    } else {
      if (!form.login || form.password.length < 3) return;
      await api.post('/users', { name: form.name, login: form.login, role: form.role, password: form.password });
    }
    setForm(null);
    await load();
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
                  <div className="text-sm text-muted">{u.login} · {roleLabel(u.role)}</div>
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
          <label className="block text-sm text-muted mb-1">Login</label>
          <input value={form.login} disabled={!!form.id} onChange={(e) => setForm({ ...form, login: e.target.value })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary disabled:opacity-60" />
          <label className="block text-sm text-muted mb-1">Rol</label>
          <Select className="mb-3" value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={roleDefs} />
          <label className="block text-sm text-muted mb-1">{form.id ? 'Yangi parol (ixtiyoriy)' : 'Parol (kamida 3 belgi)'}</label>
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={form.id ? "O'zgartirmaslik uchun bo'sh qoldiring" : '••••'}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          {form.id && (
            <label className="flex items-center gap-2 mb-4 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="w-4 h-4 accent-[#059669]" />
              Faol
            </label>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setForm(null)}>Bekor</Button>
            <Button className="flex-1" onClick={save}>{form.id ? 'Saqlash' : 'Qo‘shish'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
