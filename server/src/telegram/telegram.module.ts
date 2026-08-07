import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ExpenseEntity,
  OrderEntity,
  PaymentEntity,
  SettingsEntity,
} from '../entities';
import { TelegramService } from './telegram.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentEntity,
      ExpenseEntity,
      OrderEntity,
      SettingsEntity,
    ]),
  ],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
