import { useEffect, useState } from 'react';
import {
  CAPABILITIES,
  ROLE_FORBIDDEN_CAPABILITIES,
  User,
  UserRole,
  capabilitiesForRole,
  defaultCapabilitiesForRole,
  isFullAccessRole,
  roleAllowsCapability,
} from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { FeedbackModal, FeedbackVariant } from '../../components/FeedbackModal';
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

// Server bilan bir xil cheklovlar (server/src/users/dto.ts) — xato darhol shu yerda ko'rinadi,
// yakuniy tekshiruv baribir serverda
const LOGIN_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const PASSWORD_MIN = 4;
const PASSWORD_MAX = 64;
const NAME_MAX = 80;
/** Kirish ekranidagi PIN klaviaturasi 4 xonali — shuning uchun PIN ham 4 ta raqam */
const PIN_LENGTH = 4;

const CREDENTIALS_REQUIRED = 'Direktor uchun login va parol majburiy (PIN bilan kira olmaydi)';
const NO_CAPABILITIES = 'Kamida bitta ruxsat belgilang — aks holda xodim tizimga kirsa ham hech narsa qila olmaydi';

/** Lavozimga berilmaydigan ruxsatlar izohi (server ham saqlamaydi) — masalan ofitsiantga kassa/hisobot */
function forbiddenCapsHint(role: string): string | null {
  const keys = ROLE_FORBIDDEN_CAPABILITIES[role as UserRole] ?? [];
  if (!keys.length) return null;
  const names = CAPABILITIES.filter((c) => keys.includes(c.key)).map((c) => c.label.split(' (')[0].toLowerCase());
  return `${ROLE_LABEL[role] ?? role}ga ${names.join(', ')} berilmaydi — u faqat o‘z savdosini ko‘radi. Bunday ish kerak bo‘lsa, Kassir yoki Administrator rolini tanlang.`;
}

/** Ikki ruxsatlar ro'yxati bir xilmi (tartibsiz) */
function samePermissions(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((k) => b.includes(k));
}

interface StaffForm {
  id?: string;
  name: string;
  role: string;
  pin: string;
  active: boolean;
  permissions: string[];
  /**
   * Formadagi ruxsatlar qaysi rolning standart to'plami (direktor hali o'zgartirmagan) — rol
   * almashtirilganda yangi rolning standartlari qo'yiladi. null — ruxsatlar qo'lda tanlangan.
   */
  capsFromRole: string | null;
  login: string; // '' — login yo'q
  password: string; // tahrirlashda '' — o'zgarmaydi
  // Tahrirlashda asl qiymatlar — nima o'zgarganini aniqlash uchun
  origRole?: string;
  origLogin?: string;
  origPin?: string;
  hadPassword?: boolean;
  hadPin?: boolean;
}

interface Notice {
  variant: FeedbackVariant;
  title: string;
  subtitle?: string;
}

/** Bandlarga to'g'ri kelmaydigan tasodifiy 4 xonali PIN */
function randomPin(taken: Set<string>): string {
  let pin = '';
  for (let attempt = 0; attempt < 100; attempt++) {
    pin = '';
    for (let i = 0; i < PIN_LENGTH; i++) pin += Math.floor(Math.random() * 10);
    if (!taken.has(pin)) return pin;
  }
  return pin;
}

/** Kim qaysi rolni bera oladi: direktor — admin va direktorgacha; admin — faqat oddiy xodimlar */
function assignableRoles(actorRole: string | undefined): UserRole[] {
  const base = [UserRole.Waiter, UserRole.Cook, UserRole.Cashier];
  if (actorRole === UserRole.SuperAdmin) return [...base, UserRole.Admin, UserRole.Director, UserRole.SuperAdmin];
  if (actorRole === UserRole.Director) return [...base, UserRole.Admin, UserRole.Director];
  return base;
}

