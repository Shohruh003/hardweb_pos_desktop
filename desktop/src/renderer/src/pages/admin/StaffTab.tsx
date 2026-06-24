import { useEffect, useState } from 'react';
import { User, UserRole } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: UserRole.Waiter, label: 'Ofitsiant' },
  { value: UserRole.Cook, label: 'Oshpaz' },
  { value: UserRole.Cashier, label: 'Kassir' },
  { value: UserRole.Admin, label: 'Administrator' },
  { value: UserRole.Director, label: 'Direktor' },
];

const ROLE_LABEL = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label]),
) as Record<string, string>;

// Xodimlarni boshqarish (TZ F-4.3): qo'shish, rol, faollikni almashtirish
export function StaffTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.Waiter);
  const [password, setPassword] = useState('');

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
    setName('');
    setLogin('');
    setPassword('');
    await load();
  }

  async function toggleActive(u: User) {
    await api.patch(`/users/${u.id}`, { active: !u.active });
    await load();
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      <form
        onSubmit={addUser}
        className="bg-surface border border-border rounded-xl p-4 h-fit"
      >
        <div className="font-bold mb-3">Yangi xodim</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="To'liq ism"
          className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder="Login"
          className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Parol (kamida 3 belgi)"
          className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <Button type="submit" className="w-full">
          Qo‘shish
        </Button>
      </form>

      <div className="col-span-2 bg-surface border border-border rounded-xl divide-y divide-border">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="font-semibold">{u.name}</div>
              <div className="text-sm text-muted">
                {u.login} · {ROLE_LABEL[u.role] ?? u.role}
              </div>
            </div>
            <button
              onClick={() => toggleActive(u)}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold ${
                u.active
                  ? 'bg-success/20 text-success'
                  : 'bg-danger/20 text-danger'
              }`}
            >
              {u.active ? 'Faol' : 'Bloklangan'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
