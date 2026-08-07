import { Body, Controller, Get, Post, UseGuards, Request } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

class LoginDto {
  @IsString()
  login: string;

  @IsString()
  @MinLength(3)
  password: string;
}

class PinDto {
  @IsString()
  @MinLength(4)
  pin: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.login, dto.password);
  }

  // PIN orqali kirish (asosiy usul)
  @Post('login-pin')
  loginPin(@Body() dto: PinDto) {
    return this.auth.loginByPin(dto.pin);
  }

  // Token tekshirish / joriy foydalanuvchi
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Request() req: any) {
    return req.user;
  }
}
