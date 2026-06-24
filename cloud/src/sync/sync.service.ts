import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncPayload, SyncResult } from '@hardweb-pos/shared';
import { CloudOrderEntity, CloudPaymentEntity } from '../entities';

@Injectable()
export class SyncService {
  constructor(
    @InjectRepository(CloudOrderEntity)
    private readonly orders: Repository<CloudOrderEntity>,
    @InjectRepository(CloudPaymentEntity)
    private readonly payments: Repository<CloudPaymentEntity>,
  ) {}

  // Bir tomonlama sinxron: lokal serverdan kelgan partiyani idempotent saqlash
  async ingest(tenantId: string, payload: SyncPayload): Promise<SyncResult> {
    const orderRows = (payload.orders || []).map((o) => ({
      id: o.id,
      tenantId,
      tableNumber: o.tableNumber,
      waiterName: o.waiterName,
      status: o.status,
      total: o.total,
      openedAt: new Date(o.openedAt),
      closedAt: o.closedAt ? new Date(o.closedAt) : null,
      items: o.items || [],
    }));
    const paymentRows = (payload.payments || []).map((p) => ({
      id: p.id,
      tenantId,
      orderId: p.orderId,
      amount: p.amount,
      type: p.type,
      createdAt: new Date(p.createdAt),
    }));

    // upsert (id bo'yicha) — bir xil ma'lumot qayta kelsa ham xavfsiz
    if (orderRows.length) {
      await this.orders.upsert(orderRows, ['id']);
    }
    if (paymentRows.length) {
      await this.payments.upsert(paymentRows, ['id']);
    }
    return { ordersSaved: orderRows.length, paymentsSaved: paymentRows.length };
  }
}
