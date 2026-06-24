import { Body, Controller, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { AuthService } from './auth.service';

class CloudLoginDto {
  @IsString() subdomain: string;
  @IsString() login: string;
  @IsString() password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: CloudLoginDto) {
    return this.auth.login(dto.subdomain, dto.login, dto.password);
  }
}
