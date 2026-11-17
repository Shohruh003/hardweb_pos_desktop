import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ProductEntity,
  PurchaseEntity,
  RecipeItemEntity,
  StockMovementEntity,
  SupplierEntity,
  SupplierPaymentEntity,
} from '../entities';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { StockLedgerService } from './stock-ledger.service';
import { StockOperationsService } from './stock-operations.service';
import { SuppliersService } from './suppliers.service';

// Sklad (ombor) moduli — mahsulotlar, retseptlar, harakatlar jurnali (StockLedgerService — qoldiqni
// o'zgartirishning yagona yo'li), kirim/vozvrat/chiqim/inventarizatsiya/ishlab chiqarish, ta'minotchilar.
// InventoryService buyurtmalar moduliga beriladi: to'lovda sotuv, chek vozvratida qaytarish, band qilish.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      RecipeItemEntity,
      PurchaseEntity,
      SupplierEntity,
      SupplierPaymentEntity,
      StockMovementEntity,
    ]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService, StockLedgerService, StockOperationsService, SuppliersService],
  exports: [InventoryService],
})
export class InventoryModule {}
