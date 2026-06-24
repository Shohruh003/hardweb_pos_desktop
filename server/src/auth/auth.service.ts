import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

import { UserEntity } from '../entities';
import { UserRole } from '@hardweb-pos/shared';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
  ) {}

  async login(login: string, password: string) {
    const user = await this.users.findOne({ where: { login, active: true } });
    if (!user) {
      throw new UnauthorizedException('Login yoki parol noto‘g‘ri');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Login yoki parol noto‘g‘ri');
    }

    const payload = { sub: user.id, role: user.role, name: user.name };
    const token = await this.jwt.signAsync(payload);

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role as UserRole,
        login: user.login,
        active: user.active,
      },
    };
  }
}
