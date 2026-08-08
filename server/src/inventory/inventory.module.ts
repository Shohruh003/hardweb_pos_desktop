import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity, RecipeItemEntity } from '../entities';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

// Sklad (ombor) moduli — mahsulotlar CRUD, retsept, sotuvda ayirish
@Module({
  imports: [TypeOrmModule.forFeature([ProductEntity, RecipeItemEntity])],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
