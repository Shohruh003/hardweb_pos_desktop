// Hisobot bo'limlari uchun umumiy yordamchilar: mahalliy sanalar, CSV (Excel), ruxsatlar, summa matni.
// Sanalar doim mahalliy 'YYYY-MM-DD' (server ham shunday qabul qiladi — kassa vaqti = restoran vaqti).
import { MenuUnit, UserRole, hasCapability } from '@hardweb-pos/shared';
import type { User } from '@hardweb-pos/shared';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Sana -> 'YYYY-MM-DD' (mahalliy) */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

/** 'YYYY-MM-DD' -> mahalliy 00:00 (noto'g'ri yozuv — bugun) */
export function keyToDate(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return new Date(new Date().setHours(0, 0, 0, 0));
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function shiftDays(key: string, days: number): string {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

/** Hisobot oralig'i rejimi: kun / hafta (dushanba–yakshanba) / oy (1-sanadan oxirigacha) */
export type RangeMode = 'day' | 'week' | 'month';

export interface DateRange {
  from: string;
  to: string;
}

/** Tanlangan sana (anchor) atrofidagi oraliq */
export function modeRange(mode: RangeMode, anchor: string): DateRange {
  const d = keyToDate(anchor);
  if (mode === 'week') {
    const shift = (d.getDay() + 6) % 7; // dushanba = 0
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - shift);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return { from: dateKey(start), to: dateKey(end) };
  }
  if (mode === 'month') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: dateKey(start), to: dateKey(end) };
  }
  return { from: anchor, to: anchor };
}

/** ‹ › — oldingi / keyingi kun, hafta yoki oy */
export function shiftAnchor(mode: RangeMode, anchor: string, dir: -1 | 1): string {
  if (mode === 'week') return shiftDays(anchor, 7 * dir);
  if (mode === 'month') {
    const d = keyToDate(anchor);
    return dateKey(new Date(d.getFullYear(), d.getMonth() + dir, 1));
  }
  return shiftDays(anchor, dir);
}

/** "13.11.2026" yoki "11.11 – 17.11.2026" (yillar har xil bo'lsa — ikkalasi to'liq) */
export function rangeLabel(r: DateRange): string {
  const a = keyToDate(r.from);
  const b = keyToDate(r.to);
  const full = (d: Date) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
  if (r.from === r.to) return full(a);
  if (a.getFullYear() !== b.getFullYear()) return `${full(a)} – ${full(b)}`;
  return `${pad2(a.getDate())}.${pad2(a.getMonth() + 1)} – ${full(b)}`;
}

/** Umumiy hisobotning davr tugmalari (Bugun / Hafta / Oy — oxirgi 7 / 30 kun) -> sanalar oralig'i */
export function periodRange(period: 'day' | 'week' | 'month'): DateRange {
  const to = todayKey();
  if (period === 'week') return { from: shiftDays(to, -6), to };
  if (period === 'month') return { from: shiftDays(to, -29), to };
  return { from: to, to };
}

/** ISO vaqt -> "18:56" */
export function hm(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** ISO vaqt -> "13.11 18:56" */
export function dmHm(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${hm(iso)}`;
}

/** ISO vaqt -> "13.11.2026 18:56" */
export function dmyHm(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${hm(iso)}`;
}

/** Summa raqami minglik bo'linmas bo'shliq bilan, "so‘m"siz: 174 300 */
export function num(n: number | null | undefined): string {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? '−' : ''}${String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

/** Miqdor: dona — "3", kg — "1,107 kg" (3 xonagacha, suzuvchi qoldiqsiz) */
export function qty(q: number | string | null | undefined, unit?: string | null): string {
  const n = Number(q);
  const s = Number.isFinite(n) ? String(Math.round(n * 1000) / 1000).replace('.', ',') : '0';
  return unit === MenuUnit.Weight ? `${s} kg` : s;
}

/** Foiz matni: 5 -> "5", 5.5 -> "5,5" */
export function pct(n: number | null | undefined): string {
  const v = Number(n);
  return Number.isFinite(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : '0';
}

// ---- CSV (Excel) ----

/** CSV katagi: ; " yoki qator ko'chishi bo'lsa — qo'shtirnoq ichida */
function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Excel ochadigan CSV: UTF-8 BOM, ';' ajratgich, CRLF qatorlar (o'zbekcha harflar buzilmaydi) */
export function buildCsv(rows: (string | number | null | undefined)[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

/** CSV faylni yuklab olish (kassa kompyuterida "Saqlash" oynasi ochiladi) */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Yuklash boshlanishiga ulgursin — keyin xotiradan bo'shatamiz
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---- Ruxsatlar (server bilan bir xil qoida — keraksiz 403 so'rov yuborilmasin) ----

type Who = Pick<User, 'role' | 'permissions'> | null | undefined;

/** Administrator / direktor / superadmin */
export function isAdminRole(u: Who): boolean {
  return !!u && (u.role === UserRole.Admin || u.role === UserRole.Director || u.role === UserRole.SuperAdmin);
}

/** Ofitsiantlar hisoboti (B20): administrator / direktor yoki 'reports' ruxsati */
export function canSeeWaiterShares(u: Who): boolean {
  return isAdminRole(u) || hasCapability(u, 'reports');
}

/** Otkazlar hisoboti (B19): hisobot ko'radiganlar yoki tushumni ko'radigan kassir ('revenue') */
export function canSeeVoids(u: Who): boolean {
  return canSeeWaiterShares(u) || hasCapability(u, 'revenue');
}

/** Kassa holati va qarzlar (B33/B34): kassir, 'reports' yoki administrator / direktor */
export function canSeeCash(u: Who): boolean {
  return isAdminRole(u) || hasCapability(u, 'cashier') || hasCapability(u, 'reports');
}

/** Qarzni "to'landi" qilish: kassir yoki administrator / direktor */
export function canRepayDebt(u: Who): boolean {
  return isAdminRole(u) || hasCapability(u, 'cashier');
}
