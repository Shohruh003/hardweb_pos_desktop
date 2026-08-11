import { Body, Controller, Ip, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { LicenseService } from './license.service';

class ActivateDto {
  @IsString() key: string;
  @IsString() fingerprint: string;
  @IsOptional() @IsString() version?: string;
}

// Qurilma (lokal server) tomon endpointlari — ochiq (kalit orqali tekshiriladi).
@Controller('license')
export class LicenseController {
  constructor(private readonly license: LicenseService) {}

  @Post('activate')
  activate(@Body() dto: ActivateDto, @Ip() ip: string) {
    return this.license.activate({ ...dto, ip });
  }

  @Post('heartbeat')
  heartbeat(@Body() dto: ActivateDto, @Ip() ip: string) {
    return this.license.heartbeat({ ...dto, ip });
  }
}
