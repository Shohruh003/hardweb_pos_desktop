import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui';
import { Select } from '../../components/Select';
import { MOCK } from '../../lib/api';
import { ServerAddressForm } from '../LoginPage';
import type { PrinterConfig } from '../../global';

const NO_BRIDGE_MESSAGE = '⚠️ Printer faqat DasturXon ilovasi oynasida ishlaydi (brauzerda emas)';

// Qurilmalarni sozlash (TZ F-4.4) — server manzili + shu kompyuterning chek printeri (ESC/POS)
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
  const [testing, setTesting] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const msgTimer = useRef<number | undefined>(undefined);

  // Xabarni ko'rsatish (ms > 0 bo'lsa — shuncha vaqtdan keyin yo'qoladi)
  function flash(text: string, ms = 4000) {
    window.clearTimeout(msgTimer.current);
    setMsg(text);
    if (ms > 0) msgTimer.current = window.setTimeout(() => setMsg(''), ms);
  }
  useEffect(() => () => window.clearTimeout(msgTimer.current), []);

  useEffect(() => {
    window.hardweb?.printer?.getConfig().then(setCfg).catch(() => {});
    window.hardweb?.printer?.list().then(setPrinters).catch(() => {});
  }, []);

  async function save() {
    const bridge = window.hardweb?.printer;
    if (!bridge) return flash(NO_BRIDGE_MESSAGE, 5000);
    setSaving(true);
    try {
      const saved = await bridge.setConfig(cfg);
      setCfg(saved);
      flash('Sozlamalar saqlandi ✓', 3000);
    } catch (e) {
      flash(`⚠️ ${(e as Error).message || 'Saqlab bo‘lmadi'}`, 5000);
    } finally {
      setSaving(false);
    }
  }

  // Sinov cheki ekrandagi (hali saqlanmagan bo'lsa ham) sozlama bilan chiqishi uchun avval saqlaymiz
  async function test() {
    const bridge = window.hardweb?.printer;
    if (!bridge) return flash(NO_BRIDGE_MESSAGE, 5000);
    setTesting(true);
    flash('Sozlama saqlanib, sinov cheki yuborilmoqda...', 0);
    try {
      const saved = await bridge.setConfig(cfg);
      setCfg(saved);
      const res = await bridge.test();
      flash(res.ok ? '✓ Sinov cheki chop etildi' : `⚠️ ${res.message || 'Printer xatosi'}`, 6000);
    } catch (e) {
      flash(`⚠️ ${(e as Error).message || 'Sinov cheki yuborilmadi'}`, 6000);
    } finally {
      setTesting(false);
    }
  }

  // Printer faqat Electron oynasida ishlaydi — brauzerda ochilsa ogohlantiramiz
  const noBridge =
    typeof window === 'undefined' ||
    !(window as unknown as { hardweb?: unknown }).hardweb;

  return (
    <div className="max-w-3xl">
      {noBridge && (
        <div className="mb-4 px-4 py-2 rounded-lg text-sm font-semibold bg-danger/15 text-danger">
          ⚠️ Printer ko‘prigi ulanmagan — ilovani Electron oynasida oching (brauzerda
          chek chiqmaydi).
        </div>
      )}
      {/* Server manzili — bu terminal qaysi serverga ulanadi (boshqa PC'da o'zgartiriladi) */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="font-bold mb-1">Server manzili (bu terminal)</div>
        {MOCK ? (
          <div className="text-sm text-muted">Demo rejim — server ishlatilmaydi.</div>
        ) : (
          <>
            <div className="text-sm text-muted mb-3">
              Bir nechta terminal bo‘lsa — bu yerga server o‘rnatilgan (kassa) kompyuterning IP’sini yozing
              (masalan <span className="font-mono">http://192.168.1.10:3100</span>). Manzil tekshiriladi,
              saqlangach ilova yangi manzilga qayta ulanadi.
            </div>
            <ServerAddressForm />
          </>
        )}
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
            {printers.length > 0 ? (
              <Select
                value={cfg.printerName}
                onChange={(v) => setCfg({ ...cfg, printerName: v })}
                options={[
                  { value: '', label: '— printerni tanlang —' },
                  ...printers.map((p) => ({ value: p, label: p })),
                ]}
              />
            ) : (
              <input
                value={cfg.printerName}
                onChange={(e) => setCfg({ ...cfg, printerName: e.target.value })}
                placeholder="Masalan: DasturXon-POS80"
                className="w-full px-3 py-2 rounded-lg bg-bg border border-border outline-none focus:border-primary"
              />
            )}
            <div className="flex items-center gap-3 mt-1">
              <button
                onClick={() => window.hardweb?.printer?.list().then(setPrinters).catch(() => {})}
                className="text-xs text-muted hover:text-primary"
              >
                ↻ Ro‘yxatni yangilash
              </button>
              {printers.length === 0 && (
                <span className="text-xs text-muted/70">
                  Ro‘yxat bo‘sh — printer nomini qo‘lda yozing (Windows → Printerlar)
                </span>
              )}
            </div>
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
          <Button onClick={save} disabled={saving || testing} className="flex-1">
            {saving ? 'Saqlanmoqda...' : 'Saqlash'}
          </Button>
          <Button
            variant="ghost"
            onClick={test}
            disabled={cfg.type === 'none' || saving || testing}
            className="flex-1"
          >
            {testing ? 'Yuborilmoqda...' : 'Sinov cheki'}
          </Button>
        </div>

        {msg && <div className="mt-4 text-sm font-semibold text-text text-center">{msg}</div>}
      </div>

      {/* Oshxona/bar printerlari endi bo'limlar orqali: chekni server o'zi chiqaradi
          (terminal, telefon va oflayn yuborilgan buyurtmalar uchun ham) */}
      <div className="bg-surface border border-border rounded-xl p-5 mt-4">
        <div className="font-bold mb-1">Oshxona / bar printerlari</div>
        <div className="text-sm text-muted">
          Har bir bo‘lim (Oshxona, Bar, …) printerining IP manzili <span className="font-semibold text-text">Boshqaruv → Bo‘limlar</span>{' '}
          bo‘limida kiritiladi. Buyurtma yuborilganda chekni server o‘zi shu printerlarga chiqaradi —
          telefon va oflayn yuborilgan buyurtmalar uchun ham. Printer kassa kompyuteri bilan bir tarmoqda (port 9100) bo‘lishi kerak.
        </div>
      </div>

      <p className="text-sm text-muted mt-4">
        Eslatma: tarmoq (LAN/IP) printerlar to‘liq qo‘llab-quvvatlanadi (XPRINTER 80T
        — 80mm, port 9100). Kompyuter printer bilan bir tarmoqda bo‘lishi kerak.
      </p>
    </div>
  );
}
