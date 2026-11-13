import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ExpenseEntity,
  OrderEntity,
  PaymentEntity,
  SettingsEntity,
} from '../entities';
import { TelegramService } from './telegram.service';
import { ReportsModule } from '../reports/reports.module';

// ReportsModule — kunlik hisobotdagi ofitsiantlar ulushi, otkazlar va kassa holati uchun
// (u faqat TypeORM'ga bog'langan — halqa yo'q).
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentEntity,
      ExpenseEntity,
      OrderEntity,
      SettingsEntity,
    ]),
    ReportsModule,
  ],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
