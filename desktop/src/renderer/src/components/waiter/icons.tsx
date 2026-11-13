// Ofitsiant / kassa ekranlari uchun inline SVG belgilar (emoji o'rniga — Windows 10 monobloklarda
// emoji xira yoki "kvadrat" bo'lib chiqishi mumkin). Rang — currentColor, o'lcham — className (w-6 h-6).
import type { ReactNode } from 'react';

export interface IconProps {
  className?: string;
  /** Berilsa — ekran o'quvchi uchun nom (aks holda belgi bezak hisoblanadi) */
  title?: string;
  strokeWidth?: number;
}

function Svg({ className = 'w-6 h-6', title, strokeWidth = 2, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

/** Stol (zalda) */
export function IconTable(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="6.5" width="19" height="3.5" rx="1.2" />
      <path d="M5.5 10v9M18.5 10v9M5.5 15h13" />
    </Svg>
  );
}

/** Olib ketish (qog'oz paket: pastga kengayadi, dastasi ichkariga kiradi — axlat qutisiga o'xshamasin) */
export function IconBag(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 8h12l1.4 11.6a1.3 1.3 0 0 1-1.3 1.4H5.9a1.3 1.3 0 0 1-1.3-1.4L6 8z" />
      <path d="M9 11.5V6.8a3 3 0 0 1 6 0v4.7" />
    </Svg>
  );
}

/** Yetkazib berish (tezkor furgon — kichik o'lchamda ham aniq taniladi) */
export function IconScooter(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M1.5 8.5h3M1 12h2.5" />
      <rect x="5" y="5.5" width="11" height="9" rx="1.5" />
      <path d="M16 9h3.2l2.3 3v2.5H16" />
      <circle cx="8.5" cy="17.5" r="2" />
      <circle cx="17.5" cy="17.5" r="2" />
      <path d="M10.5 17.5h5" />
    </Svg>
  );
}

/** Hammasi (to'rt katak) */
export function IconGrid(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <Svg strokeWidth={3} {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconMinus(p: IconProps) {
  return (
    <Svg strokeWidth={3} {...p}>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </Svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <Svg strokeWidth={2.5} {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function IconBack(p: IconProps) {
  return (
    <Svg strokeWidth={2.5} {...p}>
      <path d="M15 5l-7 7 7 7" />
    </Svg>
  );
}

export function IconMore(p: IconProps) {
  return (
    <Svg strokeWidth={3} {...p}>
      <path d="M12 5.5v.01M12 12v.01M12 18.5v.01" />
    </Svg>
  );
}

export function IconEdit(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16v4z" />
      <path d="M13.5 6.5l4 4" />
    </Svg>
  );
}

export function IconTrash(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4.5h6V7" />
    </Svg>
  );
}

export function IconPhone(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 4h3.5l1.5 4-2.2 1.4a11 11 0 0 0 6.8 6.8L16 14l4 1.5V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z" />
    </Svg>
  );
}

export function IconPin(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </Svg>
  );
}

export function IconClock(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

export function IconUser(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </Svg>
  );
}

export function IconNote(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3.5h9l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
      <path d="M14.5 3.5V8H19M8.5 12.5h7M8.5 16.5h5" />
    </Svg>
  );
}

/** Pul (to'lov) */
export function IconCash(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5v.01M18 14.5v.01" />
    </Svg>
  );
}

/** Hisob (schot) */
export function IconReceipt(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.3V3z" />
      <path d="M9 8h6M9 12h6M9 16h3.5" />
    </Svg>
  );
}

export function IconStar(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" />
    </Svg>
  );
}

export function IconCart(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 4h2.2l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.2" />
      <circle cx="9.5" cy="19.5" r="1.4" />
      <circle cx="17" cy="19.5" r="1.4" />
    </Svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <Svg strokeWidth={3} {...p}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

/** Stolni almashtirish (ikki yo'nalishli strelka) */
export function IconSwap(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
    </Svg>
  );
}

export function IconUndo(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 7L4.5 11.5 9 16" />
      <path d="M5 11.5h9.5a5 5 0 0 1 0 10H11" />
    </Svg>
  );
}

export function IconList(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="M4.5 6.5v.01M4.5 12v.01M4.5 17.5v.01" strokeWidth={3} />
    </Svg>
  );
}

