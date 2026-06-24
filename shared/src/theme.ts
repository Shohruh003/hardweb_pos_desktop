// Markazlashtirilgan rang palitrasi.
// QOIDA: ko'k rang ishlatilmaydi. To'q fon + yorqin (deyarli oq) matn + emerald accent.
// Yuqori kontrast — restoran tez ish muhitida bir qarashda o'qiladi.

export const COLORS = {
  // Fonlar
  bg: '#15181E', // asosiy fon (to'q charcoal)
  surface: '#1F242D', // kartalar / panellar
  surfaceHover: '#262C36',
  border: '#2D333D', // chegaralar

  // Matn (yorqin, kontrastli)
  text: '#F4F6F8', // asosiy matn — deyarli oq
  textMuted: '#A8B0BD', // ikkilamchi matn

  // Brend / asosiy action
  primary: '#059669', // emerald
  primaryHover: '#047857',

  // Status ranglari
  success: '#22C55E', // tayyor
  warning: '#F59E0B', // kutilmoqda / tayyorlanmoqda
  danger: '#EF4444', // xato
  info: '#8B5CF6', // ma'lumot (ko'k o'rniga binafsha)
} as const;

export type ColorKey = keyof typeof COLORS;
