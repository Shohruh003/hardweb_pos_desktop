// Stollar to'ri (eski POS'dagidek, B23 / D4). Plitkada: chap yuqorida KATTA raqam (belgisiz),
// o'ng yuqorida jami summa, ofitsiant, ochilgan vaqt, chek berilgan vaqt va holat yorlig'i.
// Ranglar uzoqdan (2 m) ham tanilsin — TO'Q (solid) ranglar:
//   bo'sh          — oq/tinch fon, katta "+" va "bo‘sh" yorlig'i;
//   band           — to'q YASHIL, oq matn;
//   chek berildi   — to'q SARIQ, qora matn ("chek berildi" yorlig'i);
//   tayyor         — yashil + "tayyor" (hamma taom tayyor).
// Ofitsiantning o'z stollari — "SIZ" belgisi va oq hoshiya. Bir stolda 2+ hisob — "2 hisob".
// Ofitsiant boshqa ofitsiant stolining summasini ko'rmaydi (0.3.3) — faqat kassa (hideOthersSums=false).
// React.memo: savat yoki boshqa holat o'zgarganda plitkalar qayta chizilmaydi.
import { CSSProperties, memo } from 'react';
import { Order, OrderStatus, Table, TableStatus } from '@hardweb-pos/shared';
import { minutesSince } from '../ui';
import { elapsedLabel, firstName, formatAmount, hhmm, payableTotal } from './orderUi';
import { IconClock, IconCloudUp, IconPlus, IconPrinter, IconUser } from './icons';

// Avtomatik ustunlar: telefonda ~112 px (3 ta), 1366 px monoblokda ~130 px (9 ta), 1920 px da ~170 px (10 ta)
const GRID_STYLE: CSSProperties = {
  gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(108px, 9.2vw, 176px), 1fr))',
};

type Tone = 'free' | 'busy' | 'bill';

const TONE_CLASS: Record<Tone, string> = {
  free: 'bg-surface border-border text-text hover:border-primary/70',
  // Oq matn o'qilishi uchun to'qroq yashil (primary-hover) + yengil soya
  busy: 'bg-primary-hover border-primary-hover text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.3)] hover:brightness-110',
  // Eski POS'dagidek yorqin sariq (ikkala temada bir xil) + qora matn
  bill: 'bg-bill border-bill text-black hover:brightness-105',
};

/** Ranglar izohi (stollar ustida) — yangi xodim ham tez tushunsin */
export const TableLegend = memo(function TableLegend() {
  const dot = (cls: string) => <span className={`w-3.5 h-3.5 rounded-md border ${cls}`} />;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold text-muted">
      <span className="flex items-center gap-1.5">{dot('border-border bg-surface')}Bo‘sh</span>
      <span className="flex items-center gap-1.5">{dot('border-primary-hover bg-primary-hover')}Band</span>
      <span className="flex items-center gap-1.5">{dot('border-bill bg-bill')}Chek berildi</span>
      <span className="flex items-center gap-1.5">
        <span className="rounded-md bg-white text-black border border-border px-1 text-[10px] font-black leading-4">SIZ</span>
        Sizning stolingiz
      </span>
    </div>
  );
});

export interface TableGridProps {
  /** stollar (raqam bo'yicha tartiblangan) */
  tables: Table[];
  /** stol id -> shu stoldagi ochiq hisoblar (checkNo bo'yicha tartiblangan) */
  checksByTable: Map<string, Order[]>;
  /** oflayn navbatda yuborilmagan buyurtmasi bor stollar */
  queuedTableIds: Set<string>;
  myId: string;
  /** joriy vaqt (daqiqaga yaxlitlangan) — "necha daqiqa ochiq" uchun */
  now: number;
  onOpen: (table: Table) => void;
  /** ofitsiant ekrani: boshqa ofitsiant stolining summasi ko'rsatilmaydi */
  hideOthersSums?: boolean;
}

const NO_CHECKS: Order[] = [];

function TableGridImpl({ tables, checksByTable, queuedTableIds, myId, now, onOpen, hideOthersSums }: TableGridProps) {
  return (
    <div className="grid gap-2 sm:gap-2.5" style={GRID_STYLE}>
      {tables.map((t) => {
        const checks = checksByTable.get(t.id) ?? NO_CHECKS;
        return (
          <TableTile
            key={t.id}
            table={t}
            checks={checks}
            myId={myId}
            queued={queuedTableIds.has(t.id)}
            // Bo'sh stol vaqtga bog'liq emas — har daqiqada qayta chizilmasin
            now={checks.length ? now : 0}
            onOpen={onOpen}
            hideOthersSums={!!hideOthersSums}
          />
        );
      })}
    </div>
  );
}

