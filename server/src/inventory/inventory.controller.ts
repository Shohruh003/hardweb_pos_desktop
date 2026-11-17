import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AdjustDto,
  CountDto,
  CreateProductDto,
  MovementsQuery,
  ProductionDto,
  PurchaseDto,
  PurchasesQuery,
  SetRecipeDto,
  SupplierDto,
  SupplierPaymentDto,
  SupplierPaymentsQuery,
  UpdateProductDto,
} from './dto';
import {
  actorOf,
  assertAdminRole,
  assertCanEditRecipes,
  assertCanReadInventory,
  assertCanWriteInventory,
} from './inventory-access';
import { InventoryService } from './inventory.service';
import { StockLedgerService } from './stock-ledger.service';
import { StockOperationsService } from './stock-operations.service';
import { SuppliersService } from './suppliers.service';

// Ruxsatlar (inventory-access.ts): o'qish — 'inventory' / 'menu' / administrator / direktor;
// yozish — 'inventory' / administrator / direktor; retsept — 'menu' / 'inventory' / administrator /
// direktor; ta'minotchiga to'lovni o'chirish — faqat administrator / direktor.
@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly operations: StockOperationsService,
    private readonly ledger: StockLedgerService,
    private readonly suppliers: SuppliersService,
  ) {}

  // ---- Mahsulotlar ----

  @Get('products')
  listProducts(@Request() req: any) {
    assertCanReadInventory(req);
    return this.inventory.listProducts();
  }

  @Post('products')
  createProduct(@Body() dto: CreateProductDto, @Request() req: any) {
    assertCanWriteInventory(req);
    return this.inventory.createProduct(dto, actorOf(req));
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto, @Request() req: any) {
    assertCanWriteInventory(req);
    return this.inventory.updateProduct(id, dto);
  }

  @Delete('products/:id')
  deleteProduct(@Param('id') id: string, @Request() req: any) {
    assertCanWriteInventory(req);
    return this.inventory.deleteProduct(id);
  }

  // Chiqim (writeoff) yoki tuzatish (adjust) — yangilangan mahsulot qaytadi
  @Post('products/:id/adjust')
  adjust(@Param('id') id: string, @Body() dto: AdjustDto, @Request() req: any) {
    assertCanWriteInventory(req);
    return this.operations.adjust(id, dto, actorOf(req));
  }

  // ---- Harakatlar jurnali, inventarizatsiya, ishlab chiqarish ----

  @Get('movements')
  listMovements(@Query() query: MovementsQuery, @Request() req: any) {
    assertCanReadInventory(req);
    return this.ledger.list(query);
  }

  @Post('count')
  count(@Body() dto: CountDto, @Request() req: any) {
    assertCanWriteInventory(req);
    return this.operations.count(dto, actorOf(req));
  }

  @Post('production')
  produce(@Body() dto: ProductionDto, @Request() req: any) {
    assertCanWriteInventory(req);
    return this.operations.produce(dto, actorOf(req));
  }

  // ---- Kirim va ta'minotchiga vozvrat ----

  @Get('purchases')
  listPurchases(@Query() query: PurchasesQuery, @Request() req: any) {
    assertCanReadInventory(req);
    return this.operations.listPurchases(query);
  }

  @Post('purchases')
  createPurchase(@Body() dto: PurchaseDto, @Request() req: any) {
    assertCanWriteInventory(req);
    return this.operations.createPurchase(dto, actorOf(req));
  }

  @Post('returns')
  createReturn(@Body() dto: PurchaseDto, @Request() req: any) {
    assertCanWriteInventory(req);
    return this.operations.createReturn(dto, actorOf(req));
  }

  // ---- Ta'minotchilar va to'lovlar ----

  @Get('suppliers')
  listSuppliers(@Request() req: any) {
    assertCanReadInventory(req);
    return this.suppliers.list();
  }

  @Post('suppliers')
  createSupplier(@Body() dto: SupplierDto, @Request() req: any) {
    assertCanWriteInventory(req);
    return this.suppliers.create(dto);
  }

  @Patch('suppliers/:id')
  updateSupplier(@Param('id') id: string, @Body() dto: SupplierDto, @Request() req: any) {
    assertCanWriteInventory(req);
    return this.suppliers.update(id, dto);
  }

  @Delete('suppliers/:id')
  deleteSupplier(@Param('id') id: string, @Request() req: any) {
    assertCanWriteInventory(req);
    return this.suppliers.remove(id);
  }

  @Get('supplier-payments')
  listSupplierPayments(@Query() query: SupplierPaymentsQuery, @Request() req: any) {
    assertCanReadInventory(req);
    return this.suppliers.listPayments(query);
  }

  // Ta'minotchiga to'lov (qarzni kamaytiradi)
  @Post('supplier-payments')
  addSupplierPayment(@Body() dto: SupplierPaymentDto, @Request() req: any) {
    assertCanWriteInventory(req);
    return this.suppliers.addPayment(dto, actorOf(req));
  }

  // To'lovni o'chirish — pul yozuvini bekor qiladi, faqat administrator / direktor
  @Delete('supplier-payments/:id')
  deleteSupplierPayment(@Param('id') id: string, @Request() req: any) {
    assertAdminRole(req);
    return this.suppliers.removePayment(id);
  }

  // Eski shakl (legacy): ta'minotchilar balansi { supplier, purchased, paid, debt, count }[]
  @Get('supplier-balances')
  supplierBalances(@Request() req: any) {
    assertCanReadInventory(req);
    return this.suppliers.legacyBalances();
  }

  // ---- Taom retsepti ----

  @Get('recipe/:menuItemId')
  getRecipe(@Param('menuItemId') menuItemId: string, @Request() req: any) {
    assertCanReadInventory(req);
    return this.inventory.getRecipe(menuItemId);
  }

  @Put('recipe/:menuItemId')
  setRecipe(@Param('menuItemId') menuItemId: string, @Body() dto: SetRecipeDto, @Request() req: any) {
    assertCanEditRecipes(req);
    return this.inventory.setRecipe(menuItemId, dto.items);
  }
}
