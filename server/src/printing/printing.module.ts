import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MenuItemEntity, PrintJobEntity, StationEntity } from '../entities';
import { StationPrintService } from './station-print.service';
import { PrintJobsController } from './print-jobs.controller';
import { PrintingGateway } from './printing.gateway';

// Server tomonda bo'lim (oshxona/bar...) printerlariga chop etish.
// Buyurtma qayerdan kelmasin (terminal, telefon, oflayn navbat) — chek server orqali chiqadi.
// MenuItemEntity — taomda bo'lim snapshot'i bo'lmasa, bo'limni menyudan aniqlash uchun.
// PrintJobEntity — cheklar navbati (B17): chiqmagan chek printer tiklanishi bilan avtomatik chiqadi.
// Hodisalar StationPrintService.events orqali: 'failed' / 'recovered' — OrdersGateway socket'ga
// uzatadi (bu modul OrdersModule'ni import QILMAYDI: aylanma bog'liqlik); 'status' (printerlar
// holati, B26) — PrintingGateway uzatadi.
@Module({
  imports: [TypeOrmModule.forFeature([StationEntity, MenuItemEntity, PrintJobEntity])],
  controllers: [PrintJobsController],
  providers: [StationPrintService, PrintingGateway],
  exports: [StationPrintService],
})
export class PrintingModule {}
