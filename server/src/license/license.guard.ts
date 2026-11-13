import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { LicenseService } from './license.service';

/** Taom rasmi (GET /api/menu/items/:id/image) — <img> uchun ochiq, maxfiy ma'lumot emas */
const MENU_IMAGE_URL_RE = /\/menu\/items\/[^/?#]+\/image(?:[?#]|$)/;

// Litsenziya faol bo'lmasa — /license/* dan boshqa barcha API bloklanadi (423 Locked).
// Shunda kalitsiz terminal ishlamaydi.
@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private readonly license: LicenseService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.license.enforced()) return true;
    const req = context.switchToHttp().getRequest();
    const url: string = req.originalUrl || req.url || '';
    if (url.includes('/license/')) return true; // holat/aktivatsiya har doim ochiq
    // Taom rasmlari — litsenziya holatidan qat'i nazar (ekrandagi <img> buzilmasin)
    if (MENU_IMAGE_URL_RE.test(url)) return true;
    if (this.license.status() === 'active') return true;
    throw new HttpException(
      { statusCode: 423, licenseStatus: this.license.status(), message: 'Litsenziya faol emas' },
      423,
    );
  }
}
