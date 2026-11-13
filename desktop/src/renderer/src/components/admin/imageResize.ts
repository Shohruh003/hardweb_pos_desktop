// Taom rasmini yuklashdan oldin brauzerning o'zida kichraytirish (canvas):
// eng uzun tomoni 640 px, JPEG sifati 0.8 — odatda 40–90 KB. Shunda telefon kamerasidagi
// 5–10 MB surat ham serverga tez boradi va menyu barcha qurilmalarda tez ochiladi.

/** Manba fayl chegarasi — undan katta faylni o'qib o'tirmaymiz */
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
/** Natija rasmining eng uzun tomoni (px) */
export const MAX_SIDE = 640;
/** JPEG sifati */
export const JPEG_QUALITY = 0.8;
/** Server qabul qiladigan eng uzun data URL (B13: 1 500 000 belgi) */
export const MAX_DATA_URL_CHARS = 1_500_000;

/** Foydalanuvchiga ko'rsatiladigan rasm xatosi (o'zbekcha) */
export class ImageFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageFileError';
  }
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;

/** Fayl rasmmi (MIME turi yoki kengaytmasi bo'yicha) */
export function isImageFile(file: File): boolean {
  if (file.type) return file.type.startsWith('image/');
  return IMAGE_EXT.test(file.name);
}

/** Sudrab tashlangan / tanlangan fayllar ichidan birinchi faylni olish */
export function firstFile(list: FileList | null | undefined): File | null {
  return list && list.length > 0 ? list[0] : null;
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Decoded> {
  // Asosiy yo'l: createImageBitmap — EXIF bo'yicha aylantirilgan (telefon surati yonboshlab qolmaydi)
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      /* quyidagi <img> usuli bilan urinamiz */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => undefined };
  } catch {
    throw new ImageFileError('Rasmni o‘qib bo‘lmadi — formati noto‘g‘ri yoki fayl buzilgan (JPG, PNG yoki WEBP tanlang)');
  } finally {
    // Rasm canvas'ga chizilgunga qadar URL kerak emas: <img> allaqachon yuklangan
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Faylni tekshirib, kichraytirib, JPEG data URL qaytaradi.
 * Xatolar (rasm emas, 15 MB dan katta, o'qib bo'lmadi) — ImageFileError (aniq o'zbekcha xabar).
 */
export async function resizeImageFile(file: File): Promise<string> {
  if (!isImageFile(file)) {
    throw new ImageFileError('Faqat rasm fayli tanlang (JPG, PNG yoki WEBP)');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1).replace('.', ',');
    throw new ImageFileError(`Rasm juda katta (${mb} MB) — 15 MB gacha bo‘lgan rasm tanlang`);
  }
  if (file.size === 0) throw new ImageFileError('Fayl bo‘sh — boshqa rasm tanlang');

  const img = await decode(file);
  try {
    if (!img.width || !img.height) throw new ImageFileError('Rasm o‘lchamini aniqlab bo‘lmadi');
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageFileError('Rasmni qayta ishlab bo‘lmadi');
    // Shaffof (PNG) fon JPEG'da qora bo'lib qolmasin
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.source, 0, 0, w, h);

    let quality = JPEG_QUALITY;
    let url = canvas.toDataURL('image/jpeg', quality);
    // Juda kamdan-kam: shovqinli surat — sifatni pasaytirib serverning 1 MB chegarasiga sig'diramiz
    while (url.length > MAX_DATA_URL_CHARS && quality > 0.45) {
      quality -= 0.1;
      url = canvas.toDataURL('image/jpeg', quality);
    }
    if (!url.startsWith('data:image/jpeg')) throw new ImageFileError('Rasmni JPEG ga o‘tkazib bo‘lmadi');
    if (url.length > MAX_DATA_URL_CHARS) throw new ImageFileError('Rasm hajmi juda katta (1 MB gacha)');
    return url;
  } finally {
    img.release();
  }
}

/** data URL hajmi (taxminan, KB) — foydalanuvchiga ko'rsatish uchun */
export function dataUrlKb(url: string): number {
  const comma = url.indexOf(',');
  const b64 = comma >= 0 ? url.length - comma - 1 : url.length;
  return Math.max(1, Math.round((b64 * 3) / 4 / 1024));
}
