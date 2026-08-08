// Yengil, kutubxonasiz grafiklar (SVG/CSS) — dashboard uchun.
// Ranglar ko'k emas: emerald, amber, pink, violet, teal (loyiha uslubi).
import { formatSum } from './ui';

export const CHART_COLORS = ['#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444'];

// Qisqa summa — donut markazi kabi tor joylar uchun (10 559 000 -> "10.6 mln")
export function compactSum(n: number): string {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} mlrd`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} mln`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} ming`;
  return String(v);
}

// --- Doiraviy (donut) diagramma ---
export function DonutChart({
  data,
  centerLabel,
  centerValue,
}: {
  data: { label: string; value: number; color?: string }[];
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 60;
  const C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg viewBox="0 0 160 160" className="w-40 h-40 shrink-0">
        <g transform="rotate(-90 80 80)">
          <circle cx="80" cy="80" r={R} fill="none" stroke="rgb(var(--c-border))" strokeWidth="18" />
          {total > 0 &&
            data.map((d, i) => {
              const f = d.value / total;
              const seg = (
                <circle
                  key={i}
                  cx="80"
                  cy="80"
                  r={R}
                  fill="none"
                  stroke={d.color ?? CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth="18"
                  strokeDasharray={`${f * C} ${C - f * C}`}
                  strokeDashoffset={-acc * C}
                  strokeLinecap="butt"
                />
              );
              acc += f;
              return seg;
            })}
        </g>
        <text x="80" y="78" textAnchor="middle" className="fill-[rgb(var(--c-text))]" style={{ fontSize: 17, fontWeight: 800 }}>
          {centerValue ?? total}
        </text>
        {centerLabel && (
          <text x="80" y="96" textAnchor="middle" className="fill-[rgb(var(--c-muted))]" style={{ fontSize: 10 }}>
            {centerLabel}
          </text>
        )}
      </svg>
      <div className="space-y-2 min-w-0">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: d.color ?? CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="text-muted">{d.label}</span>
            <span className="font-semibold ml-auto pl-3">{formatSum(d.value)}</span>
          </div>
        ))}
        {total === 0 && <div className="text-muted text-sm">Ma'lumot yo'q</div>}
      </div>
    </div>
  );
}

// --- Chiziqli (area/line) diagramma ---
export function LineChart({
  points,
  height = 220,
}: {
  points: { label: string; value: number }[];
  height?: number;
}) {
  const W = 720;
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 16;
  const padB = 28;
  const max = Math.max(1, ...points.map((p) => p.value));
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const x = (i: number) => padL + i * stepX;
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  const area = `${padL},${padT + innerH} ${line} ${padL + (points.length - 1) * stepX},${padT + innerH}`;
  const gridVals = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-primary" style={{ height }}>
      <defs>
        <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Grid */}
      {gridVals.map((g, i) => (
        <line
          key={i}
          x1={padL}
          x2={W - padR}
          y1={padT + innerH - g * innerH}
          y2={padT + innerH - g * innerH}
          stroke="rgb(var(--c-border))"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      ))}
      {points.length > 0 && (
        <>
          <polygon points={area} fill="url(#lineFill)" />
          <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p.value)} r="3.5" fill="currentColor" />
          ))}
        </>
      )}
      {/* X labels */}
      {points.map((p, i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-[rgb(var(--c-muted))]" style={{ fontSize: 10 }}>
          {p.label}
        </text>
      ))}
    </svg>
  );
}

// --- Gorizontal ustunlar (top taomlar / ofitsiantlar) ---
export function HBars({
  rows,
  color = '#10b981',
  valueFmt,
}: {
  rows: { label: string; value: number; sub?: string }[];
  color?: string;
  valueFmt?: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <div className="text-muted text-sm">Ma'lumot yo'q</div>;
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="flex justify-between text-sm mb-1">
            <span className="truncate pr-2">{r.label}</span>
            <span className="font-semibold shrink-0">{valueFmt ? valueFmt(r.value) : r.value}</span>
          </div>
          <div className="h-2.5 rounded-full bg-bg overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
          {r.sub && <div className="text-xs text-muted mt-0.5">{r.sub}</div>}
        </div>
      ))}
    </div>
  );
}
