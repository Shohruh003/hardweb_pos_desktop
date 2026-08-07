import { useEffect, useState } from 'react';
import logo from '../assets/logo.png';

// Ilova ochilganda birinchi chiqadigan animatsiyali splash ekran.
// Sof oq fon — logo rasmining oq foni bilan bir xil, shuning uchun ramka ko'rinmaydi.
// Rasm butun ekranni egallaydi. ~2.2s ko'rinadi, keyin silliq so'nib ilovaga o'tadi.
export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setExiting(true), 2200);
    const t2 = setTimeout(onDone, 2700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-white"
      style={{
        opacity: exiting ? 0 : 1,
        transition: 'opacity 0.5s ease',
      }}
    >
      {/* Logo — ekranni to'ldiradi, oq fon bilan qo'shilib ketadi (ramka yo'q) */}
      <img
        src={logo}
        alt="DasturXon"
        className="animate-splash-pop w-full h-full object-contain select-none"
        style={{ maxWidth: '100vw', maxHeight: '100vh' }}
        draggable={false}
      />

      {/* Yuklanish chizig'i — pastda, nozik */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-64 max-w-[60vw]">
        <div className="h-1.5 w-full rounded-full bg-black/5 overflow-hidden">
          <div
            className="h-full rounded-full animate-splash-bar"
            style={{ background: 'linear-gradient(90deg, #F59E0B, #059669)' }}
          />
        </div>
      </div>
    </div>
  );
}
