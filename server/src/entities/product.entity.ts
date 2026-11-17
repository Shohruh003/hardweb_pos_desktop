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

  // Ombordagi qoldiq (kasr bo'lishi mumkin — 12.5 kg). FAQAT StockLedgerService.applyMovements
  // o'zgartiradi (0.3.3): har o'zgarish stock_movements jurnaliga yoziladi.
  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  stock: number;

  // Minimal qoldiq — shundan kam qolsa ogohlantiramiz
  @Column({ name: 'min_stock', type: 'decimal', precision: 14, scale: 3, default: 0 })
  minStock: number;

  // O'rtacha og'irlikdagi birlik tannarxi (so'm, 4 xona) — kirim va ishlab chiqarishda nextAvgCost
  // bilan yangilanadi (0.3.3). Eski bazalarda v6 migratsiya kirimlar tarixidan hisoblaydi.
  @Column({ name: 'avg_cost', type: 'decimal', precision: 14, scale: 4, default: 0 })
  avgCost: number;
}
