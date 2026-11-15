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

  // Qo'shimcha printerlar (0.3.2, eski POS'dagi "Printerlar"): chek nusxasi ham shu bo'limlarga chiqadi
  // (masalan salat — Salatxona + Kassa nazorati). null/bo'sh — faqat asosiy bo'lim.
  @Column({ name: 'extra_station_ids', type: 'simple-json', nullable: true })
  extraStationIds: string[] | null;

  // Rasm — data URL (base64). select:false: ro'yxatlar, buyurtma va chek so'rovlari uni
  // O'QIMAYDI (har telefonga yuzlab KB base64 ketmasin). Rasm alohida ochiq manzildan beriladi:
  // GET /api/menu/items/:id/image (kerak joyda addSelect('m.image') bilan o'qiladi).
  @Column({ nullable: true, type: 'text', select: false })
  image: string | null;

  // Rasm versiyasi — har o'zgarishda (yuklash/o'chirish) +1. Rasm manzilida ?v=<n> bo'lib keladi:
  // brauzer rasmni uzoq keshlaydi, yangi rasm esa yangi manzil bilan darhol ko'rinadi.
  @Column({ name: 'image_version', type: 'int', default: 0 })
  imageVersion: number;

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
