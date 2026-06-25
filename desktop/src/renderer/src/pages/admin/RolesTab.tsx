import { useEffect, useState } from 'react';
import { Button } from '../../components/ui';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';
import { useConfirm } from '../../state/confirm';

interface Role {
  key: string;
  label: string;
  description: string;
  panel: string;
  builtin: boolean;
}
interface RoleForm {
  key?: string;
  label: string;
  description: string;
  panel: string;
  builtin?: boolean;
}

const PANELS = [
  { value: 'ofitsiant', label: 'Ofitsiant paneli' },
  { value: 'oshpaz', label: 'Oshxona (KDS)' },
  { value: 'kassir', label: 'Kassa' },
  { value: 'administrator', label: 'Administrator' },
  { value: 'direktor', label: 'Direktor' },
];
const PANEL_LABEL = Object.fromEntries(PANELS.map((p) => [p.value, p.label]));

// Rollarni boshqarish (CRUD): "+ Yangi rol" modal orqali. Har rol qaysi panelga kiradi.
export function RolesTab() {
  const confirm = useConfirm();
  const [roles, setRoles] = useState<Role[]>([]);
  const [form, setForm] = useState<RoleForm | null>(null);

  async function load() {
    setRoles(await api.get<Role[]>('/roles'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  function openAdd() {
    setForm({ label: '', description: '', panel: 'ofitsiant' });
  }
  function openEdit(r: Role) {
    setForm({ key: r.key, label: r.label, description: r.description, panel: r.panel, builtin: r.builtin });
  }

  async function save() {
    if (!form || !form.label.trim()) return;
    if (form.key) await api.patch(`/roles/${form.key}`, { label: form.label, description: form.description, panel: form.panel });
    else await api.post('/roles', { label: form.label.trim(), description: form.description.trim(), panel: form.panel });
    setForm(null);
    await load();
  }

  async function remove(r: Role) {
    if (!(await confirm({ title: 'Rolni o‘chirish', message: `"${r.label}" o‘chirilsinmi?`, danger: true }))) return;
    await api.del(`/roles/${r.key}`);
    await load();
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="text-muted">{roles.length} ta rol</div>
        <Button onClick={openAdd}>+ Yangi rol</Button>
      </div>

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {roles.map((r) => (
          <div key={r.key} className="flex items-center justify-between px-4 py-3 gap-3">
            <div className="min-w-0">
              <div className="font-semibold truncate flex items-center gap-2">
                {r.label}
                {r.builtin && <span className="text-xs bg-info/20 text-info px-2 py-0.5 rounded">tizim</span>}
              </div>
              <div className="text-sm text-muted">
                {r.description || '—'} · panel: {PANEL_LABEL[r.panel] ?? r.panel}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => openEdit(r)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
              {!r.builtin && (
                <button onClick={() => remove(r)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger">🗑️</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {form && (
        <Modal title={form.key ? 'Rolni tahrirlash' : 'Yangi rol'} onClose={() => setForm(null)}>
          <label className="block text-sm text-muted mb-1">Rol nomi</label>
          <input value={form.label} disabled={form.builtin} onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="masalan: Menejer"
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary disabled:opacity-60" />
          <label className="block text-sm text-muted mb-1">Tavsifi</label>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="block text-sm text-muted mb-1">Qaysi panelga kiradi</label>
          <div className={form.builtin ? 'opacity-60 pointer-events-none mb-4' : 'mb-4'}>
            <Select value={form.panel} onChange={(v) => setForm({ ...form, panel: v })} options={PANELS} />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setForm(null)}>Bekor</Button>
            <Button className="flex-1" onClick={save}>{form.key ? 'Saqlash' : 'Qo‘shish'}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
