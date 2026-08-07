import { useEffect, useState } from 'react';
import { Button } from '../../components/ui';
import { Select } from '../../components/Select';
import { getServerUrl, setServerUrl } from '../../lib/config';
import type { KitchenPrinter, PrinterConfig } from '../../global';

// Qurilmalarni sozlash (TZ F-4.4) — chek printeri + oshxona printerlari (ESC/POS, tarmoq)
export function DevicesTab() {
  const [cfg, setCfg] = useState<PrinterConfig>({
    type: 'none',
    host: '192.168.1.50',
    port: 9100,
    width: 48, // XPRINTER 80T — 80mm standart
    printerName: '',
    autoCut: true,
    kitchen: [],
  });
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [serverUrl, setServer] = useState(getServerUrl());

  function saveServer() {
    setServerUrl(serverUrl.trim());
    setMsg('Server manzili saqlandi ✓ (qayta ulanish uchun ilovani yangilang)');
    setTimeout(() => setMsg(''), 4000);
  }

  useEffect(() => {
    window.hardweb?.printer.getConfig().then(setCfg).catch(() => {});
    window.hardweb?.printer.list().then(setPrinters).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      const saved = await window.hardweb.printer.setConfig(cfg);
      setCfg(saved);
      setMsg('Sozlamalar saqlandi ✓');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 3000);
    }
  }

  async function test() {
    setMsg('Sinov cheki yuborilmoqda...');
    const res = await window.hardweb.printer.test();
    setMsg(res.message);
    setTimeout(() => setMsg(''), 4000);
  }

  // --- Oshxona printerlari ---
  const kitchen = cfg.kitchen ?? [];
  function addKitchen() {
    setCfg({
      ...cfg,
      kitchen: [
        ...kitchen,
        { name: `Oshxona ${kitchen.length + 1}`, host: '192.168.1.60', port: 9100, width: 48 },
      ],
    });
  }
  function updateKitchen(i: number, patch: Partial<KitchenPrinter>) {
    setCfg({
      ...cfg,
      kitchen: kitchen.map((k, idx) => (idx === i ? { ...k, ...patch } : k)),
    });
  }
  function removeKitchen(i: number) {
    setCfg({ ...cfg, kitchen: kitchen.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="max-w-3xl">
      {/* Server manzili — bu terminal qaysi serverga ulanadi (boshqa PC'da o'zgartiriladi) */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="font-bold mb-1">Server manzili (bu terminal)</div>
        <div className="text-sm text-muted mb-3">
          Bir nechta terminal bo'lsa — bu yerga server o'rnatilgan kompyuterning IP'sini yozing
          (masalan <span className="font-mono">http://192.168.1.10:3100</span>).
        </div>
        <div className="flex gap-2">
          <input
            value={serverUrl}
            onChange={(e) => setServer(e.target.value)}
            placeholder="http://127.0.0.1:3100"
            className="flex-1 px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary font-mono text-sm"
          />
          <Button onClick={saveServer}>Saqlash</Button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="font-bold mb-4">Chek printeri (ESC/POS)</div>

        <label className="block text-sm text-muted mb-1">Ulanish turi</label>
        <Select
          className="mb-4"
          value={cfg.type}
          onChange={(v) => setCfg({ ...cfg, type: v as PrinterConfig['type'] })}
          options={[
            { value: 'none', label: 'O‘chirilgan' },
            { value: 'usb', label: 'USB (Windows printer)' },
            { value: 'network', label: 'Tarmoq (LAN/Wi-Fi/IP)' },
          ]}
        />

        {cfg.type === 'usb' && (
          <div className="mb-4">
            <label className="block text-sm text-muted mb-1">Windows printeri</label>
            <Select
              value={cfg.printerName}
              onChange={(v) => setCfg({ ...cfg, printerName: v })}
              options={[
                { value: '', label: '— printerni tanlang —' },
                ...printers.map((p) => ({ value: p, label: p })),
              ]}
            />
            <button
              onClick={() => window.hardweb?.printer.list().then(setPrinters)}
              className="text-xs text-muted hover:text-primary mt-1"
            >
              ↻ Ro‘yxatni yangilash
            </button>
          </div>
        )}

        {cfg.type === 'network' && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="col-span-1">
              <label className="block text-sm text-muted mb-1">Printer IP</label>
              <input
                value={cfg.host}
                onChange={(e) => setCfg({ ...cfg, host: e.target.value })}
                placeholder="192.168.1.50"
                className="w-full px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Port</label>
              <input
                type="number"
                value={cfg.port}
                onChange={(e) =>
                  setCfg({ ...cfg, port: Number(e.target.value) || 9100 })
                }
                className="w-full px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
              />
            </div>
          </div>
        )}

        <label className="block text-sm text-muted mb-1">Qog‘oz kengligi</label>
        <div className="mb-5">
          <Select
            value={String(cfg.width)}
            onChange={(v) => setCfg({ ...cfg, width: Number(v) })}
            options={[
              { value: '32', label: '58 mm (32 belgi)' },
              { value: '48', label: '80 mm (48 belgi)' },
            ]}
          />
        </div>

        {/* Avtomatik qirqish — cutter xato bersa o'chiriladi */}
        <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={cfg.autoCut}
            onChange={(e) => setCfg({ ...cfg, autoCut: e.target.checked })}
            className="w-4 h-4 accent-primary"
          />
          <span className="text-sm">Qog‘ozni avtomatik qirqish (cutter)</span>
        </label>

        <div className="flex gap-2">
          <Button onClick={save} disabled={saving} className="flex-1">
            {saving ? 'Saqlanmoqda...' : 'Saqlash'}
          </Button>
          <Button
            variant="ghost"
            onClick={test}
            disabled={cfg.type === 'none'}
            className="flex-1"
          >
            Sinov cheki
          </Button>
        </div>

        {msg && <div className="mt-4 text-sm text-muted text-center">{msg}</div>}
      </div>

      {/* Oshxona printerlari — buyurtma yuborilganda oshxonaga chek chiqadi */}
      <div className="bg-surface border border-border rounded-xl p-5 mt-4">
        <div className="flex items-center justify-between mb-1">
          <div className="font-bold">Oshxona printerlari (LAN)</div>
          <Button variant="ghost" onClick={addKitchen}>+ Printer qo‘shish</Button>
        </div>
        <div className="text-sm text-muted mb-4">
          Har bir sex uchun alohida printer. Ofitsiant buyurtma yuborganda
          oshxona cheki avtomatik chiqadi.
        </div>

        {kitchen.length === 0 ? (
          <div className="text-sm text-muted">Hali oshxona printeri qo‘shilmagan.</div>
        ) : (
          <div className="space-y-3">
            {kitchen.map((k, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end bg-bg rounded-lg p-3">
                <div className="col-span-4">
                  <label className="block text-xs text-muted mb-1">Nomi</label>
                  <input
                    value={k.name}
                    onChange={(e) => updateKitchen(i, { name: e.target.value })}
                    placeholder="Issiq sex"
                    className="w-full px-2.5 py-2 rounded-lg bg-surface border border-border outline-none focus:border-primary text-sm"
                  />
                </div>
                <div className="col-span-4">
                  <label className="block text-xs text-muted mb-1">IP</label>
                  <input
                    value={k.host}
                    onChange={(e) => updateKitchen(i, { host: e.target.value })}
                    placeholder="192.168.1.60"
                    className="w-full px-2.5 py-2 rounded-lg bg-surface border border-border outline-none focus:border-primary text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-muted mb-1">Port</label>
                  <input
                    type="number"
                    value={k.port}
                    onChange={(e) => updateKitchen(i, { port: Number(e.target.value) || 9100 })}
                    className="w-full px-2.5 py-2 rounded-lg bg-surface border border-border outline-none focus:border-primary text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <button
                    onClick={() => removeKitchen(i)}
                    className="w-full py-2 rounded-lg border border-danger/50 text-danger text-sm font-semibold hover:bg-danger/10"
                  >
                    O‘chirish
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <Button onClick={save} disabled={saving} className="mt-4">
          {saving ? 'Saqlanmoqda...' : 'Oshxona printerlarini saqlash'}
        </Button>
      </div>

      <p className="text-sm text-muted mt-4">
        Eslatma: tarmoq (LAN/IP) printerlar to‘liq qo‘llab-quvvatlanadi (XPRINTER 80T
        — 80mm, port 9100). Kompyuter printer bilan bir tarmoqda bo‘lishi kerak.
      </p>
    </div>
  );
}
