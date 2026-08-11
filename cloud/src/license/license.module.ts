import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from '../entities';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';

@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity])],
  controllers: [LicenseController],
  providers: [LicenseService],
})
export class LicenseModule {}
