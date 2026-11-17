// Bitta ta'minotchi: balans (olingan / to'langan / qarz), to'lovlari va kirimlari.
// To'lovni o'chirish pul yozuvini bekor qiladi — faqat administrator / direktor (tugma boshqalarga ko'rinmaydi).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Purchase, Supplier, SupplierPayment } from '@hardweb-pos/shared';
import { formatSum } from '../../../components/ui';
import { displayPhone } from '../../../components/cashier/orderType';
import { PencilIcon, TrashIcon } from '../../../components/cashier/icons';
import { EmptyState, ErrorLine, Segmented, StatTile } from '../../../components/reports/parts';
import { dmyHm } from '../../../components/reports/reportUtils';
import { api } from '../../../lib/api';
import { useConfirm } from '../../../state/confirm';
import { PurchaseRow } from './PurchasesView';
import { BackButton, LoadingBlock, PrimaryButton } from './skladUi';
import { errText } from './skladUtils';

type Tab = 'payments' | 'purchases';

export function SupplierDetail({
  supplier: s,
  canWrite,
  canDeletePayment,
  reloadKey,
  onBack,
  onPay,
  onEdit,
  onDelete,
  onChanged,
  onNotice,
}: {
  supplier: Supplier;
  canWrite: boolean;
  canDeletePayment: boolean;
  /** to'lov qo'shilganda oshadi — ro'yxat qayta yuklanadi */
  reloadKey: number;
  onBack: () => void;
  onPay: (s: Supplier) => void;
  onEdit: (s: Supplier) => void;
  onDelete: (s: Supplier) => void;
  /** balans o'zgardi (to'lov o'chirildi) — ta'minotchilar ro'yxatini yangilash */
  onChanged: (message: string) => void;
  onNotice: (title: string, subtitle: string) => void;
}) {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('payments');
  const [payments, setPayments] = useState<SupplierPayment[] | null>(null);
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const deleting = useRef(false);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const id = encodeURIComponent(s.id);
      const [pay, pur] = await Promise.all([
        api.get<SupplierPayment[]>(`/inventory/supplier-payments?supplierId=${id}`),
        api.get<Purchase[]>(`/inventory/purchases?supplierId=${id}`),
      ]);
      if (my !== seq.current) return;
      setPayments(Array.isArray(pay) ? pay : []);
      setPurchases(Array.isArray(pur) ? pur : []);
    } catch (e) {
      if (my === seq.current) setError(errText(e, 'Ma’lumot yuklanmadi'));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [s.id]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  async function removePayment(p: SupplierPayment) {
    if (deleting.current) return;
    const ok = await confirm({
      title: 'To‘lovni o‘chirish',
      message: `${formatSum(p.amount)} to‘lov (${dmyHm(p.createdAt)}) o‘chirilsinmi? Ta’minotchi qarzi shu summaga ortadi.`,
      confirmText: 'O‘chirish',
      danger: true,
    });
    if (!ok || deleting.current) return;
    deleting.current = true;
    try {
      await api.del(`/inventory/supplier-payments/${p.id}`);
      onChanged(`To‘lov o‘chirildi: ${formatSum(p.amount)}`);
    } catch (e) {
      onNotice('To‘lov o‘chirilmadi', errText(e));
    } finally {
      deleting.current = false;
      void load();
    }
  }

  const debt = Math.round(Number(s.debt) || 0);
  const list = tab === 'payments' ? payments : purchases;

  return (
    <div data-testid="sup-detail">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <BackButton onClick={onBack} testId="sup-back" />
        <div className="min-w-0 mr-auto">
          <div className="text-xl font-extrabold text-text break-words">🚚 {s.name}</div>
          <div className="text-sm text-muted">
            {[s.phone ? displayPhone(s.phone) : null, s.note || null].filter(Boolean).join(' · ') || 'Telefon kiritilmagan'}
          </div>
        </div>
        {canWrite && (
          <>
            <PrimaryButton onClick={() => onPay(s)} testId="sup-detail-pay">
              💵 To‘lov qilish
            </PrimaryButton>
            <button
              type="button"
              onClick={() => onEdit(s)}
              aria-label="Tahrirlash"
              title="Tahrirlash"
              className="w-11 h-11 rounded-xl border border-border bg-bg text-text hover:border-primary flex items-center justify-center"
            >
              <PencilIcon className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(s)}
              aria-label="O‘chirish"
              title="O‘chirish"
              className="w-11 h-11 rounded-xl border border-border bg-bg text-muted hover:border-danger hover:text-danger flex items-center justify-center"
            >
              <TrashIcon className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
        <StatTile label="Olingan (kirim − vozvrat)" value={formatSum(s.purchased)} sub={`${s.purchasesCount ?? 0} ta kirim`} />
        <StatTile label="To‘langan" value={formatSum(s.paid)} tone="success" />
        <StatTile
          label={debt < 0 ? 'Oldindan to‘langan' : 'Qarz'}
          value={<span data-testid="sup-detail-debt">{formatSum(Math.abs(debt))}</span>}
          tone={debt > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          testIdPrefix="sup-tab"
          options={[
            { value: 'payments', label: 'To‘lovlar', count: payments?.length },
            { value: 'purchases', label: 'Kirimlar', count: purchases?.length },
          ]}
        />
      </div>
      <ErrorLine message={error} onRetry={() => void load()} />

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
        {list === null ? (
          loading ? <LoadingBlock /> : <EmptyState>Yuklanmadi.</EmptyState>
        ) : list.length === 0 ? (
          <EmptyState>{tab === 'payments' ? 'Hali to‘lov qilinmagan.' : 'Bu ta’minotchidan kirim yo‘q.'}</EmptyState>
        ) : tab === 'payments' ? (
          (payments ?? []).map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-3 sm:px-4 py-3" data-testid="pay-row">
              <div className="min-w-0 flex-1">
                <div className="font-extrabold text-success tabular-nums">{formatSum(p.amount)}</div>
                <div className="text-sm text-muted break-words">
                  {[dmyHm(p.createdAt), p.userName || null, p.note || null].filter(Boolean).join(' · ')}
                </div>
              </div>
              {canDeletePayment && (
                <button
                  type="button"
                  onClick={() => void removePayment(p)}
                  aria-label="To‘lovni o‘chirish"
                  title="To‘lovni o‘chirish"
                  data-testid="pay-delete"
                  className="w-11 h-11 rounded-xl border border-border bg-bg text-muted hover:border-danger hover:text-danger flex items-center justify-center shrink-0"
                >
                  <TrashIcon className="w-5 h-5" />
                </button>
              )}
            </div>
          ))
        ) : (
          (purchases ?? []).map((p) => <PurchaseRow key={p.id} p={p} showSupplier={false} />)
        )}
      </div>
    </div>
  );
}