export function IconBackspace(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 5h10.5A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H9l-6-7 6-7z" />
      <path d="M12 9.5l5 5M17 9.5l-5 5" />
    </Svg>
  );
}

/** Oflayn navbat (bulut + strelka) */
export function IconCloudUp(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.6A3.8 3.8 0 0 1 17.5 18.5" />
      <path d="M12 12.5v7M9.5 15l2.5-2.5 2.5 2.5" />
    </Svg>
  );
}

export function IconRefresh(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5M4 4v4.5h4.5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.6l1.7-2.1M20 20v-4.5h-4.5" />
    </Svg>
  );
}

export function IconSend(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" />
    </Svg>
  );
}

/** Chek (schot) printeri */
export function IconPrinter(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 9V3.5h10V9" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v6.5H7z" />
    </Svg>
  );
}

/** Hisobni bo'lish (qaychi) */
export function IconScissors(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="7" r="2.6" />
      <circle cx="6" cy="17" r="2.6" />
      <path d="M8.2 8.6L20 18M8.2 15.4L20 6" />
    </Svg>
  );
}

/** Otkaz (taqiq belgisi) */
export function IconBan(p: IconProps) {
  return (
    <Svg strokeWidth={2.4} {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 6l12 12" />
    </Svg>
  );
}

/** Buyurtma turini o'zgartirish (aylanma strelkalar) */
export function IconRepeat(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 12V9.5A3.5 3.5 0 0 1 7.5 6H19M16 3l3 3-3 3" />
      <path d="M20 12v2.5a3.5 3.5 0 0 1-3.5 3.5H5M8 21l-3-3 3-3" />
    </Svg>
  );
}

/** Boshqa stolga ko'chirish (stol + strelka) */
export function IconTableMove(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="9" width="13" height="3" rx="1" />
      <path d="M4 12v7.5M13 12v7.5M4 16h9" />
      <path d="M15.5 5.5H22M19.5 3l2.5 2.5L19.5 8" />
    </Svg>
  );
}

/** Ofitsiantni almashtirish (odam + strelkalar) */
export function IconUserSwap(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20.5a6.5 6.5 0 0 1 13 0" />
      <path d="M17 6h5M20 3.5L22.5 6 20 8.5M22.5 13h-5M19.5 10.5L17 13l2.5 2.5" />
    </Svg>
  );
}

/** Izoh (oshxonaga) — gap pufagi */
export function IconChat(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 4.5h16a1 1 0 0 1 1 1v10.5a1 1 0 0 1-1 1h-8.5L6 21v-4H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" />
      <path d="M7.5 9h9M7.5 12.5h6" />
    </Svg>
  );
}

/** Ekran klaviaturasi */
export function IconKeyboard(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 9.5v.01M9.3 9.5v.01M12.6 9.5v.01M15.9 9.5v.01M18.5 9.5v.01M6 12.5v.01M18.5 12.5v.01" strokeWidth={2.8} />
      <path d="M9 12.5h6.5M7.5 15.5h9" />
    </Svg>
  );
}

export function IconChevronUp(p: IconProps) {
  return (
    <Svg strokeWidth={2.8} {...p}>
      <path d="M6 15l6-6 6 6" />
    </Svg>
  );
}

export function IconChevronLeft(p: IconProps) {
  return (
    <Svg strokeWidth={2.8} {...p}>
      <path d="M15 6l-6 6 6 6" />
    </Svg>
  );
}

export function IconChevronRight(p: IconProps) {
  return (
    <Svg strokeWidth={2.8} {...p}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

export function IconChevronDown(p: IconProps) {
  return (
    <Svg strokeWidth={2.8} {...p}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

/** Narx (yorliq) */
export function IconTag(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 12.5v-8a1 1 0 0 1 1-1h8l8.5 8.5-9 9-8.5-8.5z" />
      <circle cx="8.5" cy="8.5" r="1.6" />
    </Svg>
  );
}

/** Faqat ko'rish (qulf) */
export function IconLock(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Svg>
  );
}

export function IconInfo(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.5v.01" />
    </Svg>
  );
}

/** Shift (katta harf) */
export function IconShift(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4l7.5 8H15v7.5H9V12H4.5L12 4z" />
    </Svg>
  );
}

/** Enter (yangi qator / tasdiqlash) */
export function IconEnter(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M19 5v6.5a2 2 0 0 1-2 2H5" />
      <path d="M9 9.5L5 13.5l4 4" />
    </Svg>
  );
}
