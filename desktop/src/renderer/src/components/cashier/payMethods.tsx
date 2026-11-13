import { DEFAULT_PAYMENT_METHODS, paymentMethodLabel } from '@hardweb-pos/shared';
import type { PaymentMethod, PaymentMethodKind } from '@hardweb-pos/shared';
import { CardIcon, CashIcon, DebtIcon, PhonePayIcon, WalletIcon } from './icons';

// To'lov usullari (B30) — sozlamadagi ro'yxat (usePosSettings().paymentMethods): direktor nomini
// o'zgartiradi, o'chiradi, yangisini qo'shadi ("Xaqberdiga"). Kassa faqat FAOL usullarni ko'rsatadi
// va serverga faqat ularning kalitini yuboradi (nofaol kalit — 400 "To‘lov turi noto‘g‘ri").

/** Faol to'lov usullari (sozlamadagi tartibda). Bittasi ham faol bo'lmasa — standart faollar. */
export function activeMethods(list: PaymentMethod[] | null | undefined): PaymentMethod[] {
  const active = (list ?? []).filter((m) => m && m.active !== false && m.key);
  return active.length ? active : DEFAULT_PAYMENT_METHODS.filter((m) => m.active);
}

/** Usul nomi (kalit bo'yicha): sozlamadagi nom, topilmasa — standart nom yoki kalitning o'zi */
export function methodLabel(list: PaymentMethod[] | null | undefined, key: string | null | undefined): string {
  return paymentMethodLabel(list ?? [], key);
}

/** Usul turi (kalit bo'yicha) — ro'yxatda bo'lmasa (eski 'qr') — onlayn, noma'lum — boshqa */
export function methodKind(list: PaymentMethod[] | null | undefined, key: string | null | undefined): PaymentMethodKind {
  const all = [...(list ?? []), ...DEFAULT_PAYMENT_METHODS];
  return all.find((m) => m.key === key)?.kind ?? 'other';
}

/** Usul turining rangi (belgi uchun): naqd — yashil, karta — primary, onlayn — sariq, qarz — qizil */
export const KIND_TINT: Record<PaymentMethodKind, string> = {
  cash: 'text-success',
  card: 'text-primary',
  online: 'text-warning',
  debt: 'text-danger',
  other: 'text-muted',
};

/** Usul turi belgisi: naqd pul / karta / telefon / daftar / hamyon */
export function MethodIcon({ kind, className = 'w-6 h-6' }: { kind: PaymentMethodKind; className?: string }) {
  if (kind === 'cash') return <CashIcon className={className} />;
  if (kind === 'card') return <CardIcon className={className} />;
  if (kind === 'online') return <PhonePayIcon className={className} />;
  if (kind === 'debt') return <DebtIcon className={className} />;
  return <WalletIcon className={className} />;
}
