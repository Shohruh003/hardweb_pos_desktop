import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoryEntity, MenuItemEntity } from '../entities';
import { MenuController } from './menu.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CategoryEntity, MenuItemEntity])],
  controllers: [MenuController],
})
export class MenuModule {}
