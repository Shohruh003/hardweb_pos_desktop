import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DeviceType } from '@hardweb-pos/shared';

@Entity('devices')
export class DeviceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  type: DeviceType;

  @Column()
  name: string;

  @Column()
  connection: string;

  @Column({ type: 'simple-json', nullable: true })
  settings: Record<string, unknown> | null;
}
