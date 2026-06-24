import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TenantsService } from '../tenants/tenants.service';

// Lokal server x-api-key sarlavhasi bilan ulanadi (TZ T-3.4). req.tenant ni o'rnatadi.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly tenants: TenantsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const key = req.headers['x-api-key'];
    if (!key) throw new UnauthorizedException('API kalit yo‘q');
    const tenant = await this.tenants.findByApiKey(String(key));
    if (!tenant) throw new UnauthorizedException('API kalit noto‘g‘ri');
    req.tenant = tenant;
    return true;
  }
}
