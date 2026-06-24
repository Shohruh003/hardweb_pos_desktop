import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { UserRole } from '@hardweb-pos/shared';
import { CloudUserEntity, TenantEntity } from '../entities';

@Injectable()
export class TenantsService implements OnModuleInit {
  private readonly logger = new Logger('Tenants');

  constructor(
    @InjectRepository(TenantEntity)
    private readonly tenants: Repository<TenantEntity>,
    @InjectRepository(CloudUserEntity)
    private readonly users: Repository<CloudUserEntity>,
  ) {}

  // Dev: demo restoran (tenant) + direktor yaratish
  async onModuleInit() {
    if (process.env.SEED_DEMO_TENANT !== 'true') return;
    const exists = await this.tenants.findOne({
      where: { subdomain: 'demo-restoran' },
    });
    if (exists) return;

    const tenant = await this.tenants.save(
      this.tenants.create({
        name: 'Demo Restoran',
        subdomain: 'demo-restoran',
        apiKey: 'demo-api-key',
        active: true,
      }),
    );
    await this.users.save(
      this.users.create({
        tenantId: tenant.id,
        name: 'Direktor',
        login: 'direktor',
        passwordHash: await bcrypt.hash('1234', 10),
        role: UserRole.Director,
      }),
    );
    this.logger.log(
      'Demo tenant: subdomain=demo-restoran, apiKey=demo-api-key, direktor/1234',
    );
  }

  findByApiKey(apiKey: string) {
    return this.tenants.findOne({ where: { apiKey, active: true } });
  }

  findBySubdomain(subdomain: string) {
    return this.tenants.findOne({ where: { subdomain, active: true } });
  }

  // Platforma admin: yangi restoran ulash (TZ 3.2 T-3.1)
  async create(name: string, subdomain: string, directorPassword: string) {
    const dup = await this.tenants.findOne({ where: { subdomain } });
    if (dup) throw new ConflictException('Bu subdomen band');

    const tenant = await this.tenants.save(
      this.tenants.create({
        name,
        subdomain,
        apiKey: randomUUID(),
        active: true,
      }),
    );
    await this.users.save(
      this.users.create({
        tenantId: tenant.id,
        name: 'Direktor',
        login: 'direktor',
        passwordHash: await bcrypt.hash(directorPassword, 10),
        role: UserRole.Director,
      }),
    );
    return {
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      apiKey: tenant.apiKey, // lokal serverga shu kalit beriladi
      url: `https://${subdomain}.poscloud.uz`,
    };
  }
}
