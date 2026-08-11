import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { LicenseService } from './license.service';

class ActivateDto {
  @IsString() key: string;
}

// Litsenziya holati va aktivatsiya — OCHIQ (desktop logindan oldin chaqiradi).
@Controller('license')
export class LicenseController {
  constructor(private readonly license: LicenseService) {}

  @Get('status')
  status() {
    return this.license.statusInfo();
  }

  @Post('activate')
  activate(@Body() dto: ActivateDto) {
    return this.license.activate(dto.key);
  }
}
