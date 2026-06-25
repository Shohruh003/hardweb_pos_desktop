import { useEffect, useState } from 'react';
import { Button } from '../../components/ui';
import { Select } from '../../components/Select';
import type { PrinterConfig } from '../../global';

// Qurilmalarni sozlash (TZ F-4.4) — chek printeri (ESC/POS, tarmoq)
export function DevicesTab() {
  const [cfg, setCfg] = useState<PrinterConfig>({
    type: 'none',
    host: '192.168.1.50',
    port: 9100,
    width: 32,
  });
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.hardweb?.printer.getConfig().then(setCfg).catch(() => {});
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

  return (
    <div className="max-w-xl">
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="font-bold mb-4">Chek printeri (ESC/POS)</div>

        <label className="block text-sm text-muted mb-1">Ulanish turi</label>
        <Select
          className="mb-4"
          value={cfg.type}
          onChange={(v) => setCfg({ ...cfg, type: v as PrinterConfig['type'] })}
          options={[
            { value: 'none', label: 'O‘chirilgan' },
            { value: 'network', label: 'Tarmoq (LAN/Wi-Fi/IP)' },
          ]}
        />

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

      <p className="text-sm text-muted mt-4">
        Eslatma: hozir tarmoq (IP) printerlar qo‘llab-quvvatlanadi. USB printerlar
        keyingi bosqichda qo‘shiladi.
      </p>
    </div>
  );
}
