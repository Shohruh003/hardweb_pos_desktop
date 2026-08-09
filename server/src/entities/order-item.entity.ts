import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MenuUnit, OrderItemStatus } from '@hardweb-pos/shared';
import { OrderEntity } from './order.entity';

@Entity('order_items')
export class OrderItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => OrderEntity, (order) => order.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order: OrderEntity;

  @Column({ name: 'menu_item_id', type: 'uuid' })
  menuItemId: string;

  // Buyurtma payti taom nomi va narxini saqlaymiz (menyu keyin o'zgarsa ham chek to'g'ri)
  @Column({ name: 'menu_item_name' })
  menuItemName: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  price: number;

  // Miqdor — dona uchun butun, kg uchun kasr (1.5, 1.75) bo'lishi mumkin
  @Column({ type: 'numeric', precision: 10, scale: 3, default: 1 })
  quantity: number;

  // O'lchov birligi (buyurtma paytida menyudan ko'chiriladi)
  @Column({ type: 'varchar', default: MenuUnit.Piece })
  unit: MenuUnit;

  // Qaysi bo'lim tayyorlaydi (chek yo'naltirish uchun) — buyurtma paytидаги snapshot
  @Column({ name: 'station_id', type: 'uuid', nullable: true })
  stationId: string | null;

  @Column({ name: 'station_name', type: 'varchar', nullable: true })
  stationName: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({
    type: 'enum',
    enum: OrderItemStatus,
    default: OrderItemStatus.Pending,
  })
  status: OrderItemStatus;

  // Aksiz kerakmi (buyurtma paytida menyudan ko'chiriladi) — TZ F-8.5
  @Column({ name: 'excise_required', default: false })
  exciseRequired: boolean;

  // Skanerlangan aksiz kodi (bo'lsa) — TZ F-8.6
  @Column({ name: 'excise_code', type: 'varchar', nullable: true })
  exciseCode: string | null;
}
