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

  // 4 xonali PIN — xodim faqat shu bilan kiradi (login shart emas)
  @Column({ type: 'varchar', length: 10, unique: true, nullable: true })
  pin: string | null;

  @Column({ type: 'varchar', nullable: true })
  login: string | null;

  @Column({ name: 'password_hash', type: 'varchar', nullable: true })
  passwordHash: string | null;

  @Column({ default: true })
  active: boolean;

  // Direktor tomonidan berilgan qo'shimcha ruxsatlar (masalan kassir tarixni ko'radi)
  @Column({ type: 'simple-array', nullable: true })
  permissions: string[] | null;
}
