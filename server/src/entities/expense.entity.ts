import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Kassir kunlik rasxodlari (smena davomida chiqimlar) — kun oxiri hisobotiga qo'shiladi
@Entity('expenses')
export class ExpenseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'cashier_id', type: 'uuid' })
  cashierId: string;

  @Column({ name: 'cashier_name', type: 'varchar', nullable: true })
  cashierName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
