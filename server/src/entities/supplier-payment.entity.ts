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

  // Ta'minotchi nomi (ko'rsatish uchun nusxa; ta'minotchi nomi o'zgarsa birga yangilanadi)
  @Index()
  @Column({ default: '' })
  supplier: string;

  // Ta'minotchi (0.3.3) — balans shu bo'yicha hisoblanadi
  @Index()
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId: string | null;

  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0 })
  amount: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  // To'lovni kiritgan xodim (0.3.3)
  @Column({ name: 'user_name', type: 'varchar', nullable: true })
  userName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
