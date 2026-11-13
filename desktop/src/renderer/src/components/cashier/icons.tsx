import type { ReactNode, SVGProps } from 'react';

// Kassa va boshqaruv ekranlari uchun inline SVG ikonkalar (kutubxonasiz).
// Emoji o'rniga: Windows 10 monobloklarda emoji yomon chiziladi, SVG esa har joyda bir xil
// va rangi matn rangidan (currentColor) olinadi — qorong'u va yorug' temada ham aniq ko'rinadi.

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function Svg({ children, className = 'w-5 h-5', strokeWidth = 2, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Stol (zalda o'tirib) */
export function TableIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 9.5h18" />
      <path d="M5 9.5 6.5 6h11L19 9.5" />
      <path d="M6 9.5V19M18 9.5V19M8.5 14h7" />
    </Svg>
  );
}

/** Olib ketish (paket) */
export function BagIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.5 8h13l-1 12.5h-11z" />
      <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" />
    </Svg>
  );
}

/** Yetkazib berish (yuk mashina) */
export function TruckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 6.5h11v10h-11z" />
      <path d="M13.5 10h4l3 3.2v3.3h-7" />
      <circle cx="6.5" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </Svg>
  );
}

/** Naqd pul */
export function CashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5v.01M18 14.5v.01" />
    </Svg>
  );
}

/** Bank kartasi */
export function CardIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19M6.5 15h4" />
    </Svg>
  );
}

/** QR kod (Click, Payme) */
export function QrIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
      <path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 18.5v2" />
    </Svg>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <Svg strokeWidth={2.6} {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function PencilIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.6a2.1 2.1 0 0 1 3 3L7.5 18.6 3.5 19.5l.9-4z" />
    </Svg>
  );
}

export function PhoneIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 16.6v2.9a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.5 5.2 2 2 0 0 1 4.5 3h2.9a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.4 10.8a16 16 0 0 0 4.8 4.8l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
    </Svg>
  );
}

export function PinIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </Svg>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

export function UserIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </Svg>
  );
}

export function PrinterIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 9V3.5h10V9" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v6.5H7z" />
    </Svg>
  );
}

export function TrashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Svg>
  );
}

export function CameraIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 8.5A2 2 0 0 1 5 6.5h2.2L9 4h6l1.8 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.6" />
    </Svg>
  );
}

export function ArrowUpIcon(p: IconProps) {
  return (
    <Svg strokeWidth={2.4} {...p}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Svg>
  );
}

export function ArrowDownIcon(p: IconProps) {
  return (
    <Svg strokeWidth={2.4} {...p}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg strokeWidth={2.6} {...p}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <Svg strokeWidth={2.4} {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function AlertIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5 2.5 20h19z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </Svg>
  );
}

export function ImageIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="9.5" r="1.8" />
      <path d="M21 16l-5-5-8.5 9" />
    </Svg>
  );
}

export function LayersIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3 2.5 8 12 13l9.5-5z" />
      <path d="M2.5 12.5 12 17.5l9.5-5M2.5 16.5 12 21.5l9.5-5" />
    </Svg>
  );
}

/** Hisobni bo'lish (qaychi) */
export function ScissorsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="7" r="2.6" />
      <circle cx="6" cy="17" r="2.6" />
      <path d="M8.2 8.6 20 18M8.2 15.4 20 6" />
    </Svg>
  );
}

/** Otkaz (taqiq belgisi) */
export function BanIcon(p: IconProps) {
  return (
    <Svg strokeWidth={2.4} {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 6l12 12" />
    </Svg>
  );
}

/** Stop list (tugagan taomlar) — sakkiz burchakli "stop" belgisi */
export function StopIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z" />
      <path d="M8 12h8" />
    </Svg>
  );
}

/** Kirim / chiqim (kassaga kirgan va chiqqan pul) */
export function CashFlowIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 20V5M3.5 8.5 7 5l3.5 3.5" />
      <path d="M17 4v15M13.5 15.5 17 19l3.5-3.5" />
    </Svg>
  );
}

/** Qarz (daftar) */
export function DebtIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 3.5h11.5a2 2 0 0 1 2 2v15H7a2 2 0 0 1-2-2z" />
      <path d="M5 18.5a2 2 0 0 1 2-2h11.5" />
      <path d="M9 8h6M9 11.5h4" />
    </Svg>
  );
}

/** Boshqa to'lov usuli (hamyon) */
export function WalletIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path d="M16 13.5h.01" />
    </Svg>
  );
}

/** Onlayn to'lov (telefon) — Click, Payme */
export function PhonePayIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.2" />
      <path d="M10.5 18.5h3" />
      <path d="M9.5 10.5 11.5 12.5l3.5-4" />
    </Svg>
  );
}

/** Cheklar tarixi (chek qog'ozi) */
export function ReceiptIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </Svg>
  );
}

/** Hisobot (ustunli diagramma) */
export function ChartIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h16" />
      <path d="M7 16v-5M12 16V7M17 16v-8" />
    </Svg>
  );
}

/** Stollar (POS ekrani — stol xaritasi) */
export function TablesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13" width="7.5" height="7.5" rx="1.6" />
    </Svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </Svg>
  );
}

export function MinusIcon(p: IconProps) {
  return (
    <Svg strokeWidth={2.6} {...p}>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <Svg strokeWidth={2.4} {...p}>
      <path d="M6 9.5l6 6 6-6" />
    </Svg>
  );
}

/** Teng bo'lish (odamlar) */
export function UsersIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5a6 6 0 0 1 12 0" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14a6 6 0 0 1 3.5 5.5" />
    </Svg>
  );
}

/** Foiz (chegirma / xizmat haqi) */
export function PercentIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M19 5 5 19" />
      <circle cx="7" cy="7" r="2.3" />
      <circle cx="17" cy="17" r="2.3" />
    </Svg>
  );
}

/** Ochish / tahrirlash uchun POS ekraniga o'tish (strelka) */
export function ArrowRightIcon(p: IconProps) {
  return (
    <Svg strokeWidth={2.4} {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

/** Ma'lumot (i) */
export function InfoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.01" />
    </Svg>
  );
}

/** Yangilash (aylana strelka) */
export function RefreshIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.5M4 4v4.5h4.5" />
      <path d="M4 12.5a8 8 0 0 0 13.7 5.2L20 15.5M20 20v-4.5h-4.5" />
    </Svg>
  );
}
