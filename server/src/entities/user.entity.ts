import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { UserRole } from '@hardweb-pos/shared';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar' })
  role: UserRole;

  // PIN (4–10 raqam) — xodim faqat shu bilan kiradi (login shart emas).
  // Direktor/SuperAdmin PIN bilan kira olmaydi (faqat login + parol).
  @Column({ type: 'varchar', length: 10, unique: true, nullable: true })
  pin: string | null;

  // Login + parol bilan kirish uchun. Katta-kichik harfdan qat'i nazar unikal —
  // bu ilova darajasida tekshiriladi (eski bazalarda takror bo'lishi mumkinligi uchun DB indeksi yo'q).
  @Column({ type: 'varchar', nullable: true })
  login: string | null;

  // bcrypt xesh (cost 10). null — bu xodim login/parol bilan kira olmaydi.
  @Column({ name: 'password_hash', type: 'varchar', nullable: true })
  passwordHash: string | null;

  @Column({ default: true })
  active: boolean;

  // Direktor tomonidan berilgan qo'shimcha ruxsatlar (masalan kassir tarixni ko'radi)
  @Column({ type: 'simple-array', nullable: true })
  permissions: string[] | null;

  // Keyingi kirishda parolni almashtirish shart (vaqtinchalik parol: real seed yoki
  // boshqa xodim o'rnatgan parol). DEFAULT 0 — mavjud bazalarda synchronize yangi
  // ustunni ma'lumotlarni yo'qotmasdan qo'shadi (eski qatorlar = false).
  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword: boolean;
}
