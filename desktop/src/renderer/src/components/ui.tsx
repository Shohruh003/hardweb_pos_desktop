import React from 'react';
import { OrderStatus } from '@hardweb-pos/shared';

// Asosiy tugma — katta, bosishga qulay (tezkor muhit uchun)
export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  const base =
    'px-4 py-2.5 rounded-lg font-semibold transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100';
  const styles: Record<string, string> = {
    primary: 'bg-primary hover:bg-primary-hover text-white',
    ghost: 'bg-surface hover:bg-surface-hover text-text border border-border',
    danger: 'bg-danger hover:opacity-90 text-white',
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

// Buyurtma holati uchun rangli belgi
export function StatusBadge({ status }: { status: OrderStatus }) {
  const map: Record<OrderStatus, { label: string; cls: string }> = {
    [OrderStatus.Accepted]: { label: 'Qabul qilindi', cls: 'bg-info/20 text-info' },
    [OrderStatus.Cooking]: { label: 'Tayyorlanmoqda', cls: 'bg-warning/20 text-warning' },
    [OrderStatus.Ready]: { label: 'Tayyor', cls: 'bg-success/20 text-success' },
    [OrderStatus.Closed]: { label: 'Yopilgan', cls: 'bg-muted/20 text-muted' },
  };
  const it = map[status];
  return (
    <span className={`px-2.5 py-1 rounded-md text-sm font-semibold ${it.cls}`}>
      {it.label}
    </span>
  );
}

export function formatSum(n: number): string {
  return new Intl.NumberFormat('uz-UZ').format(n) + ' so‘m';
}
