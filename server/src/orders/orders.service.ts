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
  StationEntity,
  TableEntity,
  UserEntity,
} from '../entities';
import {
  Order,
  OrderStatus,
  OrderItemStatus,
  PaymentType,
  Receipt,
  TableStatus,
  MenuUnit,
} from '@hardweb-pos/shared';
import { CreateOrderDto, PayOrderDto, UpdateOrderStatusDto } from './dto';
import { OrdersGateway } from './orders.gateway';
import { TelegramService } from '../telegram/telegram.service';
import { InventoryService } from '../inventory/inventory.service';

// Tarix uchun filtr/pagination parametrlari
export interface HistoryQuery {
  page?: number | string;
  limit?: number | string;
  waiterId?: string;
  status?: string;
  hall?: string;
  dateFrom?: string;
  dateTo?: string;
  paymentType?: string;
  search?: string;
}

export interface PaginatedOrders {
  items: Order[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(MenuItemEntity)
    private readonly menuItems: Repository<MenuItemEntity>,
    @InjectRepository(StationEntity)
    private readonly stations: Repository<StationEntity>,
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
    private readonly telegram: TelegramService,
    private readonly inventory: InventoryService,
  ) {}

  // Faol (yopilmagan) buyurtmalar — KDS va kassa uchun (zal bilan)
  async findActive(): Promise<Order[]> {
    const list = await this.orders.find({
      where: { status: Not(OrderStatus.Closed) },
      order: { openedAt: 'ASC' }, // eng eskisi yuqorida (TZ F-2.5)
    });
    if (list.length === 0) return [];
    const tableRows = await this.tables.find({
      where: { id: In([...new Set(list.map((o) => o.tableId))]) },
    });
    const users = await this.users.find({
      where: { id: In([...new Set(list.map((o) => o.waiterId))]) },
    });
    const tableNo = new Map(tableRows.map((t) => [t.id, t.number]));
    const tableHall = new Map(tableRows.map((t) => [t.id, t.hall]));
    const waiterName = new Map(users.map((u) => [u.id, u.name]));
    return list.map((o) => {
      const dto = this.toDto(o, tableNo.get(o.tableId));
      dto.hall = tableHall.get(o.tableId) ?? null;
      dto.waiterName = waiterName.get(o.waiterId) ?? null;
      return dto;
    });
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const table = await this.tables.findOne({ where: { id: order.tableId } });
    return this.toDto(order, table?.number);
  }

  // Buyurtmalar tarixi — pagination + filtrlar bilan (cheklar/shikoyatlar uchun).
  // Katta hajmda ham tez ishlashi uchun sahifalab (20 tadan) qaytaramiz.
  async history(query: HistoryQuery): Promise<PaginatedOrders> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const qb = this.orders
      .createQueryBuilder('o')
      // stol ma'lumoti — filtr (zal/raqam) uchun join
      .leftJoin(TableEntity, 't', 't.id = o.tableId');

    if (query.waiterId) {
      qb.andWhere('o.waiterId = :waiterId', { waiterId: query.waiterId });
    }
    if (query.status) {
      qb.andWhere('o.status = :status', { status: query.status });
    }
    if (query.hall) {
      qb.andWhere('t.hall = :hall', { hall: query.hall });
    }
    if (query.dateFrom) {
      qb.andWhere('o.openedAt >= :dateFrom', { dateFrom: query.dateFrom });
    }
    if (query.dateTo) {
      qb.andWhere('o.openedAt <= :dateTo', { dateTo: query.dateTo });
    }
    if (query.search) {
      // stol raqami bo'yicha qidiruv
      qb.andWhere('CAST(t.number AS TEXT) LIKE :search', {
        search: `%${query.search}%`,
      });
    }
    if (query.paymentType) {
      qb.andWhere(
        `o.id IN ${qb
          .subQuery()
          .select('p.orderId')
          .from(PaymentEntity, 'p')
          .where('p.type = :pt')
          .getQuery()}`,
      ).setParameter('pt', query.paymentType);
    }

