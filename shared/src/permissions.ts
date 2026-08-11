// Ruxsatlar (capabilities) — xodim nima qila olishini belgilaydi.
// Rol emas, aynan shu ruxsatlar UI'ni va amallarni boshqaradi.
// Direktor va SuperAdmin — barcha ruxsatlarga ega (avtomatik).

export interface Capability {
  key: string;
  label: string; // o'zbekcha nom
  group: 'ops' | 'manage'; // operatsion yoki boshqaruv
  icon: string;
}

export const CAPABILITIES: Capability[] = [
  // Operatsion
  { key: 'waiter', label: 'Ofitsiantlik (zakaz)', group: 'ops', icon: '🧑‍🍳' },
  { key: 'kitchen', label: 'Oshxona (KDS)', group: 'ops', icon: '🍳' },
  { key: 'cashier', label: 'Kassa (to‘lov)', group: 'ops', icon: '💵' },
  { key: 'revenue', label: 'Tushum / statistikani ko‘rish', group: 'ops', icon: '📈' },
  { key: 'refund', label: 'Vozvrat qilish', group: 'ops', icon: '↩️' },
  // Boshqaruv
  { key: 'history', label: 'Cheklar tarixi', group: 'manage', icon: '🧾' },
  { key: 'reports', label: 'Hisobotlar (atchot)', group: 'manage', icon: '📊' },
  { key: 'menu', label: 'Menyu boshqarish', group: 'manage', icon: '📋' },
  { key: 'inventory', label: 'Sklad (ombor)', group: 'manage', icon: '📦' },
  { key: 'customers', label: 'Mijozlar (CRM)', group: 'manage', icon: '🙋' },
  { key: 'stations', label: 'Bo‘limlar (sexlar)', group: 'manage', icon: '🏭' },
  { key: 'tables', label: 'Stollar boshqarish', group: 'manage', icon: '🪑' },
  { key: 'staff', label: 'Xodimlar boshqarish', group: 'manage', icon: '👥' },
  { key: 'devices', label: 'Qurilmalar / printer', group: 'manage', icon: '🖨️' },
  { key: 'terminals', label: 'Terminal (blok) qo‘shish', group: 'manage', icon: '🖥️' },
  { key: 'settings', label: 'Sozlamalar', group: 'manage', icon: '⚙️' },
];

export const ALL_CAPABILITY_KEYS = CAPABILITIES.map((c) => c.key);

// Direktor/SuperAdmin barcha ruxsatga ega — shu rollarni tekshiramiz
export function isFullAccessRole(role: string): boolean {
  return role === 'direktor' || role === 'superadmin';
}

// Foydalanuvchida ruxsat bormi?
export function hasCapability(
  user: { role: string; permissions?: string[] } | null | undefined,
  cap: string,
): boolean {
  if (!user) return false;
  if (isFullAccessRole(user.role)) return true;
  return (user.permissions ?? []).includes(cap);
}
