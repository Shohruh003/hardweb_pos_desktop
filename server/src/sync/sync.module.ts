import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  OrderEntity,
  PaymentEntity,
  TableEntity,
  UserEntity,
} from '../entities';
import { SyncService } from './sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      PaymentEntity,
      TableEntity,
      UserEntity,
    ]),
  ],
  providers: [SyncService],
})
export class SyncModule {}
