// Ishlab chiqarish — mahsulotlardan yarim tayyor mahsulot (un + suv → xamir, go'sht → qiyma).
// Bitta so'rov (POST /inventory/production): ketganlar ayiriladi, tayyor mahsulot qo'shiladi — hammasi
// bitta tranzaksiyada (yarmi bajarilib qolmaydi). Tannarx jonli: Σ(miqdor × o'rtacha tannarx) / chiqish.
import { useMemo, useState } from 'react';
import {
  PRODUCTION_INPUTS_REQUIRED_MESSAGE,
  PRODUCTION_OUTPUT_REQUIRED_MESSAGE,
  PRODUCTION_SELF_MESSAGE,
  Product,
  nextAvgCost,
  roundStockCost,
  roundStockQty,
  stockNotEnoughMessage,
} from '@hardweb-pos/shared';
import { Modal } from '../../../components/Modal';
import { Select } from '../../../components/Select';
import { parseDecimal } from '../../../components/numeric';
import { api } from '../../../lib/api';
import { Field, FormError, FormWarning, InfoRow, ModalFooter, QtyInput, TextInput, useSubmit } from './skladUi';
import { costText, productCost, qtyText } from './skladUtils';

interface InputRow {
  key: number;
  productId: string;
  qty: string;
}

let rowSeq = 0;
const newRow = (): InputRow => ({ key: ++rowSeq, productId: '', qty: '' });

