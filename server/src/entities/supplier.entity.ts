import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Ta'minotchi (0.3.3) — kirimlar va to'lovlar supplier_id orqali bog'lanadi, balans (olingan − to'langan)
// shu bo'yicha hisoblanadi. Nom katta-kichik harf va bo'shliqlarsiz noyob — SuppliersService tekshiradi.
// Kirim/to'lov qatoridagi `supplier` matni — ko'rsatish uchun nom nusxasi (nom o'zgarsa birga yangilanadi).
@Entity('suppliers')
export class SupplierEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
