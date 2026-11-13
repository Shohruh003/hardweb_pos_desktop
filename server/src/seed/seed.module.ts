import { Module } from '@nestjs/common';
import { LicenseModule } from '../license/license.module';
import { SeedService } from './seed.service';
import { DataMigrationService } from './data-migration.service';

// SeedService faqat DataSource (global) bilan ishlaydi: barcha yozuvlar bitta tranzaksiyada
// tranzaksiya menejeri orqali bajariladi, shuning uchun forFeature repozitoriylari kerak emas.
// LicenseService — real rejimda eski demo baza topilsa, buni /license/status orqali bildirish uchun.
// DataMigrationService — bir martalik ma'lumot yangilanishlari (seed'dan keyin, har ishga tushishda).
@Module({
  imports: [LicenseModule],
  providers: [SeedService, DataMigrationService],
})
export class SeedModule {}
