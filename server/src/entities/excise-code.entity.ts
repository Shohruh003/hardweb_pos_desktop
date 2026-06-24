import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Skanerlangan aksiz kodlari (TZ excise_codes / 8.2). Soliq hisobotiga qo'shiladi.
@Entity('excise_codes')
export class ExciseCodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_item_id', type: 'uuid' })
  orderItemId: string;

  @Column({ name: 'excise_code' })
  exciseCode: string;

  @CreateDateColumn({ name: 'scanned_at' })
  scannedAt: Date;
}