export const TableGrid = memo(TableGridImpl);

/**
 * "Barcha" bo'limi: har zal — "# ZAL" sarlavhasi (band/jami soni) va o'z stollari. Zallar sozlamadagi
 * tartibda. Har zal to'ri alohida memo — bitta stol o'zgarsa faqat o'sha zal qayta chiziladi.
 */
export const HallSections = memo(function HallSections({
  halls,
  tablesByHall,
  busyByHall,
  ...grid
}: Omit<TableGridProps, 'tables'> & {
  halls: string[];
  tablesByHall: Map<string, Table[]>;
  busyByHall: Map<string, number>;
}) {
  return (
    <div className="space-y-4">
      {halls.map((h) => {
        const list = tablesByHall.get(h) ?? [];
        if (!list.length) return null;
        const busy = busyByHall.get(h) ?? 0;
        return (
          <section key={h} aria-label={h} data-testid={`hall-section-${h}`}>
            <h2 className="flex items-baseline gap-2 mb-1.5 px-0.5">
              <span className="text-muted font-black text-lg leading-none">#</span>
              <span className="font-black text-lg uppercase tracking-wide leading-none text-text">{h}</span>
              <span className="text-xs font-bold text-muted">
                {list.length} ta stol
                {busy > 0 && <span className="text-primary"> · {busy} band</span>}
              </span>
            </h2>
            <TableGrid tables={list} {...grid} />
          </section>
        );
      })}
    </div>
  );
});

/** Plitka faqat o'z ma'lumoti o'zgarganda qayta chiziladi (hisoblar ro'yxati elementma-element taqqoslanadi) */
function sameTile(a: TileProps, b: TileProps): boolean {
  if (a.table !== b.table || a.myId !== b.myId || a.queued !== b.queued || a.now !== b.now || a.onOpen !== b.onOpen) return false;
  if (a.hideOthersSums !== b.hideOthersSums) return false;
  if (a.checks === b.checks) return true;
  if (a.checks.length !== b.checks.length) return false;
  return a.checks.every((c, i) => c === b.checks[i]);
}

interface TileProps {
  table: Table;
  checks: Order[];
  myId: string;
  queued: boolean;
  now: number;
  onOpen: (table: Table) => void;
  hideOthersSums: boolean;
}

