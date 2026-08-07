import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Terminal (blok) — restorandagi POS ish joyi (kassa, ofitsiant terminali va h.k.)
@Entity('terminals')
export class TerminalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string; // masalan "Kassa 1", "Ofitsiant terminali 2"

  @Column({ type: 'varchar', nullable: true })
  hall: string | null; // qaysi zalda

  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
