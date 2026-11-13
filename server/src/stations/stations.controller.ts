import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { StationEntity } from '../entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@hardweb-pos/shared';
import {
  StationPrintResult,
  StationPrintService,
} from '../printing/station-print.service';

class StationDto {
  @IsString() name: string;
  @IsOptional() @IsString() printerHost?: string;
  @IsOptional() @IsInt() printerPort?: number;
  @IsOptional() @IsInt() printerWidth?: number;
  @IsOptional() @IsInt() sortOrder?: number;
}

class StationPatchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() printerHost?: string;
  @IsOptional() @IsInt() printerPort?: number;
  @IsOptional() @IsInt() printerWidth?: number;
  @IsOptional() @IsInt() sortOrder?: number;
}

// Tayyorlash bo'limlari (sexlar) — oshxona, bar, somsaxona, novvoyxona.
@UseGuards(JwtAuthGuard)
@Controller('stations')
export class StationsController {
  constructor(
    @InjectRepository(StationEntity)
    private readonly stations: Repository<StationEntity>,
    private readonly stationPrint: StationPrintService,
  ) {}

  // O'qish — har qanday tizimga kirgan foydalanuvchi (ofitsiant chek yo'naltirishi uchun)
  @Get()
  findAll() {
    return this.stations.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  // --- Boshqaruv (direktor/admin — 'stations' ruxsati) ---
  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Post()
  create(@Body() dto: StationDto) {
    return this.stations.save(this.stations.create(dto));
  }

  // Bo'lim printerini sinash — "SINOV CHEKI" chiqaradi va natijani qaytaradi.
  // Natija doim 200: printer ishlamasa ham (ok:false + sabab), bo'lim topilmasa ham.
  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Post(':id/test-print')
  @HttpCode(HttpStatus.OK)
  testPrint(@Param('id') id: string): Promise<StationPrintResult> {
    return this.stationPrint.testPrint(id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: StationPatchDto) {
    await this.stations.update(id, dto);
    return this.stations.findOne({ where: { id } });
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.stations.delete(id);
    return { ok: true };
  }
}
