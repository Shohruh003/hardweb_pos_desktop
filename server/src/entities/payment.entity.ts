import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ValueTransformer,
} from 'typeorm';
import { PaymentType, roundSum } from '@hardweb-pos/shared';

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

  @Column({ type: 'varchar' })
  type: PaymentType;

  @Column({ name: 'cashier_id', type: 'uuid' })
  cashierId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
