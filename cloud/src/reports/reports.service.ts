import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import {
  OrderStatus,
  PaymentType,
  ReportPeriod,
  ReportSummary,
  TopItem,
  WaiterStat,
} from '@hardweb-pos/shared';
import { CloudOrderEntity, CloudPaymentEntity } from '../entities';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(CloudPaymentEntity)
    private readonly payments: Repository<CloudPaymentEntity>,
    @InjectRepository(CloudOrderEntity)
    private readonly orders: Repository<CloudOrderEntity>,
  ) {}

  private periodStart(period: ReportPeriod): Date {
    const now = new Date();
    if (period === 'day') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    const days = period === 'week' ? 7 : 30;
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  async summary(
    tenantId: string,
    period: ReportPeriod,
  ): Promise<ReportSummary> {
    const start = this.periodStart(period);
    const rows = await this.payments
      .createQueryBuilder('p')
      .select('p.type', 'type')
      .addSelect('SUM(p.amount)', 'amount')
      .addSelect('COUNT(DISTINCT p.order_id)', 'orders')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.created_at >= :start', { start })
      .groupBy('p.type')
      .getRawMany<{ type: PaymentType; amount: string; orders: string }>();

    let revenue = 0;
    let ordersCount = 0;
    const paymentBreakdown = rows.map((r) => {
      revenue += Number(r.amount);
      ordersCount += Number(r.orders);
      return { type: r.type, amount: Number(r.amount) };
    });

    return {
      period,
      revenue,
      ordersCount,
      avgCheck: ordersCount ? Math.round(revenue / ordersCount) : 0,
      paymentBreakdown,
    };
  }

  async topItems(
    tenantId: string,
    period: ReportPeriod,
    limit = 10,
  ): Promise<TopItem[]> {
    const start = this.periodStart(period);
    const orders = await this.orders.find({
      where: {
        tenantId,
        status: OrderStatus.Closed,
        closedAt: MoreThanOrEqual(start),
      },
    });

    const map = new Map<string, TopItem>();
    for (const o of orders) {
      for (const it of o.items || []) {
        const cur = map.get(it.name) || { name: it.name, quantity: 0, sum: 0 };
        cur.quantity += it.quantity;
        cur.sum += it.price * it.quantity;
        map.set(it.name, cur);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, limit);
  }

  async waiterStats(
    tenantId: string,
    period: ReportPeriod,
  ): Promise<WaiterStat[]> {
    const start = this.periodStart(period);
    const rows = await this.orders
      .createQueryBuilder('o')
      .select('o.waiter_name', 'waiterName')
      .addSelect('COUNT(o.id)', 'ordersCount')
      .addSelect('SUM(o.total)', 'revenue')
      .where('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.status = :closed', { closed: OrderStatus.Closed })
      .andWhere('o.closed_at >= :start', { start })
      .groupBy('o.waiter_name')
      .orderBy('revenue', 'DESC')
      .getRawMany<{
        waiterName: string;
        ordersCount: string;
        revenue: string;
      }>();

    return rows.map((r) => ({
      waiterName: r.waiterName ?? '—',
      ordersCount: Number(r.ordersCount),
      revenue: Number(r.revenue),
    }));
  }
}
