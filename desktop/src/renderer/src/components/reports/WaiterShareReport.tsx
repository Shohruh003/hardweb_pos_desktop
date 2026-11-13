// "Ofitsiantlar hisoboti" (eski POS'dagi "Ofitsiantlar bo'yicha hisobot", B20/B21):
// Ism | Buyurtmalar summasi | Olib ketish va yetkazish | Xizmat summasi | Ofitsiant ulushi | Taom.
// Mijoz stolga buyurtmada xizmat haqi to'laydi; ofitsiantga stolga buyurtmalar summasining ulush foizi
// tegadi. Sana ‹ › + "Bugun", Kun / Hafta / Oy, foizni shu yerda o'zgartirib ko'rish mumkin (sozlamaga
// yozilmaydi), "Taom" — xodim sotgan taomlar, "Excel" — CSV.
import { memo, useMemo, useState } from 'react';
import type { TopItem, WaiterShareReport as Report, WaiterShareRow } from '@hardweb-pos/shared';
import { usePosSettings } from '../../lib/posSettings';
import { Sheet } from '../waiter/Sheet';
import { IconList, IconUser } from '../waiter/icons';
import { cleanDecimalInput, parseDecimal } from '../numeric';
import { DateNavigator, EmptyState, ErrorLine, RefreshButton, ReportCard } from './parts';
import { RangeMode, buildCsv, downloadCsv, modeRange, num, pct, qty, rangeLabel, todayKey } from './reportUtils';
import { useDebounced, useReportData } from './useReportData';

const ROLE_LABEL: Record<string, string> = {
  ofitsiant: 'Ofitsiant',
  kassir: 'Kassir',
  administrator: 'Administrator',
  direktor: 'Direktor',
};

/** Xizmat haqining haqiqiy foizi (zal foizlari har xil bo'lishi mumkin): 209 160 / 3 486 000 = 6% */
function servicePct(row: { serviceAmount: number; dineInSales: number }): string | null {
  if (row.dineInSales <= 0 || row.serviceAmount <= 0) return null;
  return pct(Math.round((row.serviceAmount / row.dineInSales) * 1000) / 10);
}

