import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
}

// Chiroyli dropdown (native select o'rniga). Ro'yxat PORTAL orqali chiqadi —
// modal/panel ichida ham kesilmaydi (clip bo'lmaydi).
export function Select({
  value,
  onChange,
  options,
  placeholder = 'Tanlang',
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean }>({
    top: 0, left: 0, width: 0, up: false,
  });

  const reposition = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const up = spaceBelow < 280 && r.top > spaceBelow;
    setPos({ top: up ? r.top : r.bottom, left: r.left, width: r.width, up });
  };

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onScrollResize() {
      reposition();
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onScrollResize);
    // sig'may qolgan konteynerlar skroll qilsa — pozitsiyani yangilaymiz
    window.addEventListener('scroll', onScrollResize, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onScrollResize);
      window.removeEventListener('scroll', onScrollResize, true);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-bg border text-left transition-colors ${
          open ? 'border-primary' : 'border-border hover:border-primary/60'
        }`}
      >
        <span className={`truncate ${selected ? '' : 'text-muted'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className={`text-muted shrink-0 ml-2 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={listRef}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: pos.width,
              transform: pos.up ? 'translateY(-100%)' : 'none',
              zIndex: 1000,
            }}
            className={`${pos.up ? 'mb-2' : 'mt-2'}`}
          >
            <div className="max-h-64 overflow-auto rounded-xl border border-border bg-surface shadow-2xl p-1.5 animate-pop-in">
              {options.map((o) => {
                const active = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-between ${
                      active ? 'bg-primary text-white' : 'text-text hover:bg-primary/15'
                    }`}
                  >
                    <span className="truncate">{o.label}</span>
                    {active && <span className="ml-2">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
