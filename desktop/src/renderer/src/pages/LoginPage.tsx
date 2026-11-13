import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../state/auth';
import { MOCK } from '../lib/api';
import {
  applyServerUrl,
  getDefaultServerUrl,
  getServerUrl,
  normalizeServerUrl,
  probeServer,
  type ServerProbeResult,
} from '../lib/config';
import { useI18n } from '../state/i18n';
import { Button } from '../components/ui';
import { ThemeLangControls } from '../components/ThemeLangControls';
import logo from '../assets/logo.png';

// Klaviatura hodisasi matn maydonidan kelganmi (input/textarea/select/contentEditable).
// Bunday hodisalar PIN klaviaturasiga tegishli emas (masalan server manzilini yozish).
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

type ServerPhase = 'idle' | 'checking' | 'ok' | 'fail' | 'saved';

/**
 * Server (kassa kompyuteri) manzilini kiritish. Avval tekshiradi (GET /api/license/status),
 * natijani ko'rsatadi; server topilsa saqlab, oynani qayta yuklaydi (REST + socket yangi
 * manzilga ulanadi). Topilmasa ham "Baribir saqlash" mumkin.
 * Ulanish ekrani (App), Login va Qurilmalar bo'limi shu bitta komponentdan foydalanadi.
 */
export function ServerAddressForm({
  autoFocus = false,
  submitLabel = 'Tekshirish va saqlash',
  className = '',
}: {
  autoFocus?: boolean;
  submitLabel?: string;
  className?: string;
}) {
  const [value, setValue] = useState(() => getServerUrl());
  const [phase, setPhase] = useState<ServerPhase>('idle');
  const [result, setResult] = useState<ServerProbeResult | null>(null);
  const runId = useRef(0);
  const saveTimer = useRef<number | undefined>(undefined);
  // Tasdiqlangan (server topilgan), lekin hali saqlanmagan manzil
  const pendingSave = useRef<string | null>(null);

  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      // Forma yopilib qolsa ham (masalan ulanish ekrani o'zi o'tib ketdi) tasdiqlangan manzil saqlanadi
      if (pendingSave.current) applyServerUrl(pendingSave.current);
    },
    [],
  );

  function save(url: string) {
    window.clearTimeout(saveTimer.current);
    pendingSave.current = null;
    const { reloaded } = applyServerUrl(url);
    // Amaldagi manzil o'zgarmagan — qayta yuklash shart emas
    if (!reloaded) setPhase('saved');
  }

  async function check() {
    if (phase === 'checking') return;
    const url = normalizeServerUrl(value) || getDefaultServerUrl();
    setValue(url); // foydalanuvchi to'liq manzilni ko'rsin (http:// va :3100 qo'shilgan)
    setPhase('checking');
    setResult(null);
    const id = ++runId.current;
    const r = await probeServer(url);
    if (id !== runId.current) return; // manzil o'zgartirildi — eski natija kerak emas
    setResult(r);
    setPhase(r.ok ? 'ok' : 'fail');
    // Server topildi — natijani bir lahza ko'rsatib, saqlaymiz va qayta ulanamiz
    if (r.ok) {
      pendingSave.current = r.url;
      saveTimer.current = window.setTimeout(() => save(r.url), 700);
    }
  }

  function onChange(v: string) {
    setValue(v);
    window.clearTimeout(saveTimer.current);
    pendingSave.current = null;
    runId.current++;
    setPhase('idle');
    setResult(null);
  }

  return (
    <div className={`w-full text-left ${className}`}>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void check();
            }
          }}
          placeholder="http://192.168.1.10:3100"
          autoFocus={autoFocus}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
          className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-bg border border-border text-text font-mono text-sm outline-none focus:border-primary"
        />
        <Button onClick={() => void check()} disabled={phase === 'checking'} className="shrink-0 text-sm">
          {phase === 'checking' ? 'Tekshirilmoqda…' : submitLabel}
        </Button>
      </div>

      {phase === 'checking' && (
        <div className="mt-2 flex items-center gap-2 text-sm text-muted">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Server tekshirilmoqda…
        </div>
      )}
      {phase === 'ok' && result && (
        <div className="mt-2 text-sm font-semibold text-success animate-pop-in">
          {result.message} — saqlanmoqda, ilova qayta ulanadi…
        </div>
      )}
      {phase === 'saved' && (
        <div className="mt-2 text-sm font-semibold text-success animate-pop-in">
          ✓ Saqlandi — ilova shu manzildan foydalanmoqda
        </div>
      )}
      {phase === 'fail' && result && (
        <div className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2.5 animate-pop-in">
          <div className="text-sm font-semibold text-danger">{result.message}</div>
          {result.hint && <div className="mt-0.5 text-xs text-text/80">{result.hint}</div>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => void check()} className="py-1.5 text-sm">
              ↻ Qayta tekshirish
            </Button>
            <Button variant="ghost" onClick={() => save(result.url)} className="py-1.5 text-sm">
              Baribir saqlash
            </Button>
          </div>
        </div>
      )}

      <div className="mt-1.5 text-[11px] text-muted">
        Kassa (server) kompyuteri IP manzili, masalan 192.168.1.10 — http:// va :3100 avtomatik qo‘shiladi
      </div>
    </div>
  );
}