const TableTile = memo(function TableTile({ table, checks, myId, queued, now, onOpen, hideOthersSums }: TileProps) {
  const busy = checks.length > 0 || table.status !== TableStatus.Free;
  // "Chek berildi": barcha ochiq hisoblarga schot chiqarilgan. Server billPrintedAt bermasa (eski
  // versiya) — stol holati "hisob kutilmoqda" bo'yicha
  const knowsBill = checks.some((c) => c.billPrintedAt !== undefined);
  const billGiven = busy && (knowsBill ? checks.length > 0 && checks.every((c) => !!c.billPrintedAt) : table.status === TableStatus.AwaitingBill);
  const ready = checks.length > 0 && checks.every((c) => c.status === OrderStatus.Ready);
  const tone: Tone = !busy ? 'free' : billGiven ? 'bill' : 'busy';
  const mine = checks.some((c) => c.waiterId === myId);
  const total = checks.reduce((s, c) => s + payableTotal(c), 0);
  // Summa — faqat o'z stoli (barcha hisoblar shu ofitsiantniki) yoki kassa darajasidagi xodimga
  const sumVisible = !hideOthersSums || checks.every((c) => !c.waiterId || c.waiterId === myId);
  const names = Array.from(new Set(checks.map((c) => firstName(c.waiterName)).filter(Boolean)));
  const openedAt = checks.reduce<string | null>((min, c) => (!min || c.openedAt < min ? c.openedAt : min), null);
  const billAt = checks.reduce<string | null>(
    (max, c) => (c.billPrintedAt && (!max || c.billPrintedAt > max) ? c.billPrintedAt : max),
    null,
  );
  const mins = openedAt && now ? minutesSince(openedAt, now) : 0;
  const status = !busy ? 'bo‘sh' : billGiven ? 'chek berildi' : ready ? 'tayyor' : 'band';
  const statusLabel = `Stol ${table.number}: ${status}${checks.length > 1 ? `, ${checks.length} hisob` : ''}${mine ? ', sizniki' : ''}`;

  return (
    <button
      type="button"
      onClick={() => onOpen(table)}
      data-testid={`table-${table.number}`}
      data-status={busy ? (billGiven ? 'bill' : ready ? 'ready' : 'busy') : 'free'}
      data-checks={checks.length || undefined}
      data-mine={mine ? '1' : undefined}
      aria-label={statusLabel}
      className={`relative h-[124px] sm:h-[128px] rounded-2xl border-2 p-2 flex flex-col text-left select-none transition-[transform,filter,border-color] duration-150 active:scale-[0.96] focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/50 ${TONE_CLASS[tone]} ${
        mine && busy ? 'ring-[3px] ring-offset-2 ring-offset-bg ring-text/70' : ''
      }`}
    >
      {/* Yuqori qator: raqam (chapda, katta) | summa va hisoblar soni (o'ngda) */}
      <span className="flex items-start justify-between gap-1 min-w-0">
        <span className="text-[32px] sm:text-[36px] font-black leading-[0.9] tracking-tight tabular-nums shrink-0">
          {table.number}
        </span>
        {busy && checks.length > 0 ? (
          <span className="min-w-0 flex flex-col items-end gap-0.5 pt-0.5">
            {sumVisible && (
              <span data-testid="table-total" className="text-[15px] font-black leading-none tabular-nums truncate max-w-full">
                {formatAmount(total)}
              </span>
            )}
            {checks.length > 1 && (
              <span
                data-testid="table-checks"
                className={`rounded-md px-1.5 text-[11px] font-black leading-[18px] whitespace-nowrap ${
                  tone === 'bill' ? 'bg-black/80 text-bill' : 'bg-white text-primary-hover'
                } [text-shadow:none]`}
              >
                {checks.length} hisob
              </span>
            )}
          </span>
        ) : !busy ? (
          <span className="text-[11px] font-bold text-muted leading-none pt-1 whitespace-nowrap">{table.capacity} kishi</span>
        ) : null}
      </span>

      {busy ? (
        <span className="mt-auto w-full min-w-0 space-y-0.5 text-[12px] font-bold leading-tight">
          <span className="flex items-center gap-1 min-w-0">
            <IconUser className="w-3.5 h-3.5 shrink-0" strokeWidth={2.4} />
            {mine ? (
              <span className="rounded bg-white text-black px-1 text-[11px] font-black leading-4 [text-shadow:none]">SIZ</span>
            ) : (
              <span className="truncate">{names.length ? names.join(', ') : '—'}</span>
            )}
          </span>
          <span className="flex items-center gap-0.5 sm:gap-1 min-w-0 overflow-hidden whitespace-nowrap tabular-nums text-[11px] sm:text-[12px]">
            <IconClock className="w-3.5 h-3.5 shrink-0" strokeWidth={2.4} />
            {hhmm(openedAt) || '—'}
            {billAt ? (
              <>
                <IconPrinter className="w-3.5 h-3.5 shrink-0 ml-0.5 sm:ml-1" strokeWidth={2.4} />
                {hhmm(billAt)}
              </>
            ) : (
              mins > 0 && <span className="opacity-90 truncate">· {elapsedLabel(mins)}</span>
            )}
          </span>
        </span>
      ) : (
        // Bo'sh stol: katta "+" — bosib darhol buyurtma ochiladi
        <span className="flex-1 flex items-center justify-center">
          <span className="w-10 h-10 rounded-full border-2 border-primary/40 text-primary flex items-center justify-center">
            <IconPlus className="w-6 h-6" />
          </span>
        </span>
      )}

      {/* Holat yorlig'i (pastda, butun en bo'ylab) */}
      <span
        className={`mt-1 w-full rounded-lg text-center text-[12px] font-extrabold leading-[19px] truncate px-1 [text-shadow:none] ${
          !busy
            ? 'bg-bg text-muted border border-border'
            : billGiven
              ? 'bg-black/80 text-bill'
              : ready
                ? 'bg-white text-primary-hover'
                : 'bg-black/25 text-white'
        }`}
      >
        {ready && !billGiven && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary-hover mr-1 align-middle animate-pulse" />}
        {status}
      </span>

      {queued && (
        <span
          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-warning text-black flex items-center justify-center shadow [text-shadow:none]"
          title="Oflayn navbatda yuborilmagan buyurtma bor"
        >
          <IconCloudUp className="w-4 h-4" strokeWidth={2.4} />
        </span>
      )}
    </button>
  );
}, sameTile);
