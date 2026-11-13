import { useEffect, useMemo, useState } from 'react';
import { Table, TableStatus } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CloseIcon, LayersIcon, PencilIcon, PlusIcon, TrashIcon } from '../../components/cashier/icons';
import { cleanDecimalInput, cleanDigitsInput, parseDecimal } from '../../components/numeric';
import { formatPercent } from '../../components/cashier/orderType';
import { api } from '../../lib/api';
import { refreshPosSettings, sortHalls, usePosSettings } from '../../lib/posSettings';
import { useConfirm } from '../../state/confirm';

interface TableForm {
  id?: string;
  number: string;
  hall: string;
  capacity: string;
}

interface BulkForm {
  hall: string;
  from: string;
  to: string;
  capacity: string;
  /** zalning alohida xizmat haqi foizi (ixtiyoriy; bo'sh — umumiy foiz) */
  service: string;
}

/** Zal xizmat haqi foizini tahrirlash (qatordagi kichik maydon) */
interface ServiceEdit {
  hall: string;
  text: string;
}

const PERCENT_MESSAGE = 'Foiz 0 dan 100 gacha bo‘lishi kerak';

/** Kiritilgan foiz matni -> son (0..100) yoki null (noto'g'ri) */
function parsePercent(text: string): number | null {
  const clean = cleanDecimalInput(text, 2);
  if (clean === '' || clean === '.') return null;
  const n = parseDecimal(clean);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
}

/** Bir martada qo'shiladigan stollar chegarasi (server bilan bir xil) */
const BULK_MAX = 200;

const field = 'w-full h-11 px-3 rounded-lg bg-bg border border-border outline-none focus:border-primary';

