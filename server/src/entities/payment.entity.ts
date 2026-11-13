import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ValueTransformer,
} from 'typeorm';
import { roundSum } from '@hardweb-pos/shared';

// To'lov summasi bazaga doim BUTUN so'mda yoziladi — kg taomlardagi 121000.00000000001
// kabi suzuvchi qoldiqlar saqlanmasin. O'qishda oddiy son qaytadi.
// (Faqat qiymatga ta'sir qiladi — ustun turi/sxema o'zgarmaydi.)
const wholeSumTransformer: ValueTransformer = {
  to: (value: unknown) => (value == null ? value : roundSum(value as number | string)),
  from: (value: unknown) => (value == null ? value : Number(value)),
};

@Entity('payments')
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, transformer: wholeSumTransformer })
  amount: number;

  // To'lov usuli kaliti (B30): 'naqd' | 'karta' | 'qr' | 'click' | 'payme' | 'qarz' | maxsus (sozlamadagi paymentMethods)
  @Column({ type: 'varchar' })
  type: string;

  @Column({ name: 'cashier_id', type: 'uuid' })
  cashierId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // 'Qarzga' (debt) to'lovida — kim qarzdor (B30)
  @Column({ name: 'debtor_name', type: 'varchar', nullable: true })
  debtorName: string | null;

  @Column({ name: 'debtor_phone', type: 'varchar', nullable: true })
  debtorPhone: string | null;

  // Qarz qaytarilganda (B34): qachon, kim qabul qildi, qaysi usul bilan
  @Column({ name: 'debt_repaid_at', type: 'datetime', nullable: true })
  debtRepaidAt: Date | null;

  @Column({ name: 'debt_repaid_by', type: 'uuid', nullable: true })
  debtRepaidBy: string | null;

  @Column({ name: 'debt_repaid_type', type: 'varchar', nullable: true })
  debtRepaidType: string | null;
}
