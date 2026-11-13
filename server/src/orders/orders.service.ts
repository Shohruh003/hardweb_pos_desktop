import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';

import {
  CustomerEntity,
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
  SETTABLE_ORDER_STATUSES,
  calcOrderTotals,
  canChangeOrderStatus,
  clampPercent,
  lineSum,
  remainingAmount,
  roundSum,
  sumPayments,
} from '@hardweb-pos/shared';
import { CreateOrderDto, PayOrderDto, UpdateOrderStatusDto } from './dto';
import { OrdersGateway } from './orders.gateway';
import { TelegramService } from '../telegram/telegram.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  PrintNewItemsParams,
  StationPrintService,
} from '../printing/station-print.service';

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

/** To'lovi bor hisobni bekor qilib (bo'shatib) bo'lmaydi — aks holda olingan pul hisobotdan yo'qoladi */
const HAS_PAYMENTS_MESSAGE = 'Bu hisobda to‘lov bor — avval to‘lovlarni o‘chiring';

/** Tarix sahifasi raqamining yuqori chegarasi (juda katta qiymat SQL'ni buzmasin) */
const MAX_HISTORY_PAGE = 100_000;

/** So'rov parametri -> musbat butun son; noto'g'ri bo'lsa — fallback, katta bo'lsa — max */
function positiveInt(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/** So'rov parametri -> satr (parametr takrorlangan bo'lsa — birinchisi); bo'sh -> undefined */
function queryStr(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null) return undefined;
  const s = String(v);
  return s === '' ? undefined : s;
}

/**
 * Sana filtri -> bazadagi format. opened_at SQLite'da UTC matn "YYYY-MM-DD HH:MM:SS"
 * ko'rinishida saqlanadi, mijoz esa ISO ("2026-11-12T19:00:00.000Z") yuboradi — ularni
 * matn sifatida solishtirsak, tun yarmidan keyin ochilgan buyurtmalar "Bugun"dan tushib
 * qoladi. Shuning uchun qiymatni bir xil formatga keltiramiz. Noto'g'ri sana — filtr yo'q.
 * withMillis: "gacha" chegarasi uchun .SSS qo'shiladi (oxirgi soniyadagi yozuvlar ham kirsin).
 */
function toDbDateTime(value: string | undefined, withMillis: boolean): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, withMillis ? 23 : 19).replace('T', ' ');
}

/** Date (yoki bazadan kelgan satr) -> ISO satr */
function isoOf(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  return value == null ? '' : String(value);
}

/**
 * Tarix qatoridagi to'lov turi. Tur bo'yicha filtr qo'yilgan bo'lsa — o'sha tur
 * ("Karta" filtrida qator "Naqd" bo'lib chiqmasin). Aks holda eng ko'p summa to'langan
 * tur; teng bo'lsa — birinchi to'lov turi (bo'lib to'lashda natija barqaror).
 */
