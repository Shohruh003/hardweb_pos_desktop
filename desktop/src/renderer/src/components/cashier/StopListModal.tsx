import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MenuUnit, SOCKET_EVENTS } from '@hardweb-pos/shared';
import type { Category, MenuItem } from '@hardweb-pos/shared';
import { api } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { formatSum } from '../ui';
import { Sheet, SheetError, Spinner } from '../waiter/Sheet';
import { KeyboardToggle, TouchKeyboard, useTouchKeyboardPref } from '../waiter/TouchKeyboard';
import { CheckIcon, CloseIcon, SearchIcon, StopIcon } from './icons';

// "⛔ Stop list" (B29): kassir tugagan taomni bir bosishda belgilaydi (yoki qaytaradi) —
// PATCH /menu/items/:id/availability {available}. Ofitsiant menyusida bunday taom kulrang "Tugadi"
// bo'lib turadi va server ham buyurtmani rad etadi. Boshqa kassa/admin o'zgartirsa — 'menu:changed'
// orqali darhol yangilanadi. Tugagan taomlar ro'yxat boshida.

/** Apostrof turlari va katta-kichik harfdan qat'i nazar qidirish (o‘ / o' / oʻ bir xil) */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’ʼʻ`'´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

type Filter = 'all' | 'off' | string; // string — kategoriya id

export function StopListModal({ onClose, onChanged }: { onClose: () => void; onChanged?: (offCount: number) => void }) {
  const kb = useTouchKeyboardPref();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<MenuItem[]>([]);
  itemsRef.current = items;
  const alive = useRef(true);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const [list, categories] = await Promise.all([
        api.get<MenuItem[]>('/menu/items'),
        api.get<Category[]>('/menu/categories').catch(() => [] as Category[]),
      ]);
      if (!alive.current) return;
      setItems(Array.isArray(list) ? list : []);
      setCats(Array.isArray(categories) ? categories : []);
      setLoadError('');
    } catch (e) {
      if (alive.current) setLoadError((e as Error)?.message || 'Menyu yuklanmadi');
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Boshqa joyda o'zgardi (boshqa kassa, admin) — shu taomni yangilaymiz; noma'lum bo'lsa — qayta yuklaymiz
  useEffect(() => {
    const socket = getSocket();
    let timer: number | undefined;
    const onMenu = (p: { itemId?: string; available?: boolean; deleted?: boolean } | undefined) => {
      const id = p?.itemId;
      // Yangi taom (yoki to'liq ma'lumotsiz hodisa) — ro'yxatni qayta yuklaymiz
      if (!id || (!p?.deleted && !itemsRef.current.some((it) => it.id === id))) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void load(), 300);
        return;
      }
      if (p?.deleted) {
        setItems((prev) => prev.filter((it) => it.id !== id));
        return;
      }
      const available = p?.available;
      if (typeof available === 'boolean') {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, available } : it)));
      }
    };
    socket.on(SOCKET_EVENTS.MENU_CHANGED, onMenu);
    socket.on('connect', load);
    return () => {
      window.clearTimeout(timer);
      socket.off(SOCKET_EVENTS.MENU_CHANGED, onMenu);
      socket.off('connect', load);
    };
  }, [load]);

  const offCount = useMemo(() => items.filter((it) => it.available === false).length, [items]);
  useEffect(() => {
    if (loaded) onChangedRef.current?.(offCount);
  }, [offCount, loaded]);

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c] as const)), [cats]);
  const catOrder = useMemo(() => new Map(cats.map((c, i) => [c.id, c.sortOrder ?? i] as const)), [cats]);
  // Faqat taomi bor kategoriyalar (bo'sh kategoriya tugmasi ko'rsatilmaydi)
  const usedCats = useMemo(() => cats.filter((c) => items.some((it) => it.categoryId === c.id)), [cats, items]);

  const shown = useMemo(() => {
    const needle = norm(q);
    return items
      .filter((it) => {
        if (filter === 'off' && it.available !== false) return false;
        if (filter !== 'all' && filter !== 'off' && it.categoryId !== filter) return false;
        if (needle && !norm(it.name).includes(needle)) return false;
        return true;
      })
      .sort((a, b) => {
        // Tugaganlar birinchi, keyin kategoriya tartibi, keyin nom
        const av = a.available === false ? 0 : 1;
        const bv = b.available === false ? 0 : 1;
        if (av !== bv) return av - bv;
        const ca = catOrder.get(a.categoryId) ?? 9999;
        const cb = catOrder.get(b.categoryId) ?? 9999;
        if (ca !== cb) return ca - cb;
        return a.name.localeCompare(b.name, 'uz');
      });
  }, [items, q, filter, catOrder]);

  async function toggle(it: MenuItem) {
    if (busyIds.has(it.id)) return;
    const next = it.available === false;
    setError('');
    setBusyIds((s) => new Set(s).add(it.id));
    // Darhol ko'rsatamiz; xato bo'lsa qaytaramiz
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, available: next } : x)));
    try {
      const saved = await api.patch<MenuItem>(`/menu/items/${it.id}/availability`, { available: next });
      if (!alive.current) return;
      if (saved && saved.id === it.id && typeof saved.available === 'boolean') {
        setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, available: saved.available } : x)));
      }
    } catch (e) {
      if (!alive.current) return;
      setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, available: !next } : x)));
      setError(`«${it.name}»: ${(e as Error)?.message || 'saqlanmadi'}`);
    } finally {
      if (alive.current) {
        setBusyIds((s) => {
          const n = new Set(s);
          n.delete(it.id);
          return n;
        });
      }
    }
  }

  const chip = (key: Filter, label: string, count?: number, danger?: boolean) => {
    const on = filter === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setFilter(key)}
        aria-pressed={on}
        data-testid={`stoplist-cat-${key}`}
        className={`shrink-0 h-11 px-3.5 rounded-xl border-2 text-sm font-bold whitespace-nowrap transition-colors ${
          on
            ? danger
              ? 'bg-danger text-white border-danger'
              : 'bg-primary-hover text-white border-primary-hover'
            : 'bg-bg text-text border-border hover:border-primary'
        }`}
      >
        {label}
        {typeof count === 'number' && <span className={`ml-1.5 ${on ? 'text-white/85' : 'text-muted'}`}>{count}</span>}
      </button>
    );
  };

  return (
    <Sheet
      title="Stop list"
      subtitle="Tugagan taomni bosing — ofitsiant menyusida «Tugadi» bo‘lib turadi"
      icon={<StopIcon className="w-6 h-6" />}
      iconTone="bg-danger/15 text-danger"
      size="xl"
      onClose={onClose}
      testId="stoplist-modal"
      bodyClassName="p-0 flex flex-col"
      footer={
        <div className="space-y-2.5">
          {searchActive && kb.show && (
            <TouchKeyboard target={searchRef} value={q} onChange={(v) => setQ(v.slice(0, 60))} maxLength={60} onEnter={() => setSearchActive(false)} />
          )}
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0 text-sm font-semibold text-muted">
              {offCount > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="rounded-md bg-danger text-white px-2 py-0.5 font-extrabold" data-testid="stoplist-count">
                    {offCount}
                  </span>
                  ta taom tugagan
                </span>
              ) : (
                <span className="text-success font-bold">Barcha taomlar bor</span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-14 px-6 rounded-2xl bg-primary-hover text-white text-lg font-black hover:brightness-110 active:scale-[0.98]"
            >
              Tayyor
            </button>
          </div>
        </div>
      }
    >
      <div className="shrink-0 px-4 sm:px-5 pt-3 pb-2 space-y-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <SearchIcon className="w-5 h-5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setSearchActive(true)}
              inputMode={kb.touch && kb.show ? 'none' : undefined}
              placeholder="Taom nomi bo‘yicha qidirish"
              data-testid="stoplist-search"
              className="w-full h-12 pl-10 pr-11 rounded-xl bg-bg border-2 border-border focus:border-primary outline-none text-base font-semibold text-text placeholder:font-normal placeholder:text-muted/60"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label="Tozalash"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg text-muted hover:text-text flex items-center justify-center"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            )}
          </div>
          <KeyboardToggle show={kb.show} onToggle={() => kb.setShow(!kb.show)} />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {chip('all', 'Hammasi', items.length)}
          {chip('off', 'Tugaganlar', offCount, true)}
          {usedCats.map((c) => chip(c.id, c.name))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-5 py-3">
        {error && (
          <div className="mb-3">
            <SheetError>{error}</SheetError>
          </div>
        )}
        {!loaded ? (
          <div className="py-16 flex flex-col items-center gap-3 text-muted">
            <Spinner className="w-8 h-8 border-primary" />
            Yuklanmoqda…
          </div>
        ) : loadError ? (
          <div className="py-10 text-center space-y-3">
            <div className="text-danger font-semibold">{loadError}</div>
            <button
              type="button"
              onClick={() => {
                setLoaded(false);
                void load();
              }}
              className="h-11 px-4 rounded-xl border border-border font-bold hover:border-primary"
            >
              Qayta urinish
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="py-12 text-center text-muted font-semibold">
            {filter === 'off' ? 'Tugagan taom yo‘q' : 'Hech narsa topilmadi'}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {shown.map((it) => {
              const off = it.available === false;
              const busy = busyIds.has(it.id);
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => void toggle(it)}
                  disabled={busy}
                  aria-pressed={off}
                  data-testid={`stoplist-item-${it.id}`}
                  data-available={off ? 'false' : 'true'}
                  className={`min-h-[64px] rounded-2xl border-2 pl-3.5 pr-2 py-2 flex items-center gap-3 text-left transition-colors active:scale-[0.99] disabled:opacity-70 ${
                    off ? 'border-danger bg-danger/10' : 'border-border bg-bg hover:border-primary/60'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block font-extrabold leading-tight truncate ${off ? 'text-danger' : 'text-text'}`}>{it.name}</span>
                    <span className="block text-xs font-semibold text-muted truncate">
                      {catById.get(it.categoryId)?.name ?? ''}
                      {catById.get(it.categoryId) ? ' · ' : ''}
                      {formatSum(it.price)}
                      {it.unit === MenuUnit.Weight ? ' / kg' : ''}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 h-11 min-w-[96px] px-3 rounded-xl flex items-center justify-center gap-1.5 text-sm font-black ${
                      off ? 'bg-danger text-white' : 'bg-success text-black'
                    }`}
                  >
                    {busy ? (
                      <Spinner className={`w-4 h-4 ${off ? 'border-white' : 'border-black'}`} />
                    ) : off ? (
                      <StopIcon className="w-4 h-4" />
                    ) : (
                      <CheckIcon className="w-4 h-4" />
                    )}
                    {off ? 'Tugadi' : 'Bor'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
  );
}
