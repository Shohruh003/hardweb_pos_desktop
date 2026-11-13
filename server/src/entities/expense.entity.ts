import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { CashMovementKind } from '@hardweb-pos/shared';

// Kassa harakatlari (eski POS'dagi "Kirim / Chiqim"): chiqim — kassir rasxodi (smena davomidagi
// chiqimlar), kirim — kassaga qo'yilgan pul (ertalabki maydalik, egasi bergan pul va h.k.).
// kind ustuni 0.3.0 da qo'shildi — DEFAULT 'chiqim': eski yozuvlar (avvalgi "Rasxod") chiqim bo'lib qoladi.
@Entity('expenses')
export class ExpenseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  // 'kirim' | 'chiqim'
  @Column({ type: 'varchar', default: 'chiqim' })
  kind: CashMovementKind;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'cashier_id', type: 'uuid' })
  cashierId: string;

  @Column({ name: 'cashier_name', type: 'varchar', nullable: true })
  cashierName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
