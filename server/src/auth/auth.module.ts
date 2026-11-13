import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SettingsEntity, UserEntity } from '../entities';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { LoginThrottle } from './login-throttle';
import { DirectorAccess } from './director-access';
import { jwtExpiresIn, jwtSecret } from './user-view';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, SettingsEntity]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: jwtSecret(config),
        // Standart 24 soat; JWT_EXPIRES_IN berilsa — o'sha
        signOptions: { expiresIn: jwtExpiresIn(config) },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, LoginThrottle, DirectorAccess],
  controllers: [AuthController],
  exports: [AuthService, DirectorAccess],
})
export class AuthModule {}