/** Kassa kompyuteridagi baza fayli (DEPLOY.md, 2-qadam) */
const DB_PATH = '%APPDATA%\\@hardweb-pos\\desktop\\data\\dasturxon.db';

// Kirish ekrani — PIN bilan (mock va real bir xil ishlaydi).
// demoData — server (real rejim) bazasida eski demo ma'lumotlar topilgan: qizil ogohlantirish.
export function LoginPage({ demoData = false }: { demoData?: boolean }) {
  const { loginByPin, login, sessionExpired, sessionExpiredReason, dismissSessionExpired } = useAuth();
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [logoClicks, setLogoClicks] = useState(0);
  // Direktor/rahbar — login + parol rejimi (PIN emas, xavfsizroq)
  const [pwMode, setPwMode] = useState(false);
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  // Tez bosishlarda ham to'g'ri ishlashi uchun joriy PIN va band holati ref'da
  const pinRef = useRef('');
  const busyRef = useRef(false);

  function setPinValue(v: string) {
    pinRef.current = v;
    setPin(v);
  }

  async function submitPassword() {
    if (busyRef.current || !loginName.trim() || !password) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await login(loginName.trim(), password);
    } catch (err) {
      setError((err as Error).message || 'Login yoki parol noto‘g‘ri');
      setPassword('');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const submit = useCallback(
    async (code: string) => {
      busyRef.current = true;
      setBusy(true);
      setError('');
      try {
        await loginByPin(code);
      } catch (err) {
        setError((err as Error).message || 'PIN noto‘g‘ri');
        setPinValue('');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [loginByPin],
  );

  function press(d: string) {
    if (busyRef.current) return;
    setError('');
    const current = pinRef.current;
    if (current.length >= 4) return;
    const next = current + d;
    setPinValue(next);
    if (next.length === 4) void submit(next);
  }

  const clear = () => setPinValue('');
  const backspace = () => setPinValue(pinRef.current.slice(0, -1));

  // Klaviaturadan ham kiritish (raqamlar, Backspace). Matn maydonlarida yozish
  // (server manzili, login) PIN sifatida qabul qilinmaydi.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pwMode) return; // login/parol rejimida PIN tugmalari ishlamaydi
      if (isTypingTarget(e.target)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') backspace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // har renderda yangilanadi (pwMode va submit eng so'nggi qiymatda)

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="h-full flex flex-col md:flex-row app-bg">
      {/* Chap yarim — logo (oq fon). Logoni 5 marta bossa — yashirin server sozlamasi */}
      <div className="md:w-1/2 bg-white flex items-center justify-center p-6 md:p-10 shrink-0">
        <img
          src={logo}
          alt="DasturXon"
          onClick={() => {
            const n = logoClicks + 1;
            setLogoClicks(n);
            if (n >= 5 && !MOCK) setShowServer(true);
          }}
          className="w-auto max-w-[80%] max-h-[26vh] md:max-h-[70vh] object-contain select-none cursor-default"
          draggable={false}
        />
      </div>

      {/* O'ng yarim — PIN kiritish */}
      <div className="md:w-1/2 flex-1 flex flex-col items-center justify-center p-6 relative">
        <div className="absolute top-4 right-4">
          <ThemeLangControls />
        </div>

        {/* Real ish uchun o'rnatilgan serverda eski demo baza qolib ketgan — yopib bo'lmaydigan ogohlantirish */}
        {demoData && (
          <div
            role="alert"
            className="mb-5 w-full max-w-[440px] rounded-xl border-2 border-danger bg-danger/15 px-4 py-3 text-left animate-pop-in"
          >
            <div className="flex items-start gap-2.5">
              <span className="text-xl leading-none text-danger">⛔</span>
              <div className="min-w-0">
                <div className="font-extrabold text-danger">
                  Bazada demo ma‘lumotlar bor — o‘rnatishdan oldin eski bazani o‘chiring
                </div>
                <div className="mt-1 text-sm text-text">
                  Kassa kompyuterida dasturni yoping va quyidagi faylni o‘chiring (yoki boshqa joyga ko‘chiring),
                  so‘ng dasturni qayta oching — toza baza yaratiladi:
                </div>
                <div className="mt-1.5 rounded-md bg-bg/70 border border-danger/40 px-2 py-1 font-mono text-xs text-text break-all select-all">
                  {DB_PATH}
                </div>
                <div className="mt-1.5 text-xs text-text/80">
                  Demo xodimlarning paroli hammaga ma‘lum: vendor hisobi bloklandi, qolganlar parolni almashtirishi shart.
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="text-primary font-extrabold text-2xl tracking-tight">DasturXon</div>
        <div className="text-muted text-sm mb-6">
          {pwMode ? 'Direktor — login va parol' : `${t('common.password')} — PIN`}
        </div>

        {/* Sessiya muddati tugagan / xodim bloklangan — bir martalik eslatma */}
        {sessionExpired && (
          <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-warning/40 bg-warning/15 text-text text-sm font-semibold animate-pop-in">
            <span className="text-warning text-base leading-none">{sessionExpiredReason ? '⚠' : '⏱'}</span>
            <span>{sessionExpiredReason || 'Sessiya tugadi — qayta kiring'}</span>
            <button
              onClick={dismissSessionExpired}
              className="ml-1 text-muted hover:text-text leading-none"
              aria-label="Yopish"
            >
              ✕
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 px-4 py-2 rounded-lg bg-danger/15 text-danger text-sm font-medium animate-pop-in">
            {error}
          </div>
        )}

        {!pwMode && (
          <>
            {/* PIN nuqtalari */}
            <div className="flex gap-4 mb-8">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`w-4 h-4 rounded-full transition-all duration-150 ${
                    busy
                      ? 'bg-warning animate-pulse'
                      : pin.length > i
                        ? 'bg-primary scale-110'
                        : 'bg-border'
                  }`}
                />
              ))}
            </div>

            {/* Raqamli klaviatura */}
            <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
              {keys.map((k) => (
                <button
                  key={k}
                  onClick={() => press(k)}
                  disabled={busy}
                  className="aspect-square rounded-2xl bg-surface border border-border text-2xl font-bold hover:border-primary hover:bg-surface-hover active:scale-95 transition-all disabled:opacity-50"
                >
                  {k}
                </button>
              ))}
              <button
                onClick={clear}
                disabled={busy}
                className="aspect-square rounded-2xl bg-surface border border-border text-lg font-semibold text-muted hover:text-danger hover:border-danger active:scale-95 transition-all"
              >
                C
              </button>
              <button
                onClick={() => press('0')}
                disabled={busy}
                className="aspect-square rounded-2xl bg-surface border border-border text-2xl font-bold hover:border-primary hover:bg-surface-hover active:scale-95 transition-all disabled:opacity-50"
              >
                0
              </button>
              <button
                onClick={backspace}
                disabled={busy}
                className="aspect-square rounded-2xl bg-surface border border-border text-xl hover:border-primary active:scale-95 transition-all"
              >
                ⌫
              </button>
            </div>
          </>
        )}

        {pwMode && (
          <div className="w-full max-w-[300px] flex flex-col gap-3">
            <input
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitPassword()}
              placeholder="Login"
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="px-4 py-3 rounded-xl bg-surface border border-border outline-none focus:border-primary"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitPassword()}
              placeholder="Parol"
              className="px-4 py-3 rounded-xl bg-surface border border-border outline-none focus:border-primary"
            />
            <button
              onClick={submitPassword}
              disabled={busy || !loginName.trim() || !password}
              className="py-3 rounded-xl bg-primary text-white font-bold hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
            >
              {busy ? '...' : 'Kirish'}
            </button>
          </div>
        )}

        {/* PIN <-> login/parol rejimini almashtirish */}
        <button
          onClick={() => {
            setPwMode((v) => !v);
            setError('');
            setPinValue('');
            setPassword('');
          }}
          className="mt-6 text-sm text-primary hover:underline font-semibold"
        >
          {pwMode ? '← Xodim (PIN) bilan kirish' : '🔑 Direktor (login/parol) bilan kirish'}
        </button>

        {/* Server manzili — boshqa kompyuterda (terminalda) kassa IP'sini kiritish uchun.
            Demo rejimda server yo'q — ko'rsatilmaydi. */}
        {!MOCK && (
          <>
            <button
              onClick={() => setShowServer((s) => !s)}
              className="mt-6 text-xs text-muted hover:text-primary flex items-center gap-1"
            >
              ⚙ Server manzili
            </button>
            {showServer && (
              <div className="mt-2 w-full max-w-[400px]">
                <ServerAddressForm submitLabel="Ulanish" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
