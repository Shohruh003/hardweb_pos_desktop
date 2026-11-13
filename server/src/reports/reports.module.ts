import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ExpenseEntity,
  OrderEntity,
  OrderItemEntity,
  PaymentEntity,
  SettingsEntity,
  UserEntity,
  VoidLogEntity,
} from '../entities';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { DebtsController } from './debts.controller';

// ReportsService boshqa modullarga ham kerak (Telegram kunlik hisoboti: ofitsiantlar ulushi, otkazlar,
// kassa holati). Shu sababli bu modul faqat TypeORM'ga bog'lanadi (SettingsModule/TelegramModule'ni
// import QILMAYDI) — modullar orasida halqa paydo bo'lmasin.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentEntity,
      OrderEntity,
      OrderItemEntity,
      UserEntity,
      VoidLogEntity,
      ExpenseEntity,
      SettingsEntity,
    ]),
  ],
  providers: [ReportsService],
  controllers: [ReportsController, DebtsController],
  exports: [ReportsService],
})
export class ReportsModule {}
