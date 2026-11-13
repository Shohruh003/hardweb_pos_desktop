import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { PrintJobStatus } from '@hardweb-pos/shared';

// Bo'lim (oshxona/bar) cheklari navbati (B17). Har bir chek AVVAL shu jadvalga yoziladi, keyin
// chop etiladi. Printer yoki svet o'chgan bo'lsa 'pending' holatda qoladi va printer tiklanishi
// bilan avtomatik chiqadi (server qayta ishga tushganda ham). payload — chekni keyinroq aynan
// qayta qurish uchun barcha ma'lumot (sarlavha, taomlar, izohlar, vaqt).
@Entity('print_jobs')
@Index(['status', 'createdAt'])
export class PrintJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  // "Stol 5" / "Olib ketish #12" (orderDisplayName)
  @Column({ name: 'order_name', type: 'varchar', nullable: true })
  orderName: string | null;

  @Column({ name: 'station_id', type: 'uuid', nullable: true })
  stationId: string | null;

  @Column({ name: 'station_name', type: 'varchar', default: '' })
  stationName: string;

  @Column({ type: 'varchar' })
  host: string;

  @Column({ type: 'int', default: 9100 })
  port: number;

  // 48 = 80 mm, 32 = 58 mm
  @Column({ type: 'int', default: 48 })
  width: number;

  // QO'SHIMCHA cheki (buyurtmaga qo'shilgan taomlar)
  @Column({ default: false })
  append: boolean;

  // 'order' — oddiy oshxona cheki; 'void' — OTKAZ (bekor qilingan taomlar) cheki
  @Column({ type: 'varchar', default: 'order' })
  kind: string;

  @Column({ type: 'simple-json', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ name: 'items_count', type: 'int', default: 0 })
  itemsCount: number;

  @Column({ type: 'varchar', default: 'pending' })
  status: PrintJobStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'last_attempt_at', type: 'datetime', nullable: true })
  lastAttemptAt: Date | null;

  @Column({ name: 'printed_at', type: 'datetime', nullable: true })
  printedAt: Date | null;
}