export function ProductionModal({ products, onClose, onDone }: { products: Product[]; onClose: () => void; onDone: (message: string) => void }) {
  const [outId, setOutId] = useState('');
  const [outQty, setOutQty] = useState('');
  const [rows, setRows] = useState<InputRow[]>(() => [newRow()]);
  const [note, setNote] = useState('');
  const { busy, error, setError, run } = useSubmit();

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p] as const)), [products]);
  const out = byId.get(outId);
  const outQ = roundStockQty(parseDecimal(outQty));

  // Bir mahsulot ikki qatorda bo'lsa — qo'shib yuboriladi (qoldiq tekshiruvi ham jami bo'yicha)
  const inputs = useMemo(() => {
    const merged = new Map<string, number>();
    for (const r of rows) {
      const q = roundStockQty(parseDecimal(r.qty));
      if (r.productId && q > 0) merged.set(r.productId, roundStockQty((merged.get(r.productId) ?? 0) + q));
    }
    return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
  }, [rows]);

  const inputCost = inputs.reduce((s, i) => s + i.quantity * productCost(byId.get(i.productId)), 0);
  const unitCost = outQ > 0 ? roundStockCost(inputCost / outQ) : 0;
  const newAvg = out && outQ > 0 ? nextAvgCost(Number(out.stock) || 0, productCost(out), outQ, unitCost) : 0;

  let problem = '';
  if (outId && inputs.some((i) => i.productId === outId)) problem = PRODUCTION_SELF_MESSAGE;
  else {
    for (const i of inputs) {
      const p = byId.get(i.productId);
      if (p && i.quantity > roundStockQty(p.stock)) {
        problem = stockNotEnoughMessage(p.name, Number(p.stock) || 0, p.unit);
        break;
      }
    }
  }
  const ready = !!out && outQ > 0 && inputs.length > 0 && !problem;

  const options = useMemo(
    () => products.map((p) => ({ value: p.id, label: `${p.name} — ${qtyText(p.stock)} ${p.unit}` })),
    [products],
  );

  function patchRow(key: number, patch: Partial<InputRow>) {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function submit() {
    if (!out || !(outQ > 0)) {
      setError(PRODUCTION_OUTPUT_REQUIRED_MESSAGE);
      return;
    }
    if (!inputs.length) {
      setError(PRODUCTION_INPUTS_REQUIRED_MESSAGE);
      return;
    }
    if (problem) {
      setError(problem);
      return;
    }
    await run(async () => {
      await api.post('/inventory/production', {
        outputProductId: out.id,
        outputQty: outQ,
        inputs,
        note: note.trim() || undefined,
      });
      onDone(`Ishlab chiqarildi: +${qtyText(outQ)} ${out.unit} ${out.name}`);
    }, 'Ishlab chiqarish saqlanmadi');
  }

  return (
    <Modal title="🏭 Ishlab chiqarish" wide onClose={() => !busy && onClose()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
        data-testid="production-modal"
      >
        <div className="text-sm text-muted">
          Ketgan mahsulotlar skladdan ayiriladi, tayyor mahsulot qo‘shiladi (masalan: un + suv → xamir). Hammasi birga
          saqlanadi — yarmi bajarilib qolmaydi.
        </div>

        {products.length < 2 ? (
          <FormWarning>Ishlab chiqarish uchun kamida 2 ta mahsulot kerak (masalan «Un» va «Xamir»).</FormWarning>
        ) : (
          <>
            <div className="rounded-2xl border-2 border-danger/30 bg-danger/5 p-3">
              <div className="text-xs font-extrabold text-danger mb-2 uppercase tracking-wide">Ketgan mahsulotlar (chiqim)</div>
              <div className="space-y-2">
                {rows.map((r, i) => {
                  const p = byId.get(r.productId);
                  const q = roundStockQty(parseDecimal(r.qty));
                  const lineCost = p && q > 0 ? Math.round(q * productCost(p)) : 0;
                  return (
                    <div key={r.key} className="flex flex-wrap items-center gap-2">
                      <div className="flex-1 min-w-[180px]" data-testid={`prod-in-${i}`}>
                        <Select value={r.productId} onChange={(v) => patchRow(r.key, { productId: v })} options={options} placeholder="Mahsulotni tanlang" />
                      </div>
                      <QtyInput
                        value={r.qty}
                        onChange={(v) => patchRow(r.key, { qty: v })}
                        unit={p?.unit}
                        placeholder="miqdor"
                        testId={`prod-in-qty-${i}`}
                        ariaLabel="Ketgan miqdor"
                        className="w-32"
                      />
                      <span className="w-24 text-right text-sm text-muted tabular-nums">{lineCost > 0 ? costText(lineCost) : ''}</span>
                      <button
                        type="button"
                        onClick={() => setRows((list) => (list.length > 1 ? list.filter((x) => x.key !== r.key) : [newRow()]))}
                        aria-label="Qatorni olib tashlash"
                        className="w-11 h-11 rounded-xl border border-border bg-bg text-danger hover:bg-danger/10 shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setRows((list) => [...list, newRow()])}
                data-testid="prod-add-row"
                className="mt-2 h-11 px-3 rounded-xl border-2 border-dashed border-border text-text font-bold hover:border-primary/60"
              >
                + Mahsulot qo‘shish
              </button>
            </div>

            <div className="rounded-2xl border-2 border-success/40 bg-success/5 p-3">
              <div className="text-xs font-extrabold text-success mb-2 uppercase tracking-wide">Tayyor mahsulot (kirim)</div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-[180px]" data-testid="prod-out">
                  <Select value={outId} onChange={setOutId} options={options} placeholder="Nima tayyorlandi?" />
                </div>
                <QtyInput value={outQty} onChange={setOutQty} unit={out?.unit} placeholder="miqdor" testId="prod-out-qty" ariaLabel="Tayyor miqdor" className="w-32" />
              </div>
            </div>

            <Field label="Izoh (ixtiyoriy)">
              <TextInput value={note} onChange={setNote} placeholder="Masalan: ertalabki xamir" testId="prod-note" ariaLabel="Izoh" />
            </Field>

            <div className="rounded-xl border border-border bg-bg px-3 py-1.5">
              <InfoRow label="Ketgan mahsulotlar tannarxi" value={costText(Math.round(inputCost))} />
              {out && outQ > 0 && (
                <>
                  <InfoRow label={`Tayyor mahsulot tannarxi (1 ${out.unit})`} value={costText(unitCost)} testId="prod-unit-cost" />
                  <InfoRow label={`«${out.name}» yangi qoldig‘i`} value={`${qtyText(roundStockQty((Number(out.stock) || 0) + outQ))} ${out.unit}`} tone="success" />
                  {unitCost > 0 && <InfoRow label="Yangi o‘rtacha tannarx" value={`${costText(newAvg)}/${out.unit}`} />}
                </>
              )}
              {inputs.some((i) => productCost(byId.get(i.productId)) === 0) && (
                <div className="text-xs text-muted pb-1">Tannarxi yo‘q mahsulotlar hisobga 0 so‘m bo‘lib kiradi.</div>
              )}
            </div>
            {problem && <FormWarning testId="prod-problem">{problem}</FormWarning>}
          </>
        )}

        <FormError message={error} />
        <ModalFooter onCancel={onClose} busy={busy} submitLabel="✔ Tayyorlash" busyLabel="Tayyorlanmoqda…" disabled={!ready} testId="prod-save" />
      </form>
    </Modal>
  );
}