    const total = await qb.getCount();
    const list = await qb
      .orderBy('o.openedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const items = list.length ? await this.enrichHistory(list) : [];
    return { items, total, page, limit, hasMore: page * limit < total };
  }

  // Sahifadagi buyurtmalarni stol/ofitsiant/to'lov ma'lumoti bilan boyitamiz
  private async enrichHistory(list: OrderEntity[]): Promise<Order[]> {
    const tableRows = await this.tables.find({
      where: { id: In([...new Set(list.map((o) => o.tableId))]) },
    });
    const users = await this.users.find({
      where: { id: In([...new Set(list.map((o) => o.waiterId))]) },
    });
    const pays = await this.payments.find({
      where: { orderId: In(list.map((o) => o.id)) },
    });
    const tableNo = new Map(tableRows.map((t) => [t.id, t.number]));
    const tableHall = new Map(tableRows.map((t) => [t.id, t.hall]));
    const waiterName = new Map(users.map((u) => [u.id, u.name]));
    const payByOrder = new Map(pays.map((p) => [p.orderId, p]));

    return list.map((o) => {
      const dto = this.toDto(o, tableNo.get(o.tableId));
      dto.hall = tableHall.get(o.tableId) ?? null;
      dto.waiterName = waiterName.get(o.waiterId) ?? null;
      const p = payByOrder.get(o.id);
      if (p) dto.paymentType = p.type;
      return dto;
    });
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

    // Ombor yetarliligini tekshiramiz — ochiq (to'lanmagan) buyurtmalar band
    // hisoblanadi, shuning uchun 20 ta cola bo'lsa 20 tadan ortiq sotib bo'lmaydi.
    const openOrders = await this.orders.find({
      where: { status: Not(OrderStatus.Closed) },
    });
    const reservedItems = openOrders.flatMap((o) =>
      (o.items || []).map((it) => ({
        menuItemId: it.menuItemId,
        quantity: Number(it.quantity),
      })),
    );
    await this.inventory.assertStockAvailable(
      dto.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
      reservedItems,
    );

    const menuIds = dto.items.map((i) => i.menuItemId);
    const menu = await this.menuItems.find({ where: { id: In(menuIds) } });
    const menuById = new Map(menu.map((m) => [m.id, m]));

    // Bo'lim (sex) nomlarini olib qo'yamiz — chekни to'g'ri bo'limga yo'naltirish uchun
    const stationIds = [
      ...new Set(menu.map((m) => m.stationId).filter(Boolean) as string[]),
    ];
    const stationRows = stationIds.length
      ? await this.stations.find({ where: { id: In(stationIds) } })
      : [];
    const stationNameById = new Map(stationRows.map((s) => [s.id, s.name]));

    const buildItems = (manager: typeof this.dataSource.manager) =>
      dto.items.map((i) => {
        const mi = menuById.get(i.menuItemId);
        if (!mi) {
          throw new BadRequestException(`Taom topilmadi: ${i.menuItemId}`);
        }
        return manager.create(OrderItemEntity, {
          menuItemId: mi.id,
          menuItemName: mi.name,
          price: mi.price,
          quantity: i.quantity,
          unit: mi.unit ?? MenuUnit.Piece,
          stationId: mi.stationId ?? null,
          stationName: mi.stationId ? stationNameById.get(mi.stationId) ?? null : null,
          note: i.note ?? null,
          status: OrderItemStatus.Pending,
          exciseRequired: mi.exciseRequired,
          exciseCode: null,
        });
      });

    // Agar shu stolda ochiq (yopilmagan) buyurtma bo'lsa — yangi taomlarni
    // o'sha buyurtmaga qo'shamiz (mijoz keyinroq qo'shimcha buyursa).
    const existing = await this.orders.findOne({
      where: { tableId: dto.tableId, status: Not(OrderStatus.Closed) },
      order: { openedAt: 'DESC' },
    });
    if (existing) {
      const newItems = buildItems(this.dataSource.manager);
      existing.items = [...(existing.items || []), ...newItems];
      if (dto.note !== undefined) existing.note = dto.note?.trim() || null;
      // Yangi taomlar tayyorlanishi kerak — buyurtma yana faollashadi
      if (existing.status === OrderStatus.Ready) {
        existing.status = OrderStatus.Cooking;
      }
      const savedExisting = await this.orders.save(existing);
      const dtoOut = this.toDto(savedExisting, table.number);
      this.gateway.emitOrderUpdated(dtoOut); // -> KDS yangi taomlarni ko'radi
      return dtoOut;
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const order = manager.create(OrderEntity, {
        tableId: dto.tableId,
        waiterId,
        status: OrderStatus.Accepted,
        note: dto.note?.trim() || null,
        items: buildItems(manager),
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

  // Schot (hisob) so'raldi — stolni "hisob kutilmoqda" holatiga o'tkazamiz.
  // Ofitsiant "Schot" bosганda chaqiriladi; to'lovdan keyin stol bo'shaydi.
  async requestBill(id: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const table = await this.tables.findOne({ where: { id: order.tableId } });
    if (table && table.status !== TableStatus.Free) {
      table.status = TableStatus.AwaitingBill;
      await this.tables.save(table);
    }
    const dto = this.toDto(order, table?.number);
    this.gateway.emitOrderUpdated(dto);
    return dto;
  }

  // Chekka izoh (Примечание) — ofitsiant/kassir kiritadi
  async setNote(id: string, note?: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    order.note = note?.trim() || null;
    const saved = await this.orders.save(order);
    const table = await this.tables.findOne({ where: { id: saved.tableId } });
    const dto = this.toDto(saved, table?.number);
    this.gateway.emitOrderUpdated(dto);
    return dto;
  }

  // Hisob (schot) chekini printerli terminalга (kassa) yuborish — relay.
  // Ofitsiant terminalида printer bo'lmasa, kassa terminali chop etadi.
  async printBillRelay(id: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const table = await this.tables.findOne({ where: { id: order.tableId } });
    const waiter = await this.users.findOne({ where: { id: order.waiterId } });
    const dto = this.toDto(order, table?.number);
    dto.hall = table?.hall ?? null;
    dto.waiterName = waiter?.name ?? null;
    this.gateway.emitPrintBill(dto);
    return dto;
  }

  // To'lov chekini printerli terminalга (kassa) yuborish — relay.
  // Kassa boshqa terminalда (printersiz) to'lov qilса, chek kassa printeridan chiqadi.
  printReceiptRelay(receipt: Receipt): { ok: boolean } {
    this.gateway.emitPrintReceipt(receipt);
    return { ok: true };
  }

  // Buyurtmadan ayrim taomlarni olib tashlash (qaytarish). Hamma taom olib
  // tashlansa — butun buyurtma bekor qilinadi (stol bo'shaydi).
  async removeItems(id: string, itemIds: string[]): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.status === OrderStatus.Closed) {
      throw new BadRequestException('Yopilgan buyurtmani o‘zgartirib bo‘lmaydi');
    }
    const ids = new Set(itemIds || []);
    const toRemove = (order.items || []).filter((it) => ids.has(it.id));
    const remaining = (order.items || []).filter((it) => !ids.has(it.id));
    if (toRemove.length === 0) {
      const table = await this.tables.findOne({ where: { id: order.tableId } });
      return this.toDto(order, table?.number);
    }
    // Hamma taom olib tashlandi — buyurtmani butunlay bekor qilamiz
    if (remaining.length === 0) {
      return this.cancel(id);
    }
    await this.dataSource.manager.delete(
      OrderItemEntity,
      toRemove.map((it) => it.id),
    );
    const updated = await this.orders.findOne({ where: { id } });
    const table = await this.tables.findOne({ where: { id: order.tableId } });
    const dto = this.toDto(updated!, table?.number);
    dto.hall = table?.hall ?? null;
    this.gateway.emitOrderUpdated(dto);
    return dto;
  }

  // Schotni bekor qilish (annul) — to'lanmagan buyurtmani butunlay o'chiradi,
  // stolni bo'shatadi. To'langan (yopilgan) chek uchun bu ishlamaydi (vozvrat ishlatiladi).
  async cancel(id: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.status === OrderStatus.Closed) {
      throw new BadRequestException(
        'To‘langan chekni bekor qilib bo‘lmaydi (vozvrat qiling)',
      );
    }
    const table = await this.tables.findOne({ where: { id: order.tableId } });
    const dto = this.toDto(order, table?.number);
    dto.hall = table?.hall ?? null;
    await this.dataSource.transaction(async (m) => {
      await m.delete(OrderItemEntity, { orderId: id });
      await m.delete(OrderEntity, id);
      if (table) {
        table.status = TableStatus.Free;
        await m.save(table);
      }
    });
    // Ro'yxatlardan (KDS/kassa/ofitsiant) olib tashlash uchun "yopildi" hodisasi
    this.gateway.emitOrderClosed(dto);
    return dto;
  }

  // Buyurtmani boshqa stolga ko'chirish (smenit stol)
  async moveTable(id: string, newTableId: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.status === OrderStatus.Closed) {
      throw new BadRequestException('Yopilgan buyurtmani ko‘chirib bo‘lmaydi');
    }
    if (order.tableId === newTableId) {
      const t = await this.tables.findOne({ where: { id: newTableId } });
      return this.toDto(order, t?.number);
    }
    const oldTable = await this.tables.findOne({ where: { id: order.tableId } });
    const newTable = await this.tables.findOne({ where: { id: newTableId } });
    if (!newTable) throw new NotFoundException('Yangi stol topilmadi');
    // Yangi stolда boshqa ochiq buyurtma bo'lmasligi kerak
    const busyByOther = await this.orders.findOne({
      where: { tableId: newTableId, status: Not(OrderStatus.Closed) },
    });
    if (busyByOther) {
      throw new BadRequestException('Bu stol band — avval uni bo‘shating');
    }
    order.tableId = newTableId;
    await this.orders.save(order);
    if (oldTable) {
      oldTable.status = TableStatus.Free;
      await this.tables.save(oldTable);
    }
    newTable.status = TableStatus.Busy;
    await this.tables.save(newTable);
    const dto = this.toDto(order, newTable.number);
    dto.hall = newTable.hall ?? null;
    this.gateway.emitOrderUpdated(dto);
    return dto;
  }