// Stollar va zallarni boshqarish (TZ F-4.2):
//  - Zallar paneli: tartib (↑ / ↓ — ofitsiant va kassa ekranida shu tartibda), nomini o'zgartirish,
//    zalni o'chirish (ochiq buyurtmasi bo'lsa server rad etadi), stollarni ommaviy qo'shish,
//    zalning alohida xizmat haqi foizi (B24: masalan Banket zal 10 %, qolganlari umumiy 6 %);
//  - har zal stollari ixcham to'rda; stol bosilsa — tahrirlash / o'chirish.
export function TablesTab() {
  const confirm = useConfirm();
  const pos = usePosSettings();
  const [tables, setTables] = useState<Table[]>([]);
  const [loaded, setLoaded] = useState(false);
  // PUT javobidagi eng yangi tartib (POS sozlamalari yangilanguncha shu ishlatiladi)
  const [hallOrder, setHallOrder] = useState<string[] | null>(null);
  const [form, setForm] = useState<TableForm | null>(null);
  const [bulk, setBulk] = useState<BulkForm | null>(null);
  const [rename, setRename] = useState<{ from: string; to: string } | null>(null);
  const [svcEdit, setSvcEdit] = useState<ServiceEdit | null>(null);
  const [svcError, setSvcError] = useState('');
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    try {
      const list = await api.get<Table[]>('/tables');
      setTables(Array.isArray(list) ? list : []);
      setError('');
    } catch (e) {
      setError((e as Error)?.message || 'Stollar yuklanmadi');
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const order = hallOrder ?? pos.hallOrder;
  const halls = useMemo(() => sortHalls(tables.map((t) => t.hall), order), [tables, order]);
  const byHall = useMemo(() => {
    const m = new Map<string, Table[]>();
    for (const t of tables) {
      const arr = m.get(t.hall);
      if (arr) arr.push(t);
      else m.set(t.hall, [t]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.number - b.number);
    return m;
  }, [tables]);

  // Zalning xizmat haqi foizi: o'zi bo'lsa — o'sha, aks holda umumiy (serviceDineInPercent)
  const hallPercent = (hall: string) => {
    const own = Object.prototype.hasOwnProperty.call(pos.hallServicePercent, hall);
    return { own, value: own ? pos.hallServicePercent[hall] : pos.serviceDineInPercent };
  };

  // PUT /tables/hall-service {hall, percent} — percent null: zal umumiy foizga qaytadi
  async function saveHallService(hall: string, percent: number | null) {
    if (busy) return;
    setBusy(true);
    setSvcError('');
    try {
      await api.put<{ ok: boolean }>('/tables/hall-service', { hall, percent });
      await refreshPosSettings();
      setSvcEdit(null);
      ok(
        percent === null
          ? `“${hall}”: xizmat haqi — umumiy (${formatPercent(pos.serviceDineInPercent)} %)`
          : `“${hall}”: xizmat haqi ${formatPercent(percent)} % — yangi ochiladigan hisoblarga`,
      );
    } catch (e) {
      setSvcError((e as Error)?.message || 'Foiz saqlanmadi');
    } finally {
      setBusy(false);
    }
  }

  function submitHallService() {
    if (!svcEdit) return;
    const p = parsePercent(svcEdit.text);
    if (p === null) {
      setSvcError(PERCENT_MESSAGE);
      return;
    }
    void saveHallService(svcEdit.hall, p);
  }

  function ok(text: string) {
    setNotice(text);
    setError('');
    window.setTimeout(() => setNotice((cur) => (cur === text ? '' : cur)), 3000);
  }

  // Zallar tartibi o'zgarganda / zal nomi o'zgarganda — barcha ekranlar yangi tartibni olsin
  async function syncHalls() {
    await refreshPosSettings();
    setHallOrder(null);
  }

  // ---- Zallar ----
  async function moveHall(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (busy || j < 0 || j >= halls.length) return;
    const next = [...halls];
    [next[index], next[j]] = [next[j], next[index]];
    const prev = hallOrder;
    setHallOrder(next);
    setBusy(true);
    setError('');
    try {
      const res = await api.put<{ ok: boolean; hallOrder?: string[] }>('/tables/hall-order', { halls: next });
      if (Array.isArray(res?.hallOrder)) setHallOrder(res.hallOrder);
      await refreshPosSettings();
    } catch (e) {
      setHallOrder(prev);
      setError((e as Error)?.message || 'Zallar tartibi saqlanmadi');
    } finally {
      setBusy(false);
    }
  }

  async function saveRename() {
    if (!rename || busy) return;
    const to = rename.to.trim();
    if (!to) {
      setModalError('Yangi zal nomini kiriting');
      return;
    }
    if (to === rename.from) {
      setRename(null);
      return;
    }
    setBusy(true);
    setModalError('');
    try {
      const res = await api.post<{ ok: boolean; updated?: number }>('/tables/hall/rename', { from: rename.from, to });
      setRename(null);
      await load();
      await syncHalls();
      ok(`“${rename.from}” → “${to}” (${res?.updated ?? 0} ta stol)`);
    } catch (e) {
      setModalError((e as Error)?.message || 'Nomi o‘zgarmadi');
    } finally {
      setBusy(false);
    }
  }

  async function deleteHall(hall: string) {
    const n = byHall.get(hall)?.length ?? 0;
    const yes = await confirm({
      title: 'Zalni o‘chirish',
      message: `“${hall}” zali va undagi ${n} ta stol o‘chirilsinmi? Bu amalni qaytarib bo‘lmaydi.`,
      confirmText: 'O‘chirish',
      danger: true,
    });
    if (!yes) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ ok: boolean; deleted?: number }>('/tables/hall/delete', { hall });
      await load();
      await syncHalls();
      ok(`“${hall}” zali o‘chirildi (${res?.deleted ?? n} ta stol)`);
    } catch (e) {
      // Masalan: "Bu zalda ochiq buyurtma bor — avval yoping"
      setError(`“${hall}”: ${(e as Error)?.message || 'o‘chirilmadi'}`);
    } finally {
      setBusy(false);
    }
  }

  // ---- Stollarni ommaviy qo'shish ----
  function openBulk(hall?: string) {
    const h = hall ?? halls[0] ?? '';
    const nums = (byHall.get(h) ?? []).map((t) => t.number);
    const from = (nums.length ? Math.max(...nums) : 0) + 1;
    setModalError('');
    setBulk({ hall: h, from: String(from), to: String(from + 9), capacity: '4', service: '' });
  }

  async function saveBulk() {
    if (!bulk || busy) return;
    const hall = bulk.hall.trim();
    const from = Number(bulk.from);
    const to = Number(bulk.to);
    const capacity = Number(bulk.capacity) || 4;
    if (!hall) return setModalError('Zal nomini kiriting');
    if (!(from >= 1) || !(to >= from)) return setModalError('Raqamlar oralig‘i noto‘g‘ri: 1 ≤ "dan" ≤ "gacha"');
    if (to - from + 1 > BULK_MAX) return setModalError(`Bir martada ko‘pi bilan ${BULK_MAX} ta stol qo‘shiladi`);
    // Ixtiyoriy: zalning alohida xizmat haqi foizi (bo'sh — umumiy foiz qo'llanadi)
    const serviceText = bulk.service.trim();
    const servicePercent = serviceText ? parsePercent(serviceText) : null;
    if (serviceText && servicePercent === null) return setModalError(PERCENT_MESSAGE);
    setBusy(true);
    setModalError('');
    try {
      const res = await api.post<{ ok: boolean; created?: number }>('/tables/bulk', {
        hall,
        from,
        to,
        capacity,
        ...(servicePercent !== null ? { servicePercent } : {}),
      });
      if (servicePercent !== null) await refreshPosSettings();
      const created = res?.created ?? 0;
      const total = to - from + 1;
      setBulk(null);
      await load();
      ok(
        created === total
          ? `“${hall}”: ${created} ta stol qo‘shildi ✓`
          : `“${hall}”: ${created} ta stol qo‘shildi, ${total - created} tasi allaqachon bor edi`,
      );
    } catch (e) {
      setModalError((e as Error)?.message || 'Stollar qo‘shilmadi');
    } finally {
      setBusy(false);
    }
  }

  // ---- Bitta stol ----
  function openAdd(hall?: string) {
    const h = hall ?? halls[0] ?? '';
    const nums = (byHall.get(h) ?? []).map((t) => t.number);
    setModalError('');
    setForm({ number: String((nums.length ? Math.max(...nums) : 0) + 1), hall: h, capacity: '4' });
  }
  function openEdit(t: Table) {
    setModalError('');
    setForm({ id: t.id, number: String(t.number), hall: t.hall, capacity: String(t.capacity) });
  }

  async function saveTable() {
    if (!form || busy) return;
    const number = Number(form.number);
    const hall = form.hall.trim();
    if (!(number >= 1) || !hall) {
      setModalError('Stol raqami va zal nomini kiriting');
      return;
    }
    const body = { number, hall, capacity: Number(form.capacity) || 4 };
    setBusy(true);
    setModalError('');
    try {
      if (form.id) await api.patch(`/tables/${form.id}`, body);
      else await api.post('/tables', body);
      setForm(null);
      await load();
    } catch (e) {
      setModalError((e as Error)?.message || 'Saqlanmadi');
    } finally {
      setBusy(false);
    }
  }

  async function removeTable(t: Table) {
    const yes = await confirm({ title: 'Stolni o‘chirish', message: `${t.hall} — Stol ${t.number} o‘chirilsinmi?`, danger: true });
    if (!yes) return;
    setBusy(true);
    setModalError('');
    try {
      await api.del(`/tables/${t.id}`);
      setForm(null);
      await load();
    } catch (e) {
      // Masalan: "Stolda ochiq buyurtma bor"
      setModalError((e as Error)?.message || 'O‘chirilmadi');
    } finally {
      setBusy(false);
    }
  }

  const hallOptions = (
    <datalist id="halls-list">
      {halls.map((h) => (
        <option key={h} value={h} />
      ))}
    </datalist>
  );

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="text-muted">
          {tables.length} ta stol · {halls.length} ta zal
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="ghost" onClick={() => openBulk()} className="h-11 flex items-center gap-1.5" data-testid="tables-bulk-open">
            <LayersIcon className="w-5 h-5" /> Stollarni qo‘shish
          </Button>
          <Button onClick={() => openAdd()} className="h-11 flex items-center gap-1.5">
            <PlusIcon className="w-5 h-5" /> Yangi stol
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-3 flex items-start gap-2 bg-danger/10 border border-danger/50 text-danger rounded-xl px-3 py-2.5 text-sm font-semibold">
          <span className="flex-1">⚠️ {error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Yopish" className="font-bold">
            ✕
          </button>
        </div>
      )}
      {notice && !error && (
        <div className="mb-3 flex items-center gap-2 bg-success/10 border border-success/50 text-success rounded-xl px-3 py-2.5 text-sm font-bold">
          <CheckIcon className="w-4 h-4" /> {notice}
        </div>
      )}

      {/* Zallar paneli */}
      {halls.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl mb-5" data-testid="hall-manager">
          <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-2">
            <div className="font-bold text-text">Zallar</div>
            <div className="text-xs text-muted">Ofitsiant va kassa ekranida shu tartibda chiqadi</div>
          </div>
          <div className="divide-y divide-border">
            {halls.map((h, i) => {
              const list = byHall.get(h) ?? [];
              const busyCount = list.filter((t) => t.status !== TableStatus.Free).length;
              return (
                <div key={h} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5" data-testid={`hall-row-${i + 1}`}>
                  <span className="w-7 text-center text-sm font-bold text-muted shrink-0">{i + 1}</span>
                  <div className="min-w-0 flex-1 basis-[160px]">
                    <div className="font-semibold text-text truncate">{h}</div>
                    <div className="text-xs text-muted">
                      {list.length} ta stol
                      {busyCount > 0 && <span className="text-warning font-semibold"> · {busyCount} ta band</span>}
                    </div>
                  </div>
                  <HallServiceCell
                    index={i + 1}
                    percent={hallPercent(h)}
                    generalPercent={pos.serviceDineInPercent}
                    edit={svcEdit?.hall === h ? svcEdit : null}
                    error={svcEdit?.hall === h ? svcError : ''}
                    busy={busy}
                    onStart={() => {
                      setSvcError('');
                      const cur = hallPercent(h);
                      setSvcEdit({ hall: h, text: cur.own ? String(cur.value) : '' });
                    }}
                    onChange={(text) => {
                      setSvcError('');
                      setSvcEdit({ hall: h, text: cleanDecimalInput(text, 2) });
                    }}
                    onSave={submitHallService}
                    onReset={() => void saveHallService(h, null)}
                    onCancel={() => {
                      setSvcEdit(null);
                      setSvcError('');
                    }}
                  />
                  <div className="flex items-center gap-1.5 flex-wrap ml-auto">
                    <IconBtn label="Yuqoriga" onClick={() => moveHall(i, -1)} disabled={busy || i === 0} testId={`hall-up-${i + 1}`}>
                      <ArrowUpIcon className="w-5 h-5" />
                    </IconBtn>
                    <IconBtn
                      label="Pastga"
                      onClick={() => moveHall(i, 1)}
                      disabled={busy || i === halls.length - 1}
                      testId={`hall-down-${i + 1}`}
                    >
                      <ArrowDownIcon className="w-5 h-5" />
                    </IconBtn>
                    <button
                      type="button"
                      onClick={() => {
                        setModalError('');
                        setRename({ from: h, to: h });
                      }}
                      disabled={busy}
                      className="h-11 px-3 rounded-lg bg-bg border border-border hover:border-primary text-sm font-semibold text-text inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <PencilIcon className="w-4 h-4" /> Nomini o‘zgartirish
                    </button>
                    <button
                      type="button"
                      onClick={() => openBulk(h)}
                      disabled={busy}
                      className="h-11 px-3 rounded-lg bg-bg border border-border hover:border-primary text-sm font-semibold text-text inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <PlusIcon className="w-4 h-4" /> Stollar
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteHall(h)}
                      disabled={busy}
                      data-testid={`hall-delete-${i + 1}`}
                      className="h-11 px-3 rounded-lg bg-bg border border-danger/40 text-danger hover:bg-danger/10 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <TrashIcon className="w-4 h-4" /> Zalni o‘chirish
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Har zal stollari — ixcham to'r */}
      <div className="space-y-5">
        {loaded && halls.length === 0 && (
          <div className="text-muted bg-surface border border-border rounded-2xl p-6 text-center">
            Stol yo‘q. “Stollarni qo‘shish” bilan bir zalga bir nechta stolni birdaniga qo‘shing.
          </div>
        )}
        {halls.map((h) => {
          const list = byHall.get(h) ?? [];
          return (
            <div key={h}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="font-bold text-text">
                  {h} <span className="text-sm font-semibold text-muted">· {list.length} ta</span>
                  <span className="text-sm font-semibold text-muted"> · xizmat {formatPercent(hallPercent(h).value)} %</span>
                </div>
                <button
                  type="button"
                  onClick={() => openAdd(h)}
                  className="h-10 px-3 rounded-lg text-sm font-semibold text-primary hover:bg-primary/10 inline-flex items-center gap-1"
                >
                  <PlusIcon className="w-4 h-4" /> Stol
                </button>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12 gap-2">
                {list.map((t) => {
                  const free = t.status === TableStatus.Free;
                  return (
                    // Raqam — "№"siz, katta va chapda (restoran egasi talabi); sig'im/holat — kichik
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => openEdit(t)}
                      title={`Stol ${t.number} — ${t.capacity} kishi — ${free ? 'bo‘sh' : 'band'}`}
                      data-testid={`admin-table-${t.number}`}
                      className="relative h-[72px] rounded-xl bg-surface border border-border hover:border-primary pl-2.5 pr-2 py-2 flex flex-col items-start justify-between text-left transition-colors"
                    >
                      <span
                        className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full ${free ? 'bg-success' : 'bg-warning'}`}
                        aria-hidden
                      />
                      <span className="text-2xl sm:text-3xl font-black text-text leading-none tracking-tight">{t.number}</span>
                      <span className="text-[11px] font-semibold text-muted leading-none">{t.capacity} kishi</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Stol qo'shish / tahrirlash */}
      {form && (
        <Modal title={form.id ? 'Stolni tahrirlash' : 'Yangi stol'} onClose={() => !busy && setForm(null)}>
          <label className="block text-sm text-muted mb-1">Stol raqami</label>
          <input
            inputMode="numeric"
            value={form.number}
            onChange={(e) => setForm({ ...form, number: cleanDigitsInput(e.target.value).slice(0, 5) })}
            className={`${field} mb-3`}
          />
          <label className="block text-sm text-muted mb-1">Zal</label>
          <input
            value={form.hall}
            onChange={(e) => setForm({ ...form, hall: e.target.value })}
            list="halls-list"
            placeholder="Zal nomi"
            className={`${field} mb-3`}
          />
          {hallOptions}
          <label className="block text-sm text-muted mb-1">Sig‘imi (kishi)</label>
          <input
            inputMode="numeric"
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: cleanDigitsInput(e.target.value).slice(0, 3) })}
            className={`${field} mb-4`}
          />
          {modalError && <ModalError text={modalError} />}
          <div className="flex gap-2">
            {form.id && (
              <button
                type="button"
                className="h-12 px-3 rounded-lg border border-danger/40 bg-surface text-danger font-semibold hover:bg-danger/10 inline-flex items-center gap-1.5 disabled:opacity-50"
                disabled={busy}
                aria-label="Stolni o‘chirish"
                onClick={() => {
                  const t = tables.find((x) => x.id === form.id);
                  if (t) removeTable(t);
                }}
              >
                <TrashIcon className="w-5 h-5" />
                <span className="hidden sm:inline">O‘chirish</span>
              </button>
            )}
            <Button variant="ghost" className="flex-1 h-12" onClick={() => setForm(null)} disabled={busy}>
              Bekor
            </Button>
            <Button className="flex-1 h-12" onClick={saveTable} disabled={busy}>
              {busy ? 'Saqlanmoqda…' : form.id ? 'Saqlash' : 'Qo‘shish'}
            </Button>
          </div>
        </Modal>
      )}

      {/* Zal nomini o'zgartirish */}
      {rename && (
        <Modal title="Zal nomini o‘zgartirish" onClose={() => !busy && setRename(null)}>
          <div className="text-sm text-muted mb-2">
            Hozirgi nom: <span className="font-semibold text-text">{rename.from}</span>
          </div>
          <label className="block text-sm text-muted mb-1">Yangi nom</label>
          <input
            autoFocus
            value={rename.to}
            onChange={(e) => {
              setRename({ ...rename, to: e.target.value });
              setModalError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && saveRename()}
            className={`${field} mb-4`}
          />
          {modalError && <ModalError text={modalError} />}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1 h-12" onClick={() => setRename(null)} disabled={busy}>
              Bekor
            </Button>
            <Button className="flex-1 h-12" onClick={saveRename} disabled={busy}>
              {busy ? 'Saqlanmoqda…' : 'Saqlash'}
            </Button>
          </div>
        </Modal>
      )}

      {/* Stollarni ommaviy qo'shish */}
      {bulk && (
        <Modal title="Stollarni qo‘shish" onClose={() => !busy && setBulk(null)}>
          <label className="block text-sm text-muted mb-1">Zal</label>
          <input
            value={bulk.hall}
            onChange={(e) => setBulk({ ...bulk, hall: e.target.value })}
            list="halls-list"
            placeholder="Masalan: Zal, Tapchan, Terrasa"
            className={`${field} mb-3`}
            data-testid="tables-bulk-hall"
          />
          {hallOptions}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <label className="block">
              <span className="block text-sm text-muted mb-1">Raqam: dan</span>
              <input
                inputMode="numeric"
                value={bulk.from}
                onChange={(e) => setBulk({ ...bulk, from: cleanDigitsInput(e.target.value).slice(0, 5) })}
                className={field}
                data-testid="tables-bulk-from"
              />
            </label>
            <label className="block">
              <span className="block text-sm text-muted mb-1">gacha</span>
              <input
                inputMode="numeric"
                value={bulk.to}
                onChange={(e) => setBulk({ ...bulk, to: cleanDigitsInput(e.target.value).slice(0, 5) })}
                className={field}
                data-testid="tables-bulk-to"
              />
            </label>
            <label className="block">
              <span className="block text-sm text-muted mb-1">Sig‘imi</span>
              <input
                inputMode="numeric"
                value={bulk.capacity}
                onChange={(e) => setBulk({ ...bulk, capacity: cleanDigitsInput(e.target.value).slice(0, 3) })}
                className={field}
              />
            </label>
          </div>
          <label className="block mb-3">
            <span className="block text-sm text-muted mb-1">Xizmat haqi, % (ixtiyoriy — shu zal uchun)</span>
            <input
              inputMode="decimal"
              value={bulk.service}
              onChange={(e) => setBulk({ ...bulk, service: cleanDecimalInput(e.target.value, 2) })}
              placeholder={`Bo‘sh — umumiy foiz (${formatPercent(pos.serviceDineInPercent)} %)`}
              className={field}
              data-testid="tables-bulk-service"
            />
            {bulk.hall.trim() && hallPercent(bulk.hall.trim()).own && (
              <span className="block mt-1 text-xs text-muted">
                Hozir “{bulk.hall.trim()}”: {formatPercent(hallPercent(bulk.hall.trim()).value)} % (bo‘sh qoldirilsa — o‘zgarmaydi)
              </span>
            )}
          </label>
          <div className="text-sm text-muted mb-4">
            {Number(bulk.to) >= Number(bulk.from) && Number(bulk.from) >= 1
              ? `${Number(bulk.to) - Number(bulk.from) + 1} ta stol: ${bulk.from} dan ${bulk.to} gacha. Zalda bor raqamlar o‘tkazib yuboriladi.`
              : 'Raqamlar oralig‘ini kiriting'}
          </div>
          {modalError && <ModalError text={modalError} />}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1 h-12" onClick={() => setBulk(null)} disabled={busy}>
              Bekor
            </Button>
            <Button className="flex-1 h-12" onClick={saveBulk} disabled={busy} data-testid="tables-bulk-save">
              {busy ? 'Qo‘shilmoqda…' : 'Qo‘shish'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Zal qatoridagi xizmat haqi foizi: "Xizmat haqi: 6 % (umumiy)" yoki o'z foizi "10 %".
 * Bosilsa — kichik maydon: foiz, "Saqlash", "Umumiy" (zalning o'z foizini olib tashlash), bekor.
 */
function HallServiceCell({
  index,
  percent,
  generalPercent,
  edit,
  error,
  busy,
  onStart,
  onChange,
  onSave,
  onReset,
  onCancel,
}: {
  index: number;
  percent: { own: boolean; value: number };
  generalPercent: number;
  edit: ServiceEdit | null;
  error: string;
  busy: boolean;
  onStart: () => void;
  onChange: (text: string) => void;
  onSave: () => void;
  onReset: () => void;
  onCancel: () => void;
}) {
  if (!edit) {
    return (
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        data-testid={`hall-service-${index}`}
        title="Shu zalga yangi ochiladigan hisoblar uchun xizmat haqi foizi"
        className={`h-11 px-3 rounded-lg border text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 ${
          percent.own ? 'bg-primary/10 border-primary/50 text-text' : 'bg-bg border-border text-text hover:border-primary'
        }`}
      >
        Xizmat haqi: <b className="tabular-nums">{formatPercent(percent.value)} %</b>
        {!percent.own && <span className="text-muted font-normal">(umumiy)</span>}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-1" data-testid={`hall-service-edit-${index}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="relative">
          <input
            autoFocus
            inputMode="decimal"
            value={edit.text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave();
              if (e.key === 'Escape') onCancel();
            }}
            placeholder={formatPercent(generalPercent)}
            aria-label="Xizmat haqi foizi"
            data-testid={`hall-service-input-${index}`}
            className="w-24 h-11 pl-3 pr-7 rounded-lg bg-bg border-2 border-primary outline-none text-base font-bold text-text"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted font-bold">%</span>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          data-testid={`hall-service-save-${index}`}
          className="h-11 px-3 rounded-lg bg-primary-hover text-white text-sm font-bold disabled:opacity-50"
        >
          Saqlash
        </button>
        {percent.own && (
          <button
            type="button"
            onClick={onReset}
            disabled={busy}
            data-testid={`hall-service-reset-${index}`}
            title={`Umumiy foizga qaytarish (${formatPercent(generalPercent)} %)`}
            className="h-11 px-3 rounded-lg bg-bg border border-border text-sm font-semibold text-text hover:border-primary disabled:opacity-50"
          >
            Umumiy
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          aria-label="Bekor qilish"
          className="w-11 h-11 rounded-lg bg-bg border border-border text-muted hover:text-text flex items-center justify-center disabled:opacity-50"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>
      {error && <div className="text-xs font-semibold text-danger">{error}</div>}
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-testid={testId}
      className="w-11 h-11 rounded-lg bg-bg border border-border hover:border-primary flex items-center justify-center text-text disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function ModalError({ text }: { text: string }) {
  return (
    <div role="alert" className="mb-3 bg-danger/10 border border-danger/50 text-danger rounded-xl px-3 py-2 text-sm font-semibold">
      {text}
    </div>
  );
}
