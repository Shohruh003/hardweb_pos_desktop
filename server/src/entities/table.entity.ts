import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { TableStatus } from '@hardweb-pos/shared';

@Entity('tables')
export class TableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  number: number;

  @Column()
  hall: string;

  @Column({ default: 4 })
  capacity: number;

  @Column({ type: 'enum', enum: TableStatus, default: TableStatus.Free })
  status: TableStatus;
}
