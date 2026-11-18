import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  Not,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

import {
  CustomerEntity,
  DailyCounterEntity,
  ExciseCodeEntity,
  FiscalDocEntity,
  MenuItemEntity,
  OrderEntity,
  OrderItemEntity,
  OrderRequestEntity,
  PaymentEntity,
  SettingsEntity,
  StationEntity,
  TableEntity,
  UserEntity,
  VoidLogEntity,
} from '../entities';
import {
  DeliveryLookup,
  MenuUnit,
  ORDER_TYPES,
  Order,
  OrderItem,
  OrderItemStatus,
  OrderStatus,
  OrderType,
  OrderVoidedPayload,
  Payment,
  PaymentMethod,
  PaymentType,
  Receipt,
  SETTABLE_ORDER_STATUSES,
  SplitOrderResult,
  TableStatus,
  canChangeOrderStatus,
  clampPercent,
  hallServicePercentFor,
  lineSum,
  orderDisplayName,
  orderTypeOf,
  paymentMethodLabel,
  remainingAmount,
  roundSum,
  sumPayments,
  TABLE_OWNER_MESSAGE,
  ORDER_OWNER_MESSAGE,
  UserRole,
  canSeeOrder,
  canServeTable,
} from '@hardweb-pos/shared';
import {
  ChangeOrderTypeDto,
  CreateOrderDto,
  DebtorDto,
  DeliveryInfoDto,
  ItemPriceDto,
  PayMultiDto,
  PayOrderDto,
  RemoveItemsDto,
  SplitOrderDto,
  UpdateOrderStatusDto,
} from './dto';
import { OrdersGateway } from './orders.gateway';
import { TelegramService, VoidNotification } from '../telegram/telegram.service';
import { InventoryService } from '../inventory/inventory.service';
import { orderStockLabel } from '../inventory/inventory-rules';
import {
  PrintNewItemsParams,
  PrintVoidParams,
  StationPrintService,
} from '../printing/station-print.service';
import {
  SettingsService,
  normalizeHallServiceMap,
  restaurantNameOf,
} from '../settings/settings.service';
import { hallComparator } from '../tables/hall-order';
import { FORBIDDEN_MESSAGE } from '../auth/user-view';
import {
  ADDRESS_REQUIRED_MESSAGE,
  Actor,
  BELOW_PAID_MESSAGE,
  CHECK_OTHER_TABLE_MESSAGE,
  DEBTOR_REQUIRED_MESSAGE,
  DELIVERY_FEE_MAX,
  HAS_PAYMENTS_MESSAGE,
  ITEM_LINE_NOT_FOUND_MESSAGE,
  MoneyItem,
  NOT_DELIVERY_MESSAGE,
  NOT_TABLE_ORDER_MESSAGE,
  NO_ITEMS_MESSAGE,
  ORDER_ALREADY_CLOSED_MESSAGE,
  ORDER_CLOSED_MESSAGE,
  ORDER_NOT_CLOSED_MESSAGE,
  ORDER_NOT_FOUND_MESSAGE,
  ORDER_OTHER_TABLE_MESSAGE,
  ORDER_TYPE_INVALID_MESSAGE,
  PAYABLE_TOTAL_SQL,
  PAYMENT_AMOUNT_INVALID_MESSAGE,
  PAYMENT_EXCEEDS_MESSAGE,
  PAYMENT_TYPE_INVALID_MESSAGE,
  PHONE_INVALID_MESSAGE,
  PRICE_FORBIDDEN_MESSAGE,
  SPLIT_KEEP_ONE_MESSAGE,
  SPLIT_NOTHING_MESSAGE,
  SPLIT_ONLY_TABLE_MESSAGE,
  SPLIT_QTY_INVALID_MESSAGE,
  SPLIT_SAME_CHECK_MESSAGE,
  TABLE_NOT_FOUND_MESSAGE,
  TABLE_REQUIRED_MESSAGE,
  TYPE_UNCHANGED_MESSAGE,
  VOID_QTY_INVALID_MESSAGE,
  businessDateOf,
  can,
  canOverridePrice,
  canViewAllHistory,
  checkNoOf,
  cleanReason,
  isValidQuantity,
  localBoundToUtc,
  nextFreeCheckNo,
  normalizePaymentMethods,
  normalizePhone,
  orderTotalsOf,
  parseOrderType,
  quantityInvalidMessage,
  roundQty,
  stopListMessage,
} from './order-rules';

// Tarix uchun filtr/pagination parametrlari. Eski parametrlar (0.2.x iste'molchilari — KDS "Tarix",
// "Mening buyurtmalarim", kassa tarixi) avvalgi ma'nosida qoladi; yangilari — B25 (admin "Cheklar").
export interface HistoryQuery {
  page?: number | string;
  limit?: number | string;
  type?: string; // stol | olib_ketish | yetkazish
  waiterId?: string;
  cashierId?: string; // to'lov olgan kassir
  status?: string; // qabul_qilindi | tayyorlanmoqda | tayyor | yopildi | open (yopilmaganlar)
  hall?: string;
  tableNumber?: string | number;
  dateFrom?: string; // ISO — ochilgan vaqt bo'yicha (eski)
  dateTo?: string;
  from?: string; // mahalliy 'YYYY-MM-DD' yoki 'YYYY-MM-DDTHH:MM' — yopilgan vaqt bo'yicha (ochiqda — ochilgan)
  to?: string; // shu chegara KIRADI
  paymentType?: string; // shu usulda kamida bitta to'lovi bor cheklar
  refunded?: string; // 'true' | 'false'
  minTotal?: string | number; // to'lanadigan jami summa oralig'i
  maxTotal?: string | number;
  search?: string; // eski: stol raqami, "#12" / "12" (kunlik raqam), telefon raqamlari
  q?: string; // yangi: yuqoridagilar + taom nomi, mijoz ismi, buyurtma id boshi
}

/** Butun filtr bo'yicha yig'indi (sahifadan qat'i nazar) */
export interface HistorySummary {
  count: number; // cheklar soni
  total: number; // to'lanadigan summalar yig'indisi (filtrdagi barcha cheklar)
  refundedCount: number; // shulardan vozvrat qilinganlar
  refundedTotal: number;
}

