import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudOrderEntity, CloudPaymentEntity } from '../entities';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CloudPaymentEntity, CloudOrderEntity])],
  providers: [ReportsService],
  controllers: [ReportsController, DashboardController],
})
export class ReportsModule {}
