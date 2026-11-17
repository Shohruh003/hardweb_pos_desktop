import { ORDER_TYPES, ORDER_TYPE_LABELS, OrderType, ReportSummary, roundSum } from '@hardweb-pos/shared';
import { formatSum } from '../ui';
import { OrderTypeIcon, TYPE_STYLE } from './orderType';

type ByType = NonNullable<ReportSummary['byOrderType']>;

// "Buyurtma turlari" — stolga / olib ketish / yetkazib berish bo'yicha yopilgan cheklar soni,
// tushumi va tushumdagi ulushi (%). Uchala tur doim ko'rsatiladi (nol bo'lsa ham).
// Har kartochkada nom + ikonka bor — tur faqat rang bilan ajratilmaydi; raqamlar matn rangida.
export function OrderTypeBreakdown({ data, className = '' }: { data: ByType | undefined; className?: string }) {
  // Eski server (byOrderType yo'q) — bo'lim ko'rsatilmaydi
  if (!Array.isArray(data)) return null;
  const rows = ORDER_TYPES.map((type) => {
    const r = data.find((x) => x?.type === type);
    // Vozvrat kuni (0.3.3) summa/son manfiy bo'lishi mumkin — raqam qanday bo'lsa shunday, ulush esa
    // faqat musbat tushumdan
    return { type, count: Number(r?.count) || 0, amount: roundSum(r?.amount) };
  });
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const totalCount = rows.reduce((s, r) => s + r.count, 0);
  const positiveTotal = rows.reduce((s, r) => s + Math.max(0, r.amount), 0);

  return (
    <div className={`bg-surface border border-border rounded-2xl p-4 sm:p-5 ${className}`} data-testid="order-type-breakdown">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <div className="font-bold text-text">Buyurtma turlari</div>
        <div className="text-xs text-muted">
          {totalCount} ta chek · {formatSum(totalAmount)}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {rows.map((r) => {
          const style = TYPE_STYLE[r.type as OrderType];
          const share = positiveTotal > 0 && r.amount > 0 ? (r.amount / positiveTotal) * 100 : 0;
          const shareText = `${share >= 10 || share === 0 ? Math.round(share) : share.toFixed(1)}%`;
          return (
            <div key={r.type} className="rounded-xl border border-border bg-bg p-3.5" data-testid={`order-type-${r.type}`}>
              <div className="flex items-center gap-2.5">
                <span className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${style.soft} ${style.text}`}>
                  <OrderTypeIcon type={r.type} className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <div className="font-bold text-text leading-tight truncate">{ORDER_TYPE_LABELS[r.type]}</div>
                  <div className="text-xs text-muted">{r.count} ta buyurtma</div>
                </div>
                <div className="ml-auto text-lg font-extrabold text-text">{shareText}</div>
              </div>
              <div className={`mt-3 text-xl font-extrabold truncate ${r.amount < 0 ? 'text-danger' : 'text-text'}`}>{formatSum(r.amount)}</div>
              <div
                className="mt-2 h-2.5 rounded-full bg-surface border border-border overflow-hidden"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(share)}
                aria-label={`${ORDER_TYPE_LABELS[r.type]} — tushumdagi ulushi`}
              >
                <div
                  className={`h-full rounded-full ${style.bar} transition-[width] duration-700 ease-out`}
                  style={{ width: `${share}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
