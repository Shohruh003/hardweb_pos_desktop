import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ProductEntity,
  PurchaseEntity,
  RecipeItemEntity,
  SupplierPaymentEntity,
} from '../entities';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

// Sklad (ombor) moduli — mahsulotlar CRUD, retsept, kirim, sotuvda ayirish
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      RecipeItemEntity,
      PurchaseEntity,
      SupplierPaymentEntity,
    ]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
