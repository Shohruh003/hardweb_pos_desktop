import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StationEntity } from '../entities';
import { StationsController } from './stations.controller';

@Module({
  imports: [TypeOrmModule.forFeature([StationEntity])],
  controllers: [StationsController],
})
export class StationsModule {}
