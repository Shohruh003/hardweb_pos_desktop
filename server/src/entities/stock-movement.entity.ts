import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ProductUnit, StockMovementType } from '@hardweb-pos/shared';

// Ombor harakatlari jurnali (0.3.3): qoldiqning HAR BIR o'zgarishi shu yerga yoziladi — kirim, vozvrat,
// chiqim, tuzatish, inventarizatsiya, ishlab chiqarish, sotuv va chek vozvrati (StockLedgerService).
// Mahsulot nomi va birligi harakat paytidagi holatda saqlanadi — mahsulot keyin o'zgarsa yoki o'chirilsa
// ham jurnal to'g'ri qoladi. product_id bog'lanishsiz (FK yo'q): o'chirilgan mahsulot harakatlari qoladi.
// Indekslar: mahsulot kartochkasi (product_id, created_at), umumiy jurnal (created_at), tur filtri (type),
// chek vozvratida buyurtmaning sotuv harakatlarini topish (reference).
@Entity('stock_movements')
@Index(['productId', 'createdAt'])
@Index(['createdAt'])
@Index(['type'])
@Index(['reference'])
export class StockMovementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  // Harakat paytidagi nom va birlik (snapshot)
  @Column({ name: 'product_name', type: 'varchar' })
  productName: string;

  @Column({ type: 'varchar' })
  unit: ProductUnit;

  // 'initial' | 'purchase' | 'return' | 'writeoff' | 'adjust' | 'count' | 'production_out' | 'production_in' | 'sale' | 'refund'
  @Column({ type: 'varchar' })
  type: StockMovementType;

  // Ishorali miqdor: + kirdi, − chiqdi (3 xona)
  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0 })
  quantity: number;

  // Harakatdan keyingi qoldiq — shu tranzaksiyada atomar yangilangan qiymat
  @Column({ name: 'balance_after', type: 'decimal', precision: 14, scale: 3, default: 0 })
  balanceAfter: number;

  // Shu paytdagi birlik tannarxi (so'm, 4 xona); kirimda — kirim narxi
  @Column({ name: 'unit_cost', type: 'decimal', precision: 14, scale: 4, default: 0 })
  unitCost: number;

  // Bog'liq hujjat: buyurtma id (sale/refund), kirim id (purchase/return), partiya id (count/production)
  @Column({ type: 'varchar', nullable: true })
  reference: string | null;

  // Odam o'qiydigan nom: "Stol 5 · №12", "Kirim: Baraka", "Inventarizatsiya"
  @Column({ name: 'reference_label', type: 'varchar', nullable: true })
  referenceLabel: string | null;

  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'user_name', type: 'varchar', nullable: true })
  userName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