  // Buyurtma ofitsiantини o'zgartirish (smenit ofitsant)
  async changeWaiter(id: string, waiterId: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const waiter = await this.users.findOne({ where: { id: waiterId } });
    if (!waiter) throw new NotFoundException('Ofitsiant topilmadi');
    order.waiterId = waiterId;
    await this.orders.save(order);
    const table = await this.tables.findOne({ where: { id: order.tableId } });
    const dto = this.toDto(order, table?.number);
    dto.hall = table?.hall ?? null;
    dto.waiterName = waiter.name;
    this.gateway.emitOrderUpdated(dto);
    return dto;
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
  ): Promise<{
    order: Order;
    receipt?: Receipt;
    fullyPaid: boolean;
    paidAmount: number;
    total: number;
    payments: { id: string; type: PaymentType; amount: number; createdAt: string }[];
  }> {
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

    // Chegirma/xizmat foizini buyurtmaga saqlaymiz — bo'lib to'lashda total barqaror qoladi
    if (dto.discountPercent != null) order.discountPercent = dto.discountPercent;
    if (dto.serviceFeePercent != null) order.servicePercent = dto.serviceFeePercent;

    const subtotal = (order.items || []).reduce(
      (s, it) => s + Number(it.price) * Number(it.quantity),
      0,
    );
    const discountPercent = Number(order.discountPercent) || 0;
    const serviceFeePercent = Number(order.servicePercent) || 0;
    const discountAmount = Math.round((subtotal * discountPercent) / 100);
    const serviceFeeAmount = Math.round((subtotal * serviceFeePercent) / 100);
    const total = subtotal - discountAmount + serviceFeeAmount;

    // Oldingi to'lovlar (bo'lib to'lash) — qolgan summani hisoblaymiz
    const priorPayments = await this.payments.find({
      where: { orderId: order.id },
      order: { createdAt: 'ASC' },
    });
    const priorPaid = priorPayments.reduce((s, p) => s + Number(p.amount), 0);
    const remaining = Math.max(0, total - priorPaid);
    if (remaining <= 0) {
      throw new BadRequestException('Hisob allaqachon to‘langan');
    }
    // To'lov summasi: berilmasa — qolgan summa; berilsa — qolgandan oshmaydi
    const payAmount =
      dto.amount != null ? Math.min(Math.round(dto.amount), remaining) : remaining;
    if (payAmount <= 0) {
      throw new BadRequestException('To‘lov summasi noto‘g‘ri');
    }
    const newPaid = priorPaid + payAmount;
    const fullyPaid = newPaid >= total;

    const table = await this.tables.findOne({ where: { id: order.tableId } });
    const cashier = await this.users.findOne({ where: { id: cashierId } });
    const waiter = await this.users.findOne({ where: { id: order.waiterId } });

    // Fiskal hujjat (TZ 8.1) — faqat to'liq to'langanda yaratiladi
    let fiscalNumber: string | undefined;
    let fiscalQr: string | undefined;
    let newPaymentId = '';
    const fiscalEnabled = process.env.FISCAL_ENABLED !== 'false';

    await this.dataSource.transaction(async (manager) => {
      const savedPayment = await manager.save(
        manager.create(PaymentEntity, {
          orderId: order.id,
          amount: payAmount,
          type: dto.type,
          cashierId,
        }),
      );
      newPaymentId = savedPayment.id;
      // chegirma/xizmat persistini saqlaymiz
      await manager.save(order);

      if (fullyPaid) {
        order.status = OrderStatus.Closed;
        order.closedAt = new Date();
        await manager.save(order);

        if (table) {
          table.status = TableStatus.Free; // stol bo'shadi (TZ F-3.5)
          await manager.save(table);
        }

        // Sotildi — taomlarga ketgan mahsulotlarni skladdan ayiramiz
        await this.inventory.deductForOrder(
          manager,
          (order.items || []).map((it) => ({
            menuItemId: it.menuItemId,
            quantity: Number(it.quantity),
          })),
        );

        if (fiscalEnabled) {
          const count = await manager.count(FiscalDocEntity);
          fiscalNumber = String(count + 1).padStart(10, '0');
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
      }
    });

    const allPayments = [
      ...priorPayments.map((p) => ({
        id: p.id,
        type: p.type,
        amount: Number(p.amount),
        createdAt: p.createdAt?.toISOString?.() ?? String(p.createdAt),
      })),
      { id: newPaymentId, type: dto.type, amount: payAmount, createdAt: new Date().toISOString() },
    ];

    const dtoOut = this.toDto(order, table?.number);
    dtoOut.subtotal = subtotal;
    dtoOut.discountPercent = discountPercent;
    dtoOut.servicePercent = serviceFeePercent;
    dtoOut.total = total;
    dtoOut.paidAmount = newPaid;

    if (!fullyPaid) {
      // Qisman to'landi — buyurtma ochiq qoladi, chek chiqmaydi
      this.gateway.emitOrderUpdated(dtoOut);
      return { order: dtoOut, fullyPaid: false, paidAmount: newPaid, total, payments: allPayments };
    }

    const receipt: Receipt = {
      orderId: order.id,
      tableNumber: table?.number,
      hall: table?.hall ?? null,
      waiterName: waiter?.name,
      cashierName: cashier?.name,
      lines: (order.items || []).map((it) => ({
        name: it.menuItemName,
        quantity: Number(it.quantity),
        price: Number(it.price),
        sum: Number(it.price) * Number(it.quantity),
        unit: it.unit ?? MenuUnit.Piece,
      })),
      subtotal,
      discountPercent,
      discountAmount,
      serviceFeePercent,
      serviceFeeAmount,
      total,
      paymentType: dto.type,
      payments: allPayments.map((p) => ({ type: p.type, amount: p.amount })),
      note: order.note ?? null,
      createdAt: new Date().toISOString(),
      fiscalQrPlaceholder: !fiscalEnabled,
      fiscalNumber,
      fiscalQr,
    };

    this.gateway.emitOrderClosed(dtoOut); // -> KDS/navbatdan o'chadi
    return { order: dtoOut, receipt, fullyPaid: true, paidAmount: newPaid, total, payments: allPayments };
  }

  // Bo'lib to'langan qisman to'lovni bekor qilish (chek yopilmagan bo'lsa)
  async deletePayment(orderId: string, paymentId: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.status === OrderStatus.Closed) {
      throw new BadRequestException('Yopilgan chek to‘lovini o‘chirib bo‘lmaydi');
    }
    await this.payments.delete({ id: paymentId, orderId });
    const remaining = await this.payments.find({ where: { orderId }, order: { createdAt: 'ASC' } });
    const paidAmount = remaining.reduce((s, p) => s + Number(p.amount), 0);
    const table = await this.tables.findOne({ where: { id: order.tableId } });
    const dtoOut = this.toDto(order, table?.number);
    dtoOut.paidAmount = paidAmount;
    this.gateway.emitOrderUpdated(dtoOut);
    return dtoOut;
  }

