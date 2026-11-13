import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoryEntity, MenuItemEntity } from '../entities';
import { OrdersModule } from '../orders/orders.module';
import { MenuController, MenuImageController } from './menu.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([CategoryEntity, MenuItemEntity]),
    // OrdersGateway (eksport qilingan) — stop list va menyu o'zgarishida 'menu:changed' yuborish uchun.
    // OrdersModule MenuModule'ni import qilmaydi — aylanma bog'liqlik yo'q.
    OrdersModule,
  ],
  // MenuImageController — ochiq (JWT'siz) rasm marshruti: GET /api/menu/items/:id/image
  controllers: [MenuController, MenuImageController],
})
export class MenuModule {}
