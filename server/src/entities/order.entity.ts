import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderStatus } from '@hardweb-pos/shared';
import { OrderItemEntity } from './order-item.entity';

@Entity('orders')
export class OrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'table_id', type: 'uuid' })
  tableId: string;

  @Column({ name: 'waiter_id', type: 'uuid' })
  waiterId: string;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.Accepted })
  status: OrderStatus;

  @CreateDateColumn({ name: 'opened_at' })
  openedAt: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'queue_number', type: 'int', nullable: true })
  queueNumber: number | null;

  // Chekka izoh (Примечание) — ofitsiant/kassir kiritadi
  @Column({ type: 'text', nullable: true })
  note: string | null;

  // Chegirma/xizmat haqi foizi — to'lovda saqlanadi (bo'lib to'lashda total barqaror qoladi)
  @Column({ name: 'discount_percent', type: 'numeric', precision: 5, scale: 2, default: 0 })
  discountPercent: number;

  @Column({ name: 'service_percent', type: 'numeric', precision: 5, scale: 2, default: 0 })
  servicePercent: number;

  // Mijoz (CRM) — ixtiyoriy
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ name: 'customer_name', type: 'varchar', nullable: true })
  customerName: string | null;

  // Vozvrat (to'langan chek qaytarilishi) — faqat Direktor/Administrator (TZ ruxsatlar)
  @Column({ default: false })
  refunded: boolean;

  @Column({ name: 'refund_reason', type: 'text', nullable: true })
  refundReason: string | null;

  @Column({ name: 'refunded_at', type: 'timestamptz', nullable: true })
  refundedAt: Date | null;

  @Column({ name: 'refunded_by', type: 'uuid', nullable: true })
  refundedBy: string | null;

  @OneToMany(() => OrderItemEntity, (item) => item.order, {
    cascade: true,
    eager: true,
  })
  items: OrderItemEntity[];
}
