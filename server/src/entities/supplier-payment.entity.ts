import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Ta'minotchiga to'lov — sklad kirimi (qarz) ustidan to'lov. Balans = olingan - to'langan.
@Entity('supplier_payments')
export class SupplierPaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ default: '' })
  supplier: string;

  @Column({ type: 'numeric', precision: 16, scale: 2, default: 0 })
  amount: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