export interface PaginatedOrders {
  items: Order[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  summary: HistorySummary;
}

/** To'lov qatori (javoblarda): usul nomi, kassir va qarzdor bilan */
export type PaymentView = Payment & { label: string; cashierName: string | null };

/** POST /orders/:id/pay va /pay-multi javobi */
export interface PayResult {
  order: Order;
  receipt?: Receipt;
  fullyPaid: boolean;
  paidAmount: number;
  total: number;
  payments: PaymentView[];
}

/** Tarix qatori: shared Order + vozvrat qilgan xodim ismi */
type OrderView = Order & { refundedByName?: string | null };

/**
 * PaymentEntity'ning qarzdor maydonlari ('Qarzga' to'lovi — B30). payments jadvaliga debtor_name /
 * debtor_phone ustunlari qo'shilgach (PaymentEntity) avtomatik saqlanadi va o'qiladi; ungacha
 * TypeORM noma'lum xossani e'tiborsiz qoldiradi (xato bermaydi).
 */
type PaymentWithDebtor = PaymentEntity & { debtorName?: string | null; debtorPhone?: string | null };

/** Tarix sahifasi raqamining yuqori chegarasi (juda katta qiymat SQL'ni buzmasin) */
const MAX_HISTORY_PAGE = 100_000;

/** Tarix qidiruvida telefon bo'yicha moslik uchun kamida shuncha raqam (aks holda "12" har telefonga mos keladi) */
const PHONE_SEARCH_MIN_DIGITS = 4;

/** Takroriy so'rov himoyasi (clientRequestId) — shuncha vaqt eslab qolinadi */
const REQUEST_ID_TTL_MS = 24 * 60 * 60_000;
/** Xotiradagi takroriy so'rov yozuvlari chegarasi (eng eskilari o'chiriladi) */
const REQUEST_ID_MAX = 20_000;

/** Miqdorlarni solishtirishda kasr xatoligi chegarasi (6 xonali miqdorlar) */
const QTY_EPS = 1e-9;

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
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

/** So'rov parametri -> chekli son; bo'sh/noto'g'ri -> undefined */
function queryNum(value: unknown): number | undefined {
  const s = queryStr(value);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Sana filtri (eski dateFrom/dateTo, ISO) -> bazadagi format. opened_at SQLite'da UTC matn
 * "YYYY-MM-DD HH:MM:SS" ko'rinishida saqlanadi, mijoz esa ISO yuboradi — qiymatni bir xil formatga
 * keltiramiz. Noto'g'ri sana — filtr yo'q. withMillis: "gacha" chegarasi uchun .SSS qo'shiladi.
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

/** Vaqt (ms) — saralash uchun; yo'q bo'lsa 0 */
function timeOf(value: Date | string | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  const t = value ? Date.parse(String(value)) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** LIKE uchun maxsus belgilarni ekranlash (ESCAPE '\') */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** O'zbekcha apostrof turlari (‘ ’ ʼ ` ´) -> oddiy ' (qidiruvda "Go‘sht" = "Go'sht") */
function normalizeApostrophes(s: string): string {
  return s.replace(/[‘’ʼ`´]/g, "'");
}

/** SQL: ustundagi apostrof turlarini oddiy ' ga keltirish (normalizeApostrophes bilan bir xil) */
function sqlNormalizeApostrophes(column: string): string {
  let expr = column;
  for (const ch of ['‘', '’', 'ʼ', '`', '´']) expr = `REPLACE(${expr}, '${ch}', '''')`;
  return expr;
}

/**
 * Tarix qatoridagi to'lov turi. Tur bo'yicha filtr qo'yilgan bo'lsa — o'sha tur
 * ("Karta" filtrida qator "Naqd" bo'lib chiqmasin). Aks holda eng ko'p summa to'langan
 * tur; teng bo'lsa — birinchi to'lov turi (bo'lib to'lashda natija barqaror).
 */
function mainPaymentType(pays: PaymentEntity[], preferred?: string): string {
  if (preferred && pays.some((p) => p.type === preferred)) {
    return preferred;
  }
  const byType = new Map<string, number>();
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

/** Sozlamadagi FAOL to'lov usuli (kalit bo'yicha); topilmasa/o'chirilgan bo'lsa — null */
function activeMethodOf(methods: PaymentMethod[], key: unknown): PaymentMethod | null {
  if (typeof key !== 'string') return null;
  return methods.find((m) => m.key === key && m.active) ?? null;
}

/** Taom qatori qo'shilgan vaqt bo'yicha (teng bo'lsa — bazadagi tartib saqlanadi) */
function byCreatedAt(a: OrderItemEntity, b: OrderItemEntity): number {
  return timeOf(a.createdAt) - timeOf(b.createdAt);
}

/** DTO'ni to'ldirish uchun oldindan ma'lum qismlar (berilmaganlari bazadan o'qiladi) */
interface DtoParts {
  table?: TableEntity | null;
  waiterName?: string | null;
  paidAmount?: number;
  withPayments?: boolean; // to'lovlar ro'yxati (usul nomi, kassir) bilan
}

/** Yangi buyurtma / qo'shimchaning bazasiz tekshirilgan qismlari */
interface CreateInput {
  type: OrderType; // so'ralgan tur (orderId bilan qo'shishda buyurtmaning o'z turi ustun)
  appendTo: string | null; // orderId — aynan shu ochiq buyurtmaga qo'shish
  phone: string | null;
  address: string | null;
  deliveryFee: number | null; // yangi yetkazish: berilgan narx (null — sozlamadagi standart)
}

/** Takroriy so'rov (clientRequestId) yozuvi */
interface RememberedRequest {
  orderId: string;
  at: number;
  snapshot: Order | null; // buyurtma keyin o'chirilgan bo'lsa ham javob shu bo'ladi (bazada bo'sh bo'lishi mumkin)
}

/** Otkaz qilingan qator (jurnal, OTKAZ cheki, KDS, Telegram uchun) */
interface VoidedLine {
  menuItemId: string | null;
  name: string;
  quantity: number;
  unit: MenuUnit;
  price: number;
  stationId: string | null;
  stationName: string | null;
}

/** To'lov yozuvi (pay / pay-multi) */
interface PaymentEntry {
  type: string;
  amount: number; // butun so'm, > 0
  debtor: { name: string; phone: string | null } | null;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  /**
   * Buyurtmalarni o'zgartiruvchi amallar navbati (jarayon ichidagi mutex — promise zanjiri).
   * Yaratish, qo'shish, bo'lish, tur/stol/ofitsiant o'zgarishi, to'lov, otkaz, bekor qilish —
   * hammasi KETMA-KET bajariladi: kunlik raqam (#12) va stoldagi hisob raqami takrorlanmaydi,
   * yopilayotgan hisobga taom qo'shilib qolmaydi, ombor qoldig'i ikki marta "sotilmaydi".
   * (SQLite + TypeORM bitta ulanish bilan ishlaydi — parallel tranzaksiyalar bir-birining ichiga
   * kirib qolardi; navbat buni ham oldini oladi.) Ichki chaqiruvlar *Locked metodlarni ishlatadi —
   * navbat ichidan qayta navbatga turish o'zini kutib qotib qoladi.
   */
  private queue: Promise<void> = Promise.resolve();

  /** Takroriy yuborishdan himoya (B32): clientRequestId -> natija, 24 soat */
  private readonly recentRequests = new Map<string, RememberedRequest>();

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
    private readonly settings: SettingsService,
  ) {}

  // =============================================================================================
  // O'qish: faol buyurtmalar, bitta buyurtma, tarix, chek
  // =============================================================================================

  // Faol (yopilmagan) buyurtmalar — barcha turlar (yoki ?type= bo'yicha bitta tur).
  // Tartib: avval stolga (zallar sozlamadagi tartibda, keyin stol raqami, keyin hisob raqami), keyin
  // olib ketish va yetkazish (ish kuni, keyin kunlik raqam bo'yicha). KDS/navbat ekrani o'zi saralaydi.
  async findActive(type?: string): Promise<Order[]> {
    const filter = parseOrderType(type);
    // IN (ochiq holatlar) — (status, closed_at) indeksidan foydalanadi; "!= yopildi" butun jadvalni aylanardi
    const where: FindOptionsWhere<OrderEntity> = { status: In(SETTABLE_ORDER_STATUSES) };
    if (filter) where.type = filter;
    const list = await this.orders.find({ where, order: { openedAt: 'ASC' } });
    if (list.length === 0) return [];

    const tableById = await this.tablesFor(list);
    const nameById = await this.userNamesFor(list.map((o) => o.waiterId));
    const paysByOrder = await this.paymentsFor(list.map((o) => o.id));
    const settings = await this.settings.get();
    const hallCmp = hallComparator(settings.hallOrder);

    const rows = list.map((o) => {
      const dto = this.toDto(
        o,
        o.tableId ? tableById.get(o.tableId) ?? null : null,
        nameById.get(o.waiterId) ?? null,
      );
      dto.paidAmount = sumPayments(paysByOrder.get(o.id) ?? []);
      return { o, dto };
    });
    rows.sort((a, b) => {
      const ta = orderTypeOf(a.dto);
      const tb = orderTypeOf(b.dto);
      if (ta !== tb) return ORDER_TYPES.indexOf(ta) - ORDER_TYPES.indexOf(tb);
      if (ta === OrderType.DineIn) {
        return (
          hallCmp(a.dto.hall ?? '', b.dto.hall ?? '') ||
          (a.dto.tableNumber ?? 0) - (b.dto.tableNumber ?? 0) ||
          checkNoOf(a.o) - checkNoOf(b.o) ||
          a.dto.openedAt.localeCompare(b.dto.openedAt)
        );
      }
      return (
        (a.o.businessDate ?? '').localeCompare(b.o.businessDate ?? '') ||
        (a.dto.queueNumber ?? 0) - (b.dto.queueNumber ?? 0) ||
        a.dto.openedAt.localeCompare(b.dto.openedAt)
      );
    });
    return rows.map((r) => r.dto);
  }

  // Bitta buyurtma — to'lovlari (usul nomi, kassir) bilan
  async findOne(id: string): Promise<Order> {
    const order = await this.findEntity(id);
    return this.fullDto(order, { withPayments: true });
  }

  // Buyurtmalar tarixi — pagination + filtrlar bilan (admin "Cheklar", kassa tarixi, KDS "Tarix",
  // ofitsiantning "Mening buyurtmalarim"). Har qator — to'liq buyurtma (taomlar, to'lovlar, summalar).
  // summary — butun filtr bo'yicha (sahifadan qat'i nazar) cheklar soni va jami summasi.
  // Ruxsat: 'history' / administrator / direktor — hammasi; oshxona (KDS) — ko'radi;
  // ofitsiant — faqat o'zi qabul qilgan buyurtmalar; boshqalar — 403.
  async history(query: HistoryQuery, actor?: Actor): Promise<PaginatedOrders> {
    let forcedWaiterId: string | undefined;
    // Ofitsiant (lavozim) — har doim faqat o'z savdosi, KDS ruxsati belgilangan bo'lsa ham (0.3.3)
    const kitchenSeesAll = !!actor && can(actor, 'kitchen') && actor.role !== UserRole.Waiter;
    if (actor && !canViewAllHistory(actor) && !kitchenSeesAll) {
      if (can(actor, 'waiter') && actor.id) forcedWaiterId = actor.id;
      else throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }
    // Ofitsiant faqat BUGUNGI o'z buyurtmalarini ko'radi (restoran talabi): sana filtrlari e'tiborsiz
    if (forcedWaiterId) {
      const today = businessDateOf();
      query = { ...query, from: today, to: today, dateFrom: undefined, dateTo: undefined };
    }

    const page = positiveInt(query.page, 1, MAX_HISTORY_PAGE);
    const limit = positiveInt(query.limit, 20, 100);
    const paymentType = queryStr(query.paymentType);

    const qb = this.orders
      .createQueryBuilder('o')
      // stol ma'lumoti — filtr (zal/raqam) uchun join (olib ketish / yetkazishda stol yo'q)
      .leftJoin(TableEntity, 't', 't.id = o.tableId');
    this.applyHistoryFilters(qb, query, forcedWaiterId);

    // Jami soni va summasi — taomlarsiz (yengil) so'rovlar bilan
    const total = await qb.getCount();
    const summary = await this.historySummary(qb, total);

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
    return { items, total, page, limit, hasMore: page * limit < total, summary };
  }

  /** Tarix filtrlari (eski va yangi parametrlar) */
  private applyHistoryFilters(
    qb: SelectQueryBuilder<OrderEntity>,
    query: HistoryQuery,
    forcedWaiterId?: string,
  ): void {
    const type = parseOrderType(query.type);
    if (type === OrderType.DineIn) {
      // eski (tur yozilmagan) buyurtmalar ham "stolga" hisoblanadi
      qb.andWhere('(o.type = :type OR o.type IS NULL)', { type });
    } else if (type) {
      qb.andWhere('o.type = :type', { type });
    }

    const waiterId = forcedWaiterId ?? queryStr(query.waiterId);
    if (waiterId) qb.andWhere('o.waiterId = :waiterId', { waiterId });

    const status = queryStr(query.status);
    if (status === 'open') {
      qb.andWhere('o.status IN (:...openStatuses)', { openStatuses: SETTABLE_ORDER_STATUSES });
    } else if (status) {
      qb.andWhere('o.status = :status', { status });
    }

    const hall = queryStr(query.hall);
    if (hall) qb.andWhere('t.hall = :hall', { hall });
    const tableNumber = queryNum(query.tableNumber);
    if (tableNumber !== undefined && Number.isInteger(tableNumber)) {
      qb.andWhere('t.number = :tableNumber', { tableNumber });
    }

    // Eski: ochilgan vaqt bo'yicha (ISO)
    const dateFrom = toDbDateTime(queryStr(query.dateFrom), false);
    const dateTo = toDbDateTime(queryStr(query.dateTo), true);
    if (dateFrom) qb.andWhere('o.openedAt >= :dateFrom', { dateFrom });
    if (dateTo) qb.andWhere('o.openedAt <= :dateTo', { dateTo });

    // Yangi: mahalliy sana/vaqt oralig'i, yopilgan vaqt bo'yicha (ochiq hisobda — ochilgan vaqt).
    // datetime() — bazadagi ikki xil yozuvni ("YYYY-MM-DD HH:MM:SS" va ISO "…T…Z") bir xil solishtiradi.
    const from = localBoundToUtc(queryStr(query.from), false);
    const to = localBoundToUtc(queryStr(query.to), true);
    if (from) qb.andWhere('datetime(COALESCE(o.closedAt, o.openedAt)) >= :fromAt', { fromAt: from });
    if (to) qb.andWhere('datetime(COALESCE(o.closedAt, o.openedAt)) <= :toAt', { toAt: to });

    const paymentType = queryStr(query.paymentType);
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
    const cashierId = queryStr(query.cashierId);
    if (cashierId) {
      qb.andWhere(
        `o.id IN ${qb
          .subQuery()
          .select('pc.orderId')
          .from(PaymentEntity, 'pc')
          .where('pc.cashierId = :cashierId')
          .getQuery()}`,
      ).setParameter('cashierId', cashierId);
    }

    const refunded = queryStr(query.refunded)?.toLowerCase();
    if (refunded === 'true' || refunded === '1') qb.andWhere('o.refunded = 1');
    else if (refunded === 'false' || refunded === '0') qb.andWhere('o.refunded = 0');

    // To'lanadigan jami summa oralig'i (chegirma/xizmat/yetkazish bilan — DTO'dagi total bilan bir xil)
    const minTotal = queryNum(query.minTotal);
    const maxTotal = queryNum(query.maxTotal);
    if (minTotal !== undefined) qb.andWhere(`${PAYABLE_TOTAL_SQL} >= :minTotal`, { minTotal });
    if (maxTotal !== undefined) qb.andWhere(`${PAYABLE_TOTAL_SQL} <= :maxTotal`, { maxTotal });

    // Qidiruv: eski search va yangi q (ikkalasi berilsa — ikkalasiga ham mos)
    const searches = [queryStr(query.search), queryStr(query.q)].filter((s): s is string => !!s);
    searches.forEach((s, i) => this.applySearch(qb, s, i));
  }

  /**
   * Qidiruv: "#12" — faqat kunlik raqam; aks holda stol raqami (qism-satr), kunlik raqam (aniq),
   * telefon raqamlari (kamida 4 ta), taom nomi, mijoz ismi, buyurtma id boshi (4+ belgi).
   */
  private applySearch(qb: SelectQueryBuilder<OrderEntity>, search: string, n: number): void {
    const p = (key: string) => `${key}${n}`;
    const hash = /^#\s*(\d{1,9})$/.exec(search);
    if (hash) {
      qb.andWhere(`o.queueNumber = :${p('sq')}`, { [p('sq')]: Number(hash[1]) });
      return;
    }
    const digits = search.replace(/\D/g, '');
    const text = `%${escapeLike(normalizeApostrophes(search))}%`;
    qb.andWhere(
      new Brackets((w) => {
        // stol raqami bo'yicha (qism-satr — avvalgidek)
        w.where(`CAST(t.number AS TEXT) LIKE :${p('st')} ESCAPE '\\'`, {
          [p('st')]: `%${escapeLike(search)}%`,
        });
        // "12" — kunlik raqam ham (aniq moslik)
        if (/^\d{1,9}$/.test(search)) {
          w.orWhere(`o.queueNumber = :${p('sq')}`, { [p('sq')]: Number(search) });
        }
        // telefon raqamlari (bazada "+998901234567" — faqat raqamlar bo'yicha)
        if (digits.length >= PHONE_SEARCH_MIN_DIGITS) {
          w.orWhere(`o.phone LIKE :${p('sp')}`, { [p('sp')]: `%${digits}%` });
        }
        // taom nomi (apostrof turlaridan qat'i nazar: "go‘sht" = "go'sht")
        w.orWhere(
          `EXISTS (SELECT 1 FROM order_items hq WHERE hq.order_id = o.id AND ` +
            `${sqlNormalizeApostrophes('hq.menu_item_name')} LIKE :${p('sd')} ESCAPE '\\')`,
          { [p('sd')]: text },
        );
        // mijoz ismi
        w.orWhere(`${sqlNormalizeApostrophes('o.customer_name')} LIKE :${p('sc')} ESCAPE '\\'`, {
          [p('sc')]: text,
        });
        // buyurtma id boshi (chekdagi qisqa raqam)
        if (/^[0-9a-f-]{4,36}$/i.test(search)) {
          w.orWhere(`o.id LIKE :${p('si')}`, { [p('si')]: `${search.toLowerCase()}%` });
        }
      }),
    );
  }

  /** Butun filtr bo'yicha cheklar soni va summasi (to'lanadigan jami — DTO'dagi total bilan bir xil) */
  private async historySummary(
    qb: SelectQueryBuilder<OrderEntity>,
    count: number,
  ): Promise<HistorySummary> {
    if (count === 0) return { count: 0, total: 0, refundedCount: 0, refundedTotal: 0 };
    const row = await qb
      .clone()
      .select(`COALESCE(SUM(${PAYABLE_TOTAL_SQL}), 0)`, 'total')
      .addSelect('COALESCE(SUM(CASE WHEN o.refunded = 1 THEN 1 ELSE 0 END), 0)', 'refundedCount')
      .addSelect(
        `COALESCE(SUM(CASE WHEN o.refunded = 1 THEN ${PAYABLE_TOTAL_SQL} ELSE 0 END), 0)`,
        'refundedTotal',
      )
      .getRawOne<{ total: number | string; refundedCount: number | string; refundedTotal: number | string }>();
    return {
      count,
      total: roundSum(row?.total),
      refundedCount: roundSum(row?.refundedCount),
      refundedTotal: roundSum(row?.refundedTotal),
    };
  }

  // Sahifadagi buyurtmalarni stol/ofitsiant/to'lov (kassir ismi, usul nomi) ma'lumoti bilan boyitamiz
  private async enrichHistory(list: OrderEntity[], preferredPaymentType?: string): Promise<Order[]> {
    const tableById = await this.tablesFor(list);
    const paysByOrder = await this.paymentsFor(list.map((o) => o.id));
    const allPays = [...paysByOrder.values()].flat();
    const nameById = await this.userNamesFor([
      ...list.map((o) => o.waiterId),
      ...list.map((o) => o.refundedBy),
      ...allPays.map((p) => p.cashierId),
    ]);
    const methods = await this.settings.paymentMethods();

    return list.map((o) => {
      // total — CHEK summasi (chegirma/xizmat/yetkazish bilan, mijoz to'laydigan summa);
      // subtotal — qatorlar yig'indisi. Cheklar tarixi, vozvrat va hisobotlar shu summani ko'rsatadi.
      const dto: OrderView = this.toDto(
        o,
        o.tableId ? tableById.get(o.tableId) ?? null : null,
        nameById.get(o.waiterId) ?? null,
      );
      const orderPays = paysByOrder.get(o.id) ?? [];
      dto.paidAmount = sumPayments(orderPays);
      dto.payments = orderPays.map((p) => this.paymentView(p, methods, nameById));
      if (orderPays.length) {
        dto.paymentType = mainPaymentType(orderPays, preferredPaymentType);
      }
      if (o.refunded) dto.refundedByName = o.refundedBy ? nameById.get(o.refundedBy) ?? null : null;
      return dto;
    });
  }

  // GET /orders/:id/receipt — yopilgan chekning nusxasi (qayta chop etish uchun)
  async receiptOf(id: string): Promise<Receipt> {
    const order = await this.findEntity(id);
    if (order.status !== OrderStatus.Closed) {
      throw new BadRequestException(ORDER_NOT_CLOSED_MESSAGE);
    }
    const settings = await this.settings.get();
    const methods = normalizePaymentMethods(settings.paymentMethods);
    const pays = await this.payments.find({ where: { orderId: id }, order: { createdAt: 'ASC' } });
    const names = await this.userNamesFor([order.waiterId, ...pays.map((p) => p.cashierId)]);
    const fiscal = await this.fiscalDocs.findOne({ where: { orderId: id } });
    const lastPay = pays[pays.length - 1];
    return this.buildReceipt(order, {
      table: await this.tableOf(order),
      waiterName: names.get(order.waiterId) ?? null,
      cashierName: lastPay ? names.get(lastPay.cashierId) ?? null : null,
      payments: pays.map((p) => this.paymentView(p, methods, names)),
      fallbackType: lastPay?.type ?? 'naqd',
      restaurantName: restaurantNameOf(settings),
      createdAt: isoOf(order.closedAt) || new Date().toISOString(),
      fiscalNumber: fiscal?.fiscalNumber,
      fiscalQr: fiscal?.qrCode,
      fiscalEnabled: !!fiscal || process.env.FISCAL_ENABLED !== 'false',
    });
  }

  // =============================================================================================
  // Yaratish / qo'shish (B2, B18, B21, B27–B29, B31, B32)
  // =============================================================================================

  // Yangi buyurtma yoki mavjud ochiq buyurtmaga qo'shimcha — uch tur:
  //  • stol: stol majburiy. checkNo berilsa — shu raqamli ochiq hisobga qo'shiladi, yo'q bo'lsa aynan
  //    shu raqam bilan yangi hisob ochiladi; newCheck — keyingi bo'sh raqamli yangi hisob; hech biri
  //    berilmasa — stoldagi eng kichik raqamli ochiq hisobga (yo'q bo'lsa — 1-hisob ochiladi);
  //  • olib ketish / yetkazish: (orderId'siz) HAR DOIM yangi buyurtma;
  //  • orderId berilsa — aynan shu ochiq buyurtmaga (istalgan turdagi) qo'shiladi.
  // Har yangi buyurtma kunlik raqam (№15 / #12) oladi. Bo'lim (oshxona/bar) cheklarini SERVER chop
  // etadi — faqat shu so'rovda qo'shilgan taomlar. clientRequestId takrorlansa — yangi narsa
  // yaratilmaydi, avvalgi natija qaytadi.
  async create(dto: CreateOrderDto, waiterId: string, actor?: Actor): Promise<Order> {
    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException(NO_ITEMS_MESSAGE);
    }
    const appendTo = dto.orderId || null;
    const type = orderTypeOf({ type: dto.type });

    // Kiritilgan ma'lumotni bazaga murojaatsiz tekshiramiz — xato so'rov navbatni band qilmasin
    let phone: string | null = null;
    let address: string | null = null;
    let deliveryFee: number | null = null;
    if (!appendTo) {
      if (type === OrderType.DineIn) {
        if (!dto.tableId) throw new BadRequestException(TABLE_REQUIRED_MESSAGE);
      } else {
        // Telefon: yetkazishda majburiy, olib ketishda ixtiyoriy (berilsa — to'g'ri bo'lishi shart)
        const rawPhone = typeof dto.phone === 'string' ? dto.phone.trim() : '';
        if (type === OrderType.Delivery || rawPhone) {
          phone = normalizePhone(rawPhone);
          if (!phone) throw new BadRequestException(PHONE_INVALID_MESSAGE);
        }
        // Manzil va yetkazish narxi: faqat yetkazishda (olib ketishda e'tiborsiz)
        if (type === OrderType.Delivery) {
          address = typeof dto.address === 'string' ? dto.address.trim() : '';
          if (!address) throw new BadRequestException(ADDRESS_REQUIRED_MESSAGE);
          if (dto.deliveryFee != null) deliveryFee = this.feeOf(dto.deliveryFee);
        }
      }
    }

    const requestId = typeof dto.clientRequestId === 'string' ? dto.clientRequestId.trim() : '';
    return this.serial(async () => {
      // Takroriy so'rov (oflayn navbat qayta yubordi / tarmoq uzildi) — yangi narsa yaratilmaydi
      // (server qayta ishga tushgan bo'lsa ham: yozuv bazada — order_requests)
      if (requestId) {
        const prev = await this.recalledRequest(requestId);
        if (prev) {
          const existing = await this.orders.findOne({ where: { id: prev.orderId } });
          this.logger.log(`Takroriy so‘rov (${requestId}) — avvalgi natija qaytarildi`);
          if (existing) return this.fullDto(existing);
          if (prev.snapshot) return prev.snapshot;
          throw new NotFoundException(ORDER_NOT_FOUND_MESSAGE);
        }
      }
      const out = await this.createLocked(
        dto,
        waiterId,
        { type, appendTo, phone, address, deliveryFee },
        actor,
      );
      if (requestId) await this.rememberRequest(requestId, out);
      return out;
    });
  }

  // create() ning asosiy qismi — navbat ichida bajariladi
  private async createLocked(
    dto: CreateOrderDto,
    waiterId: string,
    input: CreateInput,
    actor?: Actor,
  ): Promise<Order> {
    // 1) Qaysi buyurtmaga qo'shiladi (target) yoki yangi buyurtma qaysi stolda / qaysi hisob raqami bilan
    let target: OrderEntity | null = null;
    let table: TableEntity | null = null;
    let newCheckNo: number | null = null;
    let tableHadOpen = false;
    if (input.appendTo) {
      target = await this.orders.findOne({ where: { id: input.appendTo } });
      if (!target) throw new NotFoundException(ORDER_NOT_FOUND_MESSAGE);
      if (target.status === OrderStatus.Closed) {
        throw new BadRequestException(ORDER_CLOSED_MESSAGE);
      }
      if (orderTypeOf(target) === OrderType.DineIn) {
        if (dto.tableId && target.tableId && dto.tableId !== target.tableId) {
          throw new BadRequestException(ORDER_OTHER_TABLE_MESSAGE);
        }
        table = await this.tableOf(target);
        // Stol egasi: boshqa ofitsiant ochgan stolga taom qo'sha olmaydi
        if (actor && table && !canServeTable(actor, await this.openChecksAt(table.id))) {
          throw new ForbiddenException(TABLE_OWNER_MESSAGE);
        }
      } else if (actor && !canSeeOrder(actor, target)) {
        // Olib ketish / yetkazish: boshqa ofitsiantning buyurtmasiga taom qo'sha olmaydi (0.3.3)
        throw new ForbiddenException(ORDER_OWNER_MESSAGE);
      }
    } else if (input.type === OrderType.DineIn) {
      table = await this.tables.findOne({ where: { id: dto.tableId! } });
      if (!table) throw new NotFoundException(TABLE_NOT_FOUND_MESSAGE);
      const open = await this.openChecksAt(table.id);
      // Stol egasi: boshqa ofitsiant ochgan stolga taom qo'sha / yangi hisob ocha olmaydi
      if (actor && !canServeTable(actor, open)) throw new ForbiddenException(TABLE_OWNER_MESSAGE);
      tableHadOpen = open.length > 0;
      if (dto.checkNo != null) {
        // "Hisob-2" yorlig'i: shu raqamli ochiq hisob bo'lsa — unga, aks holda aynan shu raqam bilan yangi
        target = open.find((o) => checkNoOf(o) === dto.checkNo) ?? null;
        if (!target) newCheckNo = dto.checkNo;
      } else if (dto.newCheck) {
        newCheckNo = nextFreeCheckNo(open);
      } else {
        // Eski / oflayn mijozlar: stoldagi eng kichik raqamli ochiq hisobga (hech qachon xato bermaydi)
        target = open[0] ?? null;
        if (!target) newCheckNo = 1;
      }
    }
    const orderType = target ? orderTypeOf(target) : input.type;
    const dineIn = orderType === OrderType.DineIn;

    // 2) Mijoz (CRM): aniq tanlangan, yoki yangi yetkazishda — shu telefon raqamli mijoz
    // (topilmasa yangi mijoz YARATILMAYDI)
    let customer = dto.customerId
      ? await this.customers.findOne({ where: { id: dto.customerId } })
      : null;
    if (!customer && !target && orderType === OrderType.Delivery && input.phone) {
      customer = await this.findCustomerByPhone(input.phone);
    }

    // 3) Menyu (rasm ustuni o'qilmaydi — select:false): mavjudligi, stop list, miqdor, narx
    const menuIds = dto.items.map((i) => i.menuItemId);
    const menu = await this.menuItems.find({ where: { id: In(menuIds) } });
    const menuById = new Map(menu.map((m) => [m.id, m]));
    const unknown = dto.items.find((i) => !menuById.has(i.menuItemId));
    if (unknown) {
      throw new BadRequestException(`Taom topilmadi: ${unknown.menuItemId}`);
    }
    for (const i of dto.items) {
      const mi = menuById.get(i.menuItemId)!;
      // Stop list (B29): kassir "tugadi" deb belgilagan taom qo'shilmaydi
      if (mi.available === false) throw new BadRequestException(stopListMessage(mi.name));
      // dona — 3 xonagacha kasr (0,5 porsiya), kg — 6 xonagacha kasr (summa bo'yicha kiritilgan og'irlik)
      if (!isValidQuantity(Number(i.quantity), mi.unit ?? MenuUnit.Piece)) {
        throw new BadRequestException(quantityInvalidMessage(mi.name));
      }
    }
    // Narxni qo'lda o'zgartirish (B31) — faqat kassir / 'void' ruxsati bor xodim.
    // Menyudagi narxga teng narx — o'zgartirish hisoblanmaydi.
    const overridden = (i: CreateOrderDto['items'][number]): number | null => {
      if (i.price == null) return null;
      const price = Math.round(Number(i.price) * 100) / 100;
      return price === Number(menuById.get(i.menuItemId)!.price) ? null : price;
    };
    if (dto.items.some((i) => overridden(i) !== null) && !canOverridePrice(actor)) {
      throw new ForbiddenException(PRICE_FORBIDDEN_MESSAGE);
    }

    // 4) Ombor yetarliligini tekshiramiz — ochiq (to'lanmagan) buyurtmalar band
    // hisoblanadi, shuning uchun 20 ta cola bo'lsa 20 tadan ortiq sotib bo'lmaydi.
    const openOrders = await this.orders.find({
      where: { status: In(SETTABLE_ORDER_STATUSES) },
    });
    const reservedItems = openOrders.flatMap((o) =>
      (o.items || []).map((it) => ({
        menuItemId: it.menuItemId,
        quantity: Number(it.quantity),
      })),
    );
    await this.inventory.assertStockAvailable(
      dto.items.map((i) => ({ menuItemId: i.menuItemId, quantity: Number(i.quantity) })),
      reservedItems,
    );

    // Bo'lim (sex) nomlarini olib qo'yamiz — chekni to'g'ri bo'limga yo'naltirish uchun
    const stationIds = [
      ...new Set(menu.map((m) => m.stationId).filter(Boolean) as string[]),
    ];
    const stationRows = stationIds.length
      ? await this.stations.find({ where: { id: In(stationIds) } })
      : [];
    const stationNameById = new Map(stationRows.map((s) => [s.id, s.name]));

    // orderId — mavjud buyurtmaga qo'shilganda aniq bog'laymiz (javobdagi qatorlarda ham bo'lsin)
    const buildItems = (manager: EntityManager, orderId?: string) =>
      dto.items.map((i) => {
        const mi = menuById.get(i.menuItemId)!;
        const price = overridden(i);
        return manager.create(OrderItemEntity, {
          ...(orderId ? { orderId } : {}),
          menuItemId: mi.id,
          menuItemName: mi.name,
          price: price ?? mi.price,
          quantity: roundQty(Number(i.quantity)),
          unit: mi.unit ?? MenuUnit.Piece,
          stationId: mi.stationId ?? null,
          stationName: mi.stationId ? stationNameById.get(mi.stationId) ?? null : null,
          note: typeof i.note === 'string' && i.note.trim() ? i.note.trim() : null,
          status: OrderItemStatus.Pending,
          exciseRequired: mi.exciseRequired,
          exciseCode: null,
          // Saboy (B21) — faqat stoldagi buyurtmada ma'noli (olib ketish / yetkazish butunlay saboy)
          takeaway: dineIn ? !!i.takeaway : false,
          priceOverridden: price !== null,
          originalPrice: price !== null ? Number(mi.price) : null,
        });
      });

    // Bo'lim chekidagi ofitsiant — shu taomlarni yuborgan xodim (terminalda tanlangan yoki kirgan)
    const senderName = await this.userName(waiterId);

    // 5a) Mavjud ochiq buyurtmaga (hisobga) qo'shimcha
    if (target) {
      const existing = target;
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
      // Berilgan schot eskirdi (B23) — "chek berildi" belgisi olinadi
      existing.billPrintedAt = null;
      await this.orders.save(existing);
      // Javob, socket va oshxona cheki bazadagi holatdan quriladi (xotiradagi obyektdan emas)
      const savedExisting = await this.findEntity(existing.id);
      // Buyurtma egasi (ofitsiant) o'zgarmaydi — birinchi yuborgan xodim
      const ownerName =
        savedExisting.waiterId === waiterId
          ? senderName
          : await this.userName(savedExisting.waiterId);
      const dtoOut = await this.fullDto(savedExisting, { table, waiterName: ownerName });
      this.gateway.emitOrderUpdated(dtoOut); // -> KDS yangi taomlarni ko'radi

      // Oshxonaga FAQAT hozir qo'shilgan qatorlar ketadi ("QO'SHIMCHA" chek) — avvalgi
      // taomlar qayta chiqmaydi. save() yangi qatorlarga id beradi.
      const newIds = new Set(newItems.map((it) => it.id));
      this.printStationTickets({
        order: dtoOut,
        items: dtoOut.items.filter((it) => newIds.has(it.id)),
        append: true,
        orderType: orderTypeOf(dtoOut),
        queueNumber: dtoOut.queueNumber ?? null,
        tableNumber: dtoOut.tableNumber,
        hall: dtoOut.hall ?? null,
        checkNo: dtoOut.checkNo ?? null,
        waiterName: senderName,
      });
      return dtoOut;
    }

    // 5b) Yangi buyurtma (hisob). Xizmat haqi: stolga — zalning foizi (yo'q bo'lsa umumiy foiz),
    // olib ketish/yetkazish — 0. Yetkazish narxi — berilgan yoki sozlamadagi standart.
    const settings = await this.settings.get();
    const servicePercent = dineIn ? this.hallPercent(settings, table!.hall) : 0;
    const fee =
      orderType === OrderType.Delivery
        ? input.deliveryFee ?? this.feeOf(settings.deliveryFeeDefault)
        : 0;
    const businessDate = businessDateOf();
    const saved = await this.dataSource.transaction(async (manager) => {
      // Kunlik raqam (B27) — BARCHA turlarga bitta ketma-ketlik; navbat ichida, shu tranzaksiyada
      const queueNumber = await this.nextDailyNumber(manager, businessDate);
      const order = manager.create(OrderEntity, {
        type: orderType,
        tableId: dineIn ? table!.id : null,
        checkNo: dineIn ? newCheckNo ?? 1 : null,
        waiterId,
        status: OrderStatus.Accepted,
        queueNumber,
        phone: dineIn ? null : input.phone,
        address: orderType === OrderType.Delivery ? input.address : null,
        deliveryFee: fee,
        businessDate,
        discountPercent: 0,
        servicePercent,
        billPrintedAt: null,
        note: dto.note?.trim() || null,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        items: buildItems(manager),
      });
      const result = await manager.save(order);

      // Stol band (faqat stolga). Stolda boshqa ochiq hisob bo'lsa — holati (masalan "hisob
      // kutilmoqda") saqlanadi.
      if (dineIn && table && (!tableHadOpen || table.status === TableStatus.Free)) {
        table.status = TableStatus.Busy;
        await manager.save(table);
      }
      return result;
    });

    // Javob, socket va oshxona cheki bazadagi holatdan quriladi (xotiradagi obyektdan emas)
    const fresh = await this.findEntity(saved.id);
    const dtoOut = await this.fullDto(fresh, { table, waiterName: senderName, paidAmount: 0 });
    this.gateway.emitOrderCreated(dtoOut); // -> KDS / navbat

    // Yangi buyurtma — barcha taomlar o'z bo'limi printeriga (tranzaksiya yakunlangandan keyin)
    this.printStationTickets({
      order: dtoOut,
      items: dtoOut.items,
      append: false,
      orderType: orderTypeOf(dtoOut),
      queueNumber: dtoOut.queueNumber ?? null,
      tableNumber: dtoOut.tableNumber,
      hall: dtoOut.hall ?? null,
      checkNo: dtoOut.checkNo ?? null,
      waiterName: senderName,
    });
    return dtoOut;
  }

  /**
   * Kunlik buyurtma raqami (B27/B27b): BARCHA turlar uchun bitta ketma-ketlik, har mahalliy kun 1 dan.
   * daily_counters jadvalidan olinadi — bekor qilingan buyurtmaning raqami QAYTA berilmaydi. Kunning
   * birinchi raqamida hisoblagich shu kundagi eng katta raqamdan boshlanadi (yangilanish xavfsizligi).
   * Faqat navbat (serial) ichida, tranzaksiya bilan chaqiriladi.
   */
  private async nextDailyNumber(manager: EntityManager, businessDate: string): Promise<number> {
    const repo = manager.getRepository(DailyCounterEntity);
    let row = await repo.findOne({ where: { businessDate } });
    if (!row) {
      const max = await manager
        .createQueryBuilder(OrderEntity, 'o')
        .select('MAX(o.queueNumber)', 'max')
        .where('o.businessDate = :businessDate', { businessDate })
        .getRawOne<{ max: number | string | null }>();
      row = repo.create({ businessDate, lastNumber: Number(max?.max) || 0 });
    }
    row.lastNumber = (Number(row.lastNumber) || 0) + 1;
    await repo.save(row);
    return row.lastNumber;
  }

  /** Navbat (mutex): oldingi ish tugagach (muvaffaqiyatli yoki xato bilan) `job` bajariladi */
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Eslab qolingan takroriy so'rov (24 soat ichida): avval xotira, keyin baza (order_requests) — server
   * qayta ishga tushgandan keyin kelgan takroriy so'rov ham yangi buyurtma va oshxona cheki yaratmaydi.
   * Bazani o'qib bo'lmasa — jurnalga yoziladi va so'rov yangi deb hisoblanadi (oflayn navbat to'xtab qolmasin).
   */
  private async recalledRequest(id: string): Promise<RememberedRequest | null> {
    const now = Date.now();
    const r = this.recentRequests.get(id);
    if (r) {
      if (now - r.at <= REQUEST_ID_TTL_MS) return r;
      // Xotiradagi yozuv eskirgan — bazadagisi ham (ikkalasi birga yoziladi)
      this.recentRequests.delete(id);
      return null;
    }
    try {
      const row = await this.dataSource.getRepository(OrderRequestEntity).findOne({ where: { requestId: id } });
      const at = row?.createdAt instanceof Date ? row.createdAt.getTime() : NaN;
      if (!row || !Number.isFinite(at) || now - at > REQUEST_ID_TTL_MS) return null;
      return { orderId: row.orderId, at, snapshot: row.snapshot ?? null };
    } catch (e) {
      this.logger.warn(`Takroriy so‘rov yozuvini bazadan o‘qib bo‘lmadi (${id}): ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * So'rov natijasini eslab qolish — xotirada va bazada (navbat ichida, javobdan oldin). Xotiradagi
   * eskirganlar (Map tartibi — eng eskisi boshida) tozalanadi; bazadagilarni MaintenanceService o'chiradi.
   * Bazaga upsert: shu id bilan eskirgan (24 soatdan eski, hali o'chirilmagan) yozuv bo'lsa — yangilanadi,
   * takroriy kalit xatosi bo'lmaydi. Yozib bo'lmasa — buyurtma baribir yaratilgan: javob qaytadi,
   * xotiradagi yozuv shu jarayon davomida himoya qiladi.
   */
  private async rememberRequest(id: string, order: Order): Promise<void> {
    const now = Date.now();
    this.recentRequests.delete(id);
    this.recentRequests.set(id, { orderId: order.id, at: now, snapshot: order });
    for (const [key, r] of this.recentRequests) {
      if (now - r.at <= REQUEST_ID_TTL_MS && this.recentRequests.size <= REQUEST_ID_MAX) break;
      this.recentRequests.delete(key);
    }
    try {
      await this.dataSource
        .getRepository(OrderRequestEntity)
        .upsert({ requestId: id, orderId: order.id, snapshot: order, createdAt: new Date(now) }, ['requestId']);
    } catch (e) {
      this.logger.warn(`Takroriy so‘rov yozuvini bazaga saqlab bo‘lmadi (${id}): ${(e as Error).message}`);
    }
  }

  // =============================================================================================
  // Hisoblar: bo'lish (B18)
  // =============================================================================================

  /**
   * POST /orders/:id/split — tanlangan taomlar (miqdori bilan) yangi hisobga yoki shu stoldagi
   * boshqa ochiq hisobga ko'chadi. To'liq miqdordagi qator o'zi ko'chadi (id, oshxona holati, bo'lim,
   * aksiz kodi saqlanadi); qisman miqdor — qator ikkiga bo'linadi. Bitta tranzaksiya, oshxona cheki YO'Q.
   */
  async split(id: string, dto: SplitOrderDto): Promise<SplitOrderResult> {
    return this.serial(() => this.splitLocked(id, dto));
  }

  private async splitLocked(id: string, dto: SplitOrderDto): Promise<SplitOrderResult> {
    const source = await this.findEntity(id);
    if (orderTypeOf(source) !== OrderType.DineIn || !source.tableId) {
      throw new BadRequestException(SPLIT_ONLY_TABLE_MESSAGE);
    }
    if (source.status === OrderStatus.Closed) throw new BadRequestException(ORDER_CLOSED_MESSAGE);
    const requested = Array.isArray(dto.items) ? dto.items : [];
    if (requested.length === 0) throw new BadRequestException(SPLIT_NOTHING_MESSAGE);

    // Har qator uchun ko'chadigan miqdor (bir qator bir necha marta kelsa — qo'shiladi)
    const lineById = new Map((source.items || []).map((it) => [it.id, it]));
    const moveQty = new Map<string, number>();
    for (const r of requested) {
      const line = lineById.get(r.orderItemId);
      if (!line) throw new BadRequestException(ITEM_LINE_NOT_FOUND_MESSAGE);
      if (!isValidQuantity(Number(r.quantity), line.unit)) {
        throw new BadRequestException(SPLIT_QTY_INVALID_MESSAGE);
      }
      moveQty.set(line.id, roundQty((moveQty.get(line.id) ?? 0) + Number(r.quantity)));
    }
    const whole: OrderItemEntity[] = [];
    const parts: { line: OrderItemEntity; qty: number; left: number }[] = [];
    const remaining: MoneyItem[] = [];
    for (const line of source.items || []) {
      const qty = moveQty.get(line.id);
      if (qty === undefined) {
        remaining.push(line);
        continue;
      }
      const lineQty = Number(line.quantity);
      if (qty > lineQty + QTY_EPS) throw new BadRequestException(SPLIT_QTY_INVALID_MESSAGE);
      const left = roundQty(lineQty - qty);
      if (left <= 0) {
        whole.push(line);
      } else {
        parts.push({ line, qty, left });
        remaining.push({ price: line.price, quantity: left, takeaway: line.takeaway });
      }
    }
    if (remaining.length === 0) throw new BadRequestException(SPLIT_KEEP_ONE_MESSAGE);

    // To'lovi bor hisob: qoladigan summa to'langandan kam bo'lmasin
    const paid = sumPayments(await this.payments.find({ where: { orderId: source.id } }));
    if (paid > 0 && orderTotalsOf(source, remaining).total < paid) {
      throw new BadRequestException(BELOW_PAID_MESSAGE);
    }

    // Qabul qiluvchi hisob: berilsa — shu stoldagi OCHIQ hisob; aks holda yangi hisob ochiladi
    let target: OrderEntity | null = null;
    if (dto.targetOrderId) {
      if (dto.targetOrderId === source.id) throw new BadRequestException(SPLIT_SAME_CHECK_MESSAGE);
      target = await this.orders.findOne({ where: { id: dto.targetOrderId } });
      if (!target) throw new NotFoundException(ORDER_NOT_FOUND_MESSAGE);
      if (orderTypeOf(target) !== OrderType.DineIn || target.tableId !== source.tableId) {
        throw new BadRequestException(CHECK_OTHER_TABLE_MESSAGE);
      }
      if (target.status === OrderStatus.Closed) throw new BadRequestException(ORDER_CLOSED_MESSAGE);
    }

    const targetId = await this.dataSource.transaction(async (m) => {
      let tid = target?.id ?? null;
      if (!tid) {
        // Yangi hisob: shu stol, ofitsiant, xizmat/chegirma foizi meros; keyingi bo'sh hisob raqami
        // va kunlik raqam (B27)
        const open = await m.find(OrderEntity, {
          where: { tableId: source.tableId!, status: Not(OrderStatus.Closed) },
          loadEagerRelations: false,
        });
        const businessDate = businessDateOf();
        const created = await m.save(
          m.create(OrderEntity, {
            type: OrderType.DineIn,
            tableId: source.tableId,
            checkNo: nextFreeCheckNo(open),
            waiterId: source.waiterId,
            status: source.status,
            queueNumber: await this.nextDailyNumber(m, businessDate),
            businessDate,
            servicePercent: source.servicePercent,
            discountPercent: source.discountPercent,
            deliveryFee: 0,
            phone: null,
            address: null,
            note: null,
            customerId: null,
            customerName: null,
            billPrintedAt: null,
            items: [],
          }),
        );
        tid = created.id;
      }
      // To'liq qatorlar — o'zi ko'chadi (id, KDS holati, bo'lim, aksiz, qo'shilgan vaqt saqlanadi)
      if (whole.length) {
        await m.update(OrderItemEntity, { id: In(whole.map((l) => l.id)) }, { orderId: tid });
      }
      // Qisman — manba qatori kamayadi, yangi hisobda nusxa (narx, bo'lim, izoh, holat, saboy bilan)
      for (const { line, qty, left } of parts) {
        await m.update(OrderItemEntity, line.id, { quantity: left });
        await m.save(
          m.create(OrderItemEntity, {
            orderId: tid,
            menuItemId: line.menuItemId,
            menuItemName: line.menuItemName,
            price: line.price,
            quantity: qty,
            unit: line.unit,
            stationId: line.stationId,
            stationName: line.stationName,
            note: line.note,
            status: line.status,
            exciseRequired: line.exciseRequired,
            exciseCode: null, // aksiz kodi bitta (manba) qatorda qoladi
            takeaway: line.takeaway,
            priceOverridden: line.priceOverridden,
            originalPrice: line.originalPrice,
            createdAt: line.createdAt, // taom asli qachon buyurtilgan bo'lsa — o'sha vaqt
          }),
        );
      }
      // Ikkala hisob summasi o'zgardi — berilgan schotlar eskirdi
      await m.update(OrderEntity, { id: In([source.id, tid]) }, { billPrintedAt: null });
      return tid;
    });

    const table = await this.tableOf(source);
    const [srcEntity, tgtEntity] = await Promise.all([
      this.findEntity(source.id),
      this.findEntity(targetId),
    ]);
    const sourceDto = await this.fullDto(srcEntity, { table, paidAmount: paid });
    const targetDto = await this.fullDto(tgtEntity, { table });
    this.gateway.emitOrderUpdated(sourceDto);
    if (target) this.gateway.emitOrderUpdated(targetDto);
    else this.gateway.emitOrderCreated(targetDto, 'split'); // yangi taom yo'q — kassa cheki chiqmaydi
    this.logger.log(
      `Hisob bo‘lindi: ${orderDisplayName(sourceDto)} -> ${orderDisplayName(targetDto)} ` +
        `(${whole.length + parts.length} ta qator)`,
    );
    return { source: sourceDto, target: targetDto };
  }

  // =============================================================================================
  // Buyurtma amallari: schot, izoh, mijoz, yetkazish, tur, stol, ofitsiant (B8, B22, B23, B24, B28)
  // =============================================================================================

  // Schot (hisob) so'raldi — stolni "hisob kutilmoqda" holatiga o'tkazamiz (faqat stolga
  // buyurtmada). Ofitsiant "Schot" bosganda chaqiriladi; to'lovdan keyin stol bo'shaydi.
  async requestBill(id: string): Promise<Order> {
    return this.serial(async () => {
      const order = await this.findEntity(id);
      const table = await this.tableOf(order);
      if (table && table.status !== TableStatus.Free) {
        table.status = TableStatus.AwaitingBill;
        await this.tables.save(table);
      }
      const dto = await this.fullDto(order, { table });
      this.gateway.emitOrderUpdated(dto);
      return dto;
    });
  }

  // POST /orders/:id/bill-check — schot chiqarish mumkinmi (buyurtma bor va yopilmagan). Holat
  // o'zgarmaydi; ruxsat controller'da tekshiriladi.
  async assertBillable(id: string): Promise<{ ok: true }> {
    const order = await this.findEntity(id);
    if (order.status === OrderStatus.Closed) throw new BadRequestException(ORDER_CLOSED_MESSAGE);
    return { ok: true };
  }

  // POST /orders/:id/bill-printed — schot (hisob cheki) mijozga berildi ("chek berildi", B23).
  // Printer bo'lmasa ham chaqiriladi — schot berilgani qayd etiladi. Yangi taom qo'shilsa tozalanadi.
  async markBillPrinted(id: string): Promise<Order> {
    return this.serial(async () => {
      const order = await this.findEntity(id);
      if (order.status === OrderStatus.Closed) throw new BadRequestException(ORDER_CLOSED_MESSAGE);
      order.billPrintedAt = new Date();
      await this.orders.update(order.id, { billPrintedAt: order.billPrintedAt });
      const dto = await this.fullDto(order);
      this.gateway.emitOrderUpdated(dto);
      return dto;
    });
  }

  // Chekka izoh (Примечание) — ofitsiant/kassir kiritadi
  async setNote(id: string, note?: string): Promise<Order> {
    return this.serial(async () => {
      const order = await this.findEntity(id);
      order.note = note?.trim() || null;
      await this.orders.update(order.id, { note: order.note });
      const dto = await this.fullDto(order);
      this.gateway.emitOrderUpdated(dto);
      return dto;
    });
  }

  // Buyurtmaga mijoz (CRM) biriktirish/o'zgartirish (bo'sh — olib tashlaydi)
  async setCustomer(id: string, customerId?: string): Promise<Order> {
    return this.serial(async () => {
      const order = await this.findEntity(id);
      const customer = customerId
        ? await this.customers.findOne({ where: { id: customerId } })
        : null;
      order.customerId = customer?.id ?? null;
      order.customerName = customer?.name ?? null;
      await this.orders.update(order.id, {
        customerId: order.customerId,
        customerName: order.customerName,
      });
      const dto = await this.fullDto(order);
      this.gateway.emitOrderUpdated(dto);
      return dto;
    });
  }

  // Yetkazish ma'lumotlari (telefon, manzil, izoh, yetkazish narxi) — faqat ochiq yetkazish buyurtmasida.
  // Tekshiruv yangi yetkazish bilan bir xil; telefon o'zgarsa mijoz (CRM) qayta bog'lanadi.
  async updateDelivery(id: string, dto: DeliveryInfoDto): Promise<Order> {
    return this.serial(async () => {
      const order = await this.findEntity(id);
      if (orderTypeOf(order) !== OrderType.Delivery) {
        throw new BadRequestException(NOT_DELIVERY_MESSAGE);
      }
      if (order.status === OrderStatus.Closed) {
        throw new BadRequestException(ORDER_CLOSED_MESSAGE);
      }

      // Avval hammasi tekshiriladi — keyin o'zgartiriladi
      const phone = dto.phone != null ? normalizePhone(dto.phone) : undefined;
      if (phone === null) throw new BadRequestException(PHONE_INVALID_MESSAGE);
      const address = dto.address != null ? String(dto.address).trim() : undefined;
      if (address === '') throw new BadRequestException(ADDRESS_REQUIRED_MESSAGE);
      const fee = dto.deliveryFee != null ? this.feeOf(dto.deliveryFee) : undefined;
      const feeChanged = fee !== undefined && fee !== this.feeOf(order.deliveryFee);
      if (feeChanged) {
        // To'lovi bor hisob summasi to'langandan pastga tushmasin
        const paid = sumPayments(await this.payments.find({ where: { orderId: order.id } }));
        if (paid > 0 && orderTotalsOf({ ...order, deliveryFee: fee }).total < paid) {
          throw new BadRequestException(BELOW_PAID_MESSAGE);
        }
      }

      if (phone !== undefined && phone !== order.phone) {
        const oldPhone = order.phone;
        order.phone = phone;
        const match = await this.findCustomerByPhone(phone);
        if (match) {
          order.customerId = match.id;
          order.customerName = match.name;
        } else if (order.customerId) {
          // Eski telefon bo'yicha bog'langan mijoz endi bu buyurtmaga tegishli emas
          const current = await this.customers.findOne({ where: { id: order.customerId } });
          if (!current || (oldPhone && normalizePhone(current.phone) === oldPhone)) {
            order.customerId = null;
            order.customerName = null;
          }
        }
      }
      if (address !== undefined) order.address = address;
      if (dto.note !== undefined) {
        order.note = typeof dto.note === 'string' ? dto.note.trim() || null : null;
      }
      if (feeChanged) {
        order.deliveryFee = fee!;
        order.billPrintedAt = null; // summa o'zgardi — berilgan schot eskirdi
      }

      await this.orders.update(order.id, {
        phone: order.phone,
        address: order.address,
        note: order.note,
        customerId: order.customerId,
        customerName: order.customerName,
        deliveryFee: order.deliveryFee,
        billPrintedAt: order.billPrintedAt,
      });
      const dtoOut = await this.fullDto(order);
      this.gateway.emitOrderUpdated(dtoOut);
      return dtoOut;
    });
  }

  // Telefon bo'yicha oldingi yetkazish (manzilni avtomatik to'ldirish uchun):
  // oxirgi yetkazish manzili, CRM'dagi mijoz ismi, shu raqam bilan yetkazishlar soni.
  // Hech narsa topilmasa — null.
  async deliveryLookup(rawPhone: string | undefined): Promise<DeliveryLookup | null> {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new BadRequestException(PHONE_INVALID_MESSAGE);
    const where: FindOptionsWhere<OrderEntity> = { type: OrderType.Delivery, phone };
    const last = await this.orders.findOne({
      where,
      order: { openedAt: 'DESC' },
      loadEagerRelations: false, // taomlar kerak emas
    });
    const ordersCount = await this.orders.count({ where });
    const customer = await this.findCustomerByPhone(phone);
    if (!last && !customer) return null;
    return {
      phone,
      address: last?.address ?? null,
      customerName: customer?.name ?? last?.customerName ?? null,
      ordersCount,
    };
  }

  /**
   * POST /orders/:id/change-type — buyurtma turini o'zgartirish (eski POS'dagi "Turi"):
   *  • -> stol: stol majburiy; shu stolda hisob raqami (so'ralgan raqam bo'sh bo'lsa — o'sha, aks
   *    holda keyingi bo'sh); xizmat haqi — zal foizi (to'lov bo'lmasa); stol band;
   *  • stol -> olib ketish / yetkazish: stoldan ajraladi (boshqa ochiq hisob bo'lmasa stol bo'shaydi),
   *    xizmat haqi 0; yetkazishda telefon + manzil majburiy, yetkazish narxi — standart;
   *  • olib ketish <-> yetkazish: raqam saqlanadi.
   * Kunlik raqam (№) saqlanadi (raqamsiz eski buyurtma — yangi raqam oladi). Oshxona cheki yo'q.
   */
  async changeType(id: string, dto: ChangeOrderTypeDto, actor?: Actor): Promise<Order> {
    return this.serial(() => this.changeTypeLocked(id, dto, actor));
  }

  private async changeTypeLocked(id: string, dto: ChangeOrderTypeDto, actor?: Actor): Promise<Order> {
    const order = await this.findEntity(id);
    if (order.status === OrderStatus.Closed) throw new BadRequestException(ORDER_CLOSED_MESSAGE);
    if (!(ORDER_TYPES as string[]).includes(dto.type)) {
      throw new BadRequestException(ORDER_TYPE_INVALID_MESSAGE);
    }
    const from = orderTypeOf(order);
    const to = dto.type;
    if (from === to) throw new BadRequestException(TYPE_UNCHANGED_MESSAGE);

    const settings = await this.settings.get();
    const paid = sumPayments(await this.payments.find({ where: { orderId: order.id } }));

    let newTable: TableEntity | null = null;
    let phone: string | null = null;
    let address: string | null = null;
    if (to === OrderType.DineIn) {
      if (!dto.tableId) throw new BadRequestException(TABLE_REQUIRED_MESSAGE);
      newTable = await this.tables.findOne({ where: { id: dto.tableId } });
      if (!newTable) throw new NotFoundException(TABLE_NOT_FOUND_MESSAGE);
      if (actor && !canServeTable(actor, await this.openChecksAt(newTable.id))) {
        throw new ForbiddenException(TABLE_OWNER_MESSAGE);
      }
    } else {
      // Telefon: berilsa — tekshiriladi; berilmasa — buyurtmadagisi (olib ketishda ixtiyoriy)
      const rawPhone = typeof dto.phone === 'string' ? dto.phone.trim() : '';
      if (rawPhone) {
        phone = normalizePhone(rawPhone);
        if (!phone) throw new BadRequestException(PHONE_INVALID_MESSAGE);
      } else {
        phone = order.phone ?? null;
      }
      if (to === OrderType.Delivery) {
        if (!phone) throw new BadRequestException(PHONE_INVALID_MESSAGE);
        const rawAddress = typeof dto.address === 'string' ? dto.address.trim() : '';
        address = rawAddress || (order.address ?? '').trim();
        if (!address) throw new BadRequestException(ADDRESS_REQUIRED_MESSAGE);
      }
    }

    // Yangi pul parametrlari
    const servicePercent =
      to === OrderType.DineIn
        ? paid > 0
          ? Number(order.servicePercent) || 0 // to'lov bor — foiz o'zgarmaydi
          : this.hallPercent(settings, newTable!.hall)
        : 0;
    const deliveryFee =
      to === OrderType.Delivery
        ? from === OrderType.Delivery
          ? this.feeOf(order.deliveryFee)
          : this.feeOf(settings.deliveryFeeDefault)
        : 0;
    if (paid > 0) {
      const next = orderTotalsOf({ ...order, type: to, servicePercent, deliveryFee });
      if (next.total < paid) throw new BadRequestException(BELOW_PAID_MESSAGE);
    }

    // Yetkazishga o'tishda — shu telefon raqamli mijoz (bog'lanmagan bo'lsa)
    const customer =
      to === OrderType.Delivery && phone && !order.customerId
        ? await this.findCustomerByPhone(phone)
        : null;

    const oldTableId = from === OrderType.DineIn ? order.tableId : null;
    await this.dataSource.transaction(async (m) => {
      let checkNo: number | null = null;
      if (to === OrderType.DineIn) {
        const open = await m.find(OrderEntity, {
          where: { tableId: newTable!.id, status: Not(OrderStatus.Closed) },
          loadEagerRelations: false,
        });
        const wanted = dto.checkNo;
        checkNo =
          wanted && !open.some((o) => checkNoOf(o) === wanted) ? wanted : nextFreeCheckNo(open);
        if (open.length === 0 || newTable!.status === TableStatus.Free) {
          newTable!.status = TableStatus.Busy;
          await m.save(newTable!);
        }
      }
      order.type = to;
      order.tableId = to === OrderType.DineIn ? newTable!.id : null;
      order.checkNo = checkNo;
      order.phone = to === OrderType.DineIn ? null : phone;
      order.address = to === OrderType.Delivery ? address : null;
      order.servicePercent = servicePercent;
      order.deliveryFee = deliveryFee;
      order.billPrintedAt = null; // nomi/summasi o'zgardi — berilgan schot eskirdi
      if (customer) {
        order.customerId = customer.id;
        order.customerName = customer.name;
      }
      // Raqamsiz (0.3.0 dan oldingi) buyurtma — bugungi ketma-ketlikdan raqam oladi
      if (order.queueNumber == null) {
        const today = businessDateOf();
        order.queueNumber = await this.nextDailyNumber(m, today);
        order.businessDate = today;
      }
      await m.update(OrderEntity, order.id, {
        type: order.type,
        tableId: order.tableId,
        checkNo: order.checkNo,
        phone: order.phone,
        address: order.address,
        servicePercent: order.servicePercent,
        deliveryFee: order.deliveryFee,
        billPrintedAt: null,
        customerId: order.customerId,
        customerName: order.customerName,
        queueNumber: order.queueNumber,
        businessDate: order.businessDate,
      });
      // Eski stol: boshqa ochiq hisob qolmasa — bo'shaydi
      if (oldTableId) await this.settleTable(m, oldTableId);
    });

    const dtoOut = await this.fullDto(order, { table: newTable, paidAmount: paid });
    this.gateway.emitOrderUpdated(dtoOut);
    this.logger.log(`Buyurtma turi o‘zgardi: ${from} -> ${to} (${orderDisplayName(dtoOut)})`);
    return dtoOut;
  }

  /**
   * Hisobni boshqa stolga ko'chirish (smenit stol) — faqat stolga buyurtma, BITTA hisob.
   * Yangi stol band bo'lsa — hisob u yerda qo'shimcha hisob bo'ladi (keyingi raqam), xato emas.
   * Boshqa zalga o'tganda (to'lov bo'lmasa) xizmat haqi o'sha zal foiziga o'zgaradi (B24).
   */
  async moveTable(id: string, newTableId: string, actor?: Actor): Promise<Order> {
    return this.serial(() => this.moveTableLocked(id, newTableId, actor));
  }

  private async moveTableLocked(id: string, newTableId: string, actor?: Actor): Promise<Order> {
    const order = await this.findEntity(id);
    if (orderTypeOf(order) !== OrderType.DineIn) {
      throw new BadRequestException(NOT_TABLE_ORDER_MESSAGE);
    }
    if (order.status === OrderStatus.Closed) {
      throw new BadRequestException('Yopilgan buyurtmani ko‘chirib bo‘lmaydi');
    }
    if (order.tableId === newTableId) {
      return this.fullDto(order);
    }
    const newTable = await this.tables.findOne({ where: { id: newTableId } });
    if (!newTable) throw new NotFoundException('Yangi stol topilmadi');
    if (actor && !canServeTable(actor, await this.openChecksAt(newTable.id))) {
      throw new ForbiddenException(TABLE_OWNER_MESSAGE);
    }
    const oldTable = await this.tableOf(order);
    const oldTableId = order.tableId;
    const paid = sumPayments(await this.payments.find({ where: { orderId: order.id } }));

    // Zal foizi (B24): to'lov yo'q va boshqa zalga o'tdi — yangi zalning foizi
    let servicePercent = Number(order.servicePercent) || 0;
    if (paid === 0 && (!oldTable || (oldTable.hall ?? '').trim() !== (newTable.hall ?? '').trim())) {
      servicePercent = this.hallPercent(await this.settings.get(), newTable.hall);
    }
    const percentChanged = servicePercent !== (Number(order.servicePercent) || 0);

    await this.dataSource.transaction(async (m) => {
      const open = await m.find(OrderEntity, {
        where: { tableId: newTable.id, status: Not(OrderStatus.Closed) },
        loadEagerRelations: false,
      });
      order.tableId = newTable.id;
      order.checkNo = nextFreeCheckNo(open); // bo'sh stol — 1, band stol — keyingi hisob
      order.servicePercent = servicePercent;
      if (percentChanged) order.billPrintedAt = null; // summa o'zgardi — schot eskirdi
      await m.update(OrderEntity, order.id, {
        tableId: order.tableId,
        checkNo: order.checkNo,
        servicePercent: order.servicePercent,
        billPrintedAt: order.billPrintedAt,
      });
      if (open.length === 0 || newTable.status === TableStatus.Free) {
        newTable.status = TableStatus.Busy;
        await m.save(newTable);
      }
      // Eski stol: boshqa ochiq hisob qolmasa — bo'shaydi
      if (oldTableId) await this.settleTable(m, oldTableId);
    });
    const dto = await this.fullDto(order, { table: newTable, paidAmount: paid });
    this.gateway.emitOrderUpdated(dto);
    return dto;
  }

  // Buyurtma ofitsiantini o'zgartirish (smenit ofitsant) — ruxsat controllerda (kassir / admin / direktor)
  async changeWaiter(id: string, waiterId: string): Promise<Order> {
    return this.serial(async () => {
      const order = await this.findEntity(id);
      const waiter = waiterId
        ? await this.users.findOne({ where: { id: waiterId } })
        : null;
      if (!waiter) throw new NotFoundException('Ofitsiant topilmadi');
      order.waiterId = waiterId;
      await this.orders.update(order.id, { waiterId });
      const dto = await this.fullDto(order, { waiterName: waiter.name });
      this.gateway.emitOrderUpdated(dto);
      return dto;
    });
  }

  // Buyurtma holatini o'zgartirish (TZ F-2.3): qabul -> tayyorlanmoqda -> tayyor (KDS).
  // "yopildi" faqat to'liq to'lov orqali qo'yiladi; yopilgan (to'langan) buyurtma qayta ochilmaydi.
  async updateStatus(id: string, dto: UpdateOrderStatusDto): Promise<Order> {
    return this.serial(async () => {
      const order = await this.findEntity(id);
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

      const dtoOut = await this.fullDto(saved);
      this.gateway.emitOrderUpdated(dtoOut); // -> ofitsiant / navbat
      return dtoOut;
    });
  }

  // Hisob (schot) chekini printerli terminalga (kassa) yuborish — relay.
  // Ofitsiant terminalida printer bo'lmasa, kassa terminali chop etadi.
  async printBillRelay(id: string): Promise<Order> {
    const order = await this.findEntity(id);
    const dto = await this.fullDto(order);
    this.gateway.emitPrintBill(dto);
    return dto;
  }

  // To'lov chekini printerli terminalga (kassa) yuborish — relay.
  // Kassa boshqa terminalda (printersiz) to'lov qilsa, chek kassa printeridan chiqadi.
  printReceiptRelay(receipt: Receipt): { ok: boolean } {
    this.gateway.emitPrintReceipt(receipt);
    return { ok: true };
  }

  // =============================================================================================
  // Otkaz (B19) va narx (B31)
  // =============================================================================================

  /**
   * Otkaz: yuborilgan taomlarni (qisman miqdor bilan) bekor qilish — faqat 'void' ruxsati (controller).
   * items — qator + miqdor (3 tadan 1 tasi); itemIds — eski shakl (butun qator, noma'lumlari e'tiborsiz).
   * Hamma taom ketsa — butun hisob bekor qilinadi (to'lov bo'lsa — mumkin emas). To'lovi bor hisobda
   * qolgan summa to'langandan kam bo'lmasligi kerak. Har bir otkaz void_log'ga (shu tranzaksiyada),
   * keyin: order:voided, OTKAZ cheki bo'limlarga, Telegram'ga xabar.
   */
  async removeItems(id: string, dto: RemoveItemsDto, actor?: Actor): Promise<Order> {
    return this.serial(() => this.removeItemsLocked(id, dto ?? {}, actor));
  }

  private async removeItemsLocked(id: string, dto: RemoveItemsDto, actor?: Actor): Promise<Order> {
    const order = await this.findEntity(id);
    if (order.status === OrderStatus.Closed) {
      throw new BadRequestException('Yopilgan buyurtmani o‘zgartirib bo‘lmaydi');
    }
    const reason = cleanReason(dto.reason);
    const lineById = new Map((order.items || []).map((it) => [it.id, it]));
    const voidQty = new Map<string, number>();
    for (const r of Array.isArray(dto.items) ? dto.items : []) {
      const line = lineById.get(r.orderItemId);
      if (!line) throw new BadRequestException(ITEM_LINE_NOT_FOUND_MESSAGE);
      if (!isValidQuantity(Number(r.quantity), line.unit)) {
        throw new BadRequestException(VOID_QTY_INVALID_MESSAGE);
      }
      voidQty.set(line.id, roundQty((voidQty.get(line.id) ?? 0) + Number(r.quantity)));
    }
    // Eski shakl: butun qator (noma'lum id'lar — avvalgidek e'tiborsiz)
    for (const lineId of Array.isArray(dto.itemIds) ? dto.itemIds : []) {
      const line = lineById.get(lineId);
      if (line) voidQty.set(line.id, Number(line.quantity));
    }
    if (voidQty.size === 0) return this.fullDto(order);

    const voided: VoidedLine[] = [];
    const reduce: { id: string; left: number }[] = [];
    const drop: string[] = [];
    const remaining: MoneyItem[] = [];
    for (const line of order.items || []) {
      const qty = voidQty.get(line.id);
      if (qty === undefined) {
        remaining.push(line);
        continue;
      }
      const lineQty = Number(line.quantity);
      if (qty > lineQty + QTY_EPS) throw new BadRequestException(VOID_QTY_INVALID_MESSAGE);
      const left = roundQty(lineQty - qty);
      voided.push(this.voidedLine(line, Math.min(qty, lineQty)));
      if (left <= 0) {
        drop.push(line.id);
      } else {
        reduce.push({ id: line.id, left });
        remaining.push({ price: line.price, quantity: left, takeaway: line.takeaway });
      }
    }

    const pays = await this.payments.find({ where: { orderId: id } });
    // Hamma taom ketdi — butun hisob bekor qilinadi (to'lov bo'lsa — mumkin emas)
    if (remaining.length === 0) {
      if (pays.length > 0) throw new BadRequestException(HAS_PAYMENTS_MESSAGE);
      return this.cancelLocked(order, reason, actor);
    }
    // Qolgan taomlarning yakuniy summasi to'langan summadan kam bo'lib qolmasin
    const paid = sumPayments(pays);
    if (paid > 0 && orderTotalsOf(order, remaining).total < paid) {
      throw new BadRequestException(BELOW_PAID_MESSAGE);
    }

    const table = await this.tableOf(order);
    const before = this.toDto(order, table);
    const orderName = orderDisplayName(before);
    await this.dataSource.transaction(async (m) => {
      for (const r of reduce) await m.update(OrderItemEntity, r.id, { quantity: r.left });
      if (drop.length) await m.delete(OrderItemEntity, drop);
      // Summa o'zgardi — berilgan schot eskirdi
      await m.update(OrderEntity, order.id, { billPrintedAt: null });
      await m.save(VoidLogEntity, this.voidLogRows(order, orderName, voided, reason, actor, false));
    });

    const updated = await this.findEntity(id);
    const dtoOut = await this.fullDto(updated, { table, paidAmount: paid });
    this.gateway.emitOrderUpdated(dtoOut);
    this.afterVoid(before, orderName, voided, reason, actor, false);
    return dtoOut;
  }

  // Schotni bekor qilish (annul / otkaz) — to'lanmagan buyurtmani butunlay o'chiradi, stolda boshqa
  // ochiq hisob qolmasa stol bo'shaydi. Har bir qator void_log'ga (butun hisob). To'langan (yopilgan)
  // chek uchun bu ishlamaydi (vozvrat ishlatiladi). Ruxsat — 'void' (controller).
  async cancel(id: string, reason?: string | null, actor?: Actor): Promise<Order> {
    return this.serial(async () => this.cancelLocked(await this.findEntity(id), cleanReason(reason), actor));
  }

  private async cancelLocked(order: OrderEntity, reason: string | null, actor?: Actor): Promise<Order> {
    if (order.status === OrderStatus.Closed) {
      throw new BadRequestException('To‘langan chekni bekor qilib bo‘lmaydi (vozvrat qiling)');
    }
    // Qisman to'langan hisob o'chirilsa, olingan pul hisobotlardan yo'qolib qoladi —
    // avval kassada to'lovlar o'chirilishi kerak
    const paymentCount = await this.payments.count({ where: { orderId: order.id } });
    if (paymentCount > 0) {
      throw new BadRequestException(HAS_PAYMENTS_MESSAGE);
    }
    const table = await this.tableOf(order);
    const dto = await this.fullDto(order, { table, paidAmount: 0 });
    const orderName = orderDisplayName(dto);
    const voided = (order.items || []).map((it) => this.voidedLine(it, Number(it.quantity)));
    await this.dataSource.transaction(async (m) => {
      if (voided.length) {
        await m.save(VoidLogEntity, this.voidLogRows(order, orderName, voided, reason, actor, true));
      }
      await m.delete(OrderItemEntity, { orderId: order.id });
      await m.delete(OrderEntity, order.id);
      // Stolda boshqa ochiq hisob qolmasa — stol bo'shaydi
      if (orderTypeOf(order) === OrderType.DineIn && order.tableId) {
        await this.settleTable(m, order.tableId);
      }
    });
    // Ro'yxatlardan (KDS/kassa/ofitsiant) olib tashlash uchun "yopildi" hodisasi
    this.gateway.emitOrderClosed(dto);
    this.afterVoid(dto, orderName, voided, reason, actor, true);
    return dto;
  }

  /** Otkaz qilingan qator (jurnal / chek / KDS uchun) */
  private voidedLine(line: OrderItemEntity, quantity: number): VoidedLine {
    return {
      menuItemId: line.menuItemId ?? null,
      name: line.menuItemName,
      quantity: roundQty(quantity),
      unit: line.unit ?? MenuUnit.Piece,
      price: Number(line.price),
      stationId: line.stationId ?? null,
      stationName: line.stationName ?? null,
    };
  }

  /** void_log qatorlari (B19): kim, qachon, nimani, qancha, nima sababdan */
  private voidLogRows(
    order: OrderEntity,
    orderName: string,
    lines: VoidedLine[],
    reason: string | null,
    actor: Actor | undefined,
    wholeOrder: boolean,
  ): Partial<VoidLogEntity>[] {
    return lines.map((l) => ({
      orderId: order.id,
      orderName,
      orderType: orderTypeOf(order),
      menuItemId: l.menuItemId,
      name: l.name,
      quantity: l.quantity,
      unit: l.unit,
      price: l.price,
      sum: lineSum(l.price, l.quantity),
      reason,
      userId: actor?.id ?? null,
      userName: actor?.name ?? null,
      wholeOrder,
      sentToKitchen: true, // server qabul qilgan har bir taom oshxonaga yuborilgan
    }));
  }

  /**
   * Otkazdan keyin (tranzaksiya yakunlangach): KDS/kassaga order:voided, bo'limlarga OTKAZ cheki
   * (navbat orqali), direktorga Telegram xabari. Chek va Telegram — fonda, hech qachon xato bermaydi.
   */
  private afterVoid(
    order: Order,
    orderName: string,
    lines: VoidedLine[],
    reason: string | null,
    actor: Actor | undefined,
    wholeOrder: boolean,
  ): void {
    if (lines.length === 0) return;
    const userName = actor?.name ?? null;
    const payload: OrderVoidedPayload = {
      orderId: order.id,
      orderName,
      items: lines.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        unit: l.unit,
        stationName: l.stationName,
      })),
      reason,
      userName,
      wholeOrder,
    };
    this.gateway.emitOrderVoided(payload);
    this.logger.log(
      `Otkaz: ${orderName} — ${lines.map((l) => `${l.quantity} × ${l.name}`).join(', ')}` +
        `${wholeOrder ? ' (butun hisob)' : ''} — ${userName ?? '?'}${reason ? `, sabab: ${reason}` : ''}`,
    );

    const dineIn = orderTypeOf(order) === OrderType.DineIn;
    const params: PrintVoidParams = {
      orderId: order.id,
      orderName,
      type: orderTypeOf(order),
      tableNumber: dineIn ? order.tableNumber ?? null : null,
      hall: dineIn ? order.hall ?? null : null,
      checkNo: dineIn ? order.checkNo ?? null : null,
      queueNumber: order.queueNumber ?? null,
      items: lines.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        unit: l.unit,
        stationId: l.stationId,
        stationName: l.stationName,
      })),
      reason,
      userName,
    };
    setImmediate(() => {
      Promise.resolve()
        .then(() => this.stationPrint.printVoid(params))
        .catch((e) => this.logger.error(`OTKAZ chekida kutilmagan xato: ${errorText(e)}`));
      // Telegram (direktor chati sozlangan bo'lsa) — xabarda har qator summasi ham ko'rsatiladi
      // ("1 × BULYON (6 000 so‘m)"). notifyVoid hech qachon xato tashlamaydi; baribir himoyalangan
      const notice: VoidNotification = {
        ...payload,
        items: lines.map((l) => ({
          name: l.name,
          quantity: l.quantity,
          unit: l.unit,
          stationName: l.stationName,
          price: l.price,
          sum: lineSum(l.price, l.quantity),
        })),
      };
      Promise.resolve()
        .then(() => this.telegram.notifyVoid(notice))
        .catch((e) => this.logger.warn(`Otkaz haqida Telegram xabari yuborilmadi: ${errorText(e)}`));
    });
  }

  /**
   * PATCH /orders/:id/items/:itemId/price — yuborilgan qator narxini o'zgartirish ('void' ruxsati,
   * controllerda). Menyudagi asl narx saqlanadi (originalPrice); asl narxga qaytarilsa belgi olinadi.
   * To'lovi bor hisob summasi to'langandan pastga tushmasin. Oshxona cheki yo'q.
   */
  async setItemPrice(id: string, itemId: string, dto: ItemPriceDto, actor?: Actor): Promise<Order> {
    return this.serial(async () => {
      const order = await this.findEntity(id);
      if (order.status === OrderStatus.Closed) throw new BadRequestException(ORDER_CLOSED_MESSAGE);
      const line = (order.items || []).find((it) => it.id === itemId);
      if (!line) throw new BadRequestException(ITEM_LINE_NOT_FOUND_MESSAGE);
      const price = Math.round(Number(dto.price) * 100) / 100;
      const oldPrice = Number(line.price);
      if (price === oldPrice) return this.fullDto(order);

      const paid = sumPayments(await this.payments.find({ where: { orderId: order.id } }));
      const nextLines = (order.items || []).map((it) =>
        it.id === line.id ? { price, quantity: it.quantity, takeaway: it.takeaway } : it,
      );
      if (paid > 0 && orderTotalsOf(order, nextLines).total < paid) {
        throw new BadRequestException(BELOW_PAID_MESSAGE);
      }
      const original = line.originalPrice != null ? Number(line.originalPrice) : oldPrice;
      line.price = price;
      line.priceOverridden = price !== original;
      line.originalPrice = line.priceOverridden ? original : null;
      order.billPrintedAt = null; // summa o'zgardi — schot eskirdi
      await this.dataSource.transaction(async (m) => {
        await m.update(OrderItemEntity, line.id, {
          price: line.price,
          priceOverridden: line.priceOverridden,
          originalPrice: line.originalPrice,
        });
        await m.update(OrderEntity, order.id, { billPrintedAt: null });
      });
      const dtoOut = await this.fullDto(order, { paidAmount: paid });
      this.gateway.emitOrderUpdated(dtoOut);
      this.logger.log(
        `Narx o‘zgartirildi: ${orderDisplayName(dtoOut)} — ${line.menuItemName}: ${oldPrice} -> ${price}` +
          ` (${actor?.name ?? '?'}${dto.reason?.trim() ? `, sabab: ${dto.reason.trim()}` : ''})`,
      );
      return dtoOut;
    });
  }

  // =============================================================================================
  // To'lov (B4, B5, B9, B28, B30)
  // =============================================================================================

  // Kassa: to'lov qabul qilish (bitta usul), hisobni yopish, stolni bo'shatish, chek qaytarish.
  // Oldingi to'lovlar jami summani allaqachon qoplagan ochiq hisob (yoki 0 so'mlik hisob) shu
  // so'rov bilan yangi to'lovsiz yopiladi ("Hisobni yopish"). Usul — sozlamadagi FAOL usul kaliti.
  async pay(id: string, dto: PayOrderDto, cashierId: string): Promise<PayResult> {
    return this.serial(async () => {
      const order = await this.findEntity(id);
      if (order.status === OrderStatus.Closed) {
        throw new BadRequestException(ORDER_ALREADY_CLOSED_MESSAGE);
      }
      const settings = await this.settings.get();
      const methods = normalizePaymentMethods(settings.paymentMethods);
      const method = activeMethodOf(methods, dto.type);
      if (!method) throw new BadRequestException(PAYMENT_TYPE_INVALID_MESSAGE);
      this.assertExcise(order);

      // Shu so'rovgacha saqlangan foizlar bilan jami summa — chegirma oshirilib, jami to'langan
      // summadan pastga tushib qolishini aniqlash uchun
      const previousTotal = orderTotalsOf(order).total;
      this.applyPercents(order, dto.discountPercent, dto.serviceFeePercent);
      const total = orderTotalsOf(order).total;

      const prior = await this.payments.find({
        where: { orderId: order.id },
        order: { createdAt: 'ASC' },
      });
      const priorPaid = sumPayments(prior);
      const remaining = remainingAmount(total, priorPaid);
      const settleOnly = remaining <= 0;
      if (settleOnly) this.assertSettle(order, priorPaid, total, previousTotal);

      // To'lov summasi (butun so'm): berilmasa — qolgan summa; berilsa — qolgandan oshmaydi
      const amount = settleOnly
        ? 0
        : dto.amount != null
          ? Math.min(roundSum(dto.amount), remaining)
          : remaining;
      if (!settleOnly && amount <= 0) {
        throw new BadRequestException(PAYMENT_AMOUNT_INVALID_MESSAGE);
      }
      const debtor = amount > 0 && method.kind === 'debt' ? this.debtorOf(dto.debtor) : null;
      return this.finishPayment(order, {
        entries: amount > 0 ? [{ type: method.key, amount, debtor }] : [],
        prior,
        cashierId,
        fallbackType: method.key,
        methods,
        settings,
      });
    });
  }

  /**
   * POST /orders/:id/pay-multi — bir nechta usul bilan birdaniga (masalan 20 000 naqd + 8 620 Click),
   * BITTA tranzaksiya. Summalar butun > 0; yig'indi qoldiqdan oshmaydi; 'Qarzga' usulida mijoz ismi
   * majburiy. To'lovsiz (bo'sh ro'yxat) — faqat qoldiq 0 bo'lsa, hisobni yopish.
   */
  async payMulti(id: string, dto: PayMultiDto, cashierId: string): Promise<PayResult> {
    return this.serial(async () => {
      const order = await this.findEntity(id);
      if (order.status === OrderStatus.Closed) {
        throw new BadRequestException(ORDER_ALREADY_CLOSED_MESSAGE);
      }
      const settings = await this.settings.get();
      const methods = normalizePaymentMethods(settings.paymentMethods);

      // Bir xil usul bir necha marta kelsa — bitta to'lovga qo'shiladi
      const byKey = new Map<string, { method: PaymentMethod; amount: number }>();
      for (const p of Array.isArray(dto.payments) ? dto.payments : []) {
        const method = activeMethodOf(methods, p?.type);
        if (!method) throw new BadRequestException(PAYMENT_TYPE_INVALID_MESSAGE);
        const amount = Number(p.amount);
        if (!Number.isInteger(amount) || amount <= 0) {
          throw new BadRequestException(PAYMENT_AMOUNT_INVALID_MESSAGE);
        }
        const cur = byKey.get(method.key);
        if (cur) cur.amount += amount;
        else byKey.set(method.key, { method, amount });
      }
      const chosen = [...byKey.values()];
      const debtor = chosen.some((c) => c.method.kind === 'debt') ? this.debtorOf(dto.debtor) : null;
      this.assertExcise(order);

      const previousTotal = orderTotalsOf(order).total;
      this.applyPercents(order, dto.discountPercent, dto.serviceFeePercent);
      const total = orderTotalsOf(order).total;
      const prior = await this.payments.find({
        where: { orderId: order.id },
        order: { createdAt: 'ASC' },
      });
      const priorPaid = sumPayments(prior);
      const remaining = remainingAmount(total, priorPaid);
      const sum = chosen.reduce((s, c) => s + c.amount, 0);
      if (sum > remaining) throw new BadRequestException(PAYMENT_EXCEEDS_MESSAGE);
      if (chosen.length === 0) {
        if (remaining > 0) throw new BadRequestException(PAYMENT_AMOUNT_INVALID_MESSAGE);
        this.assertSettle(order, priorPaid, total, previousTotal);
      }
      const entries: PaymentEntry[] = chosen.map((c) => ({
        type: c.method.key,
        amount: c.amount,
        debtor: c.method.kind === 'debt' ? debtor : null,
      }));
      const fallbackType =
        entries[entries.length - 1]?.type ??
        prior[prior.length - 1]?.type ??
        methods.find((m) => m.kind === 'cash' && m.active)?.key ??
        'naqd';
      return this.finishPayment(order, { entries, prior, cashierId, fallbackType, methods, settings });
    });
  }

  /** Chegirma/xizmat foizi — BERILSA buyurtmaga yoziladi; berilmasa saqlangan foiz ishlatiladi */
  private applyPercents(order: OrderEntity, discount?: number | null, service?: number | null): void {
    if (discount != null) order.discountPercent = clampPercent(discount);
    if (service != null) order.servicePercent = clampPercent(service);
  }

  /** Aksizli taomlar uchun kod skanerlangan bo'lishi shart (TZ F-8.6/8.8) */
  private assertExcise(order: OrderEntity): void {
    const missing = (order.items || []).filter((it) => it.exciseRequired && !it.exciseCode);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Aksiz kodi skanerlanmagan: ${missing.map((it) => it.menuItemName).join(', ')}`,
      );
    }
  }

