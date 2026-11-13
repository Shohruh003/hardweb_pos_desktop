import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { MenuUnit, OrderType } from '@hardweb-pos/shared';

// Otkazlar jurnali (B19): yuborilgan taom yoki butun hisob bekor qilinganda har bir qator shu yerga
// yoziladi — kim, qachon, nimani, qancha, nima sababdan. Direktor hisobotda va Telegram'da ko'radi.
// Buyurtma o'chirilsa ham jurnal qoladi (order_id faqat ma'lumot uchun, bog'lanish yo'q).
@Entity('void_log')
@Index(['createdAt'])
export class VoidLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  // "Stol 5" / "Olib ketish #12" (orderDisplayName — otkaz paytidagi holat)
  @Column({ name: 'order_name', type: 'varchar', nullable: true })
  orderName: string | null;

  @Column({ name: 'order_type', type: 'varchar', nullable: true })
  orderType: OrderType | null;

  @Column({ name: 'menu_item_id', type: 'uuid', nullable: true })
  menuItemId: string | null;

  // Taom nomi (snapshot)
  @Column({ type: 'varchar' })
  name: string;

  // kg taomlarda summa bo'yicha kiritilgan og'irlik 6 xonagacha (83 000 / 75 000 = 1.106667 kg)
  @Column({ type: 'decimal', precision: 12, scale: 6, default: 1 })
  quantity: number;

  @Column({ type: 'varchar', nullable: true })
  unit: MenuUnit | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  price: number;

  // lineSum(price, quantity) — butun so'm
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  sum: number;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'user_name', type: 'varchar', nullable: true })
  userName: string | null;

  // Butun hisob bekor qilinganda true
  @Column({ name: 'whole_order', default: false })
  wholeOrder: boolean;

  // Oshxonaga yuborilgan edimi (OTKAZ cheki chiqarildimi)
  @Column({ name: 'sent_to_kitchen', default: true })
  sentToKitchen: boolean;
}
