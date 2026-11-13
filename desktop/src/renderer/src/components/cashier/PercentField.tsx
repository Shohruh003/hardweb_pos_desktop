import { useEffect, useState } from 'react';
import { cleanDecimalInput, parseDecimal } from '../numeric';

// Foiz maydoni (0–100). Matn holati alohida saqlanadi: "2," / "2." kabi oraliq yozuv yo'qolmaydi,
// vergul nuqtaga aylanadi ("2,5" -> 2.5), 100 dan katta qiymat 100 ga tushiriladi.
export function PercentField({
  label,
  value,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const [text, setText] = useState(value ? String(value) : '');
  // Tashqaridan qiymat o'zgarsa (server yangiladi / boshqa hisob) — matnni moslaymiz
  useEffect(() => {
    setText((cur) => (parseDecimal(cur) === value ? cur : value ? String(value) : ''));
  }, [value]);

  return (
    <label className="block min-w-0">
      <span className="text-sm text-muted font-semibold">{label}</span>
      <div className="relative mt-1">
        <input
          inputMode="decimal"
          placeholder="0"
          value={text}
          disabled={disabled}
          data-testid={testId}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const clean = cleanDecimalInput(e.target.value, 2);
            const n = parseDecimal(clean);
            if (n > 100) {
              setText('100');
              onChange(100);
              return;
            }
            setText(clean);
            onChange(n);
          }}
          className="w-full h-12 pl-3 pr-9 rounded-xl bg-bg border border-border text-text text-lg font-bold outline-none focus:border-primary disabled:opacity-60"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted font-bold">%</span>
      </div>
    </label>
  );
}
