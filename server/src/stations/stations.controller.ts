import {
  BadRequestException,
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
import { DataSource, Repository } from 'typeorm';
import {
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { MenuItemEntity, StationEntity } from '../entities';
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

/** Taomlarda ishlatilayotgan bo'limni o'chirishga urinish: "«Bar» bo'limi 4 ta taomda ishlatilgan — ..." */
function stationInUseMessage(name: string, dishes: number): string {
  const which = name ? `«${name}» bo‘limi` : 'Bu bo‘lim';
  return `${which} ${dishes} ta taomda ishlatilgan (asosiy yoki qo‘shimcha printer) — avval taomlarni boshqa bo‘limga o‘tkazing (Menyu bo‘limida)`;
}

// Tayyorlash bo'limlari (sexlar) — oshxona, bar, somsaxona, novvoyxona.
@UseGuards(JwtAuthGuard)
@Controller('stations')
export class StationsController {
  constructor(
    @InjectRepository(StationEntity)
    private readonly stations: Repository<StationEntity>,
    private readonly stationPrint: StationPrintService,
    // Taomlar (menu_items) — bo'lim o'chirilishidan oldin ishlatilayotganini tekshirish uchun
    private readonly dataSource: DataSource,
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

  // Taomlarda (asosiy bo'lim yoki qo'shimcha printer sifatida) ishlatilayotgan bo'lim o'chirilmaydi:
  // aks holda bu taomlarning cheki hech qayerga chiqmay qolardi (oshxona buyurtmani ko'rmaydi)
  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const dishes = await this.dishesUsing(id);
    if (dishes > 0) {
      const station = await this.stations.findOne({ where: { id } });
      throw new BadRequestException(stationInUseMessage(station?.name ?? '', dishes));
    }
    await this.stations.delete(id);
    return { ok: true };
  }

  /** Shu bo'limni asosiy bo'lim (station_id) yoki qo'shimcha printer (extra_station_ids) qilgan taomlar soni */
  private async dishesUsing(stationId: string): Promise<number> {
    // Rasm ustuni (select:false) o'qilmaydi — faqat bo'lim maydonlari
    const rows = await this.dataSource.getRepository(MenuItemEntity).find({
      select: { id: true, stationId: true, extraStationIds: true },
    });
    return rows.filter(
      (m) =>
        m.stationId === stationId ||
        (Array.isArray(m.extraStationIds) && m.extraStationIds.includes(stationId)),
    ).length;
  }
}
