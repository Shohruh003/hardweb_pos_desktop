import { memo } from 'react';
import { OrderType } from '@hardweb-pos/shared';
import { useAuth } from '../state/auth';
import { useTheme } from '../state/theme';
import { useI18n, LANGS, Lang } from '../state/i18n';
import { BackButton } from './BackButton';
import { IconBag, IconList, IconProps, IconScooter, IconTable, IconUser } from './waiter/icons';

type NavKey = 'tables' | 'myorders' | 'profile';

// Birinchi tugma joriy rejimga qarab nomlanadi: Stollar / Olib ketish / Yetkazish
const HOME_LABEL: Record<OrderType, string> = {
  [OrderType.DineIn]: 'Stollar',
  [OrderType.Takeaway]: 'Olib ketish',
  [OrderType.Delivery]: 'Yetkazish',
};
const HOME_ICON: Record<OrderType, (p: IconProps) => JSX.Element> = {
  [OrderType.DineIn]: IconTable,
  [OrderType.Takeaway]: IconBag,
  [OrderType.Delivery]: IconScooter,
};

const NavBtn = memo(function NavBtn({
  Icon,
  label,
  on,
  onClick,
  badge,
  testId,
}: {
  Icon: (p: IconProps) => JSX.Element;
  label: string;
  on: boolean;
  onClick: () => void;
  badge?: number;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on ? 'page' : undefined}
      data-testid={testId}
      className={`relative flex-1 min-h-[56px] flex flex-col items-center justify-center gap-1 py-1.5 active:scale-95 transition-[transform,color] ${
        on ? 'text-primary' : 'text-muted hover:text-text'
      }`}
    >
      <span className={`relative flex items-center justify-center w-12 h-7 rounded-full transition-colors ${on ? 'bg-primary/15' : ''}`}>
        <Icon className="w-[22px] h-[22px]" strokeWidth={on ? 2.4 : 2} />
        {!!badge && badge > 0 && (
          <span className="absolute -top-1 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary-hover text-white text-[10px] font-extrabold flex items-center justify-center">
            {badge}
          </span>
        )}
      </span>
      <span className="text-[11px] font-bold leading-none">{label}</span>
    </button>
  );
});

// Mobil (telefon) uchun ofitsiant pastki navigatsiyasi: Stollar (rejim) / Buyurtmalarim / Profil.
export function WaiterMobileNav({
  active,
  onTables,
  onMyOrders,
  onProfile,
  mode = OrderType.DineIn,
  myOrdersCount,
}: {
  active: NavKey;
  onTables: () => void;
  onMyOrders: () => void;
  onProfile: () => void;
  /** joriy rejim — birinchi tugma nomi va belgisi (standart: Stollar) */
  mode?: OrderType;
  /** shu xodimning ochiq buyurtmalari soni (Buyurtmalarim tugmasida) */
  myOrdersCount?: number;
}) {
  return (
    <nav
      aria-label="Ofitsiant navigatsiyasi"
      className="md:hidden fixed inset-x-0 bottom-0 z-30 bg-surface border-t border-border flex shadow-[0_-6px_20px_-12px_rgba(0,0,0,0.5)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <NavBtn Icon={HOME_ICON[mode]} label={HOME_LABEL[mode]} on={active === 'tables'} onClick={onTables} testId="nav-home" />
      <NavBtn
        Icon={IconList}
        label="Buyurtmalarim"
        on={active === 'myorders'}
        onClick={onMyOrders}
        badge={myOrdersCount}
        testId="nav-myorders"
      />
      <NavBtn Icon={IconUser} label="Profil" on={active === 'profile'} onClick={onProfile} testId="nav-profile" />
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
