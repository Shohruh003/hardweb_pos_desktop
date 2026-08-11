import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Super-admin (platforma) himoyasi — panel har so'rovda x-platform-key yuboradi.
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const key = req.headers['x-platform-key'];
    const expected = this.config.get('PLATFORM_ADMIN_KEY') || 'admin123';
    if (!key || key !== expected) {
      throw new UnauthorizedException('Platforma kaliti noto‘g‘ri');
    }
    return true;
  }
}
