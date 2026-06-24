import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', 'dev-secret'),
    });
  }

  // Tokendan tenantId ham olinadi — hisobotlar shu tenant bilan cheklanadi
  async validate(payload: any) {
    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      name: payload.name,
    };
  }
}
