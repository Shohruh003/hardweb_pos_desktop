import { Module } from '@nestjs/common';
import { LicenseModule } from '../license/license.module';
import { SeedService } from './seed.service';

// SeedService faqat DataSource (global) bilan ishlaydi: barcha yozuvlar bitta tranzaksiyada
// tranzaksiya menejeri orqali bajariladi, shuning uchun forFeature repozitoriylari kerak emas.
// LicenseService — real rejimda eski demo baza topilsa, buni /license/status orqali bildirish uchun.
@Module({
  imports: [LicenseModule],
  providers: [SeedService],
})
export class SeedModule {}
