import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  OrderEntity,
  OrderItemEntity,
  PaymentEntity,
} from '../entities';
import {
  OrderStatus,
  PaymentType,
  ReportPeriod,
  ReportSummary,
  TopItem,
  WaiterStat,
} from '@hardweb-pos/shared';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(PaymentEntity)
    private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItems: Repository<OrderItemEntity>,
  ) {}

  // Davr boshlanish vaqti: kun = bugun 00:00, hafta = 7 kun, oy = 30 kun
  private periodStart(period: ReportPeriod): Date {
    const now = new Date();
    if (period === 'day') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    const days = period === 'week' ? 7 : 30;
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  // Umumiy ko'rsatkichlar: tushum, hisoblar soni, o'rtacha chek, to'lov turlari (TZ F-5.2)
  async summary(period: ReportPeriod): Promise<ReportSummary> {
    const start = this.periodStart(period);

    const rows = await this.payments
      .createQueryBuilder('p')
      .select('p.type', 'type')
      .addSelect('SUM(p.amount)', 'amount')
      .addSelect('COUNT(DISTINCT p.order_id)', 'orders')
      .where('p.created_at >= :start', { start })
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

  // Eng ko'p sotilgan taomlar reytingi (TZ F-5.3)
  async topItems(period: ReportPeriod, limit = 10): Promise<TopItem[]> {
    const start = this.periodStart(period);
    const rows = await this.orderItems
      .createQueryBuilder('oi')
      .innerJoin(OrderEntity, 'o', 'o.id = oi.order_id')
      .select('oi.menu_item_name', 'name')
      .addSelect('SUM(oi.quantity)', 'quantity')
      .addSelect('SUM(oi.price * oi.quantity)', 'sum')
      .where('o.status = :closed', { closed: OrderStatus.Closed })
      .andWhere('o.closed_at >= :start', { start })
      .groupBy('oi.menu_item_name')
      .orderBy('quantity', 'DESC')
      .limit(limit)
      .getRawMany<{ name: string; quantity: string; sum: string }>();

    return rows.map((r) => ({
      name: r.name,
      quantity: Number(r.quantity),
      sum: Number(r.sum),
    }));
  }

  // Ofitsiantlar bo'yicha statistika (TZ F-5.4)
  async waiterStats(period: ReportPeriod): Promise<WaiterStat[]> {
    const start = this.periodStart(period);
    const rows = await this.orders
      .createQueryBuilder('o')
      .innerJoin('users', 'u', 'u.id = o.waiter_id')
      .innerJoin(PaymentEntity, 'p', 'p.order_id = o.id')
      .select('u.name', 'waiterName')
      .addSelect('COUNT(DISTINCT o.id)', 'ordersCount')
      .addSelect('SUM(p.amount)', 'revenue')
      .where('o.status = :closed', { closed: OrderStatus.Closed })
      .andWhere('o.closed_at >= :start', { start })
      .groupBy('u.name')
      .orderBy('revenue', 'DESC')
      .getRawMany<{
        waiterName: string;
        ordersCount: string;
        revenue: string;
      }>();

    return rows.map((r) => ({
      waiterName: r.waiterName,
      ordersCount: Number(r.ordersCount),
      revenue: Number(r.revenue),
    }));
  }
}
