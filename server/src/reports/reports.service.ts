import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';

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
      .innerJoin(OrderEntity, 'o', 'o.id = p.order_id')
      .select('p.type', 'type')
      .addSelect('SUM(p.amount)', 'amount')
      .addSelect('COUNT(DISTINCT p.order_id)', 'orders')
      .where('p.created_at >= :start', { start })
      .andWhere('o.refunded = 0') // vozvrat qilinganlar hisobga olinmaydi
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
      .andWhere('o.refunded = 0')
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

  // Kunlik tushum qatori (dashboard chiziqli grafigi uchun) — oxirgi N kun.
  // closed_at bo'yicha (tarix bir necha kunga taqsimlangan).
  async daily(days = 7): Promise<{ date: string; revenue: number }[]> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const rows = await this.orders
      .createQueryBuilder('o')
      .innerJoin(PaymentEntity, 'p', 'p.order_id = o.id')
      .select("strftime('%Y-%m-%d', o.closed_at)", 'date')
      .addSelect('SUM(p.amount)', 'revenue')
      .where('o.status = :closed', { closed: OrderStatus.Closed })
      .andWhere('o.closed_at >= :start', { start })
      .andWhere('o.refunded = 0')
      .groupBy('date')
      .getRawMany<{ date: string; revenue: string }>();

    const map = new Map(rows.map((r) => [r.date, Number(r.revenue)]));
    const out: { date: string; revenue: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ date: key, revenue: map.get(key) || 0 });
    }
    return out;
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
      .andWhere('o.refunded = 0')
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

  // Vozvratlar (qaytarilgan cheklar) — soni, umumiy summasi va ro'yxati
  async refunds(period: ReportPeriod) {
    const start = this.periodStart(period);
    const orders = await this.orders.find({
      where: { refunded: true, refundedAt: MoreThanOrEqual(start) },
      relations: ['items'],
      order: { refundedAt: 'DESC' },
    });
    const items = orders.map((o) => {
      const total = (o.items || []).reduce(
        (a, it) => a + Number(it.price) * it.quantity,
        0,
      );
      return {
        id: o.id,
        total,
        reason: o.refundReason || '',
        refundedAt: o.refundedAt,
        products: (o.items || []).map((it) => ({
          name: it.menuItemName,
          quantity: it.quantity,
        })),
      };
    });
    const total = items.reduce((a, r) => a + r.total, 0);
    return { count: items.length, total, items };
  }
}
