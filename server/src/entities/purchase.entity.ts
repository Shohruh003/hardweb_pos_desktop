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

  @Column({ default: '' })
  supplier: string; // ta'minotchi

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
