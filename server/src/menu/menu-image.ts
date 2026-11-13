// Taom rasmlari: yuklashni tekshirish (POST/PATCH) va saqlangan data URL'ni baytlarga aylantirish
// (GET /api/menu/items/:id/image). Rasm bazada data URL (base64) ko'rinishida saqlanadi.
import { BadRequestException } from '@nestjs/common';

/** Yuklanadigan rasm data URL'ining eng katta uzunligi (belgilarda) — taxminan 1 MB rasm */
export const IMAGE_MAX_CHARS = 1_500_000;
export const IMAGE_TOO_BIG_MESSAGE = 'Rasm hajmi juda katta (1 MB gacha)';
export const IMAGE_FORMAT_MESSAGE = 'Rasm formati noto‘g‘ri';

/** Qabul qilinadigan turlar (yuklashda) */
const UPLOAD_PREFIX_RE = /^data:image\/(jpeg|png|webp);base64,/i;
/** Saqlangan har qanday rasm data URL'i (eski yozuvlar ham) */
const STORED_PREFIX_RE = /^data:(image\/[a-z0-9.+-]+);base64,/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Baytlarning haqiqiy rasm turi (sarlavha baytlari bo'yicha); noma'lum — null */
export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) {
    return 'image/gif';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return null;
}

/**
 * Yuklangan rasmni tekshirish: faqat 'data:image/(jpeg|png|webp);base64,…', IMAGE_MAX_CHARS
 * belgigacha. Baytlar haqiqatan JPEG/PNG/WEBP bo'lishi shart; e'lon qilingan tur baytlarga mos
 * kelmasa (masalan .jpg nomli PNG fayl) — to'g'ri tur bilan saqlanadi. Xato bo'lsa 400.
 */
export function normalizeUploadedImage(value: string): string {
  const s = String(value).trim();
  const m = UPLOAD_PREFIX_RE.exec(s);
  if (!m) throw new BadRequestException(IMAGE_FORMAT_MESSAGE);
  if (s.length > IMAGE_MAX_CHARS) throw new BadRequestException(IMAGE_TOO_BIG_MESSAGE);
  const body = s.slice(m[0].length);
  if (!body || !BASE64_RE.test(body)) throw new BadRequestException(IMAGE_FORMAT_MESSAGE);
  const mime = sniffImageMime(Buffer.from(body, 'base64'));
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') {
    throw new BadRequestException(IMAGE_FORMAT_MESSAGE);
  }
  return `data:${mime};base64,${body}`;
}

/**
 * Saqlangan rasm (data URL) -> baytlar va Content-Type. Faqat haqiqiy rasm baytlari beriladi
 * (tur baytlardan aniqlanadi — masalan eski SVG yoki buzilgan yozuv berilmaydi). Yo'q — null.
 */
export function decodeStoredImage(
  value: string | null | undefined,
): { mime: string; data: Buffer } | null {
  if (!value) return null;
  const m = STORED_PREFIX_RE.exec(value);
  if (!m) return null;
  const data = Buffer.from(value.slice(m[0].length), 'base64');
  if (data.length === 0) return null;
  const mime = sniffImageMime(data);
  return mime ? { mime, data } : null;
}

/** Rasmning ochiq manzili (versiya bilan — brauzer keshi yangi rasmni darhol oladi) */
export function menuImageUrl(id: string, version: number | null | undefined): string {
  return `/api/menu/items/${id}/image?v=${Number(version) || 0}`;
}
