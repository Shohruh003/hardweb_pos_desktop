import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isFullAccessRole } from '@hardweb-pos/shared';

import { SettingsEntity } from '../entities';
import { isLocalAddress } from './local-request';

/**
 * B35 — direktor (va SuperAdmin) faqat server kompyuteridan ishlaydi (sozlama yoqilganda).
 * Sozlama faqat kerak bo'lganda (rahbar roli + tashqi manzil) bazadan o'qiladi —
 * oddiy xodimlarning so'rovlariga qo'shimcha so'rov qo'shilmaydi.
 */
@Injectable()
export class DirectorAccess {
  constructor(
    @InjectRepository(SettingsEntity)
    private readonly settings: Repository<SettingsEntity>,
  ) {}

  /** Sozlama: direktor faqat server kompyuteridan kiradi (qator yo'q yoki NULL — yoqilgan) */
  async localOnly(): Promise<boolean> {
    const s = await this.settings.findOne({ where: { id: 'main' } });
    return s?.directorLocalOnly !== false;
  }

  /** Shu rol shu manzildan ishlay olmaydimi (true — taqiqlangan) */
  async isBlocked(role: unknown, address: unknown): Promise<boolean> {
    if (!isFullAccessRole(String(role ?? ''))) return false;
    if (isLocalAddress(address)) return false;
    return this.localOnly();
  }
}
