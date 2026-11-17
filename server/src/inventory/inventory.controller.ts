import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FORBIDDEN_MESSAGE } from '../auth/user-view';
import { can, isAdminRole } from '../orders/order-rules';
import { ProductUnit, UserRole } from '@hardweb-pos/shared';
import { InventoryService } from './inventory.service';

/**
 * Sklad ma'lumotlarini o'qish (tannarx, kirimlar, ta'minotchi qarzlari): 'inventory' (Sklad) yoki
 * 'menu' (Menyu — taom retsepti va tannarxi) ruxsati, yoki administrator / direktor. Ofitsiant,
 * oshpaz va kassir — 403 (UI bu bo'limlarni ularga ko'rsatmaydi, server ham bermaydi).
 */
function assertCanReadInventory(req: any): void {
  const user = req?.user;
  if (can(user, 'inventory') || can(user, 'menu') || isAdminRole(user)) return;
  throw new ForbiddenException(FORBIDDEN_MESSAGE);
}

class ProductDto {
  @IsString() name: string;
  @IsEnum(ProductUnit) unit: ProductUnit;
  @IsOptional() @IsNumber() stock?: number;
  @IsOptional() @IsNumber() minStock?: number;
}

class ProductPatchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(ProductUnit) unit?: ProductUnit;
  @IsOptional() @IsNumber() stock?: number;
  @IsOptional() @IsNumber() minStock?: number;
}

class AdjustDto {
  @IsNumber() delta: number;
}

class PurchaseDto {
  @IsUUID() productId: string;
  @IsString() supplier: string;
  @IsNumber() quantity: number;
  @IsNumber() unitPrice: number;
  @IsOptional() @IsString() note?: string;
}

class SupplierPaymentDto {
  @IsString() supplier: string;
  @IsNumber() amount: number;
  @IsOptional() @IsString() note?: string;
}

class RecipeLineDto {
  @IsUUID() productId: string;
  @IsNumber() amount: number;
}

class SetRecipeDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeLineDto)
  items: RecipeLineDto[];
}

@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  // --- O'qish: 'inventory' / 'menu' ruxsati yoki administrator / direktor (assertCanReadInventory) ---
  @Get('products')
  listProducts(@Request() req: any) {
    assertCanReadInventory(req);
    return this.inventory.listProducts();
  }

  @Get('recipe/:menuItemId')
  getRecipe(@Param('menuItemId') menuItemId: string, @Request() req: any) {
    assertCanReadInventory(req);
    return this.inventory.getRecipe(menuItemId);
  }

  // Kirimlar tarixi (ta'minot) — barchasi yoki mahsulot bo'yicha
  @Get('purchases')
  listPurchases(@Request() req: any, @Query('productId') productId?: string) {
    assertCanReadInventory(req);
    return this.inventory.listPurchases(productId);
  }

  // Ta'minotchilar balansi (olingan - to'langan = qarz)
  @Get('supplier-balances')
  supplierBalances(@Request() req: any) {
    assertCanReadInventory(req);
    return this.inventory.getSupplierBalances();
  }

  // Ta'minotchiga to'lov (qarzni kamaytiradi)
  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Post('supplier-payments')
  addSupplierPayment(@Body() dto: SupplierPaymentDto) {
    return this.inventory.addSupplierPayment(dto.supplier, dto.amount, dto.note);
  }

  // --- Boshqaruv (admin/direktor) ---
  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Post('products')
  createProduct(@Body() dto: ProductDto) {
    return this.inventory.createProduct(dto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: ProductPatchDto) {
    return this.inventory.updateProduct(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Delete('products/:id')
  deleteProduct(@Param('id') id: string) {
    return this.inventory.deleteProduct(id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Post('products/:id/adjust')
  adjust(@Param('id') id: string, @Body() dto: AdjustDto) {
    return this.inventory.adjustStock(id, dto.delta);
  }

  // Kirim qo'shish (ta'minotchidan) — ombor oshadi + tarixга yoziladi
  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Post('purchases')
  createPurchase(@Body() dto: PurchaseDto) {
    return this.inventory.createPurchase(dto);
  }

  // Vozvrat — ta'minotchiga qaytarish (ombor kamayadi + qarz kamayadi)
  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Post('returns')
  createReturn(@Body() dto: PurchaseDto) {
    return this.inventory.createReturn(dto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Put('recipe/:menuItemId')
  setRecipe(
    @Param('menuItemId') menuItemId: string,
    @Body() dto: SetRecipeDto,
  ) {
    return this.inventory.setRecipe(menuItemId, dto.items);
  }
}