export function WaiterShareReport() {
  const pos = usePosSettings();
  const [mode, setMode] = useState<RangeMode>('day');
  const [anchor, setAnchor] = useState(todayKey());
  // Foiz: sozlamadagi qiymat bilan to'ldiriladi; o'zgartirilsa — faqat shu hisobot uchun
  const [percentText, setPercentText] = useState<string | null>(null);
  const [itemsFor, setItemsFor] = useState<WaiterShareRow | null>(null);

  const range = useMemo(() => modeRange(mode, anchor), [mode, anchor]);
  const effectiveText = percentText ?? pct(pos.waiterSharePercent);
  const percent = Math.min(100, Math.max(0, parseDecimal(effectiveText)));
  const debouncedPercent = useDebounced(percent, 400);
  const path =
    `/reports/waiter-shares?from=${range.from}&to=${range.to}` +
    (percentText !== null ? `&sharePercent=${debouncedPercent}` : '');
  const { data, loading, error, forbidden, reload } = useReportData<Report>(path);

  if (forbidden) return null;
  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const shownPercent = data?.sharePercent ?? percent;

  function exportCsv() {
    if (!data) return;
    const header = ['Ism', 'Lavozim', 'Hisoblar soni', 'Buyurtmalar summasi', 'Olib ketish va yetkazish', 'Xizmat summasi', `Ofitsiant ulushi (${pct(data.sharePercent)}%)`];
    const body = data.rows.map((r) => [r.waiterName, ROLE_LABEL[r.role] ?? r.role, r.ordersCount, r.dineInSales, r.takeawaySales, r.serviceAmount, r.shareAmount]);
    const t = data.totals;
    const csv = buildCsv([header, ...body, ['Jami', '', t.ordersCount, t.dineInSales, t.takeawaySales, t.serviceAmount, t.shareAmount]]);
    const name = data.from === data.to ? `ofitsiantlar-${data.from}.csv` : `ofitsiantlar-${data.from}_${data.to}.csv`;
    downloadCsv(name, csv);
  }

  return (
    <ReportCard
      testId="waiter-share-report"
      title="Ofitsiantlar hisoboti"
      icon={<IconUser className="w-5 h-5" strokeWidth={2.4} />}
      actions={
        <>
          <RefreshButton onClick={reload} loading={loading} />
          <button
            type="button"
            onClick={exportCsv}
            disabled={!data || rows.length === 0}
            data-testid="waiter-share-csv"
            className="h-11 px-4 rounded-xl bg-success text-black font-extrabold hover:brightness-105 disabled:opacity-40 inline-flex items-center gap-2"
          >
            <DownloadIcon /> Excel
          </button>
        </>
      }
    >
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <DateNavigator
          mode={mode}
          anchor={anchor}
          onChange={(n) => {
            setMode(n.mode);
            setAnchor(n.anchor);
          }}
          testId="waiter-share-date"
        />
        <label className="flex items-center gap-2 ml-auto">
          <span className="text-sm font-bold text-muted">Ofitsiant ulushi</span>
          <span className="relative">
            <input
              data-testid="waiter-share-percent"
              inputMode="decimal"
              value={effectiveText}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const clean = cleanDecimalInput(e.target.value, 2);
                setPercentText(parseDecimal(clean) > 100 ? '100' : clean);
              }}
              className="w-[92px] h-11 pl-3 pr-8 rounded-xl bg-bg border border-border outline-none focus:border-primary text-lg font-extrabold text-text tabular-nums"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-bold text-muted">%</span>
          </span>
        </label>
      </div>

      <ErrorLine message={error} onRetry={reload} />

      {rows.length === 0 && !loading ? (
        <EmptyState>{data ? `${rangeLabel(range)} — yopilgan hisob yo‘q` : 'Yuklanmoqda…'}</EmptyState>
      ) : (
        <>
          {/* Katta ekran: jadval */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-[15px]" data-testid="waiter-share-table">
              <thead>
                <tr className="bg-bg text-muted text-xs uppercase tracking-wide">
                  <th className="text-left font-bold px-3 py-2.5">Ism</th>
                  <th className="text-right font-bold px-3 py-2.5">Buyurtmalar summasi</th>
                  <th className="text-right font-bold px-3 py-2.5">Olib ketish va yetkazish</th>
                  <th className="text-right font-bold px-3 py-2.5">Xizmat summasi</th>
                  <th className="text-right font-bold px-3 py-2.5">Ofitsiant ulushi</th>
                  <th className="px-3 py-2.5 w-[1%]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <ShareRow key={r.waiterId} row={r} percent={shownPercent} onItems={setItemsFor} />
                ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="bg-primary/10 border-t-2 border-primary/40 font-extrabold text-text" data-testid="waiter-share-total">
                    <td className="px-3 py-3">
                      Jami <span className="text-sm font-bold text-muted">· {totals.ordersCount} ta hisob</span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{num(totals.dineInSales)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{num(totals.takeawaySales)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{num(totals.serviceAmount)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-primary text-lg">{num(totals.shareAmount)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Telefon: kartalar */}
          <div className="md:hidden space-y-2.5">
            {rows.map((r) => (
              <div key={r.waiterId} className="rounded-xl border border-border bg-bg p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-extrabold text-text truncate">{r.waiterName}</div>
                    <div className="text-xs text-muted">
                      {ROLE_LABEL[r.role] ?? r.role} · {r.ordersCount} ta hisob
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-muted">Ulush ({pct(shownPercent)}%)</div>
                    <div className="text-lg font-extrabold text-primary tabular-nums">{num(r.shareAmount)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
                  <MiniStat label="Stolga" value={num(r.dineInSales)} />
                  <MiniStat label="Olib ketish" value={num(r.takeawaySales)} />
                  <MiniStat label="Xizmat" value={num(r.serviceAmount)} />
                </div>
                <button
                  type="button"
                  onClick={() => setItemsFor(r)}
                  className="mt-2 w-full h-11 rounded-xl border border-border font-bold text-text hover:border-primary/60 inline-flex items-center justify-center gap-2"
                >
                  <IconList className="w-4 h-4" /> Taomlar
                </button>
              </div>
            ))}
            {totals && (
              <div className="rounded-xl border-2 border-primary/40 bg-primary/10 p-3 font-extrabold flex items-center justify-between">
                <span>Jami · {totals.ordersCount} ta hisob</span>
                <span className="text-primary text-lg tabular-nums">{num(totals.shareAmount)}</span>
              </div>
            )}
          </div>
          <div className="text-xs text-muted mt-3 leading-relaxed">
            Buyurtmalar summasi — stolga buyurtmalarning zalda yeyilgan taomlari (xizmat haqisiz). Olib ketish va
            yetkazish — shu buyurtmalar va stoldan olib ketilgan (saboy) taomlar. Faqat yopilgan, vozvrat qilinmagan
            hisoblar. Ulush = buyurtmalar summasi × {pct(shownPercent)}%.
          </div>
        </>
      )}

      {itemsFor && <WaiterItemsSheet row={itemsFor} from={range.from} to={range.to} onClose={() => setItemsFor(null)} />}
    </ReportCard>
  );
}

const ShareRow = memo(function ShareRow({
  row,
  percent,
  onItems,
}: {
  row: WaiterShareRow;
  percent: number;
  onItems: (r: WaiterShareRow) => void;
}) {
  const sp = servicePct(row);
  return (
    <tr className="hover:bg-surface-hover" data-testid="waiter-share-row" data-name={row.waiterName}>
      <td className="px-3 py-2.5">
        <div className="font-bold text-text">{row.waiterName}</div>
        <div className="text-xs text-muted">
          {ROLE_LABEL[row.role] ?? row.role} · {row.ordersCount} ta hisob
        </div>
      </td>
      <td className="px-3 py-2.5 text-right font-bold tabular-nums">{num(row.dineInSales)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{num(row.takeawaySales)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {num(row.serviceAmount)}
        {sp && <span className="text-xs text-muted font-semibold"> ({sp}%)</span>}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        <span className="font-extrabold text-primary">{num(row.shareAmount)}</span>
        <span className="text-xs text-muted font-semibold"> ({pct(percent)}%)</span>
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => onItems(row)}
          data-testid="waiter-share-items"
          className="h-10 px-3 rounded-lg border border-border font-bold text-text hover:border-primary/60 hover:bg-surface inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <IconList className="w-4 h-4" /> Taom
        </button>
      </td>
    </tr>
  );
});

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface border border-border px-2 py-1.5 min-w-0">
      <div className="text-[11px] font-bold text-muted truncate">{label}</div>
      <div className="font-bold text-text tabular-nums truncate">{value}</div>
    </div>
  );
}

type ItemRow = TopItem & { unit?: string | null };

/** "Taom" oynasi — shu xodim oraliqda sotgan taomlar (summa bo'yicha) */
function WaiterItemsSheet({ row, from, to, onClose }: { row: WaiterShareRow; from: string; to: string; onClose: () => void }) {
  const { data, loading, error, reload } = useReportData<ItemRow[]>(
    `/reports/waiter-items?waiterId=${encodeURIComponent(row.waiterId)}&from=${from}&to=${to}`,
  );
  const items = data ?? [];
  const total = items.reduce((s, i) => s + (Number(i.sum) || 0), 0);
  return (
    <Sheet
      title={row.waiterName}
      subtitle={`Sotilgan taomlar · ${rangeLabel({ from, to })}`}
      icon={<IconList className="w-5 h-5" />}
      onClose={onClose}
      size="md"
      testId="waiter-items-sheet"
    >
      <ErrorLine message={error} onRetry={reload} />
      {items.length === 0 ? (
        <EmptyState>{loading ? 'Yuklanmoqda…' : 'Taom yo‘q'}</EmptyState>
      ) : (
        <div className="rounded-xl border border-border divide-y divide-border">
          {items.map((it) => (
            <div key={it.name} className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-[64px] text-primary font-extrabold tabular-nums">{qty(it.quantity, it.unit)}</span>
              <span className="flex-1 min-w-0 font-semibold text-text truncate">{it.name}</span>
              <span className="font-bold tabular-nums">{num(it.sum)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-3 py-3 bg-bg font-extrabold">
            <span>Jami</span>
            <span className="tabular-nums">{num(total)} so‘m</span>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Yuklab olish belgisi */
function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />
    </svg>
  );
}
