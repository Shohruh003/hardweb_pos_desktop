import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity, TableEntity } from '../entities';
import { TablesController } from './tables.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  // OrderEntity — ochiq buyurtmasi bor stol/zalni o'chirishdan himoya; SettingsModule — zallar tartibi
  imports: [TypeOrmModule.forFeature([TableEntity, OrderEntity]), SettingsModule],
  controllers: [TablesController],
})
export class TablesModule {}
