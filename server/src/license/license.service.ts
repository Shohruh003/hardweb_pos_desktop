import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { hostname, networkInterfaces } from 'os';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Offline muhlat — internetsiz shu muddat ishlaydi, keyin qulflanadi (14 kun).
const GRACE_MS = 14 * 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 2 * 60 * 1000; // 2 daqiqa

export type LicenseStatus =
  | 'not_activated'
  | 'active'
  | 'suspended'
  | 'conflict'
  | 'invalid'
  | 'grace_expired';

interface LicenseState {
  key: string | null;
  activated: boolean;
  serverStatus: 'active' | 'suspended' | 'conflict' | 'invalid' | null;
  lastOkAt: number | null; // oxirgi muvaffaqiyatli bulut aloqasi
}

@Injectable()
export class LicenseService implements OnModuleInit {
  private readonly logger = new Logger('License');
  private readonly file: string;
  private readonly cloudUrl: string;
  private readonly appVersion: string;
  private state: LicenseState = { key: null, activated: false, serverStatus: null, lastOkAt: null };

  constructor(private readonly config: ConfigService) {
    this.file = this.config.get('LICENSE_FILE') || join(process.cwd(), 'license.json');
    this.cloudUrl = (this.config.get('CLOUD_URL') || 'http://localhost:4000/api').replace(/\/$/, '');
    this.appVersion = this.config.get('APP_VERSION') || '0.1.0';
    this.load();
  }

  onModuleInit() {
    // Litsenziya majburiy emas (LICENSE_ENFORCE=false) bo'lsa — tekshirmaymiz (dev)
    if (!this.enforced()) return;
    // Boshlanishда va davriy heartbeat
    this.heartbeat().catch(() => undefined);
    setInterval(() => this.heartbeat().catch(() => undefined), HEARTBEAT_MS);
  }

  enforced(): boolean {
    return this.config.get('LICENSE_ENFORCE', 'true') !== 'false';
  }

  private load() {
    try {
      if (existsSync(this.file)) {
        this.state = { ...this.state, ...JSON.parse(readFileSync(this.file, 'utf8')) };
      }
    } catch {
      /* buzilgan fayl — bo'sh holat */
    }
  }
  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.state, null, 2));
    } catch (e) {
      this.logger.warn('license.json saqlanmadi: ' + (e as Error).message);
    }
  }

  // Mashina barmoq izi (fingerprint) — nusxa boshqa kompyuterga ko'chirilsa o'zgaradi.
  fingerprint(): string {
    const macs = Object.values(networkInterfaces())
      .flat()
      .filter((n) => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')
      .map((n) => n!.mac)
      .sort();
    return createHash('sha256').update(hostname() + '|' + macs.join(',')).digest('hex').slice(0, 32);
  }

  // Joriy holat — desktop shuni tekshiradi
  status(): LicenseStatus {
    if (!this.enforced()) return 'active';
    if (!this.state.key || !this.state.activated) return 'not_activated';
    if (this.state.serverStatus === 'suspended') return 'suspended';
    if (this.state.serverStatus === 'conflict') return 'conflict';
    if (this.state.serverStatus === 'invalid') return 'invalid';
    if (this.state.lastOkAt && Date.now() - this.state.lastOkAt > GRACE_MS) return 'grace_expired';
    return 'active';
  }

  statusInfo() {
    const s = this.status();
    return {
      status: s,
      locked: s !== 'active',
      key: this.state.key,
      lastOkAt: this.state.lastOkAt,
      graceDays: Math.round(GRACE_MS / 86400000),
    };
  }

  // Aktivatsiya — 8 xonalik kalit bilan (desktop kiritadi)
  async activate(key: string): Promise<{ ok: boolean; status: string; message?: string }> {
    const clean = (key || '').trim();
    if (!/^\d{8}$/.test(clean)) {
      return { ok: false, status: 'invalid', message: '8 xonalik kalit kiriting' };
    }
    try {
      const res = await this.callCloud('/license/activate', clean);
      if (res.ok || res.status === 'active') {
        this.state = { key: clean, activated: true, serverStatus: 'active', lastOkAt: Date.now() };
        this.save();
        return { ok: true, status: 'active' };
      }
      return { ok: false, status: res.status || 'invalid', message: res.message };
    } catch (e) {
      return { ok: false, status: 'offline', message: 'Internetga ulanib bo‘lmadi: ' + (e as Error).message };
    }
  }

  private async heartbeat() {
    if (!this.state.key) return;
    try {
      const res = await this.callCloud('/license/heartbeat', this.state.key);
      if (res.status === 'active') {
        this.state.serverStatus = 'active';
        this.state.lastOkAt = Date.now();
      } else if (['suspended', 'conflict', 'invalid'].includes(res.status)) {
        this.state.serverStatus = res.status as LicenseState['serverStatus'];
      }
      this.save();
    } catch {
      /* offline — grace hisoblanadi, lastOkAt yangilanmaydi */
    }
  }

  private async callCloud(
    path: string,
    key: string,
  ): Promise<{ ok?: boolean; status: string; message?: string }> {
    const r = await fetch(this.cloudUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, fingerprint: this.fingerprint(), version: this.appVersion }),
      signal: AbortSignal.timeout(8000),
    });
    return (await r.json()) as { ok?: boolean; status: string; message?: string };
  }
}
