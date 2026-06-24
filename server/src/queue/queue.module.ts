import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { QueueController } from './queue.controller';

@Module({
  imports: [OrdersModule],
  controllers: [QueueController],
})
export class QueueModule {}
