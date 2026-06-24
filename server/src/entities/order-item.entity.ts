import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderItemStatus } from '@hardweb-pos/shared';
import { OrderEntity } from './order.entity';

@Entity('order_items')
export class OrderItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id' })
  orderId: string;

  @ManyToOne(() => OrderEntity, (order) => order.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order: OrderEntity;

  @Column({ name: 'menu_item_id' })
  menuItemId: string;

  // Buyurtma payti taom nomi va narxini saqlaymiz (menyu keyin o'zgarsa ham chek to'g'ri)
  @Column({ name: 'menu_item_name' })
  menuItemName: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  price: number;

  @Column({ default: 1 })
  quantity: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({
    type: 'enum',
    enum: OrderItemStatus,
    default: OrderItemStatus.Pending,
  })
  status: OrderItemStatus;
}
