// Rasmni ESC/POS raster (GS v 0) formatiga aylantiradi — chek boshida logo chiqarish uchun.
// Electron nativeImage bilan PNG o'qiladi (qo'shimcha kutubxona kerak emas),
// keyin Floyd-Steinberg dithering bilan 1-bit qora/oq'ga o'tkaziladi.
import { nativeImage } from 'electron';

export function imageToRaster(path: string, targetWidth = 384): Buffer | null {
  const img = nativeImage.createFromPath(path);
  if (img.isEmpty()) return null;

  const size = img.getSize();
  if (!size.width || !size.height) return null;

  // Printer kengligiga moslab kichraytiramiz (80mm ≈ 576 nuqta, 384 xavfsiz)
  const w = Math.min(targetWidth, 576);
  const h = Math.max(1, Math.round((size.height * w) / size.width));
  const resized = img.resize({ width: w, height: h, quality: 'best' });
  const bmp = resized.getBitmap(); // BGRA

  // Kulrang qiymatlar (0..255). Shaffof piksel — oq fon.
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const b = bmp[i * 4];
    const g = bmp[i * 4 + 1];
    const r = bmp[i * 4 + 2];
    const a = bmp[i * 4 + 3];
    let lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (a < 128) lum = 255; // shaffof -> oq
    gray[i] = lum;
  }

  // Floyd-Steinberg dithering -> 1-bit (1 = qora nuqta)
  const mono = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const old = gray[idx];
      const nv = old < 140 ? 0 : 255; // chegara
      mono[idx] = nv === 0 ? 1 : 0;
      const err = old - nv;
      if (x + 1 < w) gray[idx + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) gray[idx + w - 1] += (err * 3) / 16;
        gray[idx + w] += (err * 5) / 16;
        if (x + 1 < w) gray[idx + w + 1] += (err * 1) / 16;
      }
    }
  }

  // ESC/POS GS v 0 raster: har qatorda ceil(w/8) bayt, MSB birinchi
  const bytesPerRow = Math.ceil(w / 8);
  const data = Buffer.alloc(bytesPerRow * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mono[y * w + x]) {
        data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  const header = Buffer.from([
    0x1d, 0x76, 0x30, 0x00,
    bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
    h & 0xff, (h >> 8) & 0xff,
  ]);
  return Buffer.concat([header, data]);
}
