import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ExciseCodeEntity,
  FiscalDocEntity,
  MenuItemEntity,
  OrderEntity,
  OrderItemEntity,
  PaymentEntity,
  StationEntity,
  TableEntity,
  UserEntity,
} from '../entities';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { TelegramModule } from '../telegram/telegram.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      OrderItemEntity,
      MenuItemEntity,
      TableEntity,
      PaymentEntity,
      UserEntity,
      FiscalDocEntity,
      ExciseCodeEntity,
      StationEntity,
    ]),
    TelegramModule,
    InventoryModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway],
  exports: [OrdersService],
})
export class OrdersModule {}
