import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CustomerEntity,
  DailyCounterEntity,
  ExciseCodeEntity,
  FiscalDocEntity,
  MenuItemEntity,
  OrderEntity,
  OrderItemEntity,
  PaymentEntity,
  StationEntity,
  TableEntity,
  UserEntity,
  VoidLogEntity,
} from '../entities';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { TelegramModule } from '../telegram/telegram.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PrintingModule } from '../printing/printing.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      OrderItemEntity,
      MenuItemEntity,
      TableEntity,
      PaymentEntity,
      UserEntity,
      FiscalDocEntity,
      ExciseCodeEntity,
      StationEntity,
      CustomerEntity,
      // Otkazlar jurnali (B19) va kunlik raqam hisoblagichi (B27)
      VoidLogEntity,
      DailyCounterEntity,
    ]),
    TelegramModule,
    InventoryModule,
    // Bo'lim (oshxona/bar) cheklarini server o'zi chop etadi — StationPrintService
    PrintingModule,
    // Xizmat haqi foizlari, zallar tartibi, to'lov usullari, yetkazish narxi — SettingsService
    SettingsModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway],
  // OrdersGateway — boshqa modullar (menyu: stop list -> menu:changed) socket xabari yuborishi uchun
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}
