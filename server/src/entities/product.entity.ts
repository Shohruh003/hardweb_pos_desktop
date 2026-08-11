import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ProductUnit } from '@hardweb-pos/shared';

// Sklad (ombor) mahsuloti — masalan: guruch, go'sht, non, gaz
@Entity('products')
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  // O'lchov birligi (kg, g, l, ml, dona)
  @Column({ type: 'varchar', default: ProductUnit.Kg })
  unit: ProductUnit;

  // Ombordagi qoldiq (kasr bo'lishi mumkin — 12.5 kg)
  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  stock: number;

  // Minimal qoldiq — shundan kam qolsa ogohlantiramiz
  @Column({ name: 'min_stock', type: 'decimal', precision: 14, scale: 3, default: 0 })
  minStock: number;
}
