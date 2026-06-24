import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudOrderEntity, CloudPaymentEntity } from '../entities';
import { TenantsModule } from '../tenants/tenants.module';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([CloudOrderEntity, CloudPaymentEntity]),
    TenantsModule,
  ],
  providers: [SyncService],
  controllers: [SyncController],
})
export class SyncModule {}
