import { useEffect, useState } from 'react';
import { User, UserRole } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';

const ROLE_OPTIONS = [
  { value: UserRole.Waiter, label: 'Ofitsiant' },
  { value: UserRole.Cook, label: 'Oshpaz' },
  { value: UserRole.Cashier, label: 'Kassir' },
  { value: UserRole.Admin, label: 'Administrator' },
  { value: UserRole.Director, label: 'Direktor' },
];
const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label])) as Record<string, string>;

// Xodimlarni to'liq boshqarish (TZ F-4.3): qo'shish, tahrirlash, o'chirish, faollik
export function StaffTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [role, setRole] = useState<string>(UserRole.Waiter);
  const [password, setPassword] = useState('');
  const [edit, setEdit] = useState<(User & { password?: string }) | null>(null);

  async function load() {
    setUsers(await api.get<User[]>('/users'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !login || password.length < 3) return;
    await api.post('/users', { name, login, role, password });
    setName(''); setLogin(''); setPassword('');
    await load();
  }

  async function toggleActive(u: User) {
    await api.patch(`/users/${u.id}`, { active: !u.active });
    await load();
  }

  async function remove(id: string) {
    if (!confirm('Xodim o‘chirilsinmi?')) return;
    await api.del(`/users/${id}`);
    await load();
  }

  async function saveEdit() {
    if (!edit) return;
    const patch: Record<string, unknown> = { name: edit.name, role: edit.role, active: edit.active };
    if (edit.password && edit.password.length >= 3) patch.password = edit.password;
    await api.patch(`/users/${edit.id}`, patch);
    setEdit(null);
    await load();
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      <form onSubmit={addUser} className="bg-surface border border-border rounded-2xl p-4 h-fit">
        <div className="font-bold mb-3">Yangi xodim</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="To'liq ism"
          className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
        <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Login"
          className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
        <Select className="mb-2" value={role} onChange={setRole} options={ROLE_OPTIONS} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Parol (kamida 3 belgi)"
          className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
        <Button type="submit" className="w-full">Qo‘shish</Button>
      </form>

      <div className="col-span-2 bg-surface border border-border rounded-2xl divide-y divide-border">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between px-4 py-3 gap-3">
            <div className="min-w-0">
              <div className="font-semibold truncate">{u.name}</div>
              <div className="text-sm text-muted">{u.login} · {ROLE_LABEL[u.role] ?? u.role}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => toggleActive(u)}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold ${u.active ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'}`}>
                {u.active ? 'Faol' : 'Bloklangan'}
              </button>
              <button onClick={() => setEdit({ ...u })} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
              <button onClick={() => remove(u.id)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger">🗑️</button>
            </div>
          </div>
        ))}
      </div>

      {edit && (
        <Modal title="Xodimni tahrirlash" onClose={() => setEdit(null)}>
          <label className="block text-sm text-muted mb-1">Ism</label>
          <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="block text-sm text-muted mb-1">Rol</label>
          <Select className="mb-3" value={edit.role} onChange={(v) => setEdit({ ...edit, role: v as UserRole })} options={ROLE_OPTIONS} />
          <label className="block text-sm text-muted mb-1">Yangi parol (ixtiyoriy)</label>
          <input type="password" value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} placeholder="O'zgartirmaslik uchun bo'sh qoldiring"
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="flex items-center gap-2 mb-4 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} className="w-4 h-4 accent-[#059669]" />
            Faol
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setEdit(null)}>Bekor</Button>
            <Button className="flex-1" onClick={saveEdit}>Saqlash</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