/** Ierarxiya (server qoidasi): Direktor/SuperAdmin'ni faqat Direktor/SuperAdmin, SuperAdmin'ni faqat SuperAdmin boshqaradi */
function canManage(actor: User | null, target: User): boolean {
  if (!actor) return false;
  if (target.role === UserRole.SuperAdmin && actor.role !== UserRole.SuperAdmin) return false;
  if (isFullAccessRole(target.role) && !isFullAccessRole(actor.role)) return false;
  return true;
}

// Xodimlarni boshqarish — rol + aniq ruxsatlar (capabilities) beriladi.
// Login va parolni faqat Direktor/SuperAdmin beradi (boshqa xodimga berilgan parol vaqtinchalik —
// xodim birinchi kirishda o'zinikiga almashtiradi). Administrator direktorlarga tegina olmaydi.
export function StaffTab() {
  const confirm = useConfirm();
  const { user: me, refreshUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<StaffForm | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const actorFull = isFullAccessRole(me?.role ?? '');
  const roles = assignableRoles(me?.role);

  async function load() {
    try {
      setUsers(await api.get<User[]>('/users'));
      setLoadError('');
    } catch (e) {
      setLoadError((e as Error)?.message || 'Xodimlar ro‘yxati yuklanmadi');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const takenPins = (exceptId?: string) =>
    new Set(users.filter((u) => u.id !== exceptId && u.pin).map((u) => String(u.pin)));

  /** Formani yangilash — har o'zgarishda eski xato xabari olib tashlanadi */
  function patchForm(patch: Partial<StaffForm>) {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setFormError('');
  }

  function openAdd() {
    setFormError('');
    setShowPassword(false);
    setForm({
      name: '',
      role: UserRole.Waiter,
      pin: randomPin(takenPins()),
      active: true,
      // Rol bo'yicha standart ruxsatlar oldindan belgilanadi (direktor o'zgartira oladi)
      permissions: defaultCapabilitiesForRole(UserRole.Waiter),
      capsFromRole: UserRole.Waiter,
      login: '',
      password: '',
    });
  }
  function openEdit(u: User) {
    setFormError('');
    setShowPassword(false);
    // Lavozimga taqiqlangan eski belgilar ko'rsatilmaydi (saqlanganda tozalanadi)
    const permissions = capabilitiesForRole(u.role, u.permissions ?? []);
    const roleDefaults = defaultCapabilitiesForRole(u.role);
    setForm({
      id: u.id,
      name: u.name,
      role: u.role,
      pin: u.pin ?? '',
      active: u.active,
      permissions,
      capsFromRole: roleDefaults.length > 0 && samePermissions(permissions, roleDefaults) ? u.role : null,
      login: u.login ?? '',
      password: '',
      origRole: u.role,
      origLogin: u.login ?? '',
      origPin: u.pin ?? '',
      hadPassword: !!u.hasPassword,
      hadPin: !!u.pin,
    });
  }

  function toggleCap(key: string) {
    if (!form) return;
    const has = form.permissions.includes(key);
    patchForm({
      permissions: has ? form.permissions.filter((k) => k !== key) : [...form.permissions, key],
      capsFromRole: null, // direktor ruxsatlarni o'zi tanladi — rol almashsa ham saqlanadi
    });
  }

  /** Rol bo'yicha standart ruxsatlarni qo'yish (masalan ruxsati yo'q eski xodim uchun) */
  function applyRoleDefaults() {
    if (!form) return;
    patchForm({ permissions: defaultCapabilitiesForRole(form.role), capsFromRole: form.role });
  }

  // Rol almashtirilganda: ruxsatlar hali standart (o'zgartirilmagan) yoki umuman yo'q bo'lsa —
  // yangi rolning standart ruxsatlari qo'yiladi; direktor qo'lda tanlagan ruxsatlar saqlanadi.
  // Direktor/SuperAdmin'da ruxsatlar ishlatilmaydi — ro'yxat o'zgarmaydi.
  function changeRole(role: string) {
    if (!form) return;
    const patch: Partial<StaffForm> = { role };
    if (!isFullAccessRole(role) && (form.capsFromRole !== null || form.permissions.length === 0)) {
      patch.permissions = defaultCapabilitiesForRole(role);
      patch.capsFromRole = role;
    } else if (!isFullAccessRole(role)) {
      // Qo'lda tanlangan ruxsatlar saqlanadi — yangi lavozimga taqiqlanganlari olib tashlanadi
      // (masalan kassir ofitsiantga aylansa — kassa, tushum, tarix, otkaz)
      const kept = capabilitiesForRole(role, form.permissions);
      if (kept.length !== form.permissions.length) {
        patch.permissions = kept.length ? kept : defaultCapabilitiesForRole(role);
        patch.capsFromRole = kept.length ? null : role;
      }
    }
    patchForm(patch);
  }

  const isSelf = !!form?.id && form.id === me?.id;
  const fullRole = form ? isFullAccessRole(form.role) : false;
  // Administrator o'z rolini va ruxsatlarini o'zgartira olmaydi (server ham rad etadi)
  const lockOwnRole = isSelf && !actorFull;
  const roleOptions = (() => {
    const list: string[] = [...roles];
    // Tahrirlanayotgan xodimning joriy roli ro'yxatda bo'lmasa ham ko'rinib tursin
    if (form?.origRole && !list.includes(form.origRole)) list.push(form.origRole);
    return list.map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r }));
  })();

  // Shu PIN boshqa xodimga berilganmi? (o'zidan tashqari)
  const pinOwner =
    form && !fullRole && form.pin.length === PIN_LENGTH
      ? users.find((u) => u.pin === form.pin && u.id !== form.id)
      : null;
  // Shu login band emasmi? (katta-kichik harf farqsiz, o'zidan tashqari)
  const loginTrim = form?.login.trim() ?? '';
  const loginOwner =
    form && actorFull && loginTrim
      ? users.find((u) => (u.login ?? '').toLowerCase() === loginTrim.toLowerCase() && u.id !== form.id)
      : null;

  /** Saqlashdan oldingi tekshiruv — birinchi xato matni yoki null */
  function validate(f: StaffForm): string | null {
    const name = f.name.trim();
    if (!name || name.length > NAME_MAX) return `Ism kiriting (1–${NAME_MAX} belgi)`;
    const full = isFullAccessRole(f.role);
    const login = f.login.trim();
    const pw = f.password;
    // Tahrirlashda o'zgarmagan PIN tekshirilmaydi (server 4–10 xonali eski PIN'larni ham qabul qiladi)
    const pinChanged = f.pin !== (f.origPin ?? '');
    if (!full && pinChanged && f.pin && f.pin.length !== PIN_LENGTH) return 'PIN 4 ta raqamdan iborat bo‘lishi kerak';
    if (pinOwner) return `Bu PIN band — ${pinOwner.name}ga berilgan. Boshqa PIN tanlang`;
    // Ruxsatsiz xodim kirsa ham hech narsa qila olmaydi (Direktor/SuperAdmin — hammasi avtomatik)
    if (!full && capabilitiesForRole(f.role, f.permissions).length === 0) return NO_CAPABILITIES;
    if (actorFull) {
      if (login && !LOGIN_PATTERN.test(login)) {
        return 'Login 3–32 belgi bo‘lishi kerak: lotin harflari, raqamlar, nuqta (.), _ yoki -';
      }
      if (loginOwner) return 'Bu login band';
      if (pw && (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX)) {
        return 'Parol 4–64 ta belgidan iborat bo‘lishi kerak';
      }
    }
    if (!f.id) {
      // Yangi xodim tizimga kira olishi shart
      if (full) {
        if (!login || !pw) return CREDENTIALS_REQUIRED;
      } else {
        if (login && !pw) return 'Login uchun parol ham kiriting';
        if (pw && !login) return 'Parol uchun login ham kiriting';
        if (!f.pin && !login) return 'PIN kiriting (4 ta raqam)';
      }
      return null;
    }
    if (!actorFull) return null;
    // Tahrirlash (direktor): login/parol izchilligi — server qoidalari bilan bir xil
    const roleChanged = f.role !== f.origRole;
    const loginChanged = login !== (f.origLogin ?? '');
    const passwordAfter = loginChanged && !login ? false : !!f.hadPassword || !!pw;
    if (pw && !login) return 'Parol uchun login ham kiriting';
    if (loginChanged && login && !passwordAfter) return 'Login uchun parol ham kiriting';
    if (full && (roleChanged || loginChanged) && (!login || !passwordAfter)) return CREDENTIALS_REQUIRED;
    if (!full && !login && !f.pin && !f.hadPin) {
      return 'Xodim tizimga kira olishi uchun PIN yoki login+parol kerak';
    }
    return null;
  }

  /** Serverga yuboriladigan ma'lumot (PATCH semantikasi: berilmagan maydon — o'zgarmaydi) */
  function buildPayload(f: StaffForm): Record<string, unknown> {
    const full = isFullAccessRole(f.role);
    const body: Record<string, unknown> = {
      name: f.name.trim(),
      role: f.role,
      permissions: full ? [] : capabilitiesForRole(f.role, f.permissions),
    };
    if (f.id) body.active = f.active;
    // Direktor PIN bilan kirmaydi — PIN yuborilmaydi; tahrirlashda bo'sh yoki o'zgarmagan PIN — yuborilmaydi
    if (!full && f.pin.length === PIN_LENGTH && f.pin !== (f.origPin ?? '')) body.pin = f.pin;
    // Login/parolni faqat Direktor/SuperAdmin yuboradi (aks holda server 403 qaytaradi)
    if (actorFull) {
      const login = f.login.trim();
      if (!f.id) {
        if (login) {
          body.login = login;
          body.password = f.password;
        }
      } else {
        // null — login (va u bilan birga parol) olib tashlanadi
        if (login !== (f.origLogin ?? '')) body.login = login || null;
        if (f.password) body.password = f.password;
      }
    }
    return body;
  }

  async function save() {
    if (!form || saving) return;
    const problem = validate(form);
    if (problem) {
      setFormError(problem);
      return;
    }
    const f = form;
    const body = buildPayload(f);
    setSaving(true);
    setFormError('');
    try {
      if (f.id) await api.patch(`/users/${f.id}`, body);
      else await api.post('/users', body);
      setForm(null);
      await load();
      const login = typeof body.login === 'string' ? body.login : f.origLogin || '';
      if (!f.id) {
        setNotice({
          variant: 'success',
          title: 'Xodim qo‘shildi',
          subtitle:
            typeof body.login === 'string'
              ? `Login: ${body.login} — birinchi kirishda parolni o‘zi almashtiradi${body.pin ? ` · PIN: ${body.pin}` : ''}`
              : `PIN: ${String(body.pin ?? '')} — shu PIN bilan tizimga kiradi`,
        });
      } else if (body.password && f.id !== me?.id) {
        setNotice({
          variant: 'success',
          title: 'Yangi parol o‘rnatildi',
          subtitle: `${f.name.trim()} (login: ${login}) keyingi kirishda parolni o‘zinikiga almashtiradi`,
        });
      }
      // O'zini tahrirlagan bo'lsa — yuqori paneldagi ism/ruxsatlar yangilansin
      if (f.id && f.id === me?.id) void refreshUser();
    } catch (e) {
      // 400/403/404 — server matni shu yerda ko'rinadi (forma ochiq qoladi, tuzatish mumkin)
      setFormError((e as Error)?.message || 'Saqlanmadi');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u: User) {
    if (busyId) return;
    if (u.active) {
      const ok = await confirm({
        title: 'Xodimni bloklash',
        message: `"${u.name}" bloklansinmi? U tizimdan darhol chiqariladi va qayta kira olmaydi.`,
        confirmText: 'Bloklash',
        danger: true,
      });
      if (!ok) return;
    }
    setBusyId(u.id);
    try {
      await api.patch(`/users/${u.id}`, { active: !u.active });
    } catch (e) {
      setNotice({
        variant: 'warning',
        title: u.active ? 'Bloklanmadi' : 'Faollashtirilmadi',
        subtitle: (e as Error)?.message || 'Xato',
      });
    } finally {
      setBusyId(null);
    }
    await load();
  }

  async function remove(u: User) {
    if (busyId) return;
    if (!(await confirm({ title: 'Xodimni o‘chirish', message: `"${u.name}" o‘chirilsinmi?`, danger: true }))) return;
    setBusyId(u.id);
    try {
      await api.del(`/users/${u.id}`);
    } catch (e) {
      setNotice({ variant: 'warning', title: 'O‘chirilmadi', subtitle: (e as Error)?.message || 'Xato' });
    } finally {
      setBusyId(null);
    }
    await load();
  }

  const opsCaps = CAPABILITIES.filter((c) => c.group === 'ops');
  const manageCaps = CAPABILITIES.filter((c) => c.group === 'manage');
  const saveBlocked = saving || !!pinOwner || !!loginOwner;
  // Lavozimga berilmaydigan ruxsatlar (ofitsiantga kassa/hisobot...) — belgilab bo'lmaydi
  const capsHint = form && !fullRole ? forbiddenCapsHint(form.role) : null;
  const renderCap = (c: (typeof CAPABILITIES)[number]) => {
    if (!form) return null;
    const allowed = roleAllowsCapability(form.role, c.key);
    const locked = lockOwnRole || !allowed;
    return (
      <label
        key={c.key}
        title={allowed ? undefined : capsHint ?? undefined}
        data-cap={c.key}
        className={`flex items-center gap-2 text-sm select-none bg-bg border border-border rounded-lg px-2.5 py-2 ${
          locked ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer'
        }`}
      >
        <input
          type="checkbox"
          checked={allowed && form.permissions.includes(c.key)}
          disabled={locked}
          onChange={() => toggleCap(c.key)}
          className="w-4 h-4 accent-[#059669]"
        />
        <span className={allowed ? undefined : 'text-muted'}>
          {allowed ? c.icon : '🔒'} {c.label}
        </span>
      </label>
    );
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="text-muted">{users.length} ta xodim</div>
        <Button onClick={openAdd}>+ Yangi xodim</Button>
      </div>

      {/* Kim qanday kiradi — qisqa tushuntirish */}
      <div className="mb-4 bg-primary/5 border border-primary/25 rounded-xl px-4 py-3 text-sm text-text leading-relaxed">
        🔑 <b>Kirish:</b> ofitsiant, oshpaz, kassir — <b>4 xonali PIN</b> bilan. <b>Direktor</b> — faqat{' '}
        <b>login va parol</b> bilan (PIN bilan kirmaydi); administratorga ham login+parol berish tavsiya etiladi.
        {actorFull
          ? ' Siz bergan parol vaqtinchalik — xodim birinchi kirishda uni o‘zinikiga almashtiradi.'
          : ' Login va parolni faqat direktor beradi.'}
      </div>

      {loadError && (
        <div className="mb-3 flex items-center gap-3 bg-danger/10 border border-danger/40 rounded-xl px-4 py-3 text-sm">
          <span className="flex-1 font-semibold text-danger">⚠️ {loadError}</span>
          <Button variant="ghost" className="py-1.5" onClick={() => void load()}>
            Qayta urinish
          </Button>
        </div>
      )}

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border">
        {users.length === 0 ? (
          <div className="p-6 text-muted text-center">Xodim yo‘q. “+ Yangi xodim” bilan qo‘shing.</div>
        ) : (
          users.map((u) => {
            const manageable = canManage(me, u);
            const self = u.id === me?.id;
            const full = isFullAccessRole(u.role);
            const busy = busyId === u.id;
            return (
              <div key={u.id} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 shrink-0 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center">
                    {u.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold truncate flex items-center gap-2">
                      <span className="truncate">{u.name}</span>
                      {self && (
                        <span className="shrink-0 text-[11px] font-bold rounded px-1.5 py-0.5 bg-primary/15 text-primary">
                          Siz
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span>{ROLE_LABEL[u.role] ?? u.role}</span>
                      {!full && (
                        <span>
                          · PIN: <span className="font-mono font-semibold text-text">{u.pin ?? '—'}</span>
                        </span>
                      )}
                      {u.login && (
                        <span>
                          · login: <span className="font-mono font-semibold text-text">{u.login}</span>
                        </span>
                      )}
                      {u.hasPassword && (
                        <span className="text-[11px] font-bold rounded px-1.5 py-0.5 bg-primary/15 text-primary">
                          🔑 parol
                        </span>
                      )}
                      {u.hasPassword && u.mustChangePassword && (
                        <span
                          className="text-[11px] font-bold rounded px-1.5 py-0.5 bg-warning/20 text-warning"
                          title="Xodim hali vaqtinchalik parolni o‘zinikiga almashtirmagan"
                        >
                          vaqtinchalik parol
                        </span>
                      )}
                      {!full &&
                        (u.permissions?.length ? (
                          <span>· {u.permissions.length} ruxsat</span>
                        ) : (
                          <span className="font-semibold text-warning" title="Xodim tizimga kirsa ham hech narsa qila olmaydi">
                            · ruxsat yo‘q
                          </span>
                        ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {manageable && !self ? (
                    <button
                      onClick={() => toggleActive(u)}
                      disabled={busy}
                      title={u.active ? 'Bloklash' : 'Faollashtirish'}
                      className={`px-3 py-1.5 rounded-md text-sm font-semibold disabled:opacity-50 ${
                        u.active ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'
                      }`}
                    >
                      {u.active ? 'Faol' : 'Bloklangan'}
                    </button>
                  ) : (
                    <span
                      title={self ? 'O‘zingizni bloklay olmaysiz' : 'Faqat direktor o‘zgartira oladi'}
                      className={`px-3 py-1.5 rounded-md text-sm font-semibold ${
                        u.active ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                      }`}
                    >
                      {u.active ? 'Faol' : 'Bloklangan'}
                    </span>
                  )}
                  {manageable ? (
                    <button
                      onClick={() => openEdit(u)}
                      aria-label="Tahrirlash"
                      className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-primary"
                    >
                      ✏️
                    </button>
                  ) : (
                    <span title="Faqat direktor o‘zgartira oladi" className="px-2 text-muted" aria-label="Yopiq">
                      🔒
                    </span>
                  )}
                  {manageable && !self && (
                    <button
                      onClick={() => remove(u)}
                      disabled={busy}
                      aria-label="O‘chirish"
                      className="px-3 py-1.5 rounded-md text-sm bg-bg border border-border hover:border-danger hover:text-danger disabled:opacity-50"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {form && (
        <Modal title={form.id ? 'Xodimni tahrirlash' : 'Yangi xodim'} onClose={() => !saving && setForm(null)}>
          <label className="block text-sm text-muted mb-1">To‘liq ism</label>
          <input
            value={form.name}
            onChange={(e) => patchForm({ name: e.target.value })}
            maxLength={NAME_MAX}
            className="w-full mb-3 px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          />

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-sm text-muted mb-1">Rol</label>
              {lockOwnRole ? (
                <div
                  title="O‘z rolingizni o‘zgartira olmaysiz"
                  className="px-3 py-2.5 rounded-lg bg-bg border border-border text-text font-semibold"
                >
                  🔒 {ROLE_LABEL[form.role] ?? form.role}
                </div>
              ) : (
                <Select value={form.role} onChange={changeRole} options={roleOptions} />
              )}
            </div>
            {!fullRole ? (
              <div>
                <label className="block text-sm text-muted mb-1">PIN (4 xonali)</label>
                <div className="flex gap-1">
                  <input
                    value={form.pin}
                    inputMode="numeric"
                    maxLength={PIN_LENGTH}
                    onChange={(e) => patchForm({ pin: e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH) })}
                    placeholder={form.id && form.hadPin ? 'o‘zgarmaydi' : '1234'}
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary font-mono text-lg tracking-widest"
                  />
                  <Button
                    variant="ghost"
                    title="Tasodifiy bo‘sh PIN"
                    onClick={() => patchForm({ pin: randomPin(takenPins(form.id)) })}
                  >
                    🎲
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-end">
                <div className="w-full text-xs text-muted bg-bg border border-border rounded-lg px-3 py-2 leading-snug">
                  Direktor PIN bilan kirmaydi — login va parol bilan kiradi
                </div>
              </div>
            )}
          </div>
          {lockOwnRole && (
            <div className="text-xs text-muted mb-3">O‘z rolingiz va ruxsatlaringizni faqat direktor o‘zgartiradi.</div>
          )}
          {!fullRole &&
            (pinOwner ? (
              <div className="text-sm text-danger font-semibold mb-3 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
                ⚠️ Bunday PIN allaqachon mavjud — <b>{pinOwner.name}</b> ({ROLE_LABEL[pinOwner.role] ?? pinOwner.role})ga
                berilgan. Boshqa PIN tanlang.
              </div>
            ) : (
              <div className="text-xs text-muted mb-3">
                {form.id && form.hadPin
                  ? 'PIN bo‘sh qoldirilsa — o‘zgarmaydi.'
                  : 'Bu PIN’ni xodimga ayting — u shu bilan tizimga kiradi.'}
              </div>
            ))}

          {/* Login va parol — faqat Direktor/SuperAdmin beradi */}
          {actorFull ? (
            <div className="rounded-xl border border-border bg-bg/40 p-3 mb-3">
              <div className="text-sm font-semibold mb-0.5">
                🔑 Login va parol {fullRole ? <span className="text-danger">(majburiy)</span> : <span className="text-muted font-normal">(ixtiyoriy)</span>}
              </div>
              <div className="text-xs text-muted mb-2.5">
                {fullRole
                  ? 'Direktor faqat login va parol bilan kiradi.'
                  : form.role === UserRole.Admin
                    ? 'Administrator uchun login+parol tavsiya etiladi (PIN ham ishlaydi).'
                    : 'Odatda kerak emas — xodim PIN bilan kiradi.'}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-muted mb-1">Login</label>
                  <input
                    value={form.login}
                    onChange={(e) => patchForm({ login: e.target.value.replace(/\s+/g, '') })}
                    maxLength={32}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="masalan: aziz"
                    className={`w-full px-3 py-2.5 rounded-lg bg-bg border outline-none font-mono ${
                      loginOwner ? 'border-danger' : 'border-border focus:border-primary'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted mb-1">Parol</label>
                  <div className="flex gap-1">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => patchForm({ password: e.target.value })}
                      maxLength={PASSWORD_MAX}
                      autoComplete="new-password"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder={form.id && form.hadPassword ? 'O‘zgartirmaslik uchun bo‘sh qoldiring' : '4–64 ta belgi'}
                      className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-bg border border-border outline-none focus:border-primary"
                    />
                    <Button
                      variant="ghost"
                      className="px-3"
                      title={showPassword ? 'Yashirish' : 'Ko‘rsatish'}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? '🙈' : '👁'}
                    </Button>
                  </div>
                </div>
              </div>
              {loginOwner && (
                <div className="text-sm text-danger font-semibold mt-2">
                  ⚠️ Bu login band — {loginOwner.name}ga berilgan.
                </div>
              )}
              {form.password && !isSelf && (
                <div className="text-xs text-warning font-semibold mt-2">
                  Bu parol vaqtinchalik: xodim birinchi kirishda uni o‘zinikiga almashtiradi.
                </div>
              )}
              {form.password && isSelf && (
                <div className="text-xs text-muted mt-2">Keyingi kirishda yangi parolingiz bilan kirasiz.</div>
              )}
              {form.id && form.origLogin && !loginTrim && (
                <div className="text-xs text-warning font-semibold mt-2">
                  Login olib tashlansa — parol bilan kirish ham yopiladi.
                </div>
              )}
            </div>
          ) : form.id && (form.origLogin || form.hadPassword) ? (
            <div className="text-xs text-muted mb-3">
              🔑 Login: <span className="font-mono text-text">{form.origLogin || '—'}</span>
              {form.hadPassword ? ' · parol bor' : ''} — login va parolni faqat direktor o‘zgartiradi.
            </div>
          ) : null}

          {/* Ruxsatlar (capabilities) */}
          {fullRole ? (
            <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 text-sm mb-3">
              ✅ Direktor/Super Admin — <b>barcha ruxsatlarga</b> ega (avtomatik).
            </div>
          ) : (
            <div className="mb-3">
              <div className="text-sm font-semibold mb-1">Ruxsatlar — nima qila oladi?</div>
              {form.permissions.length === 0 ? (
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
                  <span className="flex-1 min-w-[200px] font-semibold text-text">
                    ⚠️ Hech qanday ruxsat belgilanmagan — xodim tizimga kirsa ham hech narsa qila olmaydi.
                  </span>
                  {!lockOwnRole && defaultCapabilitiesForRole(form.role).length > 0 && (
                    <Button variant="ghost" className="py-1.5 text-sm shrink-0" onClick={applyRoleDefaults}>
                      Rol bo‘yicha belgilash
                    </Button>
                  )}
                </div>
              ) : (
                form.capsFromRole === form.role && (
                  <div className="text-xs text-muted mb-2">
                    {ROLE_LABEL[form.role] ?? form.role} uchun standart ruxsatlar belgilandi — kerak bo‘lsa o‘zgartiring.
                  </div>
                )
              )}
              <div className="text-xs text-muted mb-1">Operatsion</div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                {opsCaps.map(renderCap)}
              </div>
              <div className="text-xs text-muted mb-1">Boshqaruv</div>
              <div className="grid grid-cols-2 gap-2">
                {manageCaps.map(renderCap)}
              </div>
              {capsHint && (
                <div data-testid="role-caps-hint" className="mt-2 rounded-lg bg-bg border border-border px-3 py-2 text-xs text-muted">
                  🔒 {capsHint}
                </div>
              )}
            </div>
          )}

          {form.id && (
            <label
              className={`flex items-center gap-2 mb-4 text-sm select-none ${isSelf ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              title={isSelf ? 'O‘zingizni bloklay olmaysiz' : undefined}
            >
              <input
                type="checkbox"
                checked={form.active}
                disabled={isSelf}
                onChange={(e) => patchForm({ active: e.target.checked })}
                className="w-4 h-4 accent-[#059669]"
              />
              Faol
            </label>
          )}

          {formError && (
            <div
              role="alert"
              className="mb-3 bg-danger/10 border border-danger/50 text-danger rounded-lg px-3 py-2.5 text-sm font-semibold"
            >
              ⚠️ {formError}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" disabled={saving} onClick={() => setForm(null)}>
              Bekor
            </Button>
            <Button className="flex-1" disabled={saveBlocked} onClick={save}>
              {saving ? 'Saqlanmoqda…' : form.id ? 'Saqlash' : 'Qo‘shish'}
            </Button>
          </div>
        </Modal>
      )}

      {notice && (
        <FeedbackModal
          variant={notice.variant}
          title={notice.title}
          subtitle={notice.subtitle}
          onClose={() => setNotice(null)}
        />
      )}
    </div>
  );
}
