import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PaymentType } from '@hardweb-pos/shared';

@Entity('payments')
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'enum', enum: PaymentType })
  type: PaymentType;

  @Column({ name: 'cashier_id' })
  cashierId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
