// Sklad: mahsulotlar ro'yxati — qidiruv, "kam qolgan" filtri, ombor qiymati, har qatorda qoldiq,
// o'rtacha tannarx, qiymat, retseptlar soni va amallar (Kirim / Chiqim / Tahrirlash / O‘chirish).
// Qator nomi bosilsa — shu mahsulotning harakatlar jurnali ochiladi.
import { memo, useMemo, useState } from 'react';
import { Product } from '@hardweb-pos/shared';
import { formatSum } from '../../../components/ui';
import { PencilIcon, TrashIcon } from '../../../components/cashier/icons';
import { RefreshButton } from '../../../components/reports/parts';
import { PrimaryButton, ToolButton, searchCls } from './skladUi';
import { costText, exportProductsCsv, isLowStock, productCost, productValue, qtyText, searchKey } from './skladUtils';

export interface ProductActions {
  onKirim: (p: Product) => void;
  onChiqim: (p: Product) => void;
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
  onJournal: (p: Product) => void;
}

export function ProductsView({
  products,
  canWrite,
  refreshing,
  onRefresh,
  onAdd,
  onCount,
  onProduction,
  onReturn,
  actions,
}: {
  products: Product[];
  canWrite: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onAdd: () => void;
  onCount: () => void;
  onProduction: () => void;
  onReturn: () => void;
  actions: ProductActions;
}) {
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  const lowCount = useMemo(() => products.filter(isLowStock).length, [products]);
  const totalValue = useMemo(() => products.reduce((s, p) => s + productValue(p), 0), [products]);
  const filtered = useMemo(() => {
    const q = searchKey(search);
    return products.filter((p) => (!q || searchKey(p.name).includes(q)) && (!lowOnly || isLowStock(p)));
  }, [products, search, lowOnly]);
  const filteredValue = useMemo(() => filtered.reduce((s, p) => s + productValue(p), 0), [filtered]);
  const narrowed = filtered.length !== products.length;

  return (
    <div>
      {/* Ko'rsatkichlar */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 mb-3">
        <div className="rounded-xl border border-border bg-surface px-3.5 py-3 min-w-0">
          <div className="text-xs font-bold text-muted uppercase tracking-wide">Mahsulotlar</div>
          <div className="text-xl font-extrabold text-text tabular-nums">{products.length} ta</div>
        </div>
        {/* Telefonda: 1-qator — soni va "kam qolgan", 2-qator — ombor qiymati (to'liq kenglikda, kesilmaydi) */}
        <div className="col-span-2 lg:col-span-1 order-last lg:order-none rounded-xl border border-primary/40 bg-primary/10 px-3.5 py-3 min-w-0">
          <div className="text-xs font-bold text-muted uppercase tracking-wide">Ombor qiymati</div>
          <div className="text-xl font-extrabold text-text tabular-nums break-words" data-testid="sklad-total-value">
            {formatSum(totalValue)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setLowOnly((v) => !v)}
          disabled={lowCount === 0 && !lowOnly}
          aria-pressed={lowOnly}
          data-testid="sklad-low-filter"
          className={`rounded-xl border px-3.5 py-3 min-w-0 text-left transition-colors disabled:cursor-default ${
            lowOnly
              ? 'border-danger bg-danger text-white'
              : lowCount > 0
                ? 'border-danger/50 bg-danger/10 hover:bg-danger/15'
                : 'border-border bg-surface'
          }`}
        >
          <div className={`text-xs font-bold uppercase tracking-wide ${lowOnly ? 'text-white/90' : 'text-muted'}`}>
            Kam qolgan{' '}
            {lowCount > 0 && <span className="normal-case font-semibold hidden sm:inline">· {lowOnly ? 'hammasini ko‘rsatish' : 'bosing — faqat shular'}</span>}
          </div>
          <div className={`text-xl font-extrabold tabular-nums ${lowOnly ? 'text-white' : lowCount > 0 ? 'text-danger' : 'text-text'}`}>
            {lowCount > 0 ? `⚠️ ${lowCount} ta` : 'Yo‘q ✓'}
          </div>
        </button>
      </div>

      {/* Qidiruv + amallar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 Mahsulot qidirish…"
          aria-label="Mahsulot qidirish"
          data-testid="sklad-search"
          className={searchCls}
        />
        {canWrite && (
          <PrimaryButton onClick={onAdd} testId="sklad-add">
            + Mahsulot
          </PrimaryButton>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {canWrite && (
          <>
            <ToolButton onClick={onCount} testId="sklad-count" title="Sanab chiqilgan haqiqiy qoldiqni kiritish">
              📋 Inventarizatsiya
            </ToolButton>
            <ToolButton onClick={onProduction} testId="sklad-production" title="Mahsulotlardan yarim tayyor mahsulot tayyorlash">
              🏭 Ishlab chiqarish
            </ToolButton>
            <ToolButton onClick={onReturn} testId="sklad-return" title="Ta’minotchiga qaytarish">
              ↩️ Vozvrat
            </ToolButton>
          </>
        )}
        <ToolButton onClick={() => exportProductsCsv(filtered)} testId="sklad-export" title="Ko‘rinib turgan ro‘yxatni Excel (CSV) faylga saqlash">
          📊 Excel
        </ToolButton>
        <div className="ml-auto">
          <RefreshButton onClick={onRefresh} loading={refreshing} />
        </div>
      </div>

      {narrowed && (
        <div className="text-sm text-muted mb-2 px-1">
          Ko‘rsatilgan: <b className="text-text">{filtered.length} ta</b> · qiymati <b className="text-text">{formatSum(filteredValue)}</b>
        </div>
      )}

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-muted text-center font-semibold">
            {lowOnly ? 'Kam qolgan mahsulot yo‘q.' : 'Qidiruv bo‘yicha mahsulot topilmadi.'}
          </div>
        ) : (
          filtered.map((p) => <ProductRow key={p.id} product={p} canWrite={canWrite} actions={actions} />)
        )}
      </div>
    </div>
  );
}

const ProductRow = memo(function ProductRow({
  product: p,
  canWrite,
  actions,
}: {
  product: Product;
  canWrite: boolean;
  actions: ProductActions;
}) {
  const low = isLowStock(p);
  const negative = (Number(p.stock) || 0) < 0;
  const cost = productCost(p);
  const recipes = Number(p.recipeCount) || 0;
  const minStock = Number(p.minStock) || 0;
  return (
    <div
      data-testid="sklad-row"
      data-product={p.name}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-3 ${low || negative ? 'bg-danger/5' : ''}`}
    >
      <button
        type="button"
        onClick={() => actions.onJournal(p)}
        title="Harakatlar tarixi"
        data-testid="sklad-open-journal"
        className="group min-w-0 flex-1 basis-[240px] text-left rounded-lg -mx-1 px-1 py-0.5 hover:bg-surface-hover"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-extrabold text-text text-[17px] break-words group-hover:text-primary">{p.name}</span>
          {recipes > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-primary/15 text-primary" data-testid="sklad-recipes" title="Shu mahsulot ishlatilgan taomlar soni">
              🍽 {recipes} ta taomda
            </span>
          )}
          {low && !negative && <span className="text-xs font-extrabold px-2 py-0.5 rounded-md bg-danger text-white">kam qoldi</span>}
          {negative && (
            <span className="text-xs font-extrabold px-2 py-0.5 rounded-md bg-danger text-white" title="Hisobdagidan ko‘p sotilgan — inventarizatsiya qiling">
              minus qoldiq
            </span>
          )}
        </div>
        <div className="text-sm text-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
          <span>
            Tannarx:{' '}
            <b className="text-text" data-testid="sklad-cost">
              {cost > 0 ? `${costText(cost)}/${p.unit}` : '—'}
            </b>
          </span>
          <span>
            Qiymat:{' '}
            <b className="text-text" data-testid="sklad-value">
              {formatSum(productValue(p))}
            </b>
          </span>
          {minStock > 0 && (
            <span>
              Min: {qtyText(minStock)} {p.unit}
            </span>
          )}
          <span className="text-primary/90 font-semibold hidden sm:inline group-hover:underline">Tarix ›</span>
        </div>
      </button>

      <div className="text-right shrink-0 min-w-[88px]">
        <div
          className={`text-2xl font-black tabular-nums leading-none ${low || negative ? 'text-danger' : 'text-text'}`}
          data-testid="sklad-stock"
        >
          {qtyText(p.stock)}
        </div>
        <div className="text-xs font-bold text-muted mt-1">{p.unit}</div>
      </div>

      {canWrite && (
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          <button
            type="button"
            onClick={() => actions.onKirim(p)}
            title="Kirim — ta’minotchidan qabul qilish"
            data-testid="sklad-kirim"
            className="h-11 px-3 rounded-xl border-2 border-success/50 bg-success/15 text-success font-extrabold hover:bg-success/25 whitespace-nowrap"
          >
            ＋ Kirim
          </button>
          <button
            type="button"
            onClick={() => actions.onChiqim(p)}
            title="Chiqim — hisobdan chiqarish (buzildi, yo‘qoldi…)"
            data-testid="sklad-chiqim"
            className="h-11 px-3 rounded-xl border-2 border-danger/50 bg-danger/10 text-danger font-extrabold hover:bg-danger/20 whitespace-nowrap"
          >
            － Chiqim
          </button>
          <button
            type="button"
            onClick={() => actions.onEdit(p)}
            aria-label="Tahrirlash"
            title="Tahrirlash"
            data-testid="sklad-edit"
            className="w-11 h-11 rounded-xl border border-border bg-bg text-text hover:border-primary flex items-center justify-center"
          >
            <PencilIcon className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => actions.onDelete(p)}
            aria-label="O‘chirish"
            title="O‘chirish"
            data-testid="sklad-delete"
            className="w-11 h-11 rounded-xl border border-border bg-bg text-muted hover:border-danger hover:text-danger flex items-center justify-center"
          >
            <TrashIcon className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
});

/** Mahsulot yo'q — Sklad nima qilishini tushuntiradi (Sklad ishlatmaydigan restoran uchun xato ham, ortiqcha narsa ham yo'q) */
export function SkladEmptyState({ canWrite, onAdd }: { canWrite: boolean; onAdd: () => void }) {
  return (
    <div className="max-w-2xl mx-auto mt-2 sm:mt-6 bg-surface border border-border rounded-3xl p-6 sm:p-8 text-center" data-testid="sklad-empty">
      <div className="mx-auto mb-4 w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center text-4xl">📦</div>
      <h2 className="text-2xl font-extrabold text-text mb-2">Sklad (ombor) — ixtiyoriy bo‘lim</h2>
      <p className="text-muted mb-5">
        Mahsulotlar (guruch, go‘sht, yog‘…) qoldig‘ini, kirim-chiqimni va ta’minotchilar qarzini yuritadi. Taomga retsept
        biriktirilsa, sotilganda mahsulot avtomatik ayiriladi va taom tannarxi ko‘rinadi.
      </p>
      <div className="grid sm:grid-cols-2 gap-2 text-left mb-5">
        {[
          ['📥', 'Kirim', 'ta’minotchidan qabul qilish, o‘rtacha tannarx o‘zi hisoblanadi'],
          ['📋', 'Inventarizatsiya', 'sanab chiqilgan qoldiqni bir bosishda tenglashtirish'],
          ['🏭', 'Ishlab chiqarish', 'un + suv → xamir kabi yarim tayyor mahsulot'],
          ['📜', 'Harakatlar jurnali', 'har bir o‘zgarish: kim, qachon, qancha'],
        ].map(([icon, title, text]) => (
          <div key={title} className="rounded-xl border border-border bg-bg px-3 py-2.5 flex gap-2.5">
            <span className="text-xl leading-6">{icon}</span>
            <span className="text-sm text-muted">
              <b className="text-text">{title}</b> — {text}
            </span>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted mb-5">Sklad kerak bo‘lmasa — hech narsa qilmang: kassa va menyu odatdagidek ishlayveradi.</p>
      {canWrite ? (
        <PrimaryButton onClick={onAdd} testId="sklad-empty-add" className="h-12 px-6 text-lg">
          + Mahsulot qo‘shish
        </PrimaryButton>
      ) : (
        <div className="text-sm font-semibold text-muted">Mahsulot qo‘shish uchun «Sklad» ruxsati kerak.</div>
      )}
    </div>
  );
}
