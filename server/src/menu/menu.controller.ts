import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryEntity, MenuItemEntity } from '../entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('menu')
export class MenuController {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    @InjectRepository(MenuItemEntity)
    private readonly items: Repository<MenuItemEntity>,
  ) {}

  // Menyu: kategoriyalar (TZ F-1.4)
  @Get('categories')
  findCategories() {
    return this.categories.find({ order: { sortOrder: 'ASC' } });
  }

  // Menyu: taomlar
  @Get('items')
  findItems() {
    return this.items.find({ where: { available: true } });
  }
}
