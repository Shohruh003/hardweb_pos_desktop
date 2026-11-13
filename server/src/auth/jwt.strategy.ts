import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { UserEntity } from '../entities';
import {
  effectivePermissions,
  jwtSecret,
  RequestUser,
  SESSION_INVALID_MESSAGE,
} from './user-view';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(config),
    });
  }

  // Imzosi to'g'ri token -> req.user. Foydalanuvchi HAR so'rovda bazadan o'qiladi:
  // o'chirilgan yoki bloklangan xodimning tokeni darhol 401 oladi, rol va ruxsatlar
  // esa token ichidagisidan emas, bazadagi joriy holatdan olinadi.
  // req.user shakli o'zgarmagan: { id, role, name, permissions }.
  async validate(payload: any): Promise<RequestUser> {
    const id = typeof payload?.sub === 'string' ? payload.sub : '';
    const user = id ? await this.users.findOne({ where: { id } }) : null;
    if (!user || !user.active) {
      throw new UnauthorizedException(SESSION_INVALID_MESSAGE);
    }
    return {
      id: user.id,
      role: user.role,
      name: user.name,
      // Direktor/SuperAdmin — barcha ruxsatlar
      permissions: effectivePermissions(user),
    };
  }
}
