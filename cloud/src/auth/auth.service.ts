import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { CloudUserEntity } from '../entities';
import { TenantsService } from '../tenants/tenants.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(CloudUserEntity)
    private readonly users: Repository<CloudUserEntity>,
    private readonly tenants: TenantsService,
    private readonly jwt: JwtService,
  ) {}

  // Direktor o'z restorani subdomeni orqali kiradi (TZ T-3.5)
  async login(subdomain: string, login: string, password: string) {
    const tenant = await this.tenants.findBySubdomain(subdomain);
    if (!tenant) throw new UnauthorizedException('Restoran topilmadi');

    const user = await this.users.findOne({
      where: { tenantId: tenant.id, login },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Login yoki parol noto‘g‘ri');
    }

    const token = await this.jwt.signAsync({
      sub: user.id,
      tenantId: tenant.id,
      role: user.role,
      name: user.name,
    });
    return {
      token,
      user: { id: user.id, name: user.name, role: user.role, login: user.login },
      tenant: { name: tenant.name, subdomain: tenant.subdomain },
    };
  }
}
