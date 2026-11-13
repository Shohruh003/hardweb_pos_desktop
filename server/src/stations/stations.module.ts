import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StationEntity } from '../entities';
import { PrintingModule } from '../printing/printing.module';
import { StationsController } from './stations.controller';

@Module({
  // PrintingModule — "Sinov" (test-print) uchun StationPrintService
  imports: [TypeOrmModule.forFeature([StationEntity]), PrintingModule],
  controllers: [StationsController],
})
export class StationsModule {}
