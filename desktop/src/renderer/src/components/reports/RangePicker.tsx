// Hisobot davri (0.3.2): Bugun / Hafta / Oy yoki "Sana va vaqt" — istalgan kunning istalgan soatlari
// oralig'i (masalan 15.11 08:00 — 16.11 03:00, smena bo'yicha). Server ?from=&to= ni sana yoki
// sana+vaqt ('YYYY-MM-DDTHH:MM') ko'rinishida qabul qiladi.
import { DateRange, periodRange, todayKey } from './reportUtils';
import { Segmented } from './parts';

export type ReportMode = 'day' | 'week' | 'month' | 'custom';

export interface ReportRange {
  mode: ReportMode;
  /** faqat 'custom' uchun: 'YYYY-MM-DDTHH:MM' */
  from: string;
  to: string;
}

const MODES: { value: ReportMode; label: string }[] = [
  { value: 'day', label: 'Bugun' },
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Oy' },
  { value: 'custom', label: 'Sana va vaqt' },
];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Hozirgi vaqt 'YYYY-MM-DDTHH:MM' */
function nowLocal(): string {
  const d = new Date();
  return `${todayKey()}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function defaultReportRange(): ReportRange {
  return { mode: 'day', from: `${todayKey()}T00:00`, to: nowLocal() };
}

/** Davr -> sanalar (yoki sana+vaqt) oralig'i — ?from=&to= uchun */
export function toDateRange(r: ReportRange): DateRange {
  if (r.mode === 'custom') return { from: r.from, to: r.to };
  return periodRange(r.mode);
}

/** Eski "period" so'rovlari uchun: tayyor davr — ?period=, aniq oraliq — ?from=&to= */
export function periodQuery(r: ReportRange): string {
  if (r.mode !== 'custom') return `period=${r.mode}`;
  return `from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`;
}

/** Aniq oraliq to'g'rimi (boshi oxiridan oldin) */
export function customValid(r: ReportRange): boolean {
  return r.mode !== 'custom' || (!!r.from && !!r.to && r.from < r.to);
}

export function RangePicker({ value, onChange }: { value: ReportRange; onChange: (r: ReportRange) => void }) {
  const input =
    'h-11 px-3 rounded-xl bg-bg border-2 border-border focus:border-primary outline-none font-bold text-text tabular-nums';
  const bad = value.mode === 'custom' && !customValid(value);
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="report-range">
      <Segmented<ReportMode>
        options={MODES}
        value={value.mode}
        onChange={(m) => onChange({ ...value, mode: m })}
        testIdPrefix="period"
      />
      {value.mode === 'custom' && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-sm font-bold text-muted">
            dan
            <input
              type="datetime-local"
              value={value.from}
              max={value.to || undefined}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              className={input}
              data-testid="range-from"
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm font-bold text-muted">
            gacha
            <input
              type="datetime-local"
              value={value.to}
              min={value.from || undefined}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              className={input}
              data-testid="range-to"
            />
          </label>
          {bad && <span className="text-sm font-bold text-danger">Boshlanish vaqti tugashdan oldin bo‘lishi kerak</span>}
        </div>
      )}
    </div>
  );
}
