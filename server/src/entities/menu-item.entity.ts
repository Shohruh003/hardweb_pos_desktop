import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { MenuUnit } from '@hardweb-pos/shared';

@Entity('menu_items')
export class MenuItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;

  // O'lchov birligi: dona (bo'lakda) yoki kg (kiloda sotiladigan taomlar)
  @Column({ type: 'varchar', default: MenuUnit.Piece })
  unit: MenuUnit;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  // Qaysi bo'lim (sex) tayyorlaydi — chekни shu bo'lim printeriga yo'naltirish uchun
  @Column({ name: 'station_id', type: 'uuid', nullable: true })
  stationId: string | null;

  @Column({ nullable: true, type: 'text' })
  image: string | null;

  // Taomga ketadigan mahsulotlar/ingredientlar (matn — har birini yangi qatordan)
  @Column({ nullable: true, type: 'text' })
  ingredients: string | null;

  @Column({ default: true })
  available: boolean;

  @Column({ name: 'excise_required', default: false })
  exciseRequired: boolean;

  // Sevimli (tez-tez sotiladigan) — ofitsiant menyusida "⭐ Sevimlilar"da chiqadi
  @Column({ default: false })
  favorite: boolean;
}
