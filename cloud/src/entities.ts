import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderStatus, PaymentType, UserRole } from '@hardweb-pos/shared';

// Restoran (tenant) — har biri o'z subdomeni va API kaliti bilan
@Entity('tenants')
export class TenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  subdomain: string; // masalan "restoran-nomi"

  @Column({ name: 'api_key', unique: true })
  apiKey: string; // lokal server shu kalit bilan sinxronlaydi

  @Column({ default: true })
  active: boolean; // false = suspended (bloklangan)

  // --- Litsenziya / qurilma nazorati ---
  @Column({ name: 'license_key', type: 'varchar', nullable: true, unique: true })
  licenseKey: string | null; // 8 xonalik aktivatsiya kaliti

  @Column({ type: 'varchar', nullable: true })
  fingerprint: string | null; // aktivlashtirilgan mashina (nusxa-oldini olish)

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null; // oxirgi heartbeat (online/offline)

  @Column({ name: 'last_ip', type: 'varchar', nullable: true })
  lastIp: string | null;

  @Column({ name: 'app_version', type: 'varchar', nullable: true })
  appVersion: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null; // restoran aloqa (ixtiyoriy)

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}

// Bulutdagi foydalanuvchi (direktor) — tenantga bog'langan
@Entity('cloud_users')
@Index(['tenantId', 'login'], { unique: true })
export class CloudUserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column()
  name: string;

  @Column()
  login: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.Director })
  role: UserRole;
}

// Sinxronlangan buyurtma (id lokal server idsi bilan bir xil — idempotent upsert)
@Entity('cloud_orders')
export class CloudOrderEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index()
  tenantId: string;

  @Column({ name: 'table_number', type: 'int', nullable: true })
  tableNumber: number | null;

  @Column({ name: 'waiter_name', type: 'varchar', nullable: true })
  waiterName: string | null;

  @Column({ type: 'enum', enum: OrderStatus })
  status: OrderStatus;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  total: number;

  @Column({ name: 'opened_at', type: 'timestamptz' })
  openedAt: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'jsonb', default: [] })
  items: { name: string; quantity: number; price: number }[];
}

@Entity('cloud_payments')
export class CloudPaymentEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index()
  tenantId: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'enum', enum: PaymentType })
  type: PaymentType;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
