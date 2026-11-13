import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { Order, OrderItem } from '@hardweb-pos/shared';
import { MenuItemEntity, StationEntity } from '../entities';
import { buildStationTicket, buildTestTicket, TicketItem } from './tickets';
import {
  formatAddress,
  LAN_TIMEOUTS,
  parsePrinterAddress,
  PrinterAddress,
  PrinterQueue,
  PrinterSendError,
  sendToLanPrinter,
} from './lan-printer';

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
  tableNumber?: number;
  hall?: string | null;
  waiterName?: string | null;
}

/** Birinchi urinish muvaffaqiyatsiz bo'lsa — shuncha kutib, yana bir marta urinamiz */
const RETRY_DELAY_MS = 1500;
/** Buyurtma cheki: 1 urinish + 1 qayta urinish */
const ORDER_TICKET_ATTEMPTS = 2;
/**
 * Sinov cheki bitta urinish bilan yuboriladi (admin javobni darhol ko'rsin; HTTP so'rov 10 s
 * ichida qaytsin). Printer boshqa chek bilan band bo'lsa navbatda ko'pi bilan shuncha kutamiz.
 */
const TEST_QUEUE_WAIT_MS = 3000;

interface ResolvedItem {
  stationId: string | null;
  stationName: string | null;
  ticket: TicketItem;
}

type SendOutcome = { ok: true } | { ok: false; message: string };

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Bo'lim (oshxona, bar, somsaxona...) cheklarini SERVER chop etadi: buyurtma qayerdan kelmasin
 * (terminal, telefon, oflayn navbat) — har yangi taom o'z bo'limining LAN printeriga chiqadi.
 * Turli printerlarga parallel, bitta printerga esa navbat bilan (bir ulanish) yuboriladi.
 */
@Injectable()
export class StationPrintService {
  private readonly logger = new Logger('StationPrint');
  private readonly queue = new PrinterQueue();

  constructor(
    @InjectRepository(StationEntity)
    private readonly stations: Repository<StationEntity>,
    @InjectRepository(MenuItemEntity)
    private readonly menuItems: Repository<MenuItemEntity>,
  ) {}

  /**
   * Yangi taomlarni har biri o'z bo'limi printeriga chiqaradi. Hech qachon throw qilmaydi —
   * har bo'lim uchun natija qaytaradi (printeri yo'q bo'limlar o'tkazib yuboriladi va natijaga
   * kirmaydi). Qo'shimcha buyurtmada (append) sarlavha "* QO'SHIMCHA *" bo'ladi.
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

  private async printNewItemsUnsafe(params: PrintNewItemsParams): Promise<StationPrintResult[]> {
    const items = (params?.items ?? []).filter(Boolean);
    if (items.length === 0) return [];

    const order = params.order;
    const printedAt = new Date(); // chek vaqti — hozir (buyurtma/qo'shimcha yuborilgan payt)
    const tableNumber = params.tableNumber ?? order?.tableNumber ?? null;
    const hall = params.hall ?? order?.hall ?? null;
    const waiterName = params.waiterName ?? order?.waiterName ?? null;
    const orderNote = order?.note != null ? String(order.note) : null; // chekda tozalanadi
    const append = !!params.append;

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
    let rows: StationEntity[];
    try {
      rows = await this.stations.find({ where: { id: In([...groups.keys()]) } });
    } catch (e) {
      // Baza vaqtincha band va h.k. — kassada ogohlantirish chiqsin (jim qolmasin)
      this.logger.error(`Bo‘limlarni o‘qib bo‘lmadi: ${errorText(e)}`);
      return [...groups.entries()].map(([stationId, list]) => ({
        stationId,
        station: list.find((x) => x.stationName)?.stationName ?? 'Bo‘lim',
        host: '',
        ok: false,
        message: 'Bo‘lim ma’lumotlarini o‘qib bo‘lmadi (server xatosi)',
      }));
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

    // 3) Har bo'lim printeriga — parallel (bitta printerga navbat bilan)
    const table = tableNumber ?? '-';
    const jobs: Promise<StationPrintResult>[] = [];
    for (const st of rows) {
      const list = groups.get(st.id);
      if (!list?.length) continue;
      const addr = parsePrinterAddress(st.printerHost, st.printerPort);
      if (!addr.host) continue; // printer sozlanmagan — bu bo'limga chek chiqmaydi (xato emas)
      const base = { stationId: st.id, station: st.name, host: addr.host };
      if (addr.error) {
        this.logger.warn(`${st.name}: ${addr.error}`);
        jobs.push(Promise.resolve({ ...base, ok: false, message: addr.error }));
        continue;
      }

      const data = buildStationTicket({
        width: st.printerWidth,
        stationName: st.name,
        append,
        tableNumber,
        hall,
        waiterName,
        orderNote,
        items: list.map((x) => x.ticket),
        printedAt,
      });
      const where = formatAddress(addr);
      jobs.push(
        this.deliver(st.name, addr, data, ORDER_TICKET_ATTEMPTS).then((out): StationPrintResult => {
          if (out.ok) {
            this.logger.log(
              `${st.name}: ${list.length} ta taom chop etildi (${where}) — stol ${table}` +
                (append ? ', qo‘shimcha' : ''),
            );
            return { ...base, ok: true, message: `Chek printerga yuborildi (${where})` };
          }
          this.logger.warn(`${st.name}: chek chiqmadi (stol ${table}) — ${out.message}`);
          return { ...base, ok: false, message: out.message };
        }),
      );
    }
    return Promise.all(jobs);
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
      return {
        stationId: stationId || null,
        stationName: it.stationName ?? null,
        ticket: {
          name: it.menuItemName || mi?.name || 'Taom',
          quantity: it.quantity,
          unit: it.unit ?? mi?.unit ?? null,
          note: it.note != null ? String(it.note) : null, // chekda tozalanadi (bo'sh — chiqmaydi)
        },
      };
    });
  }

  /** Printer navbatiga qo'yib yuborish (attempts marta urinib). Hech qachon reject qilmaydi. */
  private deliver(
    label: string,
    addr: PrinterAddress,
    data: Buffer,
    attempts: number,
  ): Promise<SendOutcome> {
    return this.queue
      .run(PrinterQueue.keyOf(addr), () => this.sendWithRetry(label, addr, data, attempts))
      .catch((e): SendOutcome => ({
        ok: false,
        message: `Printer xatosi (${formatAddress(addr)}): ${errorText(e)}`,
      }));
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
        return this.sendWithRetry(label, addr, data, 1);
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

  private async sendWithRetry(
    label: string,
    addr: PrinterAddress,
    data: Buffer,
    attempts: number,
  ): Promise<SendOutcome> {
    for (let attempt = 1; ; attempt++) {
      try {
        await sendToLanPrinter(addr, data, LAN_TIMEOUTS);
        if (attempt > 1) {
          this.logger.log(`${label}: ${attempt}-urinishda yuborildi (${formatAddress(addr)})`);
        }
        return { ok: true };
      } catch (e) {
        const message =
          e instanceof PrinterSendError
            ? e.message
            : `Printer xatosi (${formatAddress(addr)}): ${errorText(e)}`;
        if (attempt >= attempts) return { ok: false, message };
        this.logger.warn(`${label}: ${message} — ${RETRY_DELAY_MS / 1000} s dan so‘ng qayta urinamiz`);
        await delay(RETRY_DELAY_MS);
      }
    }
  }
}
