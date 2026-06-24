import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  OrderEntity,
  PaymentEntity,
  TableEntity,
  UserEntity,
} from '../entities';
import {
  OrderStatus,
  SyncOrder,
  SyncPayment,
  SyncPayload,
} from '@hardweb-pos/shared';

// Lokal server -> Bulut bir tomonlama, davriy sinxron (TZ 2.3 "Bir tomonlama sinxronlash").
// Yopilgan hisoblar bulutga yuboriladi; internet bo'lmasa keyingi siklda qayta urinadi.
@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Sync');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(PaymentEntity)
    private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  onModuleInit() {
    if (this.config.get('SYNC_ENABLED', 'false') !== 'true') {
      this.logger.log('Bulut sinxron o‘chirilgan (SYNC_ENABLED=false)');
      return;
    }
    const interval = Number(this.config.get('SYNC_INTERVAL_MS', 15000));
    this.timer = setInterval(() => this.tick(), interval);
    this.logger.log(`Bulut sinxron yoqildi (har ${interval} ms)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private statePath(): string {
    return join(process.cwd(), 'sync-state.json');
  }

  private getWatermark(): string {
    try {
      const p = this.statePath();
      if (existsSync(p)) {
        return JSON.parse(readFileSync(p, 'utf-8')).lastClosedAt || '1970-01-01T00:00:00.000Z';
      }
    } catch {
      /* ignore */
    }
    return '1970-01-01T00:00:00.000Z';
  }

  private setWatermark(iso: string) {
    writeFileSync(this.statePath(), JSON.stringify({ lastClosedAt: iso }), 'utf-8');
  }

  private async tick() {
    if (this.running) return; // oldingi sikl tugamagan bo'lsa o'tkazib yuboramiz
    this.running = true;
    try {
      await this.syncOnce();
    } catch (e) {
      this.logger.warn(`Sinxron xatosi: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  // Watermarkdan keyin yopilgan hisoblarni bir partiya qilib yuborish
  async syncOnce(): Promise<{ sent: number }> {
    const url = this.config.get('CLOUD_URL', '');
    const apiKey = this.config.get('CLOUD_API_KEY', '');
    if (!url || !apiKey) return { sent: 0 };

    const watermark = new Date(this.getWatermark());
    const closed = await this.orders.find({
      where: { status: OrderStatus.Closed, closedAt: MoreThan(watermark) },
      order: { closedAt: 'ASC' },
      take: 100,
    });
    if (closed.length === 0) return { sent: 0 };

    // Stol raqami va ofitsiant ismlarini to'plab olish
    const tableIds = [...new Set(closed.map((o) => o.tableId))];
    const waiterIds = [...new Set(closed.map((o) => o.waiterId))];
    const [tables, waiters, pays] = await Promise.all([
      this.tables.find({ where: { id: In(tableIds) } }),
      this.users.find({ where: { id: In(waiterIds) } }),
      this.payments.find({ where: { orderId: In(closed.map((o) => o.id)) } }),
    ]);
    const tableNo = new Map(tables.map((t) => [t.id, t.number]));
    const waiterName = new Map(waiters.map((w) => [w.id, w.name]));

    const orders: SyncOrder[] = closed.map((o) => ({
      id: o.id,
      tableNumber: tableNo.get(o.tableId) ?? null,
      waiterName: waiterName.get(o.waiterId) ?? null,
      status: o.status,
      total: (o.items || []).reduce(
        (s, it) => s + Number(it.price) * it.quantity,
        0,
      ),
      openedAt: o.openedAt.toISOString(),
      closedAt: o.closedAt ? o.closedAt.toISOString() : null,
      items: (o.items || []).map((it) => ({
        name: it.menuItemName,
        quantity: it.quantity,
        price: Number(it.price),
      })),
    }));

    const payments: SyncPayment[] = pays.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      amount: Number(p.amount),
      type: p.type,
      createdAt: p.createdAt.toISOString(),
    }));

    const payload: SyncPayload = { orders, payments };

    const res = await fetch(`${url}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Bulut javobi: ${res.status}`);
    }

    // Watermarkni oxirgi yuborilgan hisob vaqtigacha surish
    const last = closed[closed.length - 1].closedAt;
    if (last) this.setWatermark(last.toISOString());
    this.logger.log(`Bulutga ${orders.length} ta hisob yuborildi`);
    return { sent: orders.length };
  }
}
