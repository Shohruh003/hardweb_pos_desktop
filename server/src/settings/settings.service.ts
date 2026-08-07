import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettingsEntity } from '../entities';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(SettingsEntity)
    private readonly repo: Repository<SettingsEntity>,
  ) {}

  async get(): Promise<SettingsEntity> {
    let s = await this.repo.findOne({ where: { id: 'main' } });
    if (!s) {
      s = await this.repo.save(this.repo.create({ id: 'main' }));
    }
    return s;
  }

  async update(patch: Partial<SettingsEntity>): Promise<SettingsEntity> {
    const s = await this.get();
    Object.assign(s, patch, { id: 'main' });
    return this.repo.save(s);
  }
}
