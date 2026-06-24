import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';

import {
  ExciseCodeEntity,
  FiscalDocEntity,
  MenuItemEntity,
  OrderEntity,
  OrderItemEntity,
  PaymentEntity,
  TableEntity,
  UserEntity,
} from '../entities';
import {
  Order,
  OrderStatus,
  OrderItemStatus,
  Receipt,
  TableStatus,
} from '@hardweb-pos/shared';
import { CreateOrderDto, PayOrderDto, UpdateOrderStatusDto } from './dto';
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
    @InjectRepository(PaymentEntity)
    private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(FiscalDocEntity)
    private readonly fiscalDocs: Repository<FiscalDocEntity>,
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
            exciseRequired: mi.exciseRequired, // aksiz bayrog'ini ko'chiramiz
            exciseCode: null,
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

  // Kassa: to'lov qabul qilish, hisobni yopish, stolni bo'shatish, chek qaytarish (TZ 5.3)
  async pay(
    id: string,
    dto: PayOrderDto,
    cashierId: string,
  ): Promise<{ order: Order; receipt: Receipt }> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.status === OrderStatus.Closed) {
      throw new BadRequestException('Hisob allaqachon yopilgan');
    }

    // Aksizli taomlar uchun kod skanerlangan bo'lishi shart (TZ F-8.6/8.8)
    const missingExcise = (order.items || []).filter(
      (it) => it.exciseRequired && !it.exciseCode,
    );
    if (missingExcise.length > 0) {
      throw new BadRequestException(
        `Aksiz kodi skanerlanmagan: ${missingExcise
          .map((it) => it.menuItemName)
          .join(', ')}`,
      );
    }

    const subtotal = (order.items || []).reduce(
      (s, it) => s + Number(it.price) * it.quantity,
      0,
    );
    const discountPercent = dto.discountPercent ?? 0;
    const serviceFeePercent = dto.serviceFeePercent ?? 0;
    const discountAmount = Math.round((subtotal * discountPercent) / 100);
    const serviceFeeAmount = Math.round((subtotal * serviceFeePercent) / 100);
    const total = subtotal - discountAmount + serviceFeeAmount;

    const table = await this.tables.findOne({ where: { id: order.tableId } });
    const cashier = await this.users.findOne({ where: { id: cashierId } });
    const waiter = await this.users.findOne({ where: { id: order.waiterId } });

    // Fiskal hujjat (TZ 8.1). Hozir demo generator — real OFD ulanganda shu yerda
    // soliq operatori API'siga so'rov yuboriladi va fiskal_raqam/QR o'shandan olinadi.
    let fiscalNumber: string | undefined;
    let fiscalQr: string | undefined;
    const fiscalEnabled = process.env.FISCAL_ENABLED !== 'false';

    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        manager.create(PaymentEntity, {
          orderId: order.id,
          amount: total,
          type: dto.type,
          cashierId,
        }),
      );
      order.status = OrderStatus.Closed;
      order.closedAt = new Date();
      await manager.save(order);

      if (table) {
        table.status = TableStatus.Free; // stol bo'shadi (TZ F-3.5)
        await manager.save(table);
      }

      if (fiscalEnabled) {
        const count = await manager.count(FiscalDocEntity);
        fiscalNumber = String(count + 1).padStart(10, '0');
        // QR payload — real OFD'da bu soliq tekshiruv URL'i bo'ladi
        fiscalQr =
          `https://ofd.soliq.uz/check?fn=${fiscalNumber}` +
          `&sum=${total}&t=${order.closedAt!.getTime()}`;
        await manager.save(
          manager.create(FiscalDocEntity, {
            orderId: order.id,
            fiscalNumber,
            qrCode: fiscalQr,
          }),
        );
      }
    });

    const receipt: Receipt = {
      orderId: order.id,
      tableNumber: table?.number,
      waiterName: waiter?.name,
      cashierName: cashier?.name,
      lines: (order.items || []).map((it) => ({
        name: it.menuItemName,
        quantity: it.quantity,
        price: Number(it.price),
        sum: Number(it.price) * it.quantity,
      })),
      subtotal,
      discountPercent,
      discountAmount,
      serviceFeePercent,
      serviceFeeAmount,
      total,
      paymentType: dto.type,
      createdAt: new Date().toISOString(),
      fiscalQrPlaceholder: !fiscalEnabled, // fiskal o'chiq bo'lsa faqat joy ko'rsatiladi
      fiscalNumber,
      fiscalQr,
    };

    const dtoOut = this.toDto(order, table?.number);
    this.gateway.emitOrderClosed(dtoOut); // -> KDS/navbatdan o'chadi
    return { order: dtoOut, receipt };
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
        exciseRequired: it.exciseRequired,
        exciseCode: it.exciseCode,
      })),
    };
  }

  // Aksiz kodlarini saqlash (TZ F-8.6/8.8) — kassa skaner orqali kiritadi
  async addExciseCodes(
    orderId: string,
    codes: { orderItemId: string; code: string }[],
  ): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');

    await this.dataSource.transaction(async (manager) => {
      for (const c of codes) {
        const item = order.items.find((it) => it.id === c.orderItemId);
        if (!item) continue;
        item.exciseCode = c.code;
        await manager.save(item);
        await manager.save(
          manager.create(ExciseCodeEntity, {
            orderItemId: item.id,
            exciseCode: c.code,
          }),
        );
      }
    });

    return this.findOne(orderId);
  }
}