  /**
   * To'lovsiz yopish ("Hisobni yopish"): oldingi to'lovlar jami summani qoplagan (taom olib
   * tashlangan yoki 100% chegirma). Chegirma jami summani to'langandan pastga tushirmasin —
   * aks holda chekdagi to'lovlar jami summadan ko'p bo'lib qoladi.
   */
  private assertSettle(order: OrderEntity, priorPaid: number, total: number, previousTotal: number): void {
    if (!(order.items || []).length) {
      throw new BadRequestException('Buyurtmada taom yo‘q — hisobni bekor qiling');
    }
    if (priorPaid > total && total < previousTotal) {
      throw new BadRequestException(
        'Jami summa to‘langan summadan kam bo‘lib qoladi — chegirmani kamaytiring yoki ortiqcha to‘lovni o‘chiring',
      );
    }
  }

  /** 'Qarzga' to'lovidagi qarzdor: ism majburiy, telefon ixtiyoriy (berilsa — to'g'ri bo'lishi shart) */
  private debtorOf(d: DebtorDto | null | undefined): { name: string; phone: string | null } {
    const name = typeof d?.name === 'string' ? d.name.trim() : '';
    if (!name) throw new BadRequestException(DEBTOR_REQUIRED_MESSAGE);
    const rawPhone = typeof d?.phone === 'string' ? d.phone.trim() : '';
    let phone: string | null = null;
    if (rawPhone) {
      phone = normalizePhone(rawPhone);
      if (!phone) throw new BadRequestException(PHONE_INVALID_MESSAGE);
    }
    return { name: name.slice(0, 100), phone };
  }

