import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { In, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { OrderType, orderDisplayName, orderTypeOf } from '@hardweb-pos/shared';
import type {
  Order,
  OrderItem,
  PrintFailedPayload,
  PrintJob,
  PrintJobStatus,
  PrinterStatus,
  PrintersStatusPayload,
  PrintRecoveredPayload,
} from '@hardweb-pos/shared';
import { MenuItemEntity, PrintJobEntity, StationEntity } from '../entities';
import { buildTestTicket, LATE_TICKET_MS, normalizePaperWidth } from './tickets';
import {
  formatAddress,
  LAN_TIMEOUTS,
  parsePrinterAddress,
  PrinterAddress,
  PrinterQueue,
  PrinterSendError,
  probeLanPrinter,
  sendToLanPrinter,
} from './lan-printer';
import {
  OrderTicketPayload,
  PAYLOAD_VERSION,
  PrintJobKind,
  renderJobTicket,
  VoidTicketPayload,
} from './print-job-payload';

/** Bitta bo'lim printeriga yuborish natijasi */
export interface StationPrintResult {
  stationId: string;
  station: string; // bo'lim nomi
  host: string; // printer IP
  ok: boolean;
  message: string;
}

export interface PrintNewItemsParams {
  order: Order;
  items: OrderItem[]; // FAQAT yangi qo'shilgan taomlar
  append: boolean; // true = mavjud buyurtmaga qo'shimcha ("QO'SHIMCHA")
  orderType?: OrderType; // berilmasa — order.type (stol / olib ketish / yetkazish)
  queueNumber?: number | null; // berilmasa — order.queueNumber (kunlik buyurtma raqami)
  tableNumber?: number; // faqat stolga buyurtmada
  hall?: string | null;
  checkNo?: number | null; // berilmasa — order.checkNo (stoldagi alohida hisob raqami)
  waiterName?: string | null;
}

/** OTKAZ cheki (B19): bekor qilingan taomlar — har biri o'z bo'limi printeriga */
export interface PrintVoidParams {
  orderId?: string | null;
  orderName: string; // "Stol 5" / "Olib ketish #12" (orderDisplayName)
  type?: OrderType | string | null;
  tableNumber?: number | null;
  hall?: string | null;
  checkNo?: number | null;
  queueNumber?: number | null; // berilmasa — orderName'dagi "#12" dan olinadi
  items: Array<{
    name: string;
    quantity: number;
    unit?: string | null;
    stationId?: string | null;
    stationName?: string | null;
  }>;
  reason?: string | null;
  userName?: string | null;
}

/** GET /printing/jobs qatori: shared PrintJob + chek turi ('order' | 'void') */
export type PrintJobView = PrintJob & { kind: PrintJobKind };

/** GET /printing/jobs?status= qiymatlari ('open' = pending + expired) */
export const PRINT_JOB_FILTERS = ['open', 'pending', 'expired', 'printed', 'cancelled'] as const;
export type PrintJobFilter = (typeof PRINT_JOB_FILTERS)[number];

/**
 * StationPrintService.events hodisalari (OrdersGateway ularni socket orqali hammaga tarqatadi —
 * PrintingModule OrdersModule'ni import qilmaydi):
 *  'failed'    — PrintFailedPayload: chek chiqmadi (birinchi urinish yoki 3 soatda chiqmay muddati o'tdi)
 *  'recovered' — PrintRecoveredPayload: navbatda turgan chek keyinroq chiqdi
 *  'status'    — PrintersStatusPayload: printerlar holati o'zgardi (yoqiq / javob bermayapti / navbat soni)
 */
export const PRINT_EVENTS = {
  Failed: 'failed',
  Recovered: 'recovered',
  Status: 'status',
} as const;

/** Muddati o'tgan (3 soatda chiqmagan) chek uchun kassaga xabar */
export const EXPIRED_MESSAGE = 'Chek 3 soat ichida chiqmadi — kassada qo‘lda chiqaring';
const BROKEN_PAYLOAD_MESSAGE = 'Chek ma’lumotlari buzilgan — kassada qo‘lda chiqaring';
const JOB_NOT_FOUND_MESSAGE = 'Chek topilmadi';

/** Birinchi urinish muvaffaqiyatsiz bo'lsa — shuncha kutib, yana bir marta urinamiz */
const RETRY_DELAY_MS = 1500;
/** Buyurtma cheki: 1 urinish + 1 qayta urinish */
const ORDER_TICKET_ATTEMPTS = 2;
/**
 * Sinov cheki bitta urinish bilan yuboriladi (admin javobni darhol ko'rsin; HTTP so'rov 10 s
 * ichida qaytsin). Printer boshqa chek bilan band bo'lsa navbatda ko'pi bilan shuncha kutamiz.
 */
const TEST_QUEUE_WAIT_MS = 3000;

// --- Navbat ishchisi (worker) ---
/** Server ishga tushgach birinchi o'tish (svet o'chib-yonganda navbatdagi cheklar shu payt chiqadi) */
const WORKER_FIRST_RUN_MS = 5_000;
/** Navbatdagi cheklarni qayta urinish oralig'i */
const WORKER_INTERVAL_MS = 15_000;
/** Yangi chek / printer tiklangandan keyin navbatni tekshirish (bir nechta signal bitta o'tishga birlashadi) */
const WORKER_KICK_DELAY_MS = 1_000;
/** Bir o'tishda ko'pi bilan shuncha chek ko'riladi */
const WORKER_BATCH = 200;
/** Printer xato qaytargach, ishchi unga shuncha vaqt urinmaydi (printerni "bombardimon" qilmaslik) */
const HOST_BACKOFF_MS = 8_000;
/** Shundan eski chiqmagan chek avtomatik urinishdan chiqariladi (muddati o'tdi) */
const JOB_EXPIRE_MS = 3 * 60 * 60_000;
/** Kuniga bir marta: 7 kundan eski chiqqan/bekor/muddati o'tgan cheklar o'chiriladi */
const HOUSEKEEPING_EVERY_MS = 24 * 60 * 60_000;
const HOUSEKEEPING_KEEP_MS = 7 * 24 * 60 * 60_000;
/** Kassadagi "Chiqarish" / "Hozir urinish" javobi shu vaqtdan oshmaydi (kassa so'rovi 10 s kutadi) */
const MANUAL_RETRY_WAIT_MS = 7_000;
const RETRY_ALL_WAIT_MS = 6_000;
const JOBS_LIST_LIMIT = 100;

// --- Printerlar holati (B26) ---
const MONITOR_FIRST_RUN_MS = 3_000;
const MONITOR_INTERVAL_MS = 30_000;
/** Bitta xatodan keyin tezroq qayta tekshiramiz (ikkinchi xato — "javob bermayapti") */
const MONITOR_RECHECK_MS = 5_000;
const PROBE_TIMEOUT_MS = 3_000;
/** Shuncha ketma-ket xatodan keyin printer "javob bermayapti" deb ko'rsatiladi (bitta rad — band bo'lishi mumkin) */
const OFFLINE_AFTER_FAILURES = 2;
const STATUS_DEBOUNCE_MS = 300;

interface ResolvedItem {
  stationId: string | null;
  stationName: string | null;
  name: string;
  quantity: number;
  unit: string | null;
  note: string | null;
  takeaway: boolean;
}

type SendOutcome = { ok: true } | { ok: false; message: string };

/**
 * Navbatdagi chekni yuborish natijasi. retryable: false — chekni hech qachon chop etib bo'lmaydi
 * (yozuvdagi ma'lumot buzilgan): u darhol navbatdan chiqariladi va shu printerning keyingi
 * cheklarini to'sib qo'ymaydi.
 */
type JobOutcome = { ok: true } | { ok: false; message: string; retryable: boolean };

/** Chek qaysi printerga ketadi: bo'limning HOZIRGI manzili (admin IP'ni tuzatsa — navbatdagilar ham o'sha yerga) */
interface JobTarget {
  addr: PrinterAddress;
  width: number;
  /** Manzil noto'g'ri — tarmoqqa chiqmasdan xato */
  error?: string;
}

/** Printer (host:port) holati: chek urinishlari va tekshiruvlar natijasi */
interface HostHealth {
  online: boolean | null; // null — hali aniqlanmagan
  failures: number; // ketma-ket xatolar
  lastCheckAt: Date | null;
  lastOkAt: Date | null;
  retryAfter: number; // ms — ishchi shu paytgacha bu printerni o'tkazib yuboradi
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const iso = (d: Date | null | undefined): string | null =>
  d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : null;
/** Sana -> SQLite'ning UTC matni 'YYYY-MM-DD HH:MM:SS' (datetime() bilan solishtirish uchun) */
const sqliteUtc = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

/** `p` `ms` ichida tugasa — natijasi, aks holda null (p o'z ishini davom ettiradi) */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toPrintJob(e: PrintJobEntity): PrintJobView {
  return {
    id: e.id,
    createdAt: iso(e.createdAt) ?? new Date(0).toISOString(),
    orderId: e.orderId ?? null,
    orderName: e.orderName ?? null,
    stationId: e.stationId ?? null,
    stationName: e.stationName ?? '',
    host: e.host,
    port: Number(e.port) || 0,
    append: !!e.append,
    itemsCount: Number(e.itemsCount) || 0,
    status: e.status,
    attempts: Number(e.attempts) || 0,
    lastError: e.lastError ?? null,
    lastAttemptAt: iso(e.lastAttemptAt),
    printedAt: iso(e.printedAt),
    kind: e.kind === 'void' ? 'void' : 'order',
  };
}

/**
 * Bo'lim (oshxona, bar, somsaxona...) cheklarini SERVER chop etadi: buyurtma qayerdan kelmasin
 * (terminal, telefon, oflayn navbat) — har yangi taom o'z bo'limining LAN printeriga chiqadi.
 *
 * Cheklar navbati (B17): har chek AVVAL print_jobs jadvaliga yoziladi, keyin chop etiladi. Printer
 * o'chgan / qog'ozi tugagan / svet o'chgan bo'lsa chek 'pending' bo'lib qoladi va ishchi (worker)
 * har 15 s da qayta urinadi — printer javob berishi bilan avtomatik chiqadi (server qayta ishga
 * tushganda ham). 3 soatda chiqmagan chek 'expired' bo'ladi (kassada qo'lda chiqariladi).
 * Bitta printerga (host:port) barcha ishlar — yangi chek, navbat, sinov, holat tekshiruvi — bitta
 * navbat orqali ketma-ket yuboriladi; turli printerlar parallel ishlaydi.
 */
@Injectable()
export class StationPrintService implements OnModuleInit, OnModuleDestroy {
  /** Hodisalar (PRINT_EVENTS) — OrdersGateway onModuleInit'da obuna bo'lib socket orqali tarqatadi */
  readonly events = new EventEmitter();

  private readonly logger = new Logger('StationPrint');
  private readonly queue = new PrinterQueue();
  /** Hozir chop etilayotgan (yoki navbatga qo'yilgan) cheklar — ishchi ularni ikkinchi marta olmaydi */
  private readonly inFlight = new Set<string>();
  private readonly hosts = new Map<string, HostHealth>();

  private destroyed = false;
  private workerInterval: NodeJS.Timeout | null = null;
  private workerTimer: NodeJS.Timeout | null = null;
  private workerDueAt = 0;
  private workerTail: Promise<void> = Promise.resolve();
  private workerPending: Promise<void> | null = null;
  private workerPendingForce = false;
  private lastHousekeepingAt = 0;

  private monitorInterval: NodeJS.Timeout | null = null;
  private monitorTimer: NodeJS.Timeout | null = null;
  private monitorDueAt = 0;
  private monitorRunning = false;
  private statusTimer: NodeJS.Timeout | null = null;
  private lastStatusSig = '';

  constructor(
    @InjectRepository(StationEntity)
    private readonly stations: Repository<StationEntity>,
    @InjectRepository(MenuItemEntity)
    private readonly menuItems: Repository<MenuItemEntity>,
    @InjectRepository(PrintJobEntity)
    private readonly jobs: Repository<PrintJobEntity>,
  ) {
    this.events.setMaxListeners(50);
  }

  onModuleInit() {
    // Svet o'chib-yonsa: server ko'tarilgach 5 s dan keyin navbatdagi (oxirgi 3 soatdagi) cheklar chiqariladi
    this.scheduleWorker(WORKER_FIRST_RUN_MS);
    this.workerInterval = setInterval(() => this.scheduleWorker(0), WORKER_INTERVAL_MS);
    this.workerInterval.unref?.();
    this.scheduleMonitor(MONITOR_FIRST_RUN_MS);
    this.monitorInterval = setInterval(() => this.scheduleMonitor(0), MONITOR_INTERVAL_MS);
    this.monitorInterval.unref?.();
  }

  onModuleDestroy() {
    this.destroyed = true;
    for (const t of [this.workerInterval, this.monitorInterval]) if (t) clearInterval(t);
    for (const t of [this.workerTimer, this.monitorTimer, this.statusTimer]) if (t) clearTimeout(t);
    this.workerInterval = this.monitorInterval = null;
    this.workerTimer = this.monitorTimer = this.statusTimer = null;
  }

  // =============================================================================================
  // Yangi taomlar cheki
  // =============================================================================================

  /**
   * Yangi taomlarni har biri o'z bo'limi printeriga chiqaradi. Hech qachon throw qilmaydi —
   * har bo'lim uchun BIRINCHI urinish natijasini qaytaradi (printeri yo'q bo'limlar o'tkazib
   * yuboriladi va natijaga kirmaydi). Qo'shimcha buyurtmada (append) sarlavha "* QO'SHIMCHA *".
   * Chek avval navbatga yoziladi: chiqmasa — navbatda qoladi va printer tiklanishi bilan chiqadi.
   */
  async printNewItems(params: PrintNewItemsParams): Promise<StationPrintResult[]> {
    try {
      return await this.printNewItemsUnsafe(params);
    } catch (e) {
      // Bu yerga tushmasligi kerak — har ehtimolga qarshi: chaqiruvchi hech qachon xato olmaydi
      this.logger.error(`Bo‘lim cheklarini chop etishda kutilmagan xato: ${errorText(e)}`);
      return [];
    }
  }

  private async printNewItemsUnsafe(params: PrintNewItemsParams): Promise<StationPrintResult[]> {
    const items = (params?.items ?? []).filter(Boolean);
    if (items.length === 0) return [];

    const order = params.order;
    const orderType = orderTypeOf({ type: params.orderType ?? order?.type ?? null });
    const queueNumber = params.queueNumber ?? order?.queueNumber ?? null;
    const dineIn = orderType === OrderType.DineIn;
    const tableNumber = dineIn ? params.tableNumber ?? order?.tableNumber ?? null : null;
    const checkNo = dineIn ? params.checkNo ?? order?.checkNo ?? null : null;
    const hall = dineIn ? params.hall ?? order?.hall ?? null : null;
    const waiterName = params.waiterName ?? order?.waiterName ?? null;
    const orderNote = order?.note != null ? String(order.note) : null; // chekda tozalanadi
    const append = !!params.append;
    // "Stol 5" / "Stol 5 · Hisob 2" / "Olib ketish #12" / "Yetkazish #5"
    const orderName = orderDisplayName({ type: orderType, queueNumber, tableNumber, checkNo });

    // 1) Taomlarni bo'limlar bo'yicha guruhlash (bo'limsiz taom chek chiqarmaydi)
    const groups = new Map<string, ResolvedItem[]>();
    for (const it of await this.resolveItems(items)) {
      if (!it.stationId) continue;
      const list = groups.get(it.stationId);
      if (list) list.push(it);
      else groups.set(it.stationId, [it]);
    }
    if (groups.size === 0) return [];

    // 2) Bo'limlar va ularning printerlari
    const stations = await this.loadStations(groups);
    if (!stations) {
      // Baza vaqtincha band va h.k. — kassada ogohlantirish chiqsin (jim qolmasin)
      return [...groups.entries()].map(([stationId, list]) => {
        const station = list.find((x) => x.stationName)?.stationName ?? 'Bo‘lim';
        const message = 'Bo‘lim ma’lumotlarini o‘qib bo‘lmadi (server xatosi)';
        this.emitFailed({ orderId: order?.id, tableNumber, orderName, station, host: '', message });
        return { stationId, station, host: '', ok: false, message };
      });
    }

    // 3) Har bo'lim printeriga bitta chek — avval navbatga yoziladi
    const createdAt = new Date();
    const prepared: Array<{ job: PrintJobEntity; target: JobTarget }> = [];
    for (const st of stations) {
      const list = groups.get(st.id);
      if (!list?.length) continue;
      const addr = parsePrinterAddress(st.printerHost, st.printerPort);
      if (!addr.host) continue; // printer sozlanmagan — bu bo'limga chek chiqmaydi (xato emas)
      const payload: OrderTicketPayload = {
        v: PAYLOAD_VERSION,
        kind: 'order',
        stationName: st.name,
        orderType,
        queueNumber,
        tableNumber,
        hall,
        checkNo,
        orderTime: createdAt.toISOString(),
        append,
        waiterName,
        orderNote,
        items: list.map((x) => ({
          name: x.name,
          quantity: x.quantity,
          unit: x.unit,
          note: x.note,
          takeaway: x.takeaway,
        })),
      };
      prepared.push({
        job: this.newJob({
          createdAt,
          orderId: order?.id ?? null,
          orderName,
          station: st,
          addr,
          append,
          kind: 'order',
          payload: payload as unknown as Record<string, unknown>,
          itemsCount: list.length,
        }),
        target: { addr, width: normalizePaperWidth(st.printerWidth), error: addr.error },
      });
    }
    if (prepared.length === 0) return [];
    const persisted = await this.persistJobs(prepared.map((p) => p.job));

    // 4) Har bo'lim printeriga — parallel (bitta printerga navbat bilan). 1 urinish + 1 qayta urinish
    const results = await Promise.all(
      prepared.map(async ({ job, target }): Promise<StationPrintResult> => {
        const where = formatAddress(target.addr);
        const base = { stationId: job.stationId ?? '', station: job.stationName, host: target.addr.host };
        const out = await this.deliverJob(job, target, ORDER_TICKET_ATTEMPTS, 'first', persisted);
        if (out.ok) {
          this.logger.log(
            `${job.stationName}: ${job.itemsCount} ta taom chop etildi (${where}) — ${orderName}` +
              (append ? ', qo‘shimcha' : ''),
          );
          return { ...base, ok: true, message: `Chek printerga yuborildi (${where})` };
        }
        this.logger.warn(
          `${job.stationName}: chek chiqmadi (${orderName}) — ${out.message}` +
            (persisted ? ' — navbatda, printer tiklanishi bilan chiqadi' : ''),
        );
        this.emitFailed({
          orderId: order?.id,
          tableNumber,
          orderName,
          station: job.stationName,
          host: target.addr.host,
          message: out.message,
        });
        return { ...base, ok: false, message: out.message };
      }),
    );
    // Printer tiklangan bo'lishi mumkin — navbatdagi eski cheklarni ham tekshiramiz
    this.scheduleWorker(WORKER_KICK_DELAY_MS);
    return results;
  }

  /**
   * Har taom uchun bo'lim va chekdagi ko'rinish. Asosiy manba — buyurtma paytidagi snapshot
   * (order_items.station_id / station_name). Snapshot umuman berilmagan bo'lsa (stationId
   * undefined) yoki nomi yo'q bo'lsa — menyudagi taomdan olinadi. stationId = null — taom
   * bo'limsiz ("chek chiqmaydi").
   */
  private async resolveItems(items: OrderItem[]): Promise<ResolvedItem[]> {
    const lookupIds = [
      ...new Set(
        items
          .filter((it) => it.stationId === undefined || !it.menuItemName)
          .map((it) => it.menuItemId)
          .filter(Boolean),
      ),
    ];
    const menuById = new Map<string, MenuItemEntity>();
    if (lookupIds.length) {
      try {
        // Rasm (base64) ustunini o'qimaymiz — faqat kerakli maydonlar
        const rows = await this.menuItems.find({
          where: { id: In(lookupIds) },
          select: { id: true, name: true, unit: true, stationId: true },
        });
        for (const m of rows) menuById.set(m.id, m);
      } catch (e) {
        this.logger.warn(`Taomlarning bo‘limini menyudan aniqlab bo‘lmadi: ${errorText(e)}`);
      }
    }

    return items.map((it) => {
      const mi = menuById.get(it.menuItemId);
      const stationId = it.stationId !== undefined ? it.stationId : mi?.stationId ?? null;
      const q = Number(it.quantity);
      return {
        stationId: stationId || null,
        stationName: it.stationName ?? null,
        name: it.menuItemName || mi?.name || 'Taom',
        quantity: Number.isFinite(q) ? q : 0,
        unit: it.unit ?? mi?.unit ?? null,
        note: it.note != null && String(it.note).trim() ? String(it.note) : null, // chekda tozalanadi
        takeaway: it.takeaway === true,
      };
    });
  }

  // =============================================================================================
  // OTKAZ cheki (B19)
  // =============================================================================================

  /**
   * Otkaz qilingan taomlar — har bo'lim printeriga "*** OTKAZ ***" cheki (oshxona tayyorlamasin).
   * Navbat orqali (chiqmasa — printer tiklanishi bilan chiqadi, 3 soatda muddati o'tadi).
   * Fonda chaqiriladi: hech qachon throw qilmaydi.
   */
  async printVoid(params: PrintVoidParams): Promise<void> {
    try {
      await this.printVoidUnsafe(params);
    } catch (e) {
      this.logger.error(`OTKAZ chekini chop etishda kutilmagan xato: ${errorText(e)}`);
    }
  }

  private async printVoidUnsafe(params: PrintVoidParams): Promise<void> {
    const items = (params?.items ?? []).filter((it) => it && it.stationId && Number(it.quantity) > 0);
    if (items.length === 0) return;
    const orderType = orderTypeOf({ type: params.type });
    const dineIn = orderType === OrderType.DineIn;
    const orderName = String(params.orderName || '').trim() || 'Buyurtma';
    // Kunlik buyurtma raqami: berilmasa — "Olib ketish #12" nomidan
    const fromName = /#(\d+)/.exec(orderName);
    const queueNumber = params.queueNumber ?? (fromName ? Number(fromName[1]) : null);

    const groups = new Map<string, PrintVoidParams['items']>();
    for (const it of items) {
      const list = groups.get(it.stationId!);
      if (list) list.push(it);
      else groups.set(it.stationId!, [it]);
    }
    const stations = await this.stations.find({ where: { id: In([...groups.keys()]) } });
    stations.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));

    const createdAt = new Date();
    const prepared: Array<{ job: PrintJobEntity; target: JobTarget }> = [];
    for (const st of stations) {
      const list = groups.get(st.id);
      const addr = parsePrinterAddress(st.printerHost, st.printerPort);
      if (!list?.length || !addr.host) continue;
      const payload: VoidTicketPayload = {
        v: PAYLOAD_VERSION,
        kind: 'void',
        stationName: st.name,
        orderType,
        queueNumber,
        tableNumber: dineIn ? params.tableNumber ?? null : null,
        hall: dineIn ? params.hall ?? null : null,
        checkNo: dineIn ? params.checkNo ?? null : null,
        orderTime: createdAt.toISOString(),
        reason: params.reason?.trim() || null,
        userName: params.userName?.trim() || null,
        items: list.map((it) => ({
          name: String(it.name || 'Taom'),
          quantity: Number(it.quantity),
          unit: it.unit ?? null,
        })),
      };
      prepared.push({
        job: this.newJob({
          createdAt,
          orderId: params.orderId ?? null,
          orderName,
          station: st,
          addr,
          append: false,
          kind: 'void',
          payload: payload as unknown as Record<string, unknown>,
          itemsCount: list.length,
        }),
        target: { addr, width: normalizePaperWidth(st.printerWidth), error: addr.error },
      });
    }
    if (prepared.length === 0) return;
    const persisted = await this.persistJobs(prepared.map((p) => p.job));

    await Promise.all(
      prepared.map(async ({ job, target }) => {
        const out = await this.deliverJob(job, target, ORDER_TICKET_ATTEMPTS, 'first', persisted);
        if (out.ok) {
          this.logger.log(`${job.stationName}: OTKAZ cheki chiqdi (${formatAddress(target.addr)}) — ${orderName}`);
          return;
        }
        this.logger.warn(`${job.stationName}: OTKAZ cheki chiqmadi (${orderName}) — ${out.message}`);
        this.emitFailed({
          orderId: params.orderId ?? undefined,
          tableNumber: dineIn ? params.tableNumber ?? null : null,
          orderName,
          station: job.stationName,
          host: target.addr.host,
          message: `OTKAZ cheki: ${out.message}`,
        });
      }),
    );
    this.scheduleWorker(WORKER_KICK_DELAY_MS);
  }

  // =============================================================================================
  // Sinov cheki
  // =============================================================================================

  /** Bo'lim printerini sinash (Bo'limlar -> "Sinov" tugmasi). Hech qachon throw qilmaydi. */
  async testPrint(stationId: string): Promise<StationPrintResult> {
    try {
      const st = stationId ? await this.stations.findOne({ where: { id: stationId } }) : null;
      if (!st) {
        return { stationId, station: '', host: '', ok: false, message: 'Bo‘lim topilmadi' };
      }
      const addr = parsePrinterAddress(st.printerHost, st.printerPort);
      const base = { stationId: st.id, station: st.name, host: addr.host };
      if (!addr.host) {
        return { ...base, ok: false, message: 'Bo‘lim printeri sozlanmagan — printer IP manzilini kiriting' };
      }
      if (addr.error) return { ...base, ok: false, message: addr.error };

      const where = formatAddress(addr);
      const data = buildTestTicket({
        width: st.printerWidth,
        stationName: st.name,
        address: where,
        printedAt: new Date(),
      });
      const out = await this.deliverTest(st.name, addr, data);
      if (out.ok) {
        this.logger.log(`${st.name}: sinov cheki yuborildi (${where})`);
        return { ...base, ok: true, message: `Sinov cheki printerga yuborildi (${where})` };
      }
      this.logger.warn(`${st.name}: sinov cheki chiqmadi — ${out.message}`);
      return { ...base, ok: false, message: out.message };
    } catch (e) {
      this.logger.error(`Sinov chekida kutilmagan xato: ${errorText(e)}`);
      return {
        stationId,
        station: '',
        host: '',
        ok: false,
        message: `Sinov chekini yuborib bo‘lmadi: ${errorText(e)}`,
      };
    }
  }

  /**
   * Sinov chekini yuborish: printer boshqa chek bilan band bo'lsa navbatda ko'pi bilan
   * TEST_QUEUE_WAIT_MS kutamiz; navbat kelmasa — sinov bekor qilinadi (keyin chiqib qolmaydi).
   */
  private async deliverTest(label: string, addr: PrinterAddress, data: Buffer): Promise<SendOutcome> {
    const key = PrinterQueue.keyOf(addr);
    const othersQueued = this.queue.isBusy(key);
    let started = false;
    let cancelled = false;
    const job = this.queue
      .run(key, async (): Promise<SendOutcome> => {
        if (cancelled) return { ok: false, message: 'bekor qilindi' };
        started = true;
        const r = await this.sendWithRetry(label, addr, data, 1);
        this.noteHost(key, r.outcome);
        return r.outcome;
      })
      .catch((e): SendOutcome => ({
        ok: false,
        message: `Printer xatosi (${formatAddress(addr)}): ${errorText(e)}`,
      }));
    if (!othersQueued) return job;

    const waited = new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), TEST_QUEUE_WAIT_MS);
      void job.finally(() => clearTimeout(timer));
    });
    const first = await Promise.race([job, waited]);
    if (first) return first;
    if (started) return job; // navbat keldi, yuborilmoqda — natijasini kutamiz
    cancelled = true;
    return {
      ok: false,
      message: `Bu printerga hozir boshqa chek yuborilmoqda (${formatAddress(addr)}) — birozdan so‘ng qayta urinib ko‘ring`,
    };
  }

  // =============================================================================================
  // Navbat (outbox): yozish, yuborish, natijani saqlash
  // =============================================================================================

  private newJob(p: {
    createdAt: Date;
    orderId: string | null;
    orderName: string;
    station: StationEntity;
    addr: PrinterAddress;
    append: boolean;
    kind: PrintJobKind;
    payload: Record<string, unknown>;
    itemsCount: number;
  }): PrintJobEntity {
    const job = this.jobs.create({
      id: randomUUID(),
      createdAt: p.createdAt,
      orderId: p.orderId,
      orderName: p.orderName,
      stationId: p.station.id,
      stationName: p.station.name,
      host: p.addr.host,
      port: p.addr.port,
      width: normalizePaperWidth(p.station.printerWidth),
      append: p.append,
      kind: p.kind,
      payload: p.payload,
      itemsCount: p.itemsCount,
      status: 'pending',
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
      printedAt: null,
    });
    // Bazaga yozilishidan OLDIN band qilinadi — ishchi bu chekni parallel olib qo'ymasin
    this.inFlight.add(job.id);
    return job;
  }

  /**
   * Cheklarni navbatga yozish — bitta INSERT (bitta tranzaksiya: hammasi yoziladi yoki hech biri).
   * Baza xato bersa ham chek baribir chop etiladi (navbatsiz — eski usulda), false qaytadi.
   */
  private async persistJobs(rows: PrintJobEntity[]): Promise<boolean> {
    try {
      // MUHIM: qatorlar BITTALAB yoziladi (bitta tranzaksiyada). Ko'p qatorli insert'da SQLite uchun
      // TypeORM standart qiymatli ustunlarni (created_at, status, port…) "WHERE id IN (…)" bilan qayta
      // o'qib, obyektlarga massiv TARTIBI bo'yicha yozadi — qatorlar UUID tartibida qaytgani uchun
      // qiymatlar boshqa chekka tushib, chek boshqa bo'lim printeriga chiqishi mumkin edi.
      // payload (simple-json) — oddiy obyekt; TypeORM'ning chuqur partial turi uni tanimaydi
      await this.jobs.manager.transaction(async (m) => {
        for (const row of rows) {
          await m.insert(PrintJobEntity, row as unknown as QueryDeepPartialEntity<PrintJobEntity>);
        }
      });
      return true;
    } catch (e) {
      this.logger.error(
        `Cheklarni navbatga yozib bo‘lmadi — navbatsiz chop etiladi (chiqmasa qayta urinilmaydi): ${errorText(e)}`,
      );
      return false;
    }
  }

  /** Bo'limlar (tartib bilan); topilmaganlari jurnalga yoziladi. Baza xatosi — null. */
  private async loadStations(groups: Map<string, ResolvedItem[]>): Promise<StationEntity[] | null> {
    let rows: StationEntity[];
    try {
      rows = await this.stations.find({ where: { id: In([...groups.keys()]) } });
    } catch (e) {
      this.logger.error(`Bo‘limlarni o‘qib bo‘lmadi: ${errorText(e)}`);
      return null;
    }
    const found = new Set(rows.map((s) => s.id));
    for (const [stationId, list] of groups) {
      if (found.has(stationId)) continue;
      const name = list.find((x) => x.stationName)?.stationName ?? stationId;
      this.logger.warn(
        `Bo‘lim topilmadi (o‘chirilgan bo‘lishi mumkin): ${name} — ${list.length} ta taom chop etilmadi`,
      );
    }
    rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
    return rows;
  }

  /**
   * Navbatdagi chekni bir marta (attempts urinish bilan) yuborish va natijani bazaga yozish.
   * Chek printerga navbati kelgan PAYTDA quriladi — kechiksa "KECHIKKAN CHEK" qatori qo'shiladi.
   * mode: 'first' — yangi chekning birinchi yuborilishi; 'retry' — ishchi yoki kassadagi "Chiqarish".
   * Hech qachon reject qilmaydi.
   */
  private async deliverJob(
    job: PrintJobEntity,
    target: JobTarget,
    attempts: number,
    mode: 'first' | 'retry',
    persisted = true,
  ): Promise<JobOutcome> {
    this.inFlight.add(job.id);
    try {
      const key = PrinterQueue.keyOf(target.addr);
      let tries = 0;
      let outcome: JobOutcome;
      if (target.error) {
        tries = 1;
        outcome = { ok: false, message: target.error, retryable: true };
      } else {
        outcome = await this.queue
          .run(key, async (): Promise<JobOutcome> => {
            const data = renderJobTicket(job, target.width, new Date());
            if (!data) {
              tries = 1;
              return { ok: false, message: BROKEN_PAYLOAD_MESSAGE, retryable: false };
            }
            const r = await this.sendWithRetry(job.stationName, target.addr, data, attempts);
            tries = r.tries;
            this.noteHost(key, r.outcome);
            return r.outcome.ok ? r.outcome : { ...r.outcome, retryable: true };
          })
          .catch((e): JobOutcome => {
            tries = Math.max(tries, 1);
            return {
              ok: false,
              message: `Printer xatosi (${formatAddress(target.addr)}): ${errorText(e)}`,
              retryable: true,
            };
          });
      }
      if (persisted) await this.recordOutcome(job, target, outcome, tries, mode);
      return outcome;
    } finally {
      this.inFlight.delete(job.id);
    }
  }

  /** Urinish natijasini bazaga yozish; navbatdan kechikib chiqqan chek uchun 'recovered' hodisasi */
  private async recordOutcome(
    job: PrintJobEntity,
    target: JobTarget,
    outcome: JobOutcome,
    tries: number,
    mode: 'first' | 'retry',
  ): Promise<void> {
    const now = new Date();
    const attemptsSql = () => `attempts + ${Math.max(1, Math.floor(tries))}`;
    try {
      if (outcome.ok) {
        // Haqiqatda chiqdi — holat qanday bo'lmasin (hatto shu payt bekor qilingan bo'lsa ham) 'printed'
        await this.jobs.update(
          { id: job.id },
          {
            status: 'printed',
            printedAt: now,
            lastAttemptAt: now,
            attempts: attemptsSql,
            lastError: null,
            host: target.addr.host,
            port: target.addr.port,
          },
        );
      } else {
        // Bekor qilingan chek "tirilmasin" — faqat hali ochiq (pending/expired) bo'lsa yangilanadi.
        // Ma'lumoti buzilgan chek hech qachon chiqmaydi — darhol 'expired' (kassada ko'rinadi).
        await this.jobs.update(
          { id: job.id, status: In(['pending', 'expired']) },
          {
            ...(outcome.retryable ? {} : { status: 'expired' as const }),
            lastAttemptAt: now,
            attempts: attemptsSql,
            lastError: outcome.message,
            host: target.addr.host,
            port: target.addr.port,
          },
        );
      }
    } catch (e) {
      this.logger.error(`Chek holatini yozib bo‘lmadi (${job.stationName}, ${job.orderName ?? '-'}): ${errorText(e)}`);
    }

    if (mode === 'first') {
      if (!outcome.ok) this.refreshStatusSoon(); // navbatdagi cheklar soni ko'paydi
      return;
    }
    if (!outcome.ok && !outcome.retryable) {
      this.logger.error(`Navbat: ${job.stationName} — ${job.orderName ?? 'chek'}: ${outcome.message} — navbatdan chiqarildi`);
      this.emitFailed({
        orderId: job.orderId ?? undefined,
        tableNumber: this.payloadTableNumber(job),
        orderName: job.orderName ?? undefined,
        station: job.stationName,
        host: target.addr.host,
        message: outcome.message,
      });
      this.refreshStatusSoon();
      return;
    }
    const createdAt = job.createdAt instanceof Date ? job.createdAt.getTime() : now.getTime();
    const delayedMs = Math.max(0, now.getTime() - createdAt);
    if (outcome.ok) {
      this.logger.log(
        `Navbat: ${job.stationName} — ${job.orderName ?? 'chek'} chiqdi` +
          ` (${Math.round(delayedMs / 1000)} s kechikib, ${formatAddress(target.addr)})`,
      );
      // Avval chiqmagan (yoki server qayta ishga tushgani uchun kechikkan) chek endi chiqdi
      if (job.attempts > 0 || delayedMs >= LATE_TICKET_MS) {
        this.emit(PRINT_EVENTS.Recovered, {
          jobId: job.id,
          orderId: job.orderId ?? null,
          orderName: job.orderName ?? null,
          station: job.stationName,
          host: target.addr.host,
          delayedSeconds: Math.round(delayedMs / 1000),
        } satisfies PrintRecoveredPayload);
      }
    } else {
      this.logger.warn(
        `Navbat: ${job.stationName} — ${job.orderName ?? 'chek'} chiqmadi (${job.attempts + tries}-urinish): ${outcome.message}`,
      );
    }
    this.refreshStatusSoon();
  }

  /** attempts marta urinib yuborish (urinishlar orasida RETRY_DELAY_MS). Hech qachon reject qilmaydi. */
  private async sendWithRetry(
    label: string,
    addr: PrinterAddress,
    data: Buffer,
    attempts: number,
  ): Promise<{ outcome: SendOutcome; tries: number }> {
    for (let attempt = 1; ; attempt++) {
      try {
        await sendToLanPrinter(addr, data, LAN_TIMEOUTS);
        if (attempt > 1) {
          this.logger.log(`${label}: ${attempt}-urinishda yuborildi (${formatAddress(addr)})`);
        }
        return { outcome: { ok: true }, tries: attempt };
      } catch (e) {
        const message =
          e instanceof PrinterSendError
            ? e.message
            : `Printer xatosi (${formatAddress(addr)}): ${errorText(e)}`;
        if (attempt >= attempts) return { outcome: { ok: false, message }, tries: attempt };
        this.logger.warn(`${label}: ${message} — ${RETRY_DELAY_MS / 1000} s dan so‘ng qayta urinamiz`);
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  /** Chek qayerga ketadi: bo'limning hozirgi printeri; bo'lim o'chirilgan/printersiz bo'lsa — yozuvdagi manzil */
  private targetFor(job: PrintJobEntity, station: StationEntity | null | undefined): JobTarget {
    if (station) {
      const addr = parsePrinterAddress(station.printerHost, station.printerPort);
      if (addr.host) {
        return { addr, width: normalizePaperWidth(station.printerWidth), error: addr.error };
      }
    }
    const addr = parsePrinterAddress(job.host, job.port);
    if (!addr.host) {
      return { addr: { host: '', port: Number(job.port) || 9100 }, width: 48, error: 'Bo‘lim printeri sozlanmagan' };
    }
    return { addr, width: normalizePaperWidth(job.width), error: addr.error };
  }

  // =============================================================================================
  // Navbat ishchisi (worker)
  // =============================================================================================

  /** Ishchini `delayMs` dan keyin ishga tushirish (oldinroq rejalashtirilgan bo'lsa — o'zgarmaydi) */
  private scheduleWorker(delayMs: number): void {
    if (this.destroyed) return;
    const due = Date.now() + Math.max(0, delayMs);
    if (this.workerTimer) {
      if (this.workerDueAt <= due) return;
      clearTimeout(this.workerTimer);
    }
    this.workerDueAt = due;
    this.workerTimer = setTimeout(() => {
      this.workerTimer = null;
      void this.runWorker();
    }, Math.max(0, delayMs));
    this.workerTimer.unref?.();
  }

  /**
   * Ishchining bitta o'tishi. O'tishlar ketma-ket bajariladi; o'tish davomida kelgan so'rovlar
   * BITTA keyingi o'tishga birlashadi. force — printerlarning "kutish" vaqtini e'tiborsiz qoldirish
   * (kassadagi "Hozir urinish"). Qaytgan promise shu o'tish tugaganda bajariladi; hech qachon reject qilmaydi.
   */
  private runWorker(force = false): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (force) this.workerPendingForce = true;
    if (this.workerPending) return this.workerPending;
    const pass = this.workerTail.then(() => {
      this.workerPending = null; // shu o'tish boshlandi — keyingi so'rovlar yangi o'tish ochadi
      const f = this.workerPendingForce;
      this.workerPendingForce = false;
      return this.workerPass(f);
    });
    this.workerPending = pass;
    this.workerTail = pass.catch(() => undefined);
    return pass;
  }

  private async workerPass(force: boolean): Promise<void> {
    if (this.destroyed) return;
    try {
      const now = Date.now();
      await this.housekeepingIfDue(now);

      const pending = await this.jobs.find({
        where: { status: 'pending' },
        order: { createdAt: 'ASC' },
        take: WORKER_BATCH,
      });
      if (pending.length === 0) return;

      const stationIds = [...new Set(pending.map((j) => j.stationId).filter((id): id is string => !!id))];
      const stationsById = new Map<string, StationEntity>();
      if (stationIds.length) {
        for (const st of await this.stations.find({ where: { id: In(stationIds) } })) stationsById.set(st.id, st);
      }

      // Printer (host:port) bo'yicha guruhlar — eng eskisidan boshlab
      const byHost = new Map<string, Array<{ job: PrintJobEntity; target: JobTarget }>>();
      const expireBefore = now - JOB_EXPIRE_MS;
      for (const job of pending) {
        if (this.inFlight.has(job.id)) continue;
        const created = job.createdAt instanceof Date ? job.createdAt.getTime() : now;
        if (created < expireBefore) {
          await this.expireJob(job);
          continue;
        }
        const target = this.targetFor(job, job.stationId ? stationsById.get(job.stationId) : null);
        // Manzili noto'g'ri bo'lim — o'z guruhi (birinchi xatodan keyin o'tishda qolganlari kutadi)
        const key = target.error ? `!${job.stationId ?? job.id}` : PrinterQueue.keyOf(target.addr);
        const list = byHost.get(key);
        if (list) list.push({ job, target });
        else byHost.set(key, [{ job, target }]);
      }
      await Promise.all([...byHost.entries()].map(([key, list]) => this.drainHost(key, list, force)));
    } catch (e) {
      this.logger.error(`Chek navbatini qayta ishlashda xato: ${errorText(e)}`);
    }
  }

  /**
   * Bitta printerning navbatdagi cheklari — eng eskisidan, ketma-ket. Birinchi xatodan keyin shu
   * printerga bu o'tishda boshqa urinilmaydi (printer o'chgan bo'lsa har chekka bittadan kutmaslik).
   */
  private async drainHost(
    key: string,
    list: Array<{ job: PrintJobEntity; target: JobTarget }>,
    force: boolean,
  ): Promise<void> {
    if (!force && !key.startsWith('!') && (this.hosts.get(key)?.retryAfter ?? 0) > Date.now()) return;
    for (const { job, target } of list) {
      if (this.destroyed) return;
      if (this.inFlight.has(job.id)) continue;
      const out = await this.deliverJob(job, target, 1, 'retry');
      // Printer javob bermadi — shu o'tishda unga boshqa urinilmaydi. Buzilgan yozuv esa
      // (retryable: false) navbatdan chiqarildi — keyingi cheklar davom etadi.
      if (!out.ok && out.retryable) return;
    }
  }

  /** Navbat yozuvidagi stol raqami (faqat stolga buyurtmada) — 'failed' xabari uchun */
  private payloadTableNumber(job: PrintJobEntity): number | null {
    const p = job.payload as { orderType?: unknown; tableNumber?: unknown } | null;
    const dineIn = orderTypeOf({ type: typeof p?.orderType === 'string' ? p.orderType : null }) === OrderType.DineIn;
    const n = Number(p?.tableNumber);
    return dineIn && p?.tableNumber != null && Number.isInteger(n) ? n : null;
  }

  /** 3 soatda chiqmagan chek — avtomatik urinish to'xtaydi, kassaga xabar */
  private async expireJob(job: PrintJobEntity): Promise<void> {
    try {
      const res = await this.jobs.update({ id: job.id, status: 'pending' }, { status: 'expired' });
      if (res.affected === 0) return; // shu payt boshqa yo'l bilan chiqqan/bekor qilingan
    } catch (e) {
      this.logger.error(`Chek muddatini yozib bo‘lmadi: ${errorText(e)}`);
      return;
    }
    this.logger.warn(
      `Navbat: ${job.stationName} — ${job.orderName ?? 'chek'} 3 soat ichida chiqmadi (${job.attempts} ta urinish) — muddati o‘tdi`,
    );
    this.emitFailed({
      orderId: job.orderId ?? undefined,
      tableNumber: this.payloadTableNumber(job),
      orderName: job.orderName ?? undefined,
      station: job.stationName,
      host: job.host,
      message: EXPIRED_MESSAGE,
    });
    this.refreshStatusSoon();
  }

  /** Kuniga bir marta: 7 kundan eski chiqqan / bekor qilingan / muddati o'tgan cheklarni o'chirish */
  private async housekeepingIfDue(now: number): Promise<void> {
    if (now - this.lastHousekeepingAt < HOUSEKEEPING_EVERY_MS) return;
    this.lastHousekeepingAt = now;
    try {
      const res = await this.jobs
        .createQueryBuilder()
        .delete()
        .from(PrintJobEntity)
        .where('status IN (:...done)', { done: ['printed', 'cancelled', 'expired'] })
        .andWhere('datetime(created_at) < datetime(:cutoff)', { cutoff: sqliteUtc(new Date(now - HOUSEKEEPING_KEEP_MS)) })
        .execute();
      if (res.affected) this.logger.log(`Chek navbati tozalandi: 7 kundan eski ${res.affected} ta yozuv o‘chirildi`);
    } catch (e) {
      this.logger.warn(`Chek navbatini tozalab bo‘lmadi: ${errorText(e)}`);
    }
  }

  // =============================================================================================
  // Kassa uchun REST amallari (GET /printing/jobs, retry, cancel, retry-all)
  // =============================================================================================

  /** Navbatdagi cheklar (yangisi birinchi, ko'pi bilan 100 ta). 'open' — chiqmagan (pending + expired). */
  async listJobs(filter: PrintJobFilter = 'open'): Promise<PrintJobView[]> {
    const statuses: PrintJobStatus[] = filter === 'open' ? ['pending', 'expired'] : [filter];
    const rows = await this.jobs.find({
      // payload (taomlar ro'yxati) ro'yxatda kerak emas
      select: {
        id: true,
        createdAt: true,
        orderId: true,
        orderName: true,
        stationId: true,
        stationName: true,
        host: true,
        port: true,
        width: true,
        append: true,
        kind: true,
        itemsCount: true,
        status: true,
        attempts: true,
        lastError: true,
        lastAttemptAt: true,
        printedAt: true,
      },
      where: { status: In(statuses) },
      order: { createdAt: 'DESC' },
      take: JOBS_LIST_LIMIT,
    });
    return rows.map(toPrintJob);
  }

  /**
   * Chekni hozir chiqarish (kassadagi "Chiqarish"): navbatdagi yoki muddati o'tgan chek.
   * Printer boshqa cheklar bilan band bo'lsa ko'pi bilan ~7 s kutiladi — chek baribir navbatda qoladi.
   */
  async retryJob(id: string): Promise<{ ok: boolean; message: string }> {
    const job = await this.jobs.findOne({ where: { id } });
    if (!job) throw new NotFoundException(JOB_NOT_FOUND_MESSAGE);
    if (job.status === 'cancelled') throw new BadRequestException('Bekor qilingan chek');
    if (job.status === 'printed') throw new BadRequestException('Bu chek allaqachon chiqarilgan');
    if (this.inFlight.has(job.id)) {
      return { ok: false, message: 'Chek hozir printerga yuborilmoqda — birozdan so‘ng ro‘yxatni yangilang' };
    }
    const station = job.stationId ? await this.stations.findOne({ where: { id: job.stationId } }) : null;
    const target = this.targetFor(job, station);
    const out = await withTimeout(this.deliverJob(job, target, 1, 'retry'), MANUAL_RETRY_WAIT_MS);
    if (!out) {
      return { ok: false, message: 'Printer hozir band — chek navbatda turibdi, navbati kelishi bilan chiqadi' };
    }
    if (out.ok) {
      this.scheduleWorker(WORKER_KICK_DELAY_MS); // printer ishlayapti — qolgan cheklari ham chiqsin
      return { ok: true, message: `Chek chiqarildi (${formatAddress(target.addr)})` };
    }
    return { ok: false, message: out.message };
  }

  /** Chekni bekor qilish (oshxonaga og'zaki aytilgan / qo'lda chiqarilgan) */
  async cancelJob(id: string): Promise<{ ok: true }> {
    const job = await this.jobs.findOne({
      where: { id },
      select: { id: true, status: true, stationName: true, orderName: true },
    });
    if (!job) throw new NotFoundException(JOB_NOT_FOUND_MESSAGE);
    if (job.status === 'printed') throw new BadRequestException('Bu chek allaqachon chiqarilgan');
    if (job.status !== 'cancelled') {
      await this.jobs.update({ id, status: In(['pending', 'expired']) }, { status: 'cancelled' });
      this.logger.log(`Navbat: ${job.stationName} — ${job.orderName ?? 'chek'} bekor qilindi (kassa)`);
      this.refreshStatusSoon();
    }
    return { ok: true };
  }

  /** Navbatdagi barcha cheklarni hozir urinish ("Hozir urinish"); javobda qolgan navbat soni */
  async retryAll(): Promise<{ ok: true; pending: number }> {
    await withTimeout(this.runWorker(true), RETRY_ALL_WAIT_MS);
    const pending = await this.jobs.count({ where: { status: 'pending' } });
    return { ok: true, pending };
  }

  // =============================================================================================
  // Printerlar holati (B26)
  // =============================================================================================

  /** Bo'lim printerlari holati (holat qatori uchun). Printeri sozlanmagan bo'limlar kirmaydi. */
  async getPrinterStatus(): Promise<PrinterStatus[]> {
    const stations = await this.stations.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
    const counts = new Map<string, number>();
    const rows = await this.jobs
      .createQueryBuilder('j')
      .select('j.station_id', 'stationId')
      .addSelect('COUNT(*)', 'n')
      .where('j.status IN (:...open)', { open: ['pending', 'expired'] })
      .groupBy('j.station_id')
      .getRawMany<{ stationId: string | null; n: number | string }>();
    for (const r of rows) if (r.stationId) counts.set(r.stationId, Number(r.n) || 0);

    const out: PrinterStatus[] = [];
    for (const st of stations) {
      const addr = parsePrinterAddress(st.printerHost, st.printerPort);
      if (!addr.host) continue;
      const h = addr.error ? null : this.hosts.get(PrinterQueue.keyOf(addr));
      // Aniqlanmagan holat (hali tekshirilmagan yoki faqat bitta xato) — lastCheckAt: null ("tekshirilmoqda")
      const settled = !!h && h.online !== null;
      out.push({
        stationId: st.id,
        stationName: st.name,
        host: addr.host,
        port: addr.port,
        online: addr.error ? false : h?.online ?? true,
        lastCheckAt: addr.error ? new Date().toISOString() : settled ? iso(h!.lastCheckAt) : null,
        lastOkAt: iso(h?.lastOkAt),
        pendingJobs: counts.get(st.id) ?? 0,
      });
    }
    return out;
  }

  private scheduleMonitor(delayMs: number): void {
    if (this.destroyed) return;
    const due = Date.now() + Math.max(0, delayMs);
    if (this.monitorTimer) {
      if (this.monitorDueAt <= due) return;
      clearTimeout(this.monitorTimer);
    }
    this.monitorDueAt = due;
    this.monitorTimer = setTimeout(() => {
      this.monitorTimer = null;
      void this.monitorPass();
    }, Math.max(0, delayMs));
    this.monitorTimer.unref?.();
  }

  /**
   * Har ~30 s: har printerga TCP ulanib darhol uziladi (bayt yuborilmaydi). Tekshiruv shu
   * printerning chek navbati orqali o'tadi — chek chop etilayotgan paytga to'g'ri kelmaydi.
   */
  private async monitorPass(): Promise<void> {
    if (this.destroyed || this.monitorRunning) return;
    this.monitorRunning = true;
    try {
      const stations = await this.stations.find();
      const targets = new Map<string, PrinterAddress>();
      for (const st of stations) {
        const addr = parsePrinterAddress(st.printerHost, st.printerPort);
        if (addr.host && !addr.error) targets.set(PrinterQueue.keyOf(addr), addr);
      }
      // Sozlamadan olib tashlangan printerlar holatini unutamiz
      for (const key of [...this.hosts.keys()]) if (!targets.has(key)) this.hosts.delete(key);
      await Promise.all([...targets.entries()].map(([key, addr]) => this.probeHost(key, addr)));
      if ([...targets.keys()].some((k) => this.hosts.get(k)?.failures === 1)) {
        this.scheduleMonitor(MONITOR_RECHECK_MS);
      }
    } catch (e) {
      this.logger.warn(`Printerlar holatini tekshirib bo‘lmadi: ${errorText(e)}`);
    } finally {
      this.monitorRunning = false;
      this.refreshStatusSoon();
    }
  }

  private async probeHost(key: string, addr: PrinterAddress): Promise<void> {
    // Shu payt chek chop etilmoqda — uning natijasi holatni o'zi yangilaydi
    if (this.queue.isBusy(key)) return;
    const r = await this.queue
      .run(key, () => probeLanPrinter(addr, PROBE_TIMEOUT_MS))
      .catch((e): SendOutcome => ({ ok: false, message: errorText(e) }));
    this.noteHost(key, r);
  }

  /** Printer javobini qayd etish (chek urinishi yoki tekshiruv). 2 ketma-ket xato — "javob bermayapti". */
  private noteHost(key: string, outcome: SendOutcome): void {
    const now = new Date();
    let h = this.hosts.get(key);
    if (!h) {
      h = { online: null, failures: 0, lastCheckAt: null, lastOkAt: null, retryAfter: 0 };
      this.hosts.set(key, h);
    }
    h.lastCheckAt = now;
    if (outcome.ok) {
      const wasDown = h.online !== true || h.failures > 0;
      if (h.online === false) this.logger.log(`Printer yana javob beryapti (${key})`);
      h.online = true;
      h.failures = 0;
      h.lastOkAt = now;
      h.retryAfter = 0;
      if (wasDown) {
        this.refreshStatusSoon();
        this.scheduleWorker(WORKER_KICK_DELAY_MS); // navbatdagi cheklari bo'lsa — darhol chiqsin
      }
      return;
    }
    h.failures += 1;
    h.retryAfter = now.getTime() + HOST_BACKOFF_MS;
    if (h.failures >= OFFLINE_AFTER_FAILURES && h.online !== false) {
      h.online = false;
      this.logger.warn(`Printer javob bermayapti (${key}): ${outcome.message}`);
      this.refreshStatusSoon();
    }
  }

  /** Holat o'zgargan bo'lishi mumkin — qisqa kutib hisoblaymiz va o'zgargan bo'lsa 'status' yuboramiz */
  private refreshStatusSoon(): void {
    if (this.destroyed || this.statusTimer) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      void this.emitStatusIfChanged();
    }, STATUS_DEBOUNCE_MS);
    this.statusTimer.unref?.();
  }

  private async emitStatusIfChanged(): Promise<void> {
    if (this.destroyed) return;
    try {
      const printers = await this.getPrinterStatus();
      // Har tekshiruvda o'zgaradigan vaqtlar hisobga olinmaydi — faqat haqiqiy o'zgarishda yuboriladi
      const sig = JSON.stringify(
        printers.map((p) => [p.stationId, p.stationName, p.host, p.port, p.online, p.lastCheckAt === null, p.pendingJobs]),
      );
      if (sig === this.lastStatusSig) return;
      this.lastStatusSig = sig;
      this.emit(PRINT_EVENTS.Status, { printers } satisfies PrintersStatusPayload);
    } catch (e) {
      this.logger.warn(`Printerlar holatini hisoblab bo‘lmadi: ${errorText(e)}`);
    }
  }

  // =============================================================================================
  // Hodisalar
  // =============================================================================================

  /** 'failed' hodisasi: tableNumber faqat stolga buyurtmada (null/undefined — maydon yuborilmaydi) */
  private emitFailed(p: Omit<PrintFailedPayload, 'tableNumber'> & { tableNumber?: number | null }): void {
    const { tableNumber, ...rest } = p;
    const payload: PrintFailedPayload = {
      ...rest,
      ...(tableNumber != null && Number.isFinite(Number(tableNumber)) ? { tableNumber: Number(tableNumber) } : {}),
    };
    if (!payload.orderId) delete payload.orderId;
    if (!payload.orderName) delete payload.orderName;
    this.emit(PRINT_EVENTS.Failed, payload);
  }

  /** Tinglovchi xatosi chop etish jarayonini buzmasin */
  private emit(event: string, payload: unknown): void {
    try {
      this.events.emit(event, payload);
    } catch (e) {
      this.logger.error(`'${event}' hodisasi tinglovchisida xato: ${errorText(e)}`);
    }
  }
}
