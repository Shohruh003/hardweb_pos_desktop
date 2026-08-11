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

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'varchar' })
  type: PaymentType;

  @Column({ name: 'cashier_id', type: 'uuid' })
  cashierId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
