import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  FiscalDocEntity,
  MenuItemEntity,
  OrderEntity,
  OrderItemEntity,
  PaymentEntity,
  TableEntity,
  UserEntity,
} from '../entities';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';

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
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway],
  exports: [OrdersService],
})
export class OrdersModule {}
