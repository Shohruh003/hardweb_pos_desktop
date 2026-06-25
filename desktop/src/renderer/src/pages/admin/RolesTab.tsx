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

const PANELS = [
  { value: 'ofitsiant', label: 'Ofitsiant paneli' },
  { value: 'oshpaz', label: 'Oshxona (KDS)' },
  { value: 'kassir', label: 'Kassa' },
  { value: 'administrator', label: 'Administrator' },
  { value: 'direktor', label: 'Direktor' },
];
const PANEL_LABEL = Object.fromEntries(PANELS.map((p) => [p.value, p.label]));

// Rollarni boshqarish (CRUD). Har rol qaysi panelga kirishini belgilaydi.
export function RolesTab() {
  const confirm = useConfirm();
  const [roles, setRoles] = useState<Role[]>([]);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [panel, setPanel] = useState('ofitsiant');
  const [edit, setEdit] = useState<Role | null>(null);

  async function load() {
    setRoles(await api.get<Role[]>('/roles'));
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function addRole(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    await api.post('/roles', { label: label.trim(), description: description.trim(), panel });
    setLabel('');
    setDescription('');
    await load();
  }

  async function remove(r: Role) {
    if (!(await confirm({ title: 'Rolni o‘chirish', message: `"${r.label}" o‘chirilsinmi?`, danger: true }))) return;
    await api.del(`/roles/${r.key}`);
    await load();
  }

  async function saveEdit() {
    if (!edit) return;
    await api.patch(`/roles/${edit.key}`, { label: edit.label, description: edit.description, panel: edit.panel });
    setEdit(null);
    await load();
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      <form onSubmit={addRole} className="bg-surface border border-border rounded-2xl p-4 h-fit">
        <div className="font-bold mb-3">Yangi rol</div>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Rol nomi (masalan: Menejer)"
          className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tavsifi"
          className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
        <label className="block text-sm text-muted mb-1">Qaysi panelga kiradi</label>
        <Select className="mb-3" value={panel} onChange={setPanel} options={PANELS} />
        <Button type="submit" className="w-full">Qo‘shish</Button>
      </form>

      <div className="col-span-2 bg-surface border border-border rounded-2xl divide-y divide-border">
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
              <button onClick={() => setEdit({ ...r })} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary">✏️</button>
              {!r.builtin && (
                <button onClick={() => remove(r)} className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger">🗑️</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {edit && (
        <Modal title="Rolni tahrirlash" onClose={() => setEdit(null)}>
          <label className="block text-sm text-muted mb-1">Nomi</label>
          <input value={edit.label} disabled={edit.builtin} onChange={(e) => setEdit({ ...edit, label: e.target.value })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary disabled:opacity-60" />
          <label className="block text-sm text-muted mb-1">Tavsifi</label>
          <input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })}
            className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary" />
          <label className="block text-sm text-muted mb-1">Panel</label>
          <div className={edit.builtin ? 'opacity-60 pointer-events-none mb-4' : 'mb-4'}>
            <Select value={edit.panel} onChange={(v) => setEdit({ ...edit, panel: v })} options={PANELS} />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setEdit(null)}>Bekor</Button>
            <Button className="flex-1" onClick={saveEdit}>Saqlash</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
