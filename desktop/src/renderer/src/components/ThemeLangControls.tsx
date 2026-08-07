import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../state/theme';
import { useI18n, LANGS, Lang } from '../state/i18n';

// Header uchun: tema (quyosh/oy) va til almashtirgich
export function ThemeLangControls() {
  const { theme, toggle } = useTheme();
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const current = LANGS.find((l) => l.code === lang)!;

  return (
    <div className="flex items-center gap-2">
      {/* Til almashtirgich */}
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border hover:border-primary hover:bg-surface-hover transition-colors text-sm"
          title="Til / Язык / Language"
        >
          <span className="text-base leading-none">{current.flag}</span>
          <span className="font-medium uppercase">{current.code}</span>
        </button>
        {open && (
          <div className="absolute right-0 mt-1 w-40 bg-surface border border-border rounded-xl shadow-xl overflow-hidden z-50 animate-card-in">
            {LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() => {
                  setLang(l.code as Lang);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-hover transition-colors ${
                  l.code === lang ? 'text-primary font-semibold' : 'text-text'
                }`}
              >
                <span className="text-base">{l.flag}</span>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tema tugmasi */}
      <button
        onClick={toggle}
        className="p-2 rounded-lg border border-border hover:border-primary hover:bg-surface-hover transition-colors"
        title={theme === 'dark' ? "Yorug' rejim" : "Qorong'u rejim"}
        aria-label="Tema"
      >
        {theme === 'dark' ? (
          // Quyosh (yorug'ga o'tish)
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-warning">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          // Oy (qorong'uga o'tish)
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-info">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
          </svg>
        )}
      </button>
    </div>
  );
}
