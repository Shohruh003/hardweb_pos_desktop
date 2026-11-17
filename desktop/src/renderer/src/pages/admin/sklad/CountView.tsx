// Inventarizatsiya — sanab chiqilgan haqiqiy qoldiqni kiritish. Faqat kiritilgan qatorlar BITTA so'rovda
// yuboriladi (POST /inventory/count): server farqni o'z tranzaksiyasi ichidagi qoldiqdan hisoblaydi,
// shuning uchun xato yoki qayta bosish ikki marta qo'shmaydi. Bo'sh qoldirilgan mahsulot o'zgarmaydi.
import { useMemo, useRef, useState } from 'react';
import { COUNT_ITEMS_REQUIRED_MESSAGE, Product, StockMovement, roundStockQty } from '@hardweb-pos/shared';
import { formatSum } from '../../../components/ui';
import { parseDecimal } from '../../../components/numeric';
import { api } from '../../../lib/api';
import { useConfirm } from '../../../state/confirm';
import { Spinner } from '../../../components/waiter/Sheet';
import { BackButton, FormError, QtyInput, TextInput, searchCls, useSubmit } from './skladUi';
import { productCost, qtyText, searchKey, signedQtyText } from './skladUtils';

export interface CountResult {
  changed: number;
  movements?: StockMovement[];
}

