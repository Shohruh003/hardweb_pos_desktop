import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

import * as entities from './entities';
import { AuthModule } from './auth/auth.module';
import { TablesModule } from './tables/tables.module';
import { MenuModule } from './menu/menu.module';
import { InventoryModule } from './inventory/inventory.module';
import { StationsModule } from './stations/stations.module';
import { CustomersModule } from './customers/customers.module';
import { LicenseModule } from './license/license.module';
import { OrdersModule } from './orders/orders.module';
import { UsersModule } from './users/users.module';
import { QueueModule } from './queue/queue.module';
import { ReportsModule } from './reports/reports.module';
import { ExpensesModule } from './expenses/expenses.module';
import { TelegramModule } from './telegram/telegram.module';
import { SettingsModule } from './settings/settings.module';
import { TerminalsModule } from './terminals/terminals.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { SyncModule } from './sync/sync.module';
import { SeedModule } from './seed/seed.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Faylli baza (SQLite) — Docker/Postgres kerak emas, backup = faylni nusxalash.
        // DB_FILE berilmasa, joriy papkada data/dasturxon.db yaratiladi.
        const dbFile = config.get('DB_FILE') || join(process.cwd(), 'data', 'dasturxon.db');
        mkdirSync(dirname(dbFile), { recursive: true }); // papka bo'lmasa yaratamiz
        return {
          type: 'better-sqlite3' as const,
          database: dbFile,
          entities: Object.values(entities),
          synchronize: config.get('DB_SYNCHRONIZE', 'true') === 'true',
        };
      },
    }),
    LicenseModule,
    AuthModule,
    TablesModule,
    MenuModule,
    InventoryModule,
    StationsModule,
    CustomersModule,
    OrdersModule,
    UsersModule,
    QueueModule,
    ReportsModule,
    ExpensesModule,
    TelegramModule,
    SettingsModule,
    TerminalsModule,
    MaintenanceModule,
    SyncModule,
    SeedModule,
  ],
})
export class AppModule {}
