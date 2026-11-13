// Oshxonaga izoh muharriri (egasining talabi, D6): tez izohlar bir bosishda, tayyor bo'lish vaqti
// ("⏰ 15:00 ga tayyor" — katta soat/daqiqa tugmalari va tayyor vaqtlar) va erkin matn.
// Matn maydoni tashqi ref bilan — ekran klaviaturasi (TouchKeyboard) shu maydonga yozadi.
import { memo, useMemo, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { IconClock, IconMinus, IconPlus } from './icons';
import { NOTE_MAX } from './cart';

/** Tez izohlar (egasi bergan ro'yxat) */
export const QUICK_NOTES = [
  'Tuzsiz',
  'Achchiq',
  'Piyozsiz',
  'Kam yog‘li',
  'Tezroq',
  'Keyinroq olib kelinsin',
  'Mehmon kelganda olib kelinsin',
  'Saboy qilinsin',
];

const READY_HOURS = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
/** Izohdagi "⏰ HH:MM ga tayyor" bo'lagi — bittadan ortiq bo'lmasin (yangisi eskisini almashtiradi) */
const READY_RE = /\s*⏰\s*\d{1,2}:\d{2}\s*ga tayyor,?/g;
const READY_ONE = /⏰\s*(\d{1,2}):(\d{2})\s*ga tayyor/;

const pad = (n: number) => String(n).padStart(2, '0');

/** Hozirdan N daqiqa keyin, 5 daqiqaga yuqoriga yaxlitlab */
function inMinutes(min: number): { h: number; m: number } {
  const d = new Date(Date.now() + min * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return { h: d.getHours(), m: d.getMinutes() };
}

/** Izohga "⏰ HH:MM ga tayyor" qo'yish (eskisi bo'lsa — almashtiriladi, boshida turadi) */
export function withReadyTime(note: string, time: string): string {
  const rest = note.replace(READY_RE, '').trim().replace(/^,\s*/, '');
  const tag = `⏰ ${time} ga tayyor`;
  return (rest ? `${tag}, ${rest}` : tag).slice(0, NOTE_MAX);
}

/** Izohdan vaqtni olib tashlash */
function withoutReadyTime(note: string): string {
  return note.replace(READY_RE, '').trim().replace(/^,\s*/, '');
}

/** Tez izohni qo'shish (allaqachon bo'lsa — o'zgarmaydi) */
function withQuick(note: string, q: string): string {
  const cur = note.trim();
  if (cur.toLowerCase().includes(q.toLowerCase())) return note;
  return (cur ? `${cur}, ${q.charAt(0).toLowerCase()}${q.slice(1)}` : q).slice(0, NOTE_MAX);
}

export interface NoteEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** matn maydoni (ekran klaviaturasi shunga yozadi) */
  textRef: RefObject<HTMLTextAreaElement>;
  /** matn maydoni fokus oldi (ekran klaviaturasini ko'rsatish uchun) */
  onTextFocus?: () => void;
  /** sensorli qurilmada tizim klaviaturasi chiqmasin (ekran klaviaturasi bor) */
  suppressSystemKeyboard?: boolean;
  /** matn maydoni sarlavhasi yonidagi qo'shimcha (masalan "⌨ Klaviatura" tugmasi) */
  toolbar?: ReactNode;
  placeholder?: string;
}

function NoteEditorImpl({ value, onChange, textRef, onTextFocus, suppressSystemKeyboard, toolbar, placeholder }: NoteEditorProps) {
  const current = useMemo(() => {
    const m = value.match(READY_ONE);
    return m ? `${pad(Number(m[1]))}:${m[2]}` : null;
  }, [value]);
  // Soat tanlagich — boshlang'ich qiymat: izohdagi vaqt yoki hozir + 1 soat
  const [pick, setPick] = useState(() => {
    const m = value.match(READY_ONE);
    return m ? { h: Number(m[1]) % 24, m: Number(m[2]) % 60 } : inMinutes(60);
  });
  const pickText = `${pad(pick.h)}:${pad(pick.m)}`;

  const setReady = (h: number, m: number) => {
    setPick({ h, m });
    onChange(withReadyTime(value, `${pad(h)}:${pad(m)}`));
  };
  const stepHour = (d: number) => setPick((p) => ({ ...p, h: (p.h + d + 24) % 24 }));
  const stepMin = (d: number) => setPick((p) => ({ ...p, m: (p.m + d + 60) % 60 }));

  const chip =
    'min-h-[44px] px-3.5 rounded-full border text-sm font-bold transition-[transform,background-color,border-color] active:scale-95';
  const lower = value.toLowerCase();

  return (
    <div className="space-y-3">
      {/* Tez izohlar */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Tez izohlar">
        {QUICK_NOTES.map((q) => {
          const on = lower.includes(q.toLowerCase());
          return (
            <button
              key={q}
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onChange(withQuick(value, q))}
              aria-pressed={on}
              data-testid="note-chip"
              className={`${chip} ${
                on ? 'bg-warning text-black border-warning' : 'bg-bg text-text border-border hover:border-warning'
              }`}
            >
              {on ? '✓ ' : '+ '}
              {q}
            </button>
          );
        })}
      </div>

      {/* Tayyor bo'lish vaqti */}
      <div className="rounded-2xl border border-border bg-bg p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-extrabold text-text flex items-center gap-1.5">
            <IconClock className="w-5 h-5 text-warning" />
            Soat nechada tayyor bo‘lsin
          </span>
          {current && (
            <button
              type="button"
              onClick={() => onChange(withoutReadyTime(value))}
              className="h-9 px-3 rounded-lg text-xs font-bold text-danger border border-danger/40 hover:bg-danger/10"
            >
              ⏰ {current} — olib tashlash
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Katta soat / daqiqa tugmalari */}
          <Stepper label="Soat" value={pad(pick.h)} onMinus={() => stepHour(-1)} onPlus={() => stepHour(1)} />
          <span className="text-2xl font-black text-muted">:</span>
          <Stepper label="Daqiqa" value={pad(pick.m)} onMinus={() => stepMin(-5)} onPlus={() => stepMin(5)} />
          <button
            type="button"
            onClick={() => setReady(pick.h, pick.m)}
            data-testid="note-time-set"
            className={`h-12 px-4 rounded-xl font-extrabold flex items-center gap-1.5 active:scale-95 transition-transform ${
              current === pickText ? 'bg-warning text-black' : 'bg-warning/15 text-warning border border-warning/60 hover:bg-warning/25'
            }`}
          >
            ⏰ {pickText} ga
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: '+30 daq', ...inMinutes(30) },
            { label: '+1 soat', ...inMinutes(60) },
          ].map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setReady(p.h, p.m)}
              className="h-11 px-3 rounded-lg border border-warning/60 text-warning font-extrabold text-sm hover:bg-warning/10 active:scale-95"
            >
              {p.label}
            </button>
          ))}
          {READY_HOURS.map((h) => {
            const t = `${pad(h)}:00`;
            return (
              <button
                key={h}
                type="button"
                onClick={() => setReady(h, 0)}
                aria-pressed={current === t}
                className={`h-11 min-w-[60px] px-2 rounded-lg border font-extrabold text-sm tabular-nums active:scale-95 ${
                  current === t ? 'bg-warning text-black border-warning' : 'bg-surface border-border text-text hover:border-warning'
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {/* Erkin matn */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-sm font-bold text-muted">Izoh matni</span>
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted tabular-nums">
              {value.length}/{NOTE_MAX}
            </span>
            {toolbar}
          </span>
        </div>
        <textarea
          ref={textRef}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, NOTE_MAX))}
          onFocus={onTextFocus}
          rows={2}
          maxLength={NOTE_MAX}
          inputMode={suppressSystemKeyboard ? 'none' : undefined}
          placeholder={placeholder ?? 'Masalan: 5 ta somsani mehmon kelganda olib keling'}
          data-testid="line-note-text"
          className="w-full px-3 py-2.5 rounded-xl bg-bg border-2 border-border outline-none focus:border-primary resize-none text-base font-semibold text-text placeholder:font-normal placeholder:text-muted/70"
        />
      </div>
    </div>
  );
}

export const NoteEditor = memo(NoteEditorImpl);

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <span className="flex items-center gap-1" role="group" aria-label={label}>
      <button
        type="button"
        onClick={onMinus}
        aria-label={`${label} kamaytirish`}
        className="w-12 h-12 rounded-xl border border-border bg-surface flex items-center justify-center active:scale-90 hover:border-warning"
      >
        <IconMinus className="w-5 h-5" />
      </button>
      <span className="w-12 text-center text-3xl font-black tabular-nums text-text">{value}</span>
      <button
        type="button"
        onClick={onPlus}
        aria-label={`${label} oshirish`}
        className="w-12 h-12 rounded-xl border border-border bg-surface flex items-center justify-center active:scale-90 hover:border-warning"
      >
        <IconPlus className="w-5 h-5" />
      </button>
    </span>
  );
}
