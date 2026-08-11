import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { TenantEntity } from '../entities';

// Online deb hisoblash oralig'i — oxirgi heartbeat shu vaqt ichida bo'lsa online
const ONLINE_WINDOW_MS = 3 * 60 * 1000; // 3 daqiqa

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly tenants: Repository<TenantEntity>,
  ) {}

  private slug(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30) || 'restoran'
    );
  }

  // Noyob 8 xonalik kalit
  private async uniqueLicenseKey(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const key = String(Math.floor(10000000 + Math.random() * 90000000));
      const exists = await this.tenants.findOne({ where: { licenseKey: key } });
      if (!exists) return key;
    }
    // juda kam ehtimol — vaqt bilan
    return String(Date.now()).slice(-8);
  }

  private view(t: TenantEntity) {
    const online =
      !!t.lastSeenAt && Date.now() - new Date(t.lastSeenAt).getTime() < ONLINE_WINDOW_MS;
    return {
      id: t.id,
      name: t.name,
      phone: t.phone ?? null,
      licenseKey: t.licenseKey,
      active: t.active,
      activated: !!t.activatedAt,
      activatedAt: t.activatedAt,
      fingerprint: t.fingerprint,
      lastSeenAt: t.lastSeenAt,
      lastIp: t.lastIp,
      appVersion: t.appVersion,
      createdAt: t.createdAt,
      online,
    };
  }

  async list() {
    const rows = await this.tenants.find({ order: { createdAt: 'DESC' } });
    return rows.map((t) => this.view(t));
  }

  async create(name: string, phone?: string) {
    const licenseKey = await this.uniqueLicenseKey();
    const base = this.slug(name);
    const suffix = randomBytes(2).toString('hex');
    const tenant = this.tenants.create({
      name: name.trim(),
      subdomain: `${base}-${suffix}`,
      apiKey: randomBytes(16).toString('hex'),
      licenseKey,
      phone: phone?.trim() || null,
      active: true,
    });
    const saved = await this.tenants.save(tenant);
    return this.view(saved);
  }

  async update(id: string, patch: { name?: string; phone?: string; active?: boolean }) {
    const t = await this.tenants.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Restoran topilmadi');
    if (patch.name !== undefined) t.name = patch.name.trim();
    if (patch.phone !== undefined) t.phone = patch.phone?.trim() || null;
    if (patch.active !== undefined) t.active = patch.active;
    return this.view(await this.tenants.save(t));
  }

  // Fingerprintni tozalash — qurilma almashtirilganda qayta aktivatsiyaga ruxsat
  async resetFingerprint(id: string) {
    const t = await this.tenants.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Restoran topilmadi');
    t.fingerprint = null;
    t.activatedAt = null;
    return this.view(await this.tenants.save(t));
  }

  async remove(id: string) {
    await this.tenants.delete(id);
    return { ok: true };
  }
}
