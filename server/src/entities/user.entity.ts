import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { UserRole } from '@hardweb-pos/shared';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  @Column({ unique: true })
  login: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ default: true })
  active: boolean;
}