function mainPaymentType(pays: PaymentEntity[], preferred?: string): PaymentType {
  if (preferred && pays.some((p) => p.type === preferred)) {
    return preferred as PaymentType;
  }
  const byType = new Map<PaymentType, number>();
  for (const p of pays) {
    byType.set(p.type, (byType.get(p.type) ?? 0) + roundSum(p.amount));
  }
  let best = pays[0].type;
  let bestSum = -Infinity;
  for (const [type, sum] of byType) {
    if (sum > bestSum) {
      best = type;
      bestSum = sum;
    }
  }
  return best;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

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
    @InjectRepository(CustomerEntity)
    private readonly customers: Repository<CustomerEntity>,
    private readonly dataSource: DataSource,
    private readonly gateway: OrdersGateway,
    private readonly telegram: TelegramService,
    private readonly inventory: InventoryService,
    private readonly stationPrint: StationPrintService,
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

  // Buyurtmalar tarixi — pagination + filtrlar bilan (Cheklar tarixi, KDS "Tarix",
  // ofitsiantning "Mening buyurtmalarim"). Har qator taomlari va summasi bilan qaytadi.
  // Katta hajmda ham tez ishlashi uchun sahifalab (20 tadan) qaytaramiz.
  async history(query: HistoryQuery): Promise<PaginatedOrders> {
    const page = positiveInt(query.page, 1, MAX_HISTORY_PAGE);
    const limit = positiveInt(query.limit, 20, 100);

    const waiterId = queryStr(query.waiterId);
    const status = queryStr(query.status);
    const hall = queryStr(query.hall);
    const search = queryStr(query.search);
    const paymentType = queryStr(query.paymentType);
    const dateFrom = toDbDateTime(queryStr(query.dateFrom), false);
    const dateTo = toDbDateTime(queryStr(query.dateTo), true);

    const qb = this.orders
      .createQueryBuilder('o')
      // stol ma'lumoti — filtr (zal/raqam) uchun join
      .leftJoin(TableEntity, 't', 't.id = o.tableId');

    if (waiterId) {
      qb.andWhere('o.waiterId = :waiterId', { waiterId });
    }
    if (status) {
      qb.andWhere('o.status = :status', { status });
    }
    if (hall) {
      qb.andWhere('t.hall = :hall', { hall });
    }
    if (dateFrom) {
      qb.andWhere('o.openedAt >= :dateFrom', { dateFrom });
    }
    if (dateTo) {
      qb.andWhere('o.openedAt <= :dateTo', { dateTo });
    }
    if (search) {
      // stol raqami bo'yicha qidiruv
      qb.andWhere('CAST(t.number AS TEXT) LIKE :search', {
        search: `%${search}%`,
      });
    }
    if (paymentType) {
      qb.andWhere(
        `o.id IN ${qb
          .subQuery()
          .select('p.orderId')
          .from(PaymentEntity, 'p')
          .where('p.type = :pt')
          .getQuery()}`,
      ).setParameter('pt', paymentType);
    }

    // Jami soni — taomlarsiz (yengil) so'rov bilan
    const total = await qb.getCount();

    // Sahifa — taomlari bilan. QueryBuilder'ning getMany() eager relation'ni o'zi yuklamaydi,
    // shuning uchun items aniq join qilinadi. skip/take join bilan ishlaganda TypeORM avval
    // sahifadagi buyurtma id'larini (DISTINCT) tanlaydi — sahifa taom qatorlari bo'yicha emas,
    // buyurtmalar bo'yicha bo'ladi. Bir soniyada ochilgan buyurtmalar sahifalar orasida
    // takrorlanmasin/yo'qolmasin — id bo'yicha ham saralaymiz.
    const list = await qb
      .leftJoinAndSelect('o.items', 'i')
      .orderBy('o.openedAt', 'DESC')
      .addOrderBy('o.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const items = list.length ? await this.enrichHistory(list, paymentType) : [];
    return { items, total, page, limit, hasMore: page * limit < total };
  }

  // Sahifadagi buyurtmalarni stol/ofitsiant/to'lov ma'lumoti bilan boyitamiz
  private async enrichHistory(
    list: OrderEntity[],
    preferredPaymentType?: string,
  ): Promise<Order[]> {
    const tableRows = await this.tables.find({
      where: { id: In([...new Set(list.map((o) => o.tableId))]) },
    });
    const users = await this.users.find({
      where: { id: In([...new Set(list.map((o) => o.waiterId))]) },
    });
    const pays = await this.payments.find({
      where: { orderId: In(list.map((o) => o.id)) },
      order: { createdAt: 'ASC' },
    });
    const tableNo = new Map(tableRows.map((t) => [t.id, t.number]));
    const tableHall = new Map(tableRows.map((t) => [t.id, t.hall]));
    const waiterName = new Map(users.map((u) => [u.id, u.name]));
    const paysByOrder = new Map<string, PaymentEntity[]>();
    for (const p of pays) {
      const arr = paysByOrder.get(p.orderId);
      if (arr) arr.push(p);
      else paysByOrder.set(p.orderId, [p]);
    }

    return list.map((o) => {
      const dto = this.toDto(o, tableNo.get(o.tableId));
      dto.hall = tableHall.get(o.tableId) ?? null;
      dto.waiterName = waiterName.get(o.waiterId) ?? null;
      // Tarix qatorida total — CHEK summasi (chegirma/xizmat bilan, mijoz to'lagan summa);
      // subtotal — qatorlar yig'indisi. Cheklar tarixi, vozvrat va hisobotlar shu summani ko'rsatadi.
      const totals = calcOrderTotals(o.items || [], o.discountPercent, o.servicePercent);
      dto.subtotal = totals.subtotal;
      dto.discountAmount = totals.discountAmount;
      dto.serviceAmount = totals.serviceAmount;
      dto.total = totals.total;
      const orderPays = paysByOrder.get(o.id);
      if (orderPays?.length) {
        dto.paidAmount = sumPayments(orderPays);
        dto.paymentType = mainPaymentType(orderPays, preferredPaymentType);
      }
      return dto;
    });
  }

  // Yangi buyurtma — ofitsiant yuboradi (TZ F-1.7), KDS/navbatga real-time uzatiladi.
  // Bo'lim (oshxona/bar) cheklarini SERVER chop etadi — faqat shu so'rovda qo'shilgan
  // taomlar, buyurtma qayerdan kelganidan qat'i nazar (terminal, telefon, oflayn navbat).
  async create(dto: CreateOrderDto, waiterId: string): Promise<Order> {
    if (!dto.items?.length) {
      throw new BadRequestException('Buyurtma bo‘sh bo‘lishi mumkin emas');
    }

    const table = await this.tables.findOne({ where: { id: dto.tableId } });
    if (!table) throw new NotFoundException('Stol topilmadi');

    // Mijoz (CRM) — ixtiyoriy
    const customer = dto.customerId
      ? await this.customers.findOne({ where: { id: dto.customerId } })
      : null;

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

    // orderId — mavjud buyurtmaga qo'shilganda aniq bog'laymiz (javobdagi qatorlarda ham bo'lsin)
    const buildItems = (manager: typeof this.dataSource.manager, orderId?: string) =>
      dto.items.map((i) => {
        const mi = menuById.get(i.menuItemId);
        if (!mi) {
          throw new BadRequestException(`Taom topilmadi: ${i.menuItemId}`);
        }
        return manager.create(OrderItemEntity, {
          ...(orderId ? { orderId } : {}),
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

    // Bo'lim chekidagi ofitsiant — shu taomlarni yuborgan xodim (terminalda tanlangan yoki kirgan)
    const senderName = await this.userName(waiterId);

    // Agar shu stolda ochiq (yopilmagan) buyurtma bo'lsa — yangi taomlarni
    // o'sha buyurtmaga qo'shamiz (mijoz keyinroq qo'shimcha buyursa).
    const existing = await this.orders.findOne({
      where: { tableId: dto.tableId, status: Not(OrderStatus.Closed) },
      order: { openedAt: 'DESC' },
    });
    if (existing) {
      const newItems = buildItems(this.dataSource.manager, existing.id);
      existing.items = [...(existing.items || []), ...newItems];
      if (dto.note !== undefined) existing.note = dto.note?.trim() || null;
      if (customer) {
        existing.customerId = customer.id;
        existing.customerName = customer.name;
      }
      // Yangi taomlar tayyorlanishi kerak — buyurtma yana faollashadi
      if (existing.status === OrderStatus.Ready) {
        existing.status = OrderStatus.Cooking;
      }
      const savedExisting = await this.orders.save(existing);
      const dtoOut = this.toDto(savedExisting, table.number);
      dtoOut.hall = table.hall ?? null;
      // Buyurtma egasi (ofitsiant) o'zgarmaydi — birinchi yuborgan xodim
      dtoOut.waiterName =
        savedExisting.waiterId === waiterId
          ? senderName
          : await this.userName(savedExisting.waiterId);
      this.gateway.emitOrderUpdated(dtoOut); // -> KDS yangi taomlarni ko'radi

      // Oshxonaga FAQAT hozir qo'shilgan qatorlar ketadi ("QO'SHIMCHA" chek) — avvalgi
      // taomlar qayta chiqmaydi. save() yangi qatorlarga id beradi.
      const newIds = new Set(newItems.map((it) => it.id));
      this.printStationTickets({
        order: dtoOut,
        items: dtoOut.items.filter((it) => newIds.has(it.id)),
        append: true,
        tableNumber: table.number,
        hall: table.hall ?? null,
        waiterName: senderName,
      });
      return dtoOut;
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const order = manager.create(OrderEntity, {
        tableId: dto.tableId,
        waiterId,
        status: OrderStatus.Accepted,
        note: dto.note?.trim() || null,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        items: buildItems(manager),
      });
      const result = await manager.save(order);

      // Stol band bo'ldi
      table.status = TableStatus.Busy;
      await manager.save(table);

      return result;
    });

    const dtoOut = this.toDto(saved, table.number);
    dtoOut.hall = table.hall ?? null;
    dtoOut.waiterName = senderName;
    this.gateway.emitOrderCreated(dtoOut); // -> KDS / navbat

    // Yangi buyurtma — barcha taomlar o'z bo'limi printeriga (tranzaksiya yakunlangandan keyin)
    this.printStationTickets({
      order: dtoOut,
      items: dtoOut.items,
      append: false,
      tableNumber: table.number,
      hall: table.hall ?? null,
      waiterName: senderName,
    });
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

  // Buyurtmaga mijoz (CRM) biriktirish/o'zgartirish (bo'sh — olib tashlaydi)
  async setCustomer(id: string, customerId?: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const customer = customerId
      ? await this.customers.findOne({ where: { id: customerId } })
      : null;
    order.customerId = customer?.id ?? null;
    order.customerName = customer?.name ?? null;
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
  // To'lovi bor hisobda: bo'shatib bo'lmaydi va qolgan summa to'langandan kam bo'lmasligi
  // kerak — aks holda olingan pul hisobotdan yo'qoladi yoki hisobni yopib bo'lmay qoladi.
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

    const payments = await this.payments.find({ where: { orderId: id } });
    // Hamma taom olib tashlandi — buyurtmani butunlay bekor qilamiz (to'lov bo'lsa — mumkin emas)
    if (remaining.length === 0) {
      if (payments.length > 0) {
        throw new BadRequestException(HAS_PAYMENTS_MESSAGE);
      }
      return this.cancel(id);
    }
    // Qolgan taomlarning yakuniy summasi (saqlangan chegirma/xizmat foizi bilan)
    // to'langan summadan kam bo'lib qolmasin
    const paid = sumPayments(payments);
    const newTotal = calcOrderTotals(
      remaining,
      order.discountPercent,
      order.servicePercent,
    ).total;
    if (newTotal < paid) {
      throw new BadRequestException('Qolgan summa to‘langan summadan kam bo‘lib qoladi');
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
    // Qisman to'langan hisob o'chirilsa, olingan pul hisobotlardan yo'qolib qoladi —
    // avval kassada to'lovlar o'chirilishi kerak
    const paymentCount = await this.payments.count({ where: { orderId: id } });
    if (paymentCount > 0) {
      throw new BadRequestException(HAS_PAYMENTS_MESSAGE);
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

  // Buyurtma holatini o'zgartirish (TZ F-2.3): qabul -> tayyorlanmoqda -> tayyor (KDS).
  // "yopildi" faqat to'liq to'lov orqali qo'yiladi; yopilgan (to'langan) buyurtma qayta ochilmaydi.
  async updateStatus(id: string, dto: UpdateOrderStatusDto): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    // DTO ham tekshiradi — servis boshqa joydan chaqirilsa ham himoya bo'lsin
    if (!(SETTABLE_ORDER_STATUSES as string[]).includes(dto.status)) {
      throw new BadRequestException('Noto‘g‘ri buyurtma holati');
    }
    if (!canChangeOrderStatus(order.status, dto.status)) {
      throw new BadRequestException('Yopilgan buyurtma holatini o‘zgartirib bo‘lmaydi');
    }

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

  // Kassa: to'lov qabul qilish, hisobni yopish, stolni bo'shatish, chek qaytarish (TZ 5.3).
  // Oldingi to'lovlar jami summani allaqachon qoplagan ochiq hisob (yoki 0 so'mlik hisob) shu
  // so'rov bilan yangi to'lovsiz yopiladi ("Hisobni yopish"). Faqat yopilgan hisob rad etiladi.
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

    // Shu so'rovgacha saqlangan foizlar bilan jami summa — chegirma oshirilib, jami to'langan
    // summadan pastga tushib qolishini aniqlash uchun
    const previousTotal = calcOrderTotals(
      order.items || [],
      order.discountPercent,
      order.servicePercent,
    ).total;

    // Chegirma/xizmat foizini buyurtmaga saqlaymiz — bo'lib to'lashda total barqaror qoladi
    if (dto.discountPercent != null) order.discountPercent = clampPercent(dto.discountPercent);
    if (dto.serviceFeePercent != null) order.servicePercent = clampPercent(dto.serviceFeePercent);

    // Summalar — yagona manba shared/money: har qator butun so'mga yaxlitlanadi, chegirma va
    // xizmat haqi subtotal'dan. Shu sababli kg taomlarda ham "Qoldi 0" bo'lib hisob yopilmay
    // qolmaydi (2.2 kg × 55 000 = 121 000, 121000.00000000001 emas).
    const totals = calcOrderTotals(
      order.items || [],
      order.discountPercent,
      order.servicePercent,
    );
    const total = totals.total;

    // Oldingi to'lovlar (bo'lib to'lash) — qolgan summani hisoblaymiz
    const priorPayments = await this.payments.find({
      where: { orderId: order.id },
      order: { createdAt: 'ASC' },
    });
    const priorPaid = sumPayments(priorPayments);
    const remaining = remainingAmount(total, priorPaid);

    // Oldingi to'lovlar jami summani allaqachon qoplagan (masalan qisman to'lovdan keyin taom
    // olib tashlandi yoki 100% chegirma — to'lovsiz hisob): yangi to'lov yozilmaydi, hisob
    // shunchaki yopiladi (chek, sklad, fiskal — oddiy to'liq to'lovdagidek). Aks holda bunday
    // hisobni na to'lab, na bekor qilib bo'lardi.
    const settleOnly = remaining <= 0;
    if (settleOnly) {
      if (!(order.items || []).length) {
        throw new BadRequestException('Buyurtmada taom yo‘q — hisobni bekor qiling');
      }
      // Chegirma (yoki xizmat haqini kamaytirish) jami summani to'langan summadan pastga
      // tushirmasin — aks holda chekdagi to'lovlar jami summadan ko'p bo'lib qoladi
      if (priorPaid > total && total < previousTotal) {
        throw new BadRequestException(
          'Jami summa to‘langan summadan kam bo‘lib qoladi — chegirmani kamaytiring yoki ortiqcha to‘lovni o‘chiring',
        );
      }
    }
    // To'lov summasi (butun so'm): berilmasa — qolgan summa; berilsa — qolgandan oshmaydi.
    // Hisob allaqachon qoplangan bo'lsa — yangi to'lov yo'q (0)
    const payAmount = settleOnly
      ? 0
      : dto.amount != null
        ? Math.min(roundSum(dto.amount), remaining)
        : remaining;
    if (!settleOnly && payAmount <= 0) {
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
    let newPaymentAt = '';
    const fiscalEnabled = process.env.FISCAL_ENABLED !== 'false';

    await this.dataSource.transaction(async (manager) => {
      if (payAmount > 0) {
        const savedPayment = await manager.save(
          manager.create(PaymentEntity, {
            orderId: order.id,
            amount: payAmount, // butun so'm
            type: dto.type,
            cashierId,
          }),
        );
        newPaymentId = savedPayment.id;
        newPaymentAt = isoOf(savedPayment.createdAt);
      }
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

    const allPayments = priorPayments.map((p) => ({
      id: p.id,
      type: p.type,
      amount: roundSum(p.amount),
      createdAt: isoOf(p.createdAt),
    }));
    if (payAmount > 0) {
      allPayments.push({
        id: newPaymentId,
        type: dto.type,
        amount: payAmount,
        createdAt: newPaymentAt || new Date().toISOString(),
      });
    }
    // Chekdagi to'lov turi — oxirgi to'lovniki; to'lovsiz yopilgan hisobda (0 so'm) — so'rovdagi tur
    const receiptPaymentType = allPayments.length
      ? allPayments[allPayments.length - 1].type
      : dto.type;

    // To'lov javobida order.total — YAKUNIY summa (chegirma/xizmat bilan), qolgan joylarda
    // DTO total = subtotal (qatorlar yig'indisi)
    const dtoOut = this.toDto(order, table?.number);
    dtoOut.subtotal = totals.subtotal;
    dtoOut.discountPercent = totals.discountPercent;
    dtoOut.discountAmount = totals.discountAmount;
    dtoOut.servicePercent = totals.servicePercent;
    dtoOut.serviceAmount = totals.serviceAmount;
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
      // Chek qatorlari yig'indisi = subtotal (har qator lineSum bilan yaxlitlangan)
      lines: (order.items || []).map((it) => ({
        name: it.menuItemName,
        quantity: Number(it.quantity),
        price: Number(it.price),
        sum: lineSum(it.price, it.quantity),
        unit: it.unit ?? MenuUnit.Piece,
      })),
      subtotal: totals.subtotal,
      discountPercent: totals.discountPercent,
      discountAmount: totals.discountAmount,
      serviceFeePercent: totals.servicePercent,
      serviceFeeAmount: totals.serviceAmount,
      total,
      paymentType: receiptPaymentType,
      payments: allPayments.map((p) => ({ type: p.type, amount: p.amount })),
      note: order.note ?? null,
      customerName: order.customerName ?? null,
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
    const rest = await this.payments.find({ where: { orderId } });
    const table = await this.tables.findOne({ where: { id: order.tableId } });
    const dtoOut = this.toDto(order, table?.number);
    dtoOut.paidAmount = sumPayments(rest);
    this.gateway.emitOrderUpdated(dtoOut);
    return dtoOut;
  }

  // Buyurtma to'lovlari ro'yxati (bo'lib to'lash uchun) — summalar butun so'mda
  async getPayments(orderId: string) {
    const rows = await this.payments.find({ where: { orderId }, order: { createdAt: 'ASC' } });
    return rows.map((p) => ({
      id: p.id,
      type: p.type,
      amount: roundSum(p.amount),
      createdAt: isoOf(p.createdAt),
    }));
  }

  // Vozvrat — to'langan (yopilgan) chekni qaytarish. Faqat 'refund' ruxsati bor xodim
  // (controllerda tekshiriladi; Direktor/SuperAdmin avtomatik ega). Sabab jurnalga yoziladi.
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
    // Qaytariladigan summa — chek summasi (chegirma/xizmat bilan), qatorlar yig'indisi emas
    const checkTotal = calcOrderTotals(
      order.items || [],
      order.discountPercent,
      order.servicePercent,
    ).total;

    // Direktorga Telegram orqali vozvrat cheki (TZ #10) — xato bo'lsa ham davom etadi
    this.telegram
      .notifyRefund({
        tableNumber: table?.number,
        total: checkTotal,
        reason: order.refundReason ?? '',
        by: byName,
        items: (order.items || [])
          .map((it) => `${it.quantity}× ${it.menuItemName}`)
          .join(', '),
      })
      .catch(() => undefined);

    return dto;
  }

  // Entity -> shared Order. Bu DTO'da total = subtotal = qatorlar yig'indisi (Σ lineSum,
  // chegirma/xizmatsiz) — kassa ekrani foizlarni o'zi qo'shadi. Yakuniy summa
  // (chegirma/xizmat bilan) faqat to'lov javobi va chekda qaytadi.
  private toDto(o: OrderEntity, tableNumber?: number): Order {
    const subtotal = calcOrderTotals(o.items || []).subtotal;
    return {
      id: o.id,
      tableId: o.tableId,
      waiterId: o.waiterId,
      status: o.status,
      openedAt: o.openedAt?.toISOString?.() ?? String(o.openedAt),
      closedAt: o.closedAt ? o.closedAt.toISOString() : null,
      queueNumber: o.queueNumber ?? null,
      note: o.note ?? null,
      customerId: o.customerId ?? null,
      customerName: o.customerName ?? null,
      discountPercent: Number(o.discountPercent) || 0,
      servicePercent: Number(o.servicePercent) || 0,
      tableNumber,
      subtotal,
      total: subtotal,
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

  // Xodim ismi (bo'lim cheki / DTO uchun). id bo'sh bo'lsa — null
  // (TypeORM where:{id: undefined} birinchi foydalanuvchini qaytarib yuboradi).
  private async userName(id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    const user = await this.users.findOne({ where: { id } });
    return user?.name ?? null;
  }

  // Bo'lim (oshxona/bar...) printerlariga yangi taomlar cheki — FONDA ishlaydi: HTTP javobni
  // kutdirmaydi va hech qachon xato tashlamaydi. Chiqmagan har bir bo'lim cheki uchun
  // 'print:failed' hodisasi hammaga yuboriladi (kassa ogohlantirish ko'rsatadi).
  private printStationTickets(params: PrintNewItemsParams): void {
    if (params.items.length === 0) return;
    // setImmediate — javob avval jo'natilsin, chop etish undan keyin boshlansin
    setImmediate(() => {
      Promise.resolve()
        .then(() => this.stationPrint.printNewItems(params))
        .then((results) => {
          // Xatolar StationPrintService'ning o'zida jurnalga yoziladi — bu yerda faqat xabar beramiz
          for (const r of results ?? []) {
            if (r.ok) continue;
            this.gateway.emitPrintFailed({
              orderId: params.order.id,
              tableNumber: params.tableNumber,
              station: r.station,
              host: r.host,
              message: r.message,
            });
          }
        })
        .catch((e) => {
          this.logger.error(
            `Bo‘lim cheklarini chop etishda kutilmagan xato: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
    });
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
