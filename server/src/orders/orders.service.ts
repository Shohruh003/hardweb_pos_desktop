import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';

import {
  MenuItemEntity,
  OrderEntity,
  OrderItemEntity,
  TableEntity,
} from '../entities';
import {
  Order,
  OrderStatus,
  OrderItemStatus,
  TableStatus,
} from '@hardweb-pos/shared';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto';
import { OrdersGateway } from './orders.gateway';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(MenuItemEntity)
    private readonly menuItems: Repository<MenuItemEntity>,
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    private readonly dataSource: DataSource,
    private readonly gateway: OrdersGateway,
  ) {}

  // Faol (yopilmagan) buyurtmalar — KDS va kassa uchun
  async findActive(): Promise<Order[]> {
    const list = await this.orders.find({
      where: { status: Not(OrderStatus.Closed) },
      order: { openedAt: 'ASC' }, // eng eskisi yuqorida (TZ F-2.5)
    });
    const tableMap = await this.tableNumberMap(list.map((o) => o.tableId));
    return list.map((o) => this.toDto(o, tableMap.get(o.tableId)));
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const table = await this.tables.findOne({ where: { id: order.tableId } });
    return this.toDto(order, table?.number);
  }

  // stol id -> stol raqami xaritasi (KDS/kassada ko'rsatish uchun)
  private async tableNumberMap(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const tables = await this.tables.find({ where: { id: In(ids) } });
    return new Map(tables.map((t) => [t.id, t.number]));
  }

  // Yangi buyurtma — ofitsiant yuboradi (TZ F-1.7), KDS/navbatga real-time uzatiladi
  async create(dto: CreateOrderDto, waiterId: string): Promise<Order> {
    if (!dto.items?.length) {
      throw new BadRequestException('Buyurtma bo‘sh bo‘lishi mumkin emas');
    }

    const table = await this.tables.findOne({ where: { id: dto.tableId } });
    if (!table) throw new NotFoundException('Stol topilmadi');

    const menuIds = dto.items.map((i) => i.menuItemId);
    const menu = await this.menuItems.find({ where: { id: In(menuIds) } });
    const menuById = new Map(menu.map((m) => [m.id, m]));

    const saved = await this.dataSource.transaction(async (manager) => {
      const order = manager.create(OrderEntity, {
        tableId: dto.tableId,
        waiterId,
        status: OrderStatus.Accepted,
        items: dto.items.map((i) => {
          const mi = menuById.get(i.menuItemId);
          if (!mi) {
            throw new BadRequestException(`Taom topilmadi: ${i.menuItemId}`);
          }
          return manager.create(OrderItemEntity, {
            menuItemId: mi.id,
            menuItemName: mi.name,
            price: mi.price,
            quantity: i.quantity,
            note: i.note ?? null,
            status: OrderItemStatus.Pending,
          });
        }),
      });
      const result = await manager.save(order);

      // Stol band bo'ldi
      table.status = TableStatus.Busy;
      await manager.save(table);

      return result;
    });

    const dtoOut = this.toDto(saved, table.number);
    this.gateway.emitOrderCreated(dtoOut); // -> KDS / navbat
    return dtoOut;
  }

  // Buyurtma holatini o'zgartirish (TZ F-2.3): qabul -> tayyorlanmoqda -> tayyor
  async updateStatus(id: string, dto: UpdateOrderStatusDto): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');

    order.status = dto.status;
    if (dto.status === OrderStatus.Ready) {
      order.items.forEach((it) => (it.status = OrderItemStatus.Ready));
    }
    const saved = await this.orders.save(order);

    const table = await this.tables.findOne({ where: { id: saved.tableId } });
    const dtoOut = this.toDto(saved, table?.number);
    this.gateway.emitOrderUpdated(dtoOut); // -> ofitsiant / navbat
    return dtoOut;
  }

  private toDto(o: OrderEntity, tableNumber?: number): Order {
    const total = (o.items || []).reduce(
      (sum, it) => sum + Number(it.price) * it.quantity,
      0,
    );
    return {
      id: o.id,
      tableId: o.tableId,
      waiterId: o.waiterId,
      status: o.status,
      openedAt: o.openedAt?.toISOString?.() ?? String(o.openedAt),
      closedAt: o.closedAt ? o.closedAt.toISOString() : null,
      queueNumber: o.queueNumber ?? null,
      tableNumber,
      total,
      items: (o.items || []).map((it) => ({
        id: it.id,
        orderId: it.orderId,
        menuItemId: it.menuItemId,
        menuItemName: it.menuItemName,
        price: Number(it.price),
        quantity: it.quantity,
        note: it.note,
        status: it.status,
      })),
    };
  }
}
