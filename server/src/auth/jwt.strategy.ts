import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { UserEntity } from '../entities';
import { DirectorAccess } from './director-access';
import { clientIp } from './login-throttle';
import { DIRECTOR_LOCAL_ONLY_MESSAGE } from './local-request';
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
    private readonly directorAccess: DirectorAccess,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(config),
      // B35: so'rov manzili kerak (direktor tokeni tashqi kompyuterdan kelsa — 401)
      passReqToCallback: true,
    });
  }

  // Imzosi to'g'ri token -> req.user. Foydalanuvchi HAR so'rovda bazadan o'qiladi:
  // o'chirilgan yoki bloklangan xodimning tokeni darhol 401 oladi, rol va ruxsatlar
  // esa token ichidagisidan emas, bazadagi joriy holatdan olinadi.
  // req.user shakli o'zgarmagan: { id, role, name, permissions }.
  async validate(req: any, payload: any): Promise<RequestUser> {
    const id = typeof payload?.sub === 'string' ? payload.sub : '';
    const user = id ? await this.users.findOne({ where: { id } }) : null;
    if (!user || !user.active) {
      throw new UnauthorizedException(SESSION_INVALID_MESSAGE);
    }
    // B35: direktor/SuperAdmin tokeni server kompyuteridan tashqarida ishlamaydi (sozlama yoqilganda) —
    // monoblok/telefondagi eski direktor sessiyasi shu bilan tugaydi
    if (await this.directorAccess.isBlocked(user.role, clientIp(req))) {
      throw new UnauthorizedException(DIRECTOR_LOCAL_ONLY_MESSAGE);
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
