import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('menu_items')
export class MenuItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  price: number;

  @Column({ name: 'category_id' })
  categoryId: string;

  @Column({ nullable: true, type: 'text' })
  image: string | null;

  @Column({ default: true })
  available: boolean;

  @Column({ name: 'excise_required', default: false })
  exciseRequired: boolean;
}
