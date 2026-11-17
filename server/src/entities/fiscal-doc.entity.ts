import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Fiskal hujjat (TZ 8.1 / fiscal_docs) — soliq cheki ma'lumotlari.
// Hozir demo generator; real OFD (soliq operatori) ulanganda fiskal_raqam va QR o'shandan keladi.
@Entity('fiscal_docs')
export class FiscalDocEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Chek nusxasi / tarixda buyurtma bo'yicha qidiriladi (0.3.3: jadval endi tozalanmaydi)
  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'fiscal_number' })
  fiscalNumber: string;

  @Column({ name: 'qr_code', type: 'text' })
  qrCode: string; // QR ichidagi ma'lumot (URL/payload)

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
