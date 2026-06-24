import { useEffect, useState } from 'react';
import { Table, TableStatus } from '@hardweb-pos/shared';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';

// Stollar va zallarni boshqarish (TZ F-4.2)
export function TablesTab() {
  const [tables, setTables] = useState<Table[]>([]);
  const [number, setNumber] = useState('');
  const [hall, setHall] = useState('');
  const [capacity, setCapacity] = useState('4');

  async function load() {
    setTables(await api.get<Table[]>('/tables'));
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function addTable(e: React.FormEvent) {
    e.preventDefault();
    if (!number || !hall) return;
    await api.post('/tables', {
      number: Number(number),
      hall,
      capacity: Number(capacity) || 4,
    });
    setNumber('');
    await load();
  }

  // Zallar bo'yicha guruhlash
  const halls = Array.from(new Set(tables.map((t) => t.hall)));

  return (
    <div className="grid grid-cols-3 gap-6">
      <form
        onSubmit={addTable}
        className="bg-surface border border-border rounded-xl p-4 h-fit"
      >
        <div className="font-bold mb-3">Yangi stol</div>
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          type="number"
          placeholder="Stol raqami"
          className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <input
          value={hall}
          onChange={(e) => setHall(e.target.value)}
          placeholder="Zal nomi"
          className="w-full mb-2 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
          list="halls"
        />
        <datalist id="halls">
          {halls.map((h) => (
            <option key={h} value={h} />
          ))}
        </datalist>
        <input
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          type="number"
          placeholder="Sig'imi"
          className="w-full mb-3 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
        />
        <Button type="submit" className="w-full">
          Qo‘shish
        </Button>
      </form>

      <div className="col-span-2 space-y-5">
        {halls.map((h) => (
          <div key={h}>
            <div className="font-semibold mb-2 text-muted">{h}</div>
            <div className="grid grid-cols-4 gap-3">
              {tables
                .filter((t) => t.hall === h)
                .map((t) => (
                  <div
                    key={t.id}
                    className="bg-surface border border-border rounded-xl p-3 text-center"
                  >
                    <div className="text-xl font-bold">№{t.number}</div>
                    <div className="text-xs text-muted">{t.capacity} kishi</div>
                    <div
                      className={`text-xs mt-1 font-semibold ${
                        t.status === TableStatus.Free
                          ? 'text-success'
                          : 'text-warning'
                      }`}
                    >
                      {t.status === TableStatus.Free ? 'Bo‘sh' : 'Band'}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
