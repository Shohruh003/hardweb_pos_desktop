import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DeviceType } from '@hardweb-pos/shared';

@Entity('devices')
export class DeviceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: DeviceType })
  type: DeviceType;

  @Column()
  name: string;

  @Column()
  connection: string;

  @Column({ type: 'jsonb', default: {} })
  settings: Record<string, unknown>;
}
