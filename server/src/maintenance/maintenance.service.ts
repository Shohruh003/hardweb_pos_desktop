import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderRequestEntity } from '../entities';
import { sqliteUtc } from '../reports/report-dates';

// Texnik tozalash (0.3.3). BIZNES MA'LUMOTLARI HECH QACHON O'CHIRILMAYDI: buyurtmalar, taomlar, to'lovlar,
// fiskal cheklar, aksiz kodlari, rasxodlar — ega istalgan kungi chekni istalgan vaqtda ko'ra olishi kerak
// (0.3.2 gacha 2 oydan eskilari har kuni o'chirilardi). Bu yerda faqat yordamchi jadvallar tozalanadi:
//  • order_requests — takroriy so'rov (clientRequestId) yozuvlari: OrdersService ularni 24 soat ishlatadi,
//    48 soatdan eskilari o'chiriladi.
// print_jobs (bo'lim cheklari navbati) bu yerda TOZALANMAYDI: StationPrintService o'zi kuniga bir marta
// 7 kundan eski chiqqan / bekor qilingan / muddati o'tgan cheklarni o'chiradi (navbatdagi va chop
// etilayotgan cheklarga tegmaydi) — ikkinchi tozalash faqat takror bo'lardi.

/** Server ishga tushgach birinchi tozalash */
const FIRST_RUN_MS = 10_000;
/** Keyin — kuniga bir marta */
const EVERY_MS = 24 * 60 * 60_000;
/** order_requests yozuvlari shuncha saqlanadi (ishlatilishi — 24 soat) */
const ORDER_REQUEST_KEEP_MS = 48 * 60 * 60_000;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Maintenance');
  private firstTimer: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly dataSource: DataSource) {}

  onModuleInit() {
    this.firstTimer = setTimeout(() => {
      this.firstTimer = null;
      void this.housekeeping();
    }, FIRST_RUN_MS);
    this.firstTimer.unref?.();
    this.interval = setInterval(() => void this.housekeeping(), EVERY_MS);
    this.interval.unref?.();
  }

  onModuleDestroy() {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.interval) clearInterval(this.interval);
    this.firstTimer = this.interval = null;
  }

  /**
   * Bitta tozalash o'tishi. Hech qachon reject qilmaydi — xato faqat jurnalga yoziladi (server yiqilmaydi).
   * Hozir bitta DELETE — o'zi atomar. Bu yerda dataSource.transaction() ATAYLAB ishlatilmaydi: SQLite'da
   * TypeORM bitta ulanish (bitta query runner) bilan ishlaydi va fondagi tranzaksiya shu payt ochiq
   * turgan boshqa tranzaksiya (masalan buyurtma yaratish) ichiga SAVEPOINT bo'lib kirib qolardi — biri
   * bekor qilinsa (rollback), ikkinchisining yarim ishi saqlanib qolishi mumkin. Bir nechta bog'liq
   * amal kerak bo'lsa — bitta SQL ifodasiga birlashtiring yoki OrdersService navbati orqali bajaring.
   */
  async housekeeping(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const cutoff = sqliteUtc(new Date(now.getTime() - ORDER_REQUEST_KEEP_MS));
      const res = await this.dataSource
        .createQueryBuilder()
        .delete()
        .from(OrderRequestEntity)
        .where('datetime(created_at) < datetime(:cutoff)', { cutoff })
        .execute();
      if (res.affected) {
        this.logger.log(`Tozalash: 48 soatdan eski ${res.affected} ta takroriy so‘rov yozuvi o‘chirildi`);
      }
    } catch (e) {
      this.logger.warn(`Tozalash xatosi: ${errorText(e)}`);
    } finally {
      this.running = false;
    }
  }
}
