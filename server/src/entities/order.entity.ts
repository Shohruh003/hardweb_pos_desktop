import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderStatus, OrderType } from '@hardweb-pos/shared';
import { OrderItemEntity } from './order-item.entity';

// Sxema o'zgarishlari (0.3.0) — synchronize jadvalni qayta yaratib, barcha qatorlarni ko'chiradi:
//  • order_type — yangi ustun, DEFAULT 'stol': eski buyurtmalar "stolga" bo'lib qoladi;
//  • table_id — endi NULL bo'lishi mumkin (olib ketish / yetkazishda stol yo'q);
//  • phone, address, business_date — yangi, NULL bo'lishi mumkin;
//  • check_no (stoldagi hisob raqami), bill_printed_at (schot berilgan vaqt) — NULL bo'lishi mumkin;
//  • delivery_fee — DEFAULT 0 (eski buyurtmalarda yetkazish narxi yo'q).
// Yangi ustunlar faqat nullable yoki DEFAULT bilan qo'shiladi — aks holda eski baza bilan server ishga tushmaydi.
@Entity('orders')
export class OrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Buyurtma turi: stol (zalda) | olib_ketish | yetkazish
  @Column({ name: 'order_type', type: 'varchar', default: OrderType.DineIn })
  type: OrderType;

  // Stol — faqat 'stol' turida; olib ketish / yetkazishda NULL
  @Column({ name: 'table_id', type: 'uuid', nullable: true })
  tableId: string | null;

  @Column({ name: 'waiter_id', type: 'uuid' })
  waiterId: string;

  @Column({ type: 'varchar', default: OrderStatus.Accepted })
  status: OrderStatus;

  @CreateDateColumn({ name: 'opened_at' })
  openedAt: Date;

  @Column({ name: 'closed_at', type: 'datetime', nullable: true })
  closedAt: Date | null;

  // Kunlik tartib raqam (№12) — BARCHA turlar uchun bitta ketma-ketlik, har kuni 1 dan
  // (daily_counters jadvalidan). 0.3.0 dan oldingi stolga buyurtmalarda NULL.
  @Column({ name: 'queue_number', type: 'int', nullable: true })
  queueNumber: number | null;

  // Stolda alohida hisob raqami (1, 2, 3…): bitta stolda bir nechta ochiq hisob bo'lishi mumkin
  // ("Hisob 1 / Hisob 2"). Olib ketish / yetkazishda NULL; eski stolga buyurtmalarda NULL = 1-hisob.
  @Column({ name: 'check_no', type: 'int', nullable: true })
  checkNo: number | null;

  // Schot (hisob cheki) mijozga berilgan vaqt — "chek berildi". Yangi taom qo'shilsa (yoki hisob
  // summasi o'zgarsa) tozalanadi: berilgan schot eskirgan bo'ladi.
  @Column({ name: 'bill_printed_at', type: 'datetime', nullable: true })
  billPrintedAt: Date | null;

  // Yetkazish narxi (butun so'm) — faqat yetkazish buyurtmasida; boshqa turlarda doim 0.
  // Jami summaga chegirma/xizmat haqidan keyin qo'shiladi (shared calcOrderTotals).
  @Column({ name: 'delivery_fee', type: 'int', default: 0 })
  deliveryFee: number;

  // Yetkazish (ixtiyoriy olib ketishda ham): mijoz telefoni, normallashtirilgan "+998901234567"
  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  // Yetkazish manzili
  @Column({ type: 'text', nullable: true })
  address: string | null;

  // Ish kuni (mahalliy 'YYYY-MM-DD', yaratilgan payt) — kunlik raqamlash kaliti
  @Column({ name: 'business_date', type: 'varchar', length: 10, nullable: true })
  businessDate: string | null;

  // Chekka izoh (Примечание) — ofitsiant/kassir kiritadi
  @Column({ type: 'text', nullable: true })
  note: string | null;

  // Chegirma/xizmat haqi foizi — buyurtmada saqlanadi (bo'lib to'lashda total barqaror qoladi).
  // Xizmat haqi yaratilganda: stolga — sozlamadagi foiz, olib ketish/yetkazish — 0.
  @Column({ name: 'discount_percent', type: 'decimal', precision: 5, scale: 2, default: 0 })
  discountPercent: number;

  @Column({ name: 'service_percent', type: 'decimal', precision: 5, scale: 2, default: 0 })
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

  @Column({ name: 'refunded_at', type: 'datetime', nullable: true })
  refundedAt: Date | null;

  @Column({ name: 'refunded_by', type: 'uuid', nullable: true })
  refundedBy: string | null;

  @OneToMany(() => OrderItemEntity, (item) => item.order, {
    cascade: true,
    eager: true,
  })
  items: OrderItemEntity[];
}