export function CountView({
  products,
  onCancel,
  onSaved,
}: {
  products: Product[];
  onCancel: () => void;
  onSaved: (changed: number, entered: number) => void;
}) {
  const confirm = useConfirm();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [onlyEntered, setOnlyEntered] = useState(false);
  const [note, setNote] = useState('');
  const { busy, error, setError, run } = useSubmit();
  const confirming = useRef(false);

  const entered = useMemo(
    () =>
      products
        .filter((p) => (counts[p.id] ?? '') !== '')
        .map((p) => ({ product: p, actual: roundStockQty(parseDecimal(counts[p.id])) })),
    [products, counts],
  );
  const changed = entered.filter((e) => e.actual !== roundStockQty(e.product.stock));
  const valueDiff = changed.reduce((s, e) => s + (e.actual - (Number(e.product.stock) || 0)) * productCost(e.product), 0);

  const shown = useMemo(() => {
    const q = searchKey(search);
    return products.filter((p) => (!q || searchKey(p.name).includes(q)) && (!onlyEntered || (counts[p.id] ?? '') !== ''));
  }, [products, search, onlyEntered, counts]);

  async function leave() {
    if (busy) return;
    if (entered.length > 0) {
      const ok = await confirm({
        title: 'Inventarizatsiyadan chiqish',
        message: `${entered.length} ta mahsulot sanog‘i kiritilgan — saqlanmaydi. Chiqilsinmi?`,
        confirmText: 'Chiqish',
        danger: true,
      });
      if (!ok) return;
    }
    onCancel();
  }

  async function save() {
    if (busy || confirming.current) return;
    if (!entered.length) {
      setError(COUNT_ITEMS_REQUIRED_MESSAGE);
      return;
    }
    confirming.current = true;
    let ok = false;
    try {
      ok = await confirm({
        title: 'Inventarizatsiyani saqlash',
        message:
          changed.length > 0
            ? `${entered.length} ta mahsulot sanog‘i saqlanadi: ${changed.length} tasida qoldiq sanalgan miqdorga tenglashtiriladi.`
            : `${entered.length} ta mahsulot sanog‘i saqlanadi — farq yo‘q, qoldiqlar o‘zgarmaydi.`,
        confirmText: 'Saqlash',
      });
    } finally {
      confirming.current = false;
    }
    if (!ok) return;
    await run(async () => {
      const r = await api.post<CountResult>('/inventory/count', {
        items: entered.map((e) => ({ productId: e.product.id, actual: e.actual })),
        note: note.trim() || undefined,
      });
      onSaved(Number(r?.changed) || 0, entered.length);
    }, 'Inventarizatsiya saqlanmadi');
  }

  return (
    <div data-testid="count-view">
      {/* Uzun ro'yxatda ham "Saqlash" ko'rinib tursin — sarlavha qatori yuqoriga yopishadi */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-6 px-3 sm:px-6 py-2.5 mb-3 bg-bg border-b border-border flex flex-wrap items-center gap-2">
        <BackButton onClick={leave} label="Bekor" testId="count-cancel" />
        <div className="text-xl font-extrabold text-text mr-auto">📋 Inventarizatsiya</div>
        <button
          type="button"
          onClick={save}
          disabled={busy || entered.length === 0}
          data-testid="count-save"
          className="h-11 px-5 rounded-xl bg-primary hover:bg-primary-hover text-white font-extrabold inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy && <Spinner className="w-5 h-5 border-white" />}
          {busy ? 'Saqlanmoqda…' : `✔ Saqlash${entered.length ? ` (${entered.length})` : ''}`}
        </button>
      </div>

      <div className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5 text-sm text-text mb-3">
        Har bir mahsulotning <b>sanab chiqilgan haqiqiy</b> qoldig‘ini kiriting. Bo‘sh qoldirilgani o‘zgarmaydi. Farq yashil (+)
        yoki qizil (−) bo‘lib ko‘rinadi va jurnalga «Inventarizatsiya» bo‘lib yoziladi.
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 Mahsulot qidirish…"
          aria-label="Mahsulot qidirish"
          className={searchCls}
        />
        <button
          type="button"
          onClick={() => setOnlyEntered((v) => !v)}
          aria-pressed={onlyEntered}
          className={`h-11 px-3.5 rounded-xl border-2 font-bold ${
            onlyEntered ? 'bg-primary-hover border-primary-hover text-white' : 'bg-surface border-border text-text hover:border-primary/60'
          }`}
        >
          Faqat kiritilganlar ({entered.length})
        </button>
      </div>

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden mb-3">
        {shown.length === 0 ? (
          <div className="p-8 text-center text-muted font-semibold">Mahsulot topilmadi.</div>
        ) : (
          shown.map((p) => {
            const raw = counts[p.id] ?? '';
            const actual = raw === '' ? null : roundStockQty(parseDecimal(raw));
            const diff = actual === null ? 0 : roundStockQty(actual - (Number(p.stock) || 0));
            return (
              <div key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 ${raw !== '' ? 'bg-primary/5' : ''}`}>
                <div className="min-w-0 flex-1 basis-[180px]">
                  <div className="font-bold text-text break-words">{p.name}</div>
                  <div className="text-sm text-muted">
                    Hisobda: <b className="text-text tabular-nums">{qtyText(p.stock)} {p.unit}</b>
                  </div>
                </div>
                <div className="w-28 text-right font-extrabold tabular-nums" data-testid="count-diff">
                  {actual === null ? (
                    ''
                  ) : diff === 0 ? (
                    <span className="text-muted">farq yo‘q</span>
                  ) : (
                    <span className={diff > 0 ? 'text-success' : 'text-danger'}>
                      {signedQtyText(diff)} {p.unit}
                    </span>
                  )}
                </div>
                <div className="w-36 shrink-0" data-testid="count-row" data-product={p.name}>
                  <QtyInput
                    value={raw}
                    onChange={(v) => setCounts((c) => ({ ...c, [p.id]: v }))}
                    unit={p.unit}
                    placeholder="sanoq"
                    testId="count-input"
                    ariaLabel={`${p.name} — sanalgan qoldiq`}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <div className="text-sm font-bold text-muted mb-1.5">Izoh (ixtiyoriy)</div>
          <TextInput value={note} onChange={setNote} placeholder="Masalan: oy oxiri sanog‘i" testId="count-note" ariaLabel="Inventarizatsiya izohi" />
        </div>
        <div className="rounded-xl border border-border bg-surface px-4 py-2 text-sm min-w-[220px]">
          <div className="flex justify-between gap-3">
            <span className="text-muted">Kiritildi</span>
            <b className="text-text">{entered.length} ta</b>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted">Farq bor</span>
            <b className="text-text">{changed.length} ta</b>
          </div>
          {changed.length > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-muted">Farq qiymati</span>
              <b className={valueDiff < 0 ? 'text-danger' : 'text-success'}>{formatSum(Math.round(valueDiff))}</b>
            </div>
          )}
        </div>
      </div>
      <FormError message={error} />
    </div>
  );
}
