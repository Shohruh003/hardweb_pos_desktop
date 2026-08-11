import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { LicenseService } from './license.service';

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
    if (this.license.status() === 'active') return true;
    throw new HttpException(
      { statusCode: 423, licenseStatus: this.license.status(), message: 'Litsenziya faol emas' },
      423,
    );
  }
}
