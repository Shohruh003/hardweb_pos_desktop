import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsString, MinLength } from 'class-validator';
import { TenantsService } from './tenants.service';

class CreateTenantDto {
  @IsString() name: string;
  @IsString() @MinLength(2) subdomain: string;
  @IsString() @MinLength(3) directorPassword: string;
}

// Platforma administratori paneli (TZ: admin.poscloud.uz) — yangi restoran ulash
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  create(
    @Headers('x-platform-key') platformKey: string,
    @Body() dto: CreateTenantDto,
  ) {
    const expected = this.config.get('PLATFORM_ADMIN_KEY', '');
    if (!expected || platformKey !== expected) {
      throw new UnauthorizedException('Platforma kaliti noto‘g‘ri');
    }
    if (!/^[a-z0-9-]+$/.test(dto.subdomain)) {
      throw new BadRequestException(
        'Subdomen faqat kichik harf, raqam va chiziqcha bo‘lishi mumkin',
      );
    }
    return this.tenants.create(dto.name, dto.subdomain, dto.directorPassword);
  }
}