  /**
   * To'lovlarni yozish va (to'liq bo'lsa) hisobni yopish — BITTA tranzaksiya: to'lovlar, foizlar,
   * holat, stol (boshqa ochiq hisob qolmasa bo'shaydi), ombordan ayirish, fiskal hujjat.
   */
  private async finishPayment(
    order: OrderEntity,
    args: {
      entries: PaymentEntry[];
      prior: PaymentEntity[];
      cashierId: string;
      fallbackType: string;
      methods: PaymentMethod[];
      settings: SettingsEntity;
    },
  ): Promise<PayResult> {
    const total = orderTotalsOf(order).total;
    const priorPaid = sumPayments(args.prior);
    const paidNow = args.entries.reduce((s, e) => s + e.amount, 0);
    const newPaid = priorPaid + paidNow;
    const fullyPaid = newPaid >= total;

    // Stol — faqat stolga buyurtmada (olib ketish / yetkazishda stolga tegilmaydi)
    const table = await this.tableOf(order);
    const names = await this.userNamesFor([
      order.waiterId,
      args.cashierId,
      ...args.prior.map((p) => p.cashierId),
    ]);
    const waiterName = names.get(order.waiterId) ?? null;

    // Fiskal hujjat (TZ 8.1) — faqat to'liq to'langanda yaratiladi
    let fiscalNumber: string | undefined;
    let fiscalQr: string | undefined;
    const fiscalEnabled = process.env.FISCAL_ENABLED !== 'false';
    const saved: PaymentEntity[] = [];

    await this.dataSource.transaction(async (manager) => {
      for (const e of args.entries) {
        const p = manager.create(PaymentEntity, {
          orderId: order.id,
          amount: e.amount, // butun so'm
          type: e.type as PaymentType, // usul kaliti (sozlamadagi to'lov usuli)
          cashierId: args.cashierId,
        }) as PaymentWithDebtor;
        if (e.debtor) {
          p.debtorName = e.debtor.name;
          p.debtorPhone = e.debtor.phone;
        }
        saved.push(await manager.save(p));
      }
      if (fullyPaid) {
        order.status = OrderStatus.Closed;
        order.closedAt = new Date();
      }
      // Foizlar (berilgan bo'lsa) va holat — taom qatorlariga tegmasdan
      await manager.update(OrderEntity, order.id, {
        discountPercent: order.discountPercent,
        servicePercent: order.servicePercent,
        ...(fullyPaid ? { status: order.status, closedAt: order.closedAt } : {}),
      });

      if (fullyPaid) {
        // Stol bo'shaydi (TZ F-3.5) — shu stolda boshqa ochiq hisob qolmagan bo'lsa
        if (orderTypeOf(order) === OrderType.DineIn && order.tableId) {
          await this.settleTable(manager, order.tableId);
        }

        // Sotildi — taomlarga ketgan mahsulotlar skladdan ayiriladi ('sale' harakatlari: kassir,
        // buyurtma id va nomi bilan). Retseptsiz taomlar / mahsulotsiz restoran — hech narsa.
        await this.inventory.deductForOrder(
          manager,
          (order.items || []).map((it) => ({
            menuItemId: it.menuItemId,
            quantity: Number(it.quantity),
          })),
          {
            userId: args.cashierId,
            userName: names.get(args.cashierId) ?? null,
            reference: order.id,
            referenceLabel: orderStockLabel({
              type: order.type,
              queueNumber: order.queueNumber,
              tableNumber: table?.number ?? null,
              checkNo: order.checkNo,
            }),
          },
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

    const allPayments = [...args.prior, ...saved].map((p) => this.paymentView(p, args.methods, names));
    // order.total — to'lanadigan yakuniy summa (chegirma/xizmat/yetkazish bilan)
    const dtoOut = await this.fullDto(order, { table, waiterName, paidAmount: newPaid });

    if (!fullyPaid) {
      // Qisman to'landi — buyurtma ochiq qoladi, chek chiqmaydi
      this.gateway.emitOrderUpdated(dtoOut);
      return { order: dtoOut, fullyPaid: false, paidAmount: newPaid, total, payments: allPayments };
    }

    const receipt = this.buildReceipt(order, {
      table,
      waiterName,
      cashierName: names.get(args.cashierId) ?? null,
      payments: allPayments,
      fallbackType: args.fallbackType,
      restaurantName: restaurantNameOf(args.settings),
      createdAt: isoOf(order.closedAt) || new Date().toISOString(),
      fiscalNumber,
      fiscalQr,
      fiscalEnabled,
    });
    this.gateway.emitOrderClosed(dtoOut); // -> KDS/navbatdan o'chadi
    return { order: dtoOut, receipt, fullyPaid: true, paidAmount: newPaid, total, payments: allPayments };
  }

  /**
   * Chek (B9): tur, kunlik raqam, stol hisobi, telefon/manzil, yetkazish narxi, saboy qatorlari,
   * restoran nomi, har bir to'lov usul nomi bilan. Stol raqami va zal — faqat stolga buyurtmada.
   */
  private buildReceipt(
    o: OrderEntity,
    parts: {
      table: TableEntity | null;
      waiterName: string | null;
      cashierName: string | null;
      payments: PaymentView[];
      fallbackType: string;
      restaurantName: string;
      createdAt: string;
      fiscalNumber?: string;
      fiscalQr?: string;
      fiscalEnabled: boolean;
    },
  ): Receipt {
    const type = orderTypeOf(o);
    const dineIn = type === OrderType.DineIn;
    const totals = orderTotalsOf(o);
    const items = [...(o.items || [])].sort(byCreatedAt);
    const last = parts.payments[parts.payments.length - 1];
    return {
      orderId: o.id,
      orderType: type,
      queueNumber: o.queueNumber ?? null,
      checkNo: dineIn ? checkNoOf(o) : null,
      phone: o.phone ?? null,
      address: o.address ?? null,
      deliveryFee: totals.deliveryFee,
      ...(dineIn ? { tableNumber: parts.table?.number, hall: parts.table?.hall ?? null } : {}),
      waiterName: parts.waiterName ?? undefined,
      cashierName: parts.cashierName ?? undefined,
      // Chek qatorlari yig'indisi = subtotal (har qator lineSum bilan yaxlitlangan)
      lines: items.map((it) => ({
        name: it.menuItemName,
        quantity: Number(it.quantity),
        price: Number(it.price),
        sum: lineSum(it.price, it.quantity),
        unit: it.unit ?? MenuUnit.Piece,
        takeaway: !!it.takeaway,
        // narx qo'lda o'zgartirilgan (chekda "*" va asl narx) — qo'shimcha maydonlar
        priceOverridden: !!it.priceOverridden,
        originalPrice: it.originalPrice != null ? Number(it.originalPrice) : null,
      })),
      subtotal: totals.subtotal,
      discountPercent: totals.discountPercent,
      discountAmount: totals.discountAmount,
      serviceFeePercent: totals.servicePercent,
      serviceFeeAmount: totals.serviceAmount,
      total: totals.total,
      // asosiy (oxirgi) to'lov usuli; to'lovsiz yopilgan hisobda (0 so'm) — so'rovdagi usul
      paymentType: last?.type ?? parts.fallbackType,
      payments: parts.payments.map((p) => ({ type: p.type, amount: p.amount, label: p.label })),
      restaurantName: parts.restaurantName,
      note: o.note ?? null,
      customerName: o.customerName ?? null,
      createdAt: parts.createdAt,
      fiscalQrPlaceholder: !parts.fiscalEnabled,
      fiscalNumber: parts.fiscalNumber,
      fiscalQr: parts.fiscalQr,
    };
  }

  // Bo'lib to'langan qisman to'lovni bekor qilish (chek yopilmagan bo'lsa)
  async deletePayment(orderId: string, paymentId: string): Promise<Order> {
    return this.serial(async () => {
      const order = await this.findEntity(orderId);
      if (order.status === OrderStatus.Closed) {
        throw new BadRequestException('Yopilgan chek to‘lovini o‘chirib bo‘lmaydi');
      }
      await this.payments.delete({ id: paymentId, orderId });
      const rest = await this.payments.find({ where: { orderId } });
      const dtoOut = await this.fullDto(order, { paidAmount: sumPayments(rest) });
      this.gateway.emitOrderUpdated(dtoOut);
      return dtoOut;
    });
  }

  // Buyurtma to'lovlari ro'yxati (bo'lib to'lash uchun) — summalar butun so'mda, usul nomi va kassir bilan
  async getPayments(orderId: string): Promise<PaymentView[]> {
    const rows = await this.payments.find({ where: { orderId }, order: { createdAt: 'ASC' } });
    if (rows.length === 0) return [];
    const methods = await this.settings.paymentMethods();
    const names = await this.userNamesFor(rows.map((p) => p.cashierId));
    return rows.map((p) => this.paymentView(p, methods, names));
  }

  // Vozvrat — to'langan (yopilgan) chekni qaytarish. Faqat 'refund' ruxsati bor xodim
  // (controllerda tekshiriladi; Direktor/SuperAdmin avtomatik ega). Sabab jurnalga yoziladi.
  // returnStock — sotuvda ayirilgan mahsulotlar skladga qaytadi ('refund' harakatlari), shu tranzaksiyada.
  async refund(
    id: string,
    reason: string,
    userId: string,
    byName = 'Admin',
    returnStock = false,
  ): Promise<Order> {
    return this.serial(async () => {
      const order = await this.findEntity(id);
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
      const table = await this.tableOf(order);
      await this.dataSource.transaction(async (m) => {
        await m.update(OrderEntity, order.id, {
          refunded: true,
          refundReason: order.refundReason,
          refundedAt: order.refundedAt,
          refundedBy: userId,
        });
        if (returnStock) {
          await this.inventory.returnSaleStock(m, order.id, {
            userId,
            userName: byName,
            reference: order.id,
            referenceLabel: `Vozvrat: ${orderStockLabel({
              type: order.type,
              queueNumber: order.queueNumber,
              tableNumber: table?.number ?? null,
              checkNo: order.checkNo,
            })}`,
          });
        }
      });
      const dto = await this.fullDto(order, { table });

      // Direktorga Telegram orqali vozvrat cheki (TZ #10) — xato bo'lsa ham davom etadi.
      // Qaytariladigan summa — chek summasi (chegirma/xizmat bilan), qatorlar yig'indisi emas.
      this.telegram
        .notifyRefund({
          orderName: orderDisplayName(dto),
          hall: dto.hall ?? null,
          total: dto.total ?? 0,
          reason: order.refundReason ?? '',
          by: byName,
          items: (order.items || [])
            .map((it) => `${Number(it.quantity)}× ${it.menuItemName}`)
            .join(', '),
        })
        .catch(() => undefined);

      return dto;
    });
  }

  // Aksiz kodlarini saqlash (TZ F-8.6/8.8) — kassa skaner orqali kiritadi
  async addExciseCodes(
    orderId: string,
    codes: { orderItemId: string; code: string }[],
  ): Promise<Order> {
    return this.serial(async () => {
      const order = await this.findEntity(orderId);

      await this.dataSource.transaction(async (manager) => {
        for (const c of codes) {
          const item = order.items.find((it) => it.id === c.orderItemId);
          if (!item) continue;
          item.exciseCode = c.code;
          await manager.update(OrderItemEntity, item.id, { exciseCode: c.code });
          await manager.save(
            manager.create(ExciseCodeEntity, {
              orderItemId: item.id,
              exciseCode: c.code,
            }),
          );
        }
      });

      return this.findOne(orderId);
    });
  }

  // =============================================================================================
  // DTO va yordamchilar
  // =============================================================================================

  // Entity -> shared Order. Barcha javoblar va socket hodisalarida bir xil shakl:
  //  • type doim to'ldiriladi (eski buyurtmalar — 'stol'); queueNumber (kunlik №), phone, address;
  //  • tableNumber, hall, checkNo (hisob raqami; eskisi — 1) — FAQAT stolga buyurtmada;
  //  • pul: subtotal = Σ lineSum; discountAmount / serviceAmount (saboy qatorlarisiz) / deliveryFee /
  //    total — orderTotalsOf; total — TO'LANADIGAN yakuniy summa (ustiga yana xizmat qo'shilmaydi);
  //  • qatorlar qo'shilgan vaqti (createdAt), saboy belgisi, qo'lda o'zgartirilgan narx bilan.
  private toDto(o: OrderEntity, table?: TableEntity | null, waiterName?: string | null): Order {
    const type = orderTypeOf(o);
    const dineIn = type === OrderType.DineIn;
    const totals = orderTotalsOf(o);
    const items = [...(o.items || [])].sort(byCreatedAt);
    const dto: Order = {
      id: o.id,
      type,
      tableId: dineIn ? o.tableId ?? null : null,
      checkNo: dineIn ? checkNoOf(o) : null,
      billPrintedAt: o.billPrintedAt ? isoOf(o.billPrintedAt) : null,
      waiterId: o.waiterId,
      status: o.status,
      openedAt: isoOf(o.openedAt),
      closedAt: o.closedAt ? isoOf(o.closedAt) : null,
      queueNumber: o.queueNumber ?? null,
      phone: o.phone ?? null,
      address: o.address ?? null,
      deliveryFee: totals.deliveryFee,
      note: o.note ?? null,
      customerId: o.customerId ?? null,
      customerName: o.customerName ?? null,
      discountPercent: totals.discountPercent,
      servicePercent: totals.servicePercent,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      serviceAmount: totals.serviceAmount,
      total: totals.total,
      refunded: o.refunded ?? false,
      refundReason: o.refundReason ?? null,
      refundedAt: o.refundedAt ? isoOf(o.refundedAt) : null,
      items: items.map((it) => this.itemDto(it)),
    };
    if (dineIn) {
      dto.tableNumber = table?.number;
      dto.hall = table?.hall ?? null;
    }
    if (waiterName !== undefined) dto.waiterName = waiterName;
    return dto;
  }

  private itemDto(it: OrderItemEntity): OrderItem {
    return {
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
      createdAt: it.createdAt ? isoOf(it.createdAt) : undefined,
      takeaway: !!it.takeaway,
      priceOverridden: !!it.priceOverridden,
      originalPrice: it.originalPrice != null ? Number(it.originalPrice) : null,
    };
  }

  /** To'lov qatori: usul nomi (sozlamadan), kassir ismi, qarzdor */
  private paymentView(
    p: PaymentEntity,
    methods: PaymentMethod[],
    names: Map<string, string>,
  ): PaymentView {
    const d = p as PaymentWithDebtor;
    return {
      id: p.id,
      orderId: p.orderId,
      amount: roundSum(p.amount),
      type: p.type,
      cashierId: p.cashierId,
      createdAt: isoOf(p.createdAt),
      debtorName: d.debtorName ?? null,
      debtorPhone: d.debtorPhone ?? null,
      label: paymentMethodLabel(methods, p.type),
      cashierName: names.get(p.cashierId) ?? null,
    };
  }

  /**
   * To'liq DTO (bitta buyurtma uchun): stol (faqat stolga), ofitsiant ismi va to'langan summa
   * bilan. Javoblar va socket hodisalari (order:created/updated/closed, print:bill) shu shaklda.
   */
  private async fullDto(o: OrderEntity, parts: DtoParts = {}): Promise<Order> {
    const table = parts.table !== undefined ? parts.table : await this.tableOf(o);
    const waiterName =
      parts.waiterName !== undefined ? parts.waiterName : await this.userName(o.waiterId);
    const dto = this.toDto(o, table, waiterName);
    if (parts.withPayments) {
      const pays = await this.getPayments(o.id);
      dto.payments = pays;
      dto.paidAmount = sumPayments(pays);
      return dto;
    }
    dto.paidAmount =
      parts.paidAmount !== undefined
        ? parts.paidAmount
        : sumPayments(await this.payments.find({ where: { orderId: o.id } }));
    return dto;
  }

  /** Buyurtma (taomlari bilan) yoki 404 */
  private async findEntity(id: string): Promise<OrderEntity> {
    const order = id ? await this.orders.findOne({ where: { id } }) : null;
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND_MESSAGE);
    return order;
  }

  /**
   * Buyurtma stoli — FAQAT stolga buyurtmada. Olib ketish / yetkazishda (table_id NULL) null.
   * Diqqat: TypeORM where:{id: null} shartni tashlab yuborib BIRINCHI stolni qaytaradi —
   * shuning uchun stolni hech qachon to'g'ridan-to'g'ri order.tableId bilan qidirmaymiz.
   */
  private async tableOf(o: Pick<OrderEntity, 'type' | 'tableId'>): Promise<TableEntity | null> {
    if (orderTypeOf(o) !== OrderType.DineIn || !o.tableId) return null;
    return this.tables.findOne({ where: { id: o.tableId } });
  }

  /** Stoldagi ochiq hisoblar (taomlari bilan) — hisob raqami bo'yicha (eskisi — 1) */
  private async openChecksAt(tableId: string): Promise<OrderEntity[]> {
    if (!tableId) return [];
    const list = await this.orders.find({
      where: { tableId, status: Not(OrderStatus.Closed) },
      order: { openedAt: 'ASC' },
    });
    return list
      .filter((o) => orderTypeOf(o) === OrderType.DineIn)
      .sort((a, b) => checkNoOf(a) - checkNoOf(b));
  }

  /**
   * Stol holatini hisoblar bo'yicha tiklash (tranzaksiya ichida): ochiq hisob qolmagan bo'lsa —
   * bo'sh; bor bo'lsa va stol "bo'sh" deb turgan bo'lsa — band (aks holda holati saqlanadi,
   * masalan "hisob kutilmoqda").
   */
  private async settleTable(m: EntityManager, tableId: string | null | undefined): Promise<void> {
    if (!tableId) return; // TypeORM where:{id: null} — birinchi stolni qaytaradi, shuning uchun himoya
    const table = await m.findOne(TableEntity, { where: { id: tableId } });
    if (!table) return;
    const open = await m.count(OrderEntity, {
      where: { tableId, status: Not(OrderStatus.Closed) },
    });
    const next =
      open === 0
        ? TableStatus.Free
        : table.status === TableStatus.Free
          ? TableStatus.Busy
          : table.status;
    if (next !== table.status) {
      table.status = next;
      await m.save(table);
    }
  }

  /** Stolga hisob uchun xizmat haqi foizi: zalning alohida foizi (B24), yo'q bo'lsa — umumiy */
  private hallPercent(settings: SettingsEntity, hall: string | null | undefined): number {
    return hallServicePercentFor(
      {
        serviceDineInPercent: Number(settings.serviceDineInPercent) || 0,
        hallServicePercent: normalizeHallServiceMap(settings.hallServicePercent),
      },
      (hall ?? '').trim(),
    );
  }

  /** Yetkazish narxi: butun so'm, 0..1 000 000 */
  private feeOf(value: unknown): number {
    return Math.min(DELIVERY_FEE_MAX, Math.max(0, roundSum(value as number)));
  }

  /** Ro'yxatdagi stolga buyurtmalarning stollari (id -> stol) */
  private async tablesFor(list: OrderEntity[]): Promise<Map<string, TableEntity>> {
    const ids = [
      ...new Set(
        list
          .filter((o) => orderTypeOf(o) === OrderType.DineIn && o.tableId)
          .map((o) => o.tableId as string),
      ),
    ];
    if (ids.length === 0) return new Map();
    const rows = await this.tables.find({ where: { id: In(ids) } });
    return new Map(rows.map((t) => [t.id, t]));
  }

  /** Xodim ismlari (id -> ism) */
  private async userNamesFor(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (unique.length === 0) return new Map();
    const rows = await this.users.find({ where: { id: In(unique) } });
    return new Map(rows.map((u) => [u.id, u.name]));
  }

  /** Buyurtmalar to'lovlari (orderId -> to'lovlar, vaqt bo'yicha) */
  private async paymentsFor(orderIds: string[]): Promise<Map<string, PaymentEntity[]>> {
    const map = new Map<string, PaymentEntity[]>();
    if (orderIds.length === 0) return map;
    const rows = await this.payments.find({
      where: { orderId: In(orderIds) },
      order: { createdAt: 'ASC' },
    });
    for (const p of rows) {
      const arr = map.get(p.orderId);
      if (arr) arr.push(p);
      else map.set(p.orderId, [p]);
    }
    return map;
  }

  /**
   * CRM'dagi shu telefon raqamli mijoz (bir nechta bo'lsa — eng yangisi). Mijoz telefoni erkin
   * matn ("90 123 45 67", "+998901234567") — har biri normallashtirib solishtiriladi.
   */
  private async findCustomerByPhone(phone: string): Promise<CustomerEntity | null> {
    const rows = await this.customers.find({
      where: { phone: Not('') },
      order: { createdAt: 'DESC' },
    });
    return rows.find((c) => normalizePhone(c.phone) === phone) ?? null;
  }

  // Xodim ismi (bo'lim cheki / DTO uchun). id bo'sh bo'lsa — null
  // (TypeORM where:{id: undefined} birinchi foydalanuvchini qaytarib yuboradi).
  private async userName(id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    const user = await this.users.findOne({ where: { id } });
    return user?.name ?? null;
  }

  // Bo'lim (oshxona/bar...) printerlariga yangi taomlar cheki — FONDA ishlaydi: HTTP javobni
  // kutdirmaydi va hech qachon xato tashlamaydi. Chek avval navbatga yoziladi (B17); chiqmagan chek
  // haqidagi 'print:failed' xabarini StationPrintService hodisasi orqali OrdersGateway yuboradi
  // (bu yerda yuborilmaydi — har xabar bir marta ketadi).
  private printStationTickets(params: PrintNewItemsParams): void {
    if (params.items.length === 0) return;
    // setImmediate — javob avval jo'natilsin, chop etish undan keyin boshlansin
    setImmediate(() => {
      Promise.resolve()
        .then(() => this.stationPrint.printNewItems(params))
        .catch((e) => {
          this.logger.error(`Bo‘lim cheklarini chop etishda kutilmagan xato: ${errorText(e)}`);
        });
    });
  }
}

/** Xato matni (log uchun) */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
