import { useEffect, useState } from 'react';

/** Joriy vaqt (ms) — har `intervalMs` da yangilanadi ("12 daq oldin" kabi ko'rsatkichlar uchun) */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** CSS media query holati (masalan telefon kengligi) — o'lcham o'zgarsa yangilanadi */
export function useMediaQuery(query: string): boolean {
  const get = () => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(query);
    } catch {
      return;
    }
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Sensorli qurilmami (monoblok / telefon) — avtomatik fokus ekran klaviaturasini ochib yubormasligi uchun */
export function isTouchDevice(): boolean {
  try {
    return (navigator.maxTouchPoints ?? 0) > 0;
  } catch {
    return false;
  }
}

/** localStorage'dan xavfsiz o'qish (yopiq bo'lsa — null) */
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** localStorage'ga xavfsiz yozish (null — o'chirish) */
export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* localStorage yopiq — faqat xotirada qoladi */
  }
}
