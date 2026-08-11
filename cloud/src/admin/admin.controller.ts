import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { AdminService } from './admin.service';
import { PlatformGuard } from './platform.guard';

class LoginDto {
  @IsString() password: string;
}
class CreateRestaurantDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() phone?: string;
}
class UpdateRestaurantDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

// Super-admin panel (bizniki) — restoranlar, litsenziya kalitlari, online holat.
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly config: ConfigService,
  ) {}

  // Kirish — parol to'g'ri bo'lsa panel ishlatadigan kalitni qaytaradi
  @Post('login')
  login(@Body() dto: LoginDto) {
    const expected = this.config.get('PLATFORM_ADMIN_KEY') || 'admin123';
    if (dto.password !== expected) {
      throw new UnauthorizedException('Parol noto‘g‘ri');
    }
    return { ok: true, key: expected };
  }

  @UseGuards(PlatformGuard)
  @Get('restaurants')
  list() {
    return this.admin.list();
  }

  @UseGuards(PlatformGuard)
  @Post('restaurants')
  create(@Body() dto: CreateRestaurantDto) {
    return this.admin.create(dto.name, dto.phone);
  }

  @UseGuards(PlatformGuard)
  @Patch('restaurants/:id')
  update(@Param('id') id: string, @Body() dto: UpdateRestaurantDto) {
    return this.admin.update(id, dto);
  }

  @UseGuards(PlatformGuard)
  @Post('restaurants/:id/reset-device')
  resetDevice(@Param('id') id: string) {
    return this.admin.resetFingerprint(id);
  }

  @UseGuards(PlatformGuard)
  @Delete('restaurants/:id')
  remove(@Param('id') id: string) {
    return this.admin.remove(id);
  }
}
