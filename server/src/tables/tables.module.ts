import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TableEntity } from '../entities';
import { TablesController } from './tables.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TableEntity])],
  controllers: [TablesController],
})
export class TablesModule {}
