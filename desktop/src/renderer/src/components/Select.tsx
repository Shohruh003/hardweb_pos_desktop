import { useEffect, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

// Chiroyli ochiladigan dropdown (native select o'rniga). To'q tema + emerald.
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-bg border text-left transition-colors ${
          open ? 'border-primary' : 'border-border hover:border-primary/60'
        }`}
      >
        <span className={selected ? '' : 'text-muted'}>
          {selected ? selected.label : placeholder}
        </span>
        <span
          className={`text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-full max-h-64 overflow-auto rounded-xl border border-border bg-surface shadow-2xl p-1.5 animate-pop-in">
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
                  active
                    ? 'bg-primary text-white'
                    : 'text-text hover:bg-primary/15'
                }`}
              >
                {o.label}
                {active && <span>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
