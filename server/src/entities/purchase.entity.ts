import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProductUnit } from '@hardweb-pos/shared';

// Sklad kirimi — mahsulot kimdan/qayerdan, qancha narxда olingani.
@Entity('purchases')
export class PurchaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  // Kirim paytидаги nom/birlik (mahsulot keyin o'zgarsa ham tarix to'g'ri)
  @Column({ name: 'product_name' })
  productName: string;

  @Column({ type: 'varchar', default: ProductUnit.Kg })
  unit: ProductUnit;

  // Ta'minotchi nomi (ko'rsatish uchun nusxa; ta'minotchi nomi o'zgarsa birga yangilanadi)
  @Column({ default: '' })
  supplier: string;

  // Ta'minotchi (0.3.3) — balans shu bo'yicha hisoblanadi; ta'minotchisiz kirimda NULL
  @Index()
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId: string | null;

  // Vozvrat (ta'minotchiga qaytarish) — manfiy qator: quantity va total manfiy
  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  quantity: number;

  @Column({ name: 'unit_price', type: 'decimal', precision: 14, scale: 2, default: 0 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0 })
  total: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
