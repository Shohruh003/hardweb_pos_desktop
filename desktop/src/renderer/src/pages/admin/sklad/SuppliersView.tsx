// Ta'minotchilar: ro'yxat (olingan / to'langan / qarz), qo'shish, tahrirlash, o'chirish (kirim yoki
// to'lovi bor ta'minotchini server o'chirmaydi — sababi ko'rsatiladi), to'lov va har birining sahifasi.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Supplier } from '@hardweb-pos/shared';
import { formatSum } from '../../../components/ui';
import { displayPhone } from '../../../components/cashier/orderType';
import { PencilIcon, TrashIcon } from '../../../components/cashier/icons';
import { EmptyState, ErrorLine, RefreshButton } from '../../../components/reports/parts';
import { dmyHm } from '../../../components/reports/reportUtils';
import { api } from '../../../lib/api';
import { useConfirm } from '../../../state/confirm';
import { SupplierDetail } from './SupplierDetail';
import { PaymentModal, SupplierFormModal } from './SupplierModals';
import { LoadingBlock, PrimaryButton, searchCls } from './skladUi';
import { errText, searchKey } from './skladUtils';

export function SuppliersView({
  canWrite,
  canDeletePayment,
  onFlash,
  onNotice,
}: {
  canWrite: boolean;
  canDeletePayment: boolean;
  onFlash: (message: string) => void;
  onNotice: (title: string, subtitle: string) => void;
}) {
  const confirm = useConfirm();
  const [list, setList] = useState<Supplier[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{ supplier?: Supplier } | null>(null);
  const [payFor, setPayFor] = useState<Supplier | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState(0);
  const seq = useRef(0);
  const deleting = useRef(false);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const r = await api.get<Supplier[]>('/inventory/suppliers');
      if (my !== seq.current) return;
      setList(Array.isArray(r) ? r : []);
      setError('');
    } catch (e) {
      if (my === seq.current) setError(errText(e, 'Ta’minotchilar yuklanmadi'));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const suppliers = useMemo(() => list ?? [], [list]);
  const totalDebt = suppliers.reduce((s, x) => s + Math.max(0, Number(x.debt) || 0), 0);
  const shown = useMemo(() => {
    const q = searchKey(search);
    const digits = search.replace(/\D/g, '');
    return suppliers.filter(
      (s) => !q || searchKey(s.name).includes(q) || (digits.length > 0 && (s.phone ?? '').replace(/\D/g, '').includes(digits)),
    );
  }, [suppliers, search]);
  const open = openId ? suppliers.find((s) => s.id === openId) : undefined;

  async function remove(s: Supplier) {
    if (deleting.current) return;
    const ok = await confirm({
      title: 'Ta’minotchini o‘chirish',
      message: `«${s.name}» o‘chirilsinmi?`,
      confirmText: 'O‘chirish',
      danger: true,
    });
    if (!ok || deleting.current) return;
    deleting.current = true;
    try {
      await api.del(`/inventory/suppliers/${s.id}`);
      if (openId === s.id) setOpenId(null);
      onFlash(`«${s.name}» o‘chirildi`);
    } catch (e) {
      onNotice('O‘chirib bo‘lmaydi', errText(e, 'O‘chirilmadi'));
    } finally {
      deleting.current = false;
      void load();
    }
  }

  const modals = (
    <>
      {form && (
        <SupplierFormModal
          supplier={form.supplier}
          suppliers={suppliers}
          onClose={() => setForm(null)}
          onDone={(msg) => {
            setForm(null);
            onFlash(msg);
            void load();
            setDetailKey((k) => k + 1);
          }}
        />
      )}
      {payFor && (
        <PaymentModal
          supplier={payFor}
          onClose={() => setPayFor(null)}
          onDone={(msg) => {
            setPayFor(null);
            onFlash(msg);
            void load();
            setDetailKey((k) => k + 1);
          }}
        />
      )}
    </>
  );

  if (open) {
    return (
      <>
        <SupplierDetail
          supplier={open}
          canWrite={canWrite}
          canDeletePayment={canDeletePayment}
          reloadKey={detailKey}
          onBack={() => setOpenId(null)}
          onPay={setPayFor}
          onEdit={(s) => setForm({ supplier: s })}
          onDelete={(s) => void remove(s)}
          onChanged={(msg) => {
            onFlash(msg);
            void load();
          }}
          onNotice={onNotice}
        />
        {modals}
      </>
    );
  }

  return (
    <div data-testid="suppliers-view">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
        <div className="rounded-xl border border-border bg-surface px-3.5 py-3">
          <div className="text-xs font-bold text-muted uppercase tracking-wide">Ta’minotchilar</div>
          <div className="text-xl font-extrabold text-text tabular-nums">{suppliers.length} ta</div>
        </div>
        <div className={`rounded-xl border px-3.5 py-3 ${totalDebt > 0 ? 'border-danger/50 bg-danger/10' : 'border-border bg-surface'}`}>
          <div className="text-xs font-bold text-muted uppercase tracking-wide">Jami qarzimiz</div>
          <div className={`text-xl font-extrabold tabular-nums ${totalDebt > 0 ? 'text-danger' : 'text-text'}`} data-testid="sup-total-debt">
            {formatSum(totalDebt)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 Ta’minotchi qidirish (nom yoki telefon)…"
          aria-label="Ta’minotchi qidirish"
          className={searchCls}
        />
        {canWrite && (
          <PrimaryButton onClick={() => setForm({})} testId="sup-add">
            + Ta’minotchi
          </PrimaryButton>
        )}
        <RefreshButton onClick={() => void load()} loading={loading} />
      </div>

      <ErrorLine message={error} onRetry={() => void load()} />

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
        {list === null ? (
          loading ? <LoadingBlock /> : <EmptyState>Ta’minotchilar yuklanmadi.</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState>
            {suppliers.length === 0
              ? 'Ta’minotchi yo‘q. Kirim qilishda «+ Yangi ta’minotchi» tanlansa yoki shu yerda qo‘shilsa — ro‘yxatga tushadi.'
              : 'Qidiruv bo‘yicha topilmadi.'}
          </EmptyState>
        ) : (
          shown.map((s) => {
            const debt = Math.round(Number(s.debt) || 0);
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-3" data-testid="sup-row" data-supplier={s.name}>
                <button
                  type="button"
                  onClick={() => setOpenId(s.id)}
                  className="group min-w-0 flex-1 basis-[240px] text-left rounded-lg -mx-1 px-1 py-0.5 hover:bg-surface-hover"
                  data-testid="sup-open"
                  title="To‘lovlar va kirimlar"
                >
                  <div className="font-extrabold text-text text-[17px] break-words group-hover:text-primary">🚚 {s.name}</div>
                  <div className="text-sm text-muted flex flex-wrap gap-x-3">
                    {s.phone && <span className="font-semibold text-text">{displayPhone(s.phone)}</span>}
                    <span>
                      Olingan: <b className="text-text">{formatSum(s.purchased)}</b>
                    </span>
                    <span>
                      To‘langan: <b className="text-text">{formatSum(s.paid)}</b>
                    </span>
                    <span>{s.purchasesCount ?? 0} ta kirim</span>
                    {s.lastPurchaseAt && <span>oxirgisi {dmyHm(s.lastPurchaseAt)}</span>}
                  </div>
                </button>
                <div className="text-right shrink-0 min-w-[110px]">
                  <div className="text-xs font-bold text-muted">{debt < 0 ? 'Oldindan to‘langan' : 'Qarz'}</div>
                  <div
                    className={`text-lg font-black tabular-nums ${debt > 0 ? 'text-danger' : debt < 0 ? 'text-success' : 'text-text'}`}
                    data-testid="sup-debt"
                  >
                    {formatSum(Math.abs(debt))}
                  </div>
                </div>
                {canWrite && (
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    <button
                      type="button"
                      onClick={() => setPayFor(s)}
                      data-testid="sup-pay"
                      className="h-11 px-3 rounded-xl border-2 border-success/50 bg-success/15 text-success font-extrabold hover:bg-success/25 whitespace-nowrap"
                    >
                      💵 To‘lov
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({ supplier: s })}
                      aria-label="Tahrirlash"
                      title="Tahrirlash"
                      data-testid="sup-edit"
                      className="w-11 h-11 rounded-xl border border-border bg-bg text-text hover:border-primary flex items-center justify-center"
                    >
                      <PencilIcon className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(s)}
                      aria-label="O‘chirish"
                      title="O‘chirish"
                      data-testid="sup-delete"
                      className="w-11 h-11 rounded-xl border border-border bg-bg text-muted hover:border-danger hover:text-danger flex items-center justify-center"
                    >
                      <TrashIcon className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {modals}
    </div>
  );
}
