import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantEntity } from '../entities';

export interface ActivateInput {
  key: string;
  fingerprint: string;
  version?: string;
  ip?: string;
}

// Qurilma (lokal server) tomon: aktivatsiya va heartbeat.
@Injectable()
export class LicenseService {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly tenants: Repository<TenantEntity>,
  ) {}

  // Aktivatsiya — 8 xonalik kalit bilan. Kalit bir mashinaga bog'lanadi (nusxa-oldini olish).
  async activate(input: ActivateInput) {
    const key = (input.key || '').trim();
    const tenant = await this.tenants.findOne({ where: { licenseKey: key } });
    if (!tenant) {
      return { ok: false, status: 'invalid', message: 'Kalit noto‘g‘ri' };
    }
    if (!tenant.active) {
      return { ok: false, status: 'suspended', message: 'Litsenziya bloklangan' };
    }
    // Kalit boshqa mashinaga bog'langan bo'lsa — nusxa (copy)
    if (tenant.fingerprint && input.fingerprint && tenant.fingerprint !== input.fingerprint) {
      return {
        ok: false,
        status: 'conflict',
        message: 'Bu kalit boshqa qurilmada faollashtirilgan',
      };
    }
    if (!tenant.fingerprint) tenant.fingerprint = input.fingerprint || null;
    if (!tenant.activatedAt) tenant.activatedAt = new Date();
    tenant.lastSeenAt = new Date();
    tenant.lastIp = input.ip ?? tenant.lastIp;
    tenant.appVersion = input.version ?? tenant.appVersion;
    await this.tenants.save(tenant);
    return { ok: true, status: 'active', name: tenant.name };
  }

  // Heartbeat — server har necha daqiqada "tirikman" deb yuboradi (online/offline + suspend).
  async heartbeat(input: ActivateInput) {
    const key = (input.key || '').trim();
    const tenant = await this.tenants.findOne({ where: { licenseKey: key } });
    if (!tenant) return { status: 'invalid' };
    if (!tenant.active) return { status: 'suspended' };
    if (tenant.fingerprint && input.fingerprint && tenant.fingerprint !== input.fingerprint) {
      return { status: 'conflict' };
    }
    tenant.lastSeenAt = new Date();
    tenant.lastIp = input.ip ?? tenant.lastIp;
    tenant.appVersion = input.version ?? tenant.appVersion;
    await this.tenants.save(tenant);
    return { status: 'active', name: tenant.name };
  }
}
