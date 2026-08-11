import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Modal } from './Modal';

// Ofitsiant telefonda web ilovani ochishi uchun QR (kassaning http://IP:8080 manzili).
export function WaiterQrModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    window.hardweb
      ?.getLanInfo?.()
      .then((info) => {
        setAvailable(info.webAvailable);
        setUrl(info.webUrl);
        if (info.webUrl) {
          QRCode.toDataURL(info.webUrl, { width: 280, margin: 1 })
            .then(setQr)
            .catch(() => undefined);
        }
      })
      .catch(() => setAvailable(false));
  }, []);

  return (
    <Modal title="📱 Ofitsiant telefoni uchun" onClose={onClose}>
      {!available || !url ? (
        <div className="text-muted text-center py-6">
          Bu kompyuter web tarqatmaydi. QR faqat <b>kassa (server)</b> kompyuterida ko‘rinadi.
        </div>
      ) : (
        <div className="text-center">
          <div className="text-sm text-muted mb-3">
            Ofitsiant telefonda (kassa bilan bir xil WiFi‘da) shu QR‘ni skanerlaydi — ilova
            brauzerda ochiladi.
          </div>
          {qr ? (
            <img src={qr} alt="QR" className="mx-auto rounded-xl bg-white p-3 w-[240px] h-[240px]" />
          ) : (
            <div className="py-16 text-muted">QR tayyorlanmoqda...</div>
          )}
          <div className="mt-3 font-mono font-bold text-lg text-primary">{url}</div>
          <div className="text-xs text-muted mt-1">
            Yoki brauzerda shu manzilni yozadi
          </div>
        </div>
      )}
    </Modal>
  );
}
