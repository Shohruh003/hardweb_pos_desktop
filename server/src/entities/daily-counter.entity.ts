import { Column, Entity, PrimaryColumn } from 'typeorm';

// Kunlik buyurtma raqamlari hisoblagichi (B27): har bir mahalliy kun ('YYYY-MM-DD') uchun oxirgi
// berilgan raqam. Raqam max(queue_number)+1 bilan emas, shu yerdan olinadi — shunda bekor qilingan
// (o'chirilgan) buyurtmaning raqami QAYTA berilmaydi (oshxonada bir xil #raqamli ikki chek bo'lmaydi).
// Yangilash buyurtma yaratish mutex'i ichida bajariladi.
@Entity('daily_counters')
export class DailyCounterEntity {
  // Mahalliy sana 'YYYY-MM-DD' (orders.business_date bilan bir xil)
  @PrimaryColumn({ name: 'business_date', type: 'varchar', length: 10 })
  businessDate: string;

  @Column({ name: 'last_number', type: 'int', default: 0 })
  lastNumber: number;
}
