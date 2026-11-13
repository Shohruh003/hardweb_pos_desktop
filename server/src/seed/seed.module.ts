import { Module } from '@nestjs/common';
import { SeedService } from './seed.service';

// SeedService faqat DataSource (global) bilan ishlaydi: barcha yozuvlar bitta tranzaksiyada
// tranzaksiya menejeri orqali bajariladi, shuning uchun forFeature repozitoriylari kerak emas.
@Module({
  providers: [SeedService],
})
export class SeedModule {}
