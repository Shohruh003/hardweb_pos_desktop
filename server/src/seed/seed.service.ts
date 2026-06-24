import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

import {
  CategoryEntity,
  MenuItemEntity,
  TableEntity,
  UserEntity,
} from '../entities';
import { TableStatus, UserRole } from '@hardweb-pos/shared';

// Dev rejimda boshlang'ich ma'lumotlar (SEED_ON_START=true bo'lsa)
@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger('Seed');

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    @InjectRepository(MenuItemEntity)
    private readonly menuItems: Repository<MenuItemEntity>,
  ) {}

  async onModuleInit() {
    if (process.env.SEED_ON_START !== 'true') return;

    const userCount = await this.users.count();
    if (userCount > 0) {
      this.logger.log('Ma’lumotlar mavjud — seed o‘tkazib yuborildi');
      return;
    }

    this.logger.log('Boshlang‘ich ma’lumotlar yuklanmoqda...');

    // Xodimlar (har rol uchun bittadan). Parol hammasiga: 1234
    const passwordHash = await bcrypt.hash('1234', 10);
    await this.users.save([
      { name: 'Aziz (ofitsiant)', role: UserRole.Waiter, login: 'ofitsiant', passwordHash, active: true },
      { name: 'Bekzod (oshpaz)', role: UserRole.Cook, login: 'oshpaz', passwordHash, active: true },
      { name: 'Dilnoza (kassir)', role: UserRole.Cashier, login: 'kassir', passwordHash, active: true },
      { name: 'Admin', role: UserRole.Admin, login: 'admin', passwordHash, active: true },
      { name: 'Direktor', role: UserRole.Director, login: 'direktor', passwordHash, active: true },
    ] as Partial<UserEntity>[]);

    // Stollar (2 zal)
    const tables: Partial<TableEntity>[] = [];
    for (let n = 1; n <= 6; n++) {
      tables.push({ number: n, hall: 'Asosiy zal', capacity: 4, status: TableStatus.Free });
    }
    for (let n = 7; n <= 10; n++) {
      tables.push({ number: n, hall: 'VIP zal', capacity: 6, status: TableStatus.Free });
    }
    await this.tables.save(tables);

    // Kategoriyalar
    const [issiq, salat, ichimlik] = await this.categories.save([
      { name: 'Issiq taomlar', sortOrder: 1 },
      { name: 'Salatlar', sortOrder: 2 },
      { name: 'Ichimliklar', sortOrder: 3 },
    ] as Partial<CategoryEntity>[]);

    // Taomlar
    await this.menuItems.save([
      { name: 'Osh', price: 35000, categoryId: issiq.id, available: true, exciseRequired: false },
      { name: 'Lag‘mon', price: 32000, categoryId: issiq.id, available: true, exciseRequired: false },
      { name: 'Shashlik', price: 28000, categoryId: issiq.id, available: true, exciseRequired: false },
      { name: 'Achchiq-chuchuk', price: 18000, categoryId: salat.id, available: true, exciseRequired: false },
      { name: 'Sezar', price: 30000, categoryId: salat.id, available: true, exciseRequired: false },
      { name: 'Choy', price: 8000, categoryId: ichimlik.id, available: true, exciseRequired: false },
      { name: 'Coca-Cola', price: 12000, categoryId: ichimlik.id, available: true, exciseRequired: false },
      // Aksizli mahsulot — kassada kodi skanerlanishi shart (TZ F-8.5)
      { name: 'Pivo (0.5)', price: 22000, categoryId: ichimlik.id, available: true, exciseRequired: true },
    ] as Partial<MenuItemEntity>[]);

    this.logger.log('Seed tayyor. Login: ofitsiant/oshpaz/kassir/admin/direktor — parol: 1234');
  }
}
