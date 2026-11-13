import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { clientIp } from './login-throttle';

// Kirish DTO'larida minimal uzunlik yo'q: qisqa qiymat ham oddiy "noto'g'ri" (401)
// javobini oladi va urinishlar cheklovida sanaladi. Maksimal uzunlik — katta yuklarga qarshi.
class LoginDto {
  @IsString({ message: 'Login kiriting' })
  @MaxLength(64, { message: 'Login yoki parol noto‘g‘ri' })
  login: string;

  @IsString({ message: 'Parol kiriting' })
  @MaxLength(128, { message: 'Login yoki parol noto‘g‘ri' })
  password: string;
}

class PinDto {
  @IsString({ message: 'PIN kiriting' })
  @MaxLength(32, { message: 'PIN noto‘g‘ri' })
  pin: string;
}

class ChangePasswordDto {
  @IsString({ message: 'Joriy parolni kiriting' })
  @MaxLength(128, { message: 'Joriy parol noto‘g‘ri' })
  currentPassword: string;

  @IsString({ message: 'Yangi parolni kiriting' })
  @MinLength(4, { message: 'Yangi parol kamida 4 ta belgidan iborat bo‘lishi kerak' })
  @MaxLength(64, { message: 'Yangi parol 64 ta belgidan oshmasligi kerak' })
  newPassword: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Login + parol (Direktor/SuperAdmin; parol berilgan boshqa xodimlar ham)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto.login, dto.password, clientIp(req));
  }

  // PIN orqali kirish (asosiy usul)
  @Post('login-pin')
  loginPin(@Body() dto: PinDto, @Req() req: any) {
    return this.auth.loginByPin(dto.pin, clientIp(req));
  }

  // Token tekshirish / joriy foydalanuvchi (bazadan yangi holatda)
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.auth.me(req.user.id);
  }

  // O'z parolini almashtirish: {currentPassword, newPassword} -> {ok, user}
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    return this.auth.changePassword(
      req.user.id,
      dto.currentPassword,
      dto.newPassword,
      clientIp(req),
    );
  }
}
