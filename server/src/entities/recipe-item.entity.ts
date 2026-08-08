import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Taom retsepti — bir taomga qaysi mahsulotdan qancha ketishi.
// Taom sotilganda shu miqdorlar (miqdor * sotilgan son) skladdan ayiriladi.
@Entity('recipe_items')
export class RecipeItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'menu_item_id', type: 'uuid' })
  menuItemId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  // Taomning 1 birligiga ketadigan miqdor (mahsulot birligida)
  @Column({ type: 'numeric', precision: 14, scale: 3, default: 0 })
  amount: number;
}
