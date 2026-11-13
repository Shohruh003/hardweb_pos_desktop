// POS sozlamalari (GET /settings/pos): xizmat haqi foizi (stolga; zal bo'yicha alohida foiz —
// hallServicePercentFor(settings, hall) shared'dan), ofitsiant ulushi, zallar tartibi, restoran nomi.
// Ofitsiant, kassa va KDS ekranlari shu yerdan o'qiydi. Bir marta yuklanadi va xotirada saqlanadi;
// sozlama o'zgartirilgach refreshPosSettings() chaqiriladi (yoki 60 s dan keyin qayta yuklanadi).
import { useEffect, useState } from 'react';
import { DEFAULT_PAYMENT_METHODS } from '@hardweb-pos/shared';
import type { PaymentMethod, PosSettings } from '@hardweb-pos/shared';
import { api } from './api';

/** Server javobi normallashtirilgach — barcha maydonlar to'ldirilgan */
export type FullPosSettings = Required<PosSettings>;

export const DEFAULT_POS_SETTINGS: FullPosSettings = {
  restaurantName: 'DasturXon',
  serviceDineInPercent: 0,
  hallServicePercent: {},
  waiterSharePercent: 0,
  deliveryFeeDefault: 0,
  paymentMethods: DEFAULT_PAYMENT_METHODS,
  hallOrder: [],
};

const METHOD_KINDS = ['cash', 'card', 'online', 'debt', 'other'];

/** To'lov usullari ro'yxati: noto'g'ri yozuvlar tashlanadi; bo'sh bo'lsa — standart ro'yxat */
function normalizeMethods(raw: unknown): PaymentMethod[] {
  if (!Array.isArray(raw)) return DEFAULT_PAYMENT_METHODS;
  const seen = new Set<string>();
  const list: PaymentMethod[] = [];
  for (const m of raw as Partial<PaymentMethod>[]) {
    const key = typeof m?.key === 'string' ? m.key.trim() : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push({
      key,
      label: typeof m.label === 'string' && m.label.trim() ? m.label.trim() : key,
      kind: METHOD_KINDS.includes(String(m.kind)) ? (m.kind as PaymentMethod['kind']) : 'other',
      active: m.active !== false,
    });
  }
  return list.length ? list : DEFAULT_PAYMENT_METHODS;
}

const MAX_AGE_MS = 60_000;

let cache: FullPosSettings | null = null;
let loadedAt = 0;
let inflight: Promise<FullPosSettings> | null = null;
const listeners = new Set<(s: FullPosSettings) => void>();

function percent(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

function normalize(raw: Partial<PosSettings> | null | undefined): FullPosSettings {
  const halls: Record<string, number> = {};
  const map = raw?.hallServicePercent;
  if (map && typeof map === 'object') {
    for (const [hall, v] of Object.entries(map)) {
      if (v !== null && v !== undefined && Number.isFinite(Number(v))) halls[hall] = percent(v);
    }
  }
  return {
    restaurantName: raw?.restaurantName || DEFAULT_POS_SETTINGS.restaurantName,
    serviceDineInPercent: percent(raw?.serviceDineInPercent),
    hallServicePercent: halls,
    waiterSharePercent: percent(raw?.waiterSharePercent),
    deliveryFeeDefault: Math.max(0, Math.round(Number(raw?.deliveryFeeDefault) || 0)),
    paymentMethods: normalizeMethods(raw?.paymentMethods),
    hallOrder: Array.isArray(raw?.hallOrder) ? raw!.hallOrder.filter((h) => typeof h === 'string') : [],
  };
}

/** Sozlamalarni yuklash (xotiradagi nusxa yangi bo'lsa — so'rovsiz). Xato bo'lsa oxirgi/standart qiymat. */
export function loadPosSettings(force = false): Promise<FullPosSettings> {
  if (!force && cache && Date.now() - loadedAt < MAX_AGE_MS) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = api
    .get<PosSettings>('/settings/pos')
    .then((raw): FullPosSettings => {
      const next = normalize(raw);
      cache = next;
      loadedAt = Date.now();
      listeners.forEach((fn) => fn(next));
      return next;
    })
    .catch(() => cache ?? DEFAULT_POS_SETTINGS)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Sozlama saqlangandan keyin chaqiriladi — barcha ochiq ekranlar yangi qiymatni oladi */
export function refreshPosSettings(): Promise<FullPosSettings> {
  return loadPosSettings(true);
}

/** React hook: joriy POS sozlamalari (birinchi yuklanguncha — oxirgi/standart qiymat) */
export function usePosSettings(): FullPosSettings {
  const [s, setS] = useState<FullPosSettings>(cache ?? DEFAULT_POS_SETTINGS);
  useEffect(() => {
    let alive = true;
    const fn = (next: FullPosSettings) => {
      if (alive) setS(next);
    };
    listeners.add(fn);
    loadPosSettings().then(fn);
    return () => {
      alive = false;
      listeners.delete(fn);
    };
  }, []);
  return s;
}

/**
 * Zallarni sozlamadagi tartibda saralash: hallOrder'dagilar o'sha tartibda,
 * qolganlari (ro'yxatda yo'q yangi zallar) oxirida alifbo bo'yicha.
 */
export function sortHalls(halls: string[], hallOrder: string[]): string[] {
  const unique = Array.from(new Set(halls));
  const pos = new Map(hallOrder.map((h, i) => [h, i] as const));
  return unique.sort((a, b) => {
    const pa = pos.get(a);
    const pb = pos.get(b);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return a.localeCompare(b, 'uz');
  });
}
