import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

import { UserEntity } from '../entities';
import {
  ALL_CAPABILITY_KEYS,
  isFullAccessRole,
  UserRole,
} from '@hardweb-pos/shared';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
  ) {}

  async login(login: string, password: string) {
    const user = await this.users.findOne({ where: { login, active: true } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Login yoki parol noto‘g‘ri');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Login yoki parol noto‘g‘ri');
    }
    return this.issue(user);
  }

  // PIN orqali kirish — xodim faqat 4 xonali kodini kiritadi
  async loginByPin(pin: string) {
    const user = await this.users.findOne({ where: { pin, active: true } });
    if (!user) {
      throw new UnauthorizedException('PIN noto‘g‘ri');
    }
    // Direktor/SuperAdmin PIN bilan kira olmaydi — login+parol bilan kiradi
    // (tasodifiy 4 xonali raqam bilan rahbar kabinetiga kirib qolmasligi uchun)
    if (isFullAccessRole(user.role)) {
      throw new UnauthorizedException(
        'Direktor login va parol bilan kiradi (PIN emas)',
      );
    }
    return this.issue(user);
  }

  private async issue(user: UserEntity) {
    // Direktor/SuperAdmin — barcha ruxsatlarga ega
    const permissions = isFullAccessRole(user.role)
      ? ALL_CAPABILITY_KEYS
      : user.permissions ?? [];
    const payload = {
      sub: user.id,
      role: user.role,
      name: user.name,
      permissions,
    };
    const token = await this.jwt.signAsync(payload);
    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role as UserRole,
        login: user.login,
        active: user.active,
        permissions,
      },
    };
  }
}
