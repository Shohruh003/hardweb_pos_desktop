import { useAuth } from '../state/auth';
import { useTheme } from '../state/theme';
import { useI18n, LANGS, Lang } from '../state/i18n';
import { BackButton } from './BackButton';

type NavKey = 'tables' | 'myorders' | 'profile';

// Mobil (telefon) uchun ofitsiant pastki navigatsiyasi: Stollar / Buyurtmalarim / Profil.
export function WaiterMobileNav({
  active,
  onTables,
  onMyOrders,
  onProfile,
}: {
  active: NavKey;
  onTables: () => void;
  onMyOrders: () => void;
  onProfile: () => void;
}) {
  const NavBtn = ({
    icon,
    label,
    on,
    onClick,
  }: {
    icon: string;
    label: string;
    on: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-0.5 py-2 active:scale-95 transition-all ${
        on ? 'text-primary' : 'text-muted'
      }`}
    >
      <span className="text-[22px] leading-none">{icon}</span>
      <span className="text-[11px] font-semibold">{label}</span>
    </button>
  );

  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-30 bg-surface/95 backdrop-blur border-t border-border flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <NavBtn icon="🍽️" label="Stollar" on={active === 'tables'} onClick={onTables} />
      <NavBtn icon="🧾" label="Buyurtmalarim" on={active === 'myorders'} onClick={onMyOrders} />
      <NavBtn icon="👤" label="Profil" on={active === 'profile'} onClick={onProfile} />
    </nav>
  );
}

// Profil — alohida to'liq sahifa (akkaunt + buyurtmalar tarixi + til + tema + chiqish).
export function WaiterProfileView({ onHistory }: { onHistory: () => void }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { t, lang, setLang } = useI18n();

  return (
    <div className="h-full overflow-auto p-4 pb-24 md:pb-6">
      <div className="max-w-md mx-auto">
        {/* Akkaunt */}
        <div className="flex items-center gap-4 mb-6 mt-2 p-4 rounded-2xl bg-surface border border-border">
          <span className="w-16 h-16 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-3xl shrink-0">
            {user?.name?.charAt(0) ?? '?'}
          </span>
          <div className="min-w-0">
            <div className="font-bold text-xl truncate">{user?.name}</div>
            <div className="text-sm text-muted">{t(`role.${user?.role ?? ''}`, user?.role)}</div>
          </div>
        </div>

        {/* Buyurtmalar tarixi */}
        <button
          onClick={onHistory}
          className="w-full flex items-center justify-between px-4 py-4 mb-5 rounded-xl border border-border hover:border-primary hover:bg-surface-hover transition-colors font-semibold"
        >
          <span className="flex items-center gap-2">🧾 Buyurtmalar tarixi</span>
          <span className="text-muted">›</span>
        </button>

        {/* Til */}
        <div className="mb-5">
          <div className="text-xs font-bold text-muted mb-2 uppercase tracking-wide">Til</div>
          <div className="grid grid-cols-3 gap-2">
            {LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() => setLang(l.code as Lang)}
                className={`flex items-center justify-center gap-1.5 py-3.5 rounded-xl border font-semibold transition-colors ${
                  l.code === lang ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text'
                }`}
              >
                <span className="text-base">{l.flag}</span>
                <span className="text-sm uppercase">{l.code}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tema */}
        <div className="mb-6">
          <div className="text-xs font-bold text-muted mb-2 uppercase tracking-wide">Ko‘rinish</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => theme !== 'light' && toggle()}
              className={`py-3.5 rounded-xl border font-semibold transition-colors ${
                theme === 'light' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text'
              }`}
            >
              ☀️ Kunduzgi
            </button>
            <button
              onClick={() => theme !== 'dark' && toggle()}
              className={`py-3.5 rounded-xl border font-semibold transition-colors ${
                theme === 'dark' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text'
              }`}
            >
              🌙 Tungi
            </button>
          </div>
        </div>

        {/* Chiqish */}
        <button
          onClick={() => logout()}
          className="w-full py-4 rounded-xl bg-danger/10 text-danger font-bold hover:bg-danger/20 transition-colors"
        >
          ⎋ Chiqish
        </button>

        {/* Orqaga (bosh sahifaga) — faqat ko'p modulli userda (admin/direktor) ko'rinadi */}
        <BackButton className="w-full justify-center mt-3 h-12 rounded-xl" />
      </div>
    </div>
  );
}
