import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  CloudOrderEntity,
  CloudPaymentEntity,
  CloudUserEntity,
  TenantEntity,
} from './entities';
import { AuthModule } from './auth/auth.module';
import { SyncModule } from './sync/sync.module';
import { ReportsModule } from './reports/reports.module';
import { TenantsModule } from './tenants/tenants.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: Number(config.get('DB_PORT', 5433)),
        username: config.get('DB_USERNAME', 'postgres'),
        password: config.get('DB_PASSWORD', 'postgres'),
        database: config.get('DB_NAME', 'hardweb_cloud'),
        entities: [
          TenantEntity,
          CloudUserEntity,
          CloudOrderEntity,
          CloudPaymentEntity,
        ],
        synchronize: config.get('DB_SYNCHRONIZE', 'true') === 'true',
      }),
    }),
    AuthModule,
    SyncModule,
    ReportsModule,
    TenantsModule,
  ],
})
export class AppModule {}