  // Buyurtma to'lovlari ro'yxati (bo'lib to'lash uchun)
  async getPayments(orderId: string) {
    const rows = await this.payments.find({ where: { orderId }, order: { createdAt: 'ASC' } });
    return rows.map((p) => ({
      id: p.id,
      type: p.type,
      amount: Number(p.amount),
      createdAt: p.createdAt?.toISOString?.() ?? String(p.createdAt),
    }));
  }

  // Vozvrat — to'langan (yopilgan) chekni qaytarish. Faqat Direktor/Administrator
  // (ruxsat controllerda RolesGuard bilan tekshiriladi). Sabab jurnalga yoziladi.
  async refund(
    id: string,
    reason: string,
    userId: string,
    byName = 'Admin',
  ): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.status !== OrderStatus.Closed) {
      throw new BadRequestException('Faqat to‘langan (yopilgan) chek qaytariladi');
    }
    if (order.refunded) {
      throw new BadRequestException('Bu chek allaqachon qaytarilgan');
    }
    order.refunded = true;
    order.refundReason = reason?.trim() || null;
    order.refundedAt = new Date();
    order.refundedBy = userId;
    const saved = await this.orders.save(order);
    const table = await this.tables.findOne({ where: { id: saved.tableId } });
    const dto = this.toDto(saved, table?.number);

    // Direktorga Telegram orqali vozvrat cheki (TZ #10) — xato bo'lsa ham davom etadi
    this.telegram
      .notifyRefund({
        tableNumber: table?.number,
        total: dto.total ?? 0,
        reason: order.refundReason ?? '',
        by: byName,
        items: (order.items || [])
          .map((it) => `${it.quantity}× ${it.menuItemName}`)
          .join(', '),
      })
      .catch(() => undefined);

    return dto;
  }

  private toDto(o: OrderEntity, tableNumber?: number): Order {
    const total = (o.items || []).reduce(
      (sum, it) => sum + Number(it.price) * Number(it.quantity),
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
      note: o.note ?? null,
      discountPercent: Number(o.discountPercent) || 0,
      servicePercent: Number(o.servicePercent) || 0,
      tableNumber,
      total,
      refunded: o.refunded ?? false,
      refundReason: o.refundReason ?? null,
      refundedAt: o.refundedAt ? o.refundedAt.toISOString() : null,
      items: (o.items || []).map((it) => ({
        id: it.id,
        orderId: it.orderId,
        menuItemId: it.menuItemId,
        menuItemName: it.menuItemName,
        price: Number(it.price),
        quantity: Number(it.quantity),
        unit: it.unit ?? MenuUnit.Piece,
        stationId: it.stationId ?? null,
        stationName: it.stationName ?? null,
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
