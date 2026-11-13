import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MenuUnit, OrderItemStatus } from '@hardweb-pos/shared';
import { OrderEntity } from './order.entity';

// Sxema o'zgarishlari (0.3.0) — synchronize jadvalni qayta yaratib, barcha qatorlarni ko'chiradi:
//  • quantity — decimal(12,6): kg taomda summa bo'yicha kiritilgan og'irlik 6 xonagacha saqlanadi
//    (83 000 / 75 000 = 1.106667 kg — chekdagi summa aynan 83 000 chiqadi);
//  • created_at — taom buyurtmaga qo'shilgan vaqt (eski qatorlar — yangilanish vaqtini oladi);
//  • takeaway, price_overridden — DEFAULT false; original_price — NULL bo'lishi mumkin;
//  • order_id indeksi — buyurtma taomlarini (eager) va tarix summalarini tez o'qish uchun.
@Entity('order_items')
export class OrderItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
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

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;

  // Miqdor — dona uchun butun, kg uchun kasr (6 xonagacha: 1.5, 1.106667) bo'lishi mumkin
  @Column({ type: 'decimal', precision: 12, scale: 6, default: 1 })
  quantity: number;

  // O'lchov birligi (buyurtma paytida menyudan ko'chiriladi)
  @Column({ type: 'varchar', default: MenuUnit.Piece })
  unit: MenuUnit;

  // Qaysi bo'lim tayyorlaydi (chek yo'naltirish uchun) — buyurtma paytidagi snapshot
  @Column({ name: 'station_id', type: 'uuid', nullable: true })
  stationId: string | null;

  @Column({ name: 'station_name', type: 'varchar', nullable: true })
  stationName: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({
    type: 'varchar',
    default: OrderItemStatus.Pending,
  })
  status: OrderItemStatus;

  // Aksiz kerakmi (buyurtma paytida menyudan ko'chiriladi) — TZ F-8.5
  @Column({ name: 'excise_required', default: false })
  exciseRequired: boolean;

  // Skanerlangan aksiz kodi (bo'lsa) — TZ F-8.6
  @Column({ name: 'excise_code', type: 'varchar', nullable: true })
  exciseCode: string | null;

  // Taom buyurtmaga qo'shilgan vaqt (ofitsiant panelida "13.11.2026 (18:56)").
  // Hisob bo'linganda ko'chgan qator asl vaqtini saqlaydi.
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Stoldagi buyurtmada "olib ketish" (saboy) qatori — xizmat haqi olinmaydi, oshxona chekida
  // alohida guruhda chiqadi. Olib ketish / yetkazish buyurtmalarida doim false (butun buyurtma saboy).
  @Column({ default: false })
  takeaway: boolean;

  // Narx kassir/direktor tomonidan qo'lda o'zgartirilgan (chek va tarixda belgilanadi)
  @Column({ name: 'price_overridden', default: false })
  priceOverridden: boolean;

  // Menyudagi asl narx (narx o'zgartirilgan bo'lsa); aks holda NULL
  @Column({ name: 'original_price', type: 'decimal', precision: 12, scale: 2, nullable: true })
  originalPrice: number | null;
}
