// Ta'minotchi oynalari: qo'shish / tahrirlash (nom, telefon, izoh) va to'lov (qarzni kamaytiradi).
import { useState } from 'react';
import {
  SUPPLIER_NAME_REQUIRED_MESSAGE,
  SUPPLIER_NAME_TAKEN_MESSAGE,
  SUPPLIER_PAYMENT_AMOUNT_MESSAGE,
  Supplier,
  SupplierPayment,
} from '@hardweb-pos/shared';
import { Modal } from '../../../components/Modal';
import { formatSum } from '../../../components/ui';
import { displayPhone, normalizePhone } from '../../../components/cashier/orderType';
import { api } from '../../../lib/api';
import { Field, FormError, InfoRow, ModalFooter, MoneyInput, TextInput, useSubmit } from './skladUi';
import { sameName } from './skladUtils';

export function SupplierFormModal({
  supplier,
  suppliers,
  onClose,
  onDone,
}: {
  /** berilsa — tahrirlash */
  supplier?: Supplier;
  /** nom takrorini darrov ko'rsatish uchun */
  suppliers: Supplier[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ? displayPhone(supplier.phone) : '');
  const [note, setNote] = useState(supplier?.note ?? '');
  const { busy, error, setError, run } = useSubmit();
  const trimmed = name.trim();
  const duplicate = !!trimmed && suppliers.some((s) => s.id !== supplier?.id && sameName(s.name, trimmed));
  const rawPhone = phone.trim();
  const phoneHint = rawPhone && !normalizePhone(rawPhone) ? 'Raqam O‘zbekiston formatida emas — yozilganicha saqlanadi' : '';

  async function submit() {
    if (!trimmed) {
      setError(SUPPLIER_NAME_REQUIRED_MESSAGE);
      return;
    }
    if (duplicate) {
      setError(SUPPLIER_NAME_TAKEN_MESSAGE);
      return;
    }
    const body = { name: trimmed, phone: rawPhone ? normalizePhone(rawPhone) ?? rawPhone : '', note: note.trim() };
    await run(async () => {
      if (supplier) await api.patch<Supplier>(`/inventory/suppliers/${supplier.id}`, body);
      else await api.post<Supplier>('/inventory/suppliers', body);
      onDone(supplier ? `«${trimmed}» saqlandi` : `«${trimmed}» qo‘shildi`);
    });
  }

  return (
    <Modal title={supplier ? 'Ta’minotchini tahrirlash' : 'Yangi ta’minotchi'} onClose={() => !busy && onClose()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
        data-testid="supplier-form"
      >
        <Field label="Nomi" hint={duplicate ? <span className="text-danger font-bold">{SUPPLIER_NAME_TAKEN_MESSAGE}</span> : undefined}>
          <TextInput value={name} onChange={setName} placeholder="Masalan: Baraka savdo" autoFocus maxLength={120} testId="sup-name" ariaLabel="Ta’minotchi nomi" />
        </Field>
        <Field label="Telefon (ixtiyoriy)" hint={phoneHint ? <span className="text-warning font-semibold">{phoneHint}</span> : undefined}>
          <TextInput
            value={phone}
            onChange={setPhone}
            onBlur={() => {
              const n = normalizePhone(phone);
              if (n) setPhone(displayPhone(n));
            }}
            inputMode="tel"
            placeholder="+998 90 123 45 67"
            maxLength={32}
            testId="sup-phone"
            ariaLabel="Telefon"
          />
        </Field>
        <Field label="Izoh (ixtiyoriy)">
          <TextInput value={note} onChange={setNote} placeholder="Masalan: go‘sht, har seshanba" testId="sup-note" ariaLabel="Izoh" />
        </Field>
        {supplier && trimmed && trimmed !== supplier.name && (
          <div className="text-xs text-muted">Nom o‘zgarsa — eski kirim va to‘lovlarda ham yangi nom ko‘rinadi.</div>
        )}
        <FormError message={error} />
        <ModalFooter onCancel={onClose} busy={busy} submitLabel={supplier ? 'Saqlash' : 'Qo‘shish'} disabled={!trimmed} testId="sup-save" />
      </form>
    </Modal>
  );
}

export function PaymentModal({ supplier, onClose, onDone }: { supplier: Supplier; onClose: () => void; onDone: (message: string) => void }) {
  const debt = Math.round(Number(supplier.debt) || 0);
  const [amount, setAmount] = useState(debt > 0 ? String(debt) : '');
  const [note, setNote] = useState('');
  const { busy, error, setError, run } = useSubmit();
  const sum = Number(amount) || 0;

  async function submit() {
    if (!(sum > 0)) {
      setError(SUPPLIER_PAYMENT_AMOUNT_MESSAGE);
      return;
    }
    await run(async () => {
      await api.post<SupplierPayment>('/inventory/supplier-payments', {
        supplierId: supplier.id,
        amount: sum,
        note: note.trim() || undefined,
      });
      onDone(`To‘lov saqlandi: ${supplier.name} — ${formatSum(sum)}`);
    }, 'To‘lov saqlanmadi');
  }

  return (
    <Modal title={`💵 To‘lov — ${supplier.name}`} onClose={() => !busy && onClose()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
        data-testid="payment-modal"
      >
        <div className="rounded-xl border border-border bg-bg px-3 py-1.5">
          <InfoRow label="Olingan" value={formatSum(supplier.purchased)} />
          <InfoRow label="To‘langan" value={formatSum(supplier.paid)} />
          <InfoRow label={debt < 0 ? 'Oldindan to‘langan' : 'Qarz'} value={formatSum(Math.abs(debt))} tone={debt > 0 ? 'danger' : 'success'} />
        </div>
        <Field label="To‘lov summasi">
          <MoneyInput value={amount} onChange={setAmount} autoFocus big testId="pay-amount" ariaLabel="To‘lov summasi" />
        </Field>
        <Field label="Izoh (ixtiyoriy)">
          <TextInput value={note} onChange={setNote} placeholder="Masalan: naqd berildi" testId="pay-note" ariaLabel="Izoh" />
        </Field>
        {sum > 0 && (
          <div className="rounded-xl border-2 border-success/40 bg-success/10 px-3 py-1.5">
            <InfoRow
              label={debt - sum < 0 ? 'To‘lovdan keyin — oldindan to‘langan' : 'To‘lovdan keyin qarz'}
              value={formatSum(Math.abs(debt - sum))}
              tone={debt - sum > 0 ? 'danger' : 'success'}
            />
          </div>
        )}
        <FormError message={error} />
        <ModalFooter onCancel={onClose} busy={busy} submitLabel="To‘lash" disabled={!(sum > 0)} testId="pay-save" />
      </form>
    </Modal>
  );
}
