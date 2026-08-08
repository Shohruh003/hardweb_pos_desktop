import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
import { ProductUnit, UserRole } from '@hardweb-pos/shared';
import { InventoryService } from './inventory.service';

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

  // --- O'qish (barcha rollar) ---
  @Get('products')
  listProducts() {
    return this.inventory.listProducts();
  }

  @Get('recipe/:menuItemId')
  getRecipe(@Param('menuItemId') menuItemId: string) {
    return this.inventory.getRecipe(menuItemId);
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
