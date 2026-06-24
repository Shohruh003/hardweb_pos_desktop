import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { CategoryEntity, MenuItemEntity } from '../entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@hardweb-pos/shared';

class CategoryDto {
  @IsString() name: string;
  @IsOptional() @IsNumber() sortOrder?: number;
}

class MenuItemDto {
  @IsString() name: string;
  @IsNumber() @Min(0) price: number;
  @IsUUID() categoryId: string;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsBoolean() exciseRequired?: boolean;
}

class MenuItemPatchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsBoolean() exciseRequired?: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('menu')
export class MenuController {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    @InjectRepository(MenuItemEntity)
    private readonly items: Repository<MenuItemEntity>,
  ) {}

  // --- O'qish (barcha rollar) ---

  @Get('categories')
  findCategories() {
    return this.categories.find({ order: { sortOrder: 'ASC' } });
  }

  // Ofitsiant uchun: faqat mavjud taomlar (TZ F-1.4)
  @Get('items')
  findItems() {
    return this.items.find({ where: { available: true } });
  }

  // Admin uchun: barcha taomlar (mavjud bo'lmaganlar ham)
  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin)
  @Get('all-items')
  findAllItems() {
    return this.items.find();
  }

  // --- Boshqaruv (faqat admin) — TZ F-4.1 ---

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin)
  @Post('categories')
  createCategory(@Body() dto: CategoryDto) {
    return this.categories.save(this.categories.create(dto));
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin)
  @Patch('categories/:id')
  async updateCategory(@Param('id') id: string, @Body() dto: CategoryDto) {
    await this.categories.update(id, dto);
    return this.categories.findOne({ where: { id } });
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin)
  @Post('items')
  createItem(@Body() dto: MenuItemDto) {
    return this.items.save(this.items.create(dto));
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin)
  @Patch('items/:id')
  async updateItem(@Param('id') id: string, @Body() dto: MenuItemPatchDto) {
    await this.items.update(id, dto);
    return this.items.findOne({ where: { id } });
  }
}
