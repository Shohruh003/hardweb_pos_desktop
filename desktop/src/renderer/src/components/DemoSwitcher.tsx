import { useAuth } from '../state/auth';
import { useDemoNav } from '../state/demoNav';

// Prezentatsiya uchun panel almashtirgich (faqat mock rejimda ko'rinadi)
const ROLE_VIEWS = [
  { login: 'ofitsiant', label: 'Ofitsiant', role: 'ofitsiant' },
  { login: 'oshpaz', label: 'Oshxona', role: 'oshpaz' },
  { login: 'kassir', label: 'Kassa', role: 'kassir' },
  { login: 'admin', label: 'Admin', role: 'administrator' },
  { login: 'direktor', label: 'Direktor', role: 'direktor' },
];

export function DemoSwitcher() {
  const { user } = useAuth();
  const { queue, openQueue, openRole } = useDemoNav();

  return (
    <div className="flex items-center gap-1 bg-bg/60 rounded-lg p-1">
      <span className="text-[11px] text-muted px-1.5 hidden xl:inline">Demo:</span>
      {ROLE_VIEWS.map((v) => {
        const active = !queue && user?.role === v.role;
        return (
          <button
            key={v.login}
            onClick={() => openRole(v.login)}
            className={`px-2.5 py-1.5 rounded-md text-sm font-semibold transition-colors ${
              active ? 'bg-primary text-white' : 'text-muted hover:text-text'
            }`}
          >
            {v.label}
          </button>
        );
      })}
      <button
        onClick={openQueue}
        className={`px-2.5 py-1.5 rounded-md text-sm font-semibold transition-colors ${
          queue ? 'bg-primary text-white' : 'text-muted hover:text-text'
        }`}
      >
        Navbat ekrani
      </button>
    </div>
  );
}
