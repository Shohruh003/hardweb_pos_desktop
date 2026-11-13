import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MenuItemEntity, StationEntity } from '../entities';
import { StationPrintService } from './station-print.service';

// Server tomonda bo'lim (oshxona/bar...) printerlariga chop etish.
// Buyurtma qayerdan kelmasin (terminal, telefon, oflayn navbat) — chek server orqali chiqadi.
// MenuItemEntity — taomda bo'lim snapshot'i bo'lmasa, bo'limni menyudan aniqlash uchun.
@Module({
  imports: [TypeOrmModule.forFeature([StationEntity, MenuItemEntity])],
  providers: [StationPrintService],
  exports: [StationPrintService],
})
export class PrintingModule {}
