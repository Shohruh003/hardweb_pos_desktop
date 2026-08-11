import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from '../entities';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PlatformGuard } from './platform.guard';

@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity])],
  controllers: [AdminController],
  providers: [AdminService, PlatformGuard],
})
export class AdminModule {}
