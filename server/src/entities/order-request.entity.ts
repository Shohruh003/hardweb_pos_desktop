import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { Order } from '@hardweb-pos/shared';

// Takroriy so'rov himoyasi (B32, 0.3.3): POST /orders dagi clientRequestId -> yaratilgan buyurtma.
// Oflayn navbat yoki uzilgan tarmoq so'rovni qayta yuborsa — server qayta ishga tushgan bo'lsa ham —
// yangi buyurtma (va ikkinchi oshxona cheki) yaratilmaydi, avvalgi natija qaytadi. 24 soat ishlatiladi
// (OrdersService), 48 soatdan eski yozuvlarni MaintenanceService o'chiradi.
@Entity('order_requests')
export class OrderRequestEntity {
  // Mijoz yuborgan clientRequestId (CreateOrderDto: ko'pi bilan 64 belgi)
  @PrimaryColumn({ name: 'request_id', type: 'varchar', length: 64 })
  requestId: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  // Javob nusxasi: buyurtma keyin o'chirilgan (bekor qilingan) bo'lsa ham takroriy so'rovga shu qaytadi
  @Column({ type: 'simple-json', nullable: true })
  snapshot: Order | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
