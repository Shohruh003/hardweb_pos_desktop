import { Controller, Get, Header } from '@nestjs/common';
import { OrderStatus, OrderType, orderTypeOf } from '@hardweb-pos/shared';
import { OrdersService } from '../orders/orders.service';
import { QUEUE_HTML } from './queue.html';

/** Navbat tablosi uchun buyurtma ko'rinishi — shaxsiy ma'lumotsiz (telefon/manzil/ism/izoh/taomlar yo'q) */
interface QueueBoardOrder {
  id: string;
  status: OrderStatus;
  type: OrderType;
  queueNumber: number | null;
  tableNumber: number | null;
  checkNo: number | null;
  openedAt: string;
}

// Navbat ekrani — PUBLIC (login talab qilmaydi), TV/brauzer uchun (TZ F-7.7).
// Bu controller global 'api' prefiksidan tashqarida (main.ts da exclude qilingan).
@Controller('queue')
export class QueueController {
  constructor(private readonly orders: OrdersService) {}

  // TV/brauzer ochadigan sahifa
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return QUEUE_HTML;
  }

  // Boshlang'ich ma'lumot: faol (yopilmagan) buyurtmalar.
  // Bu manzil login'siz ochiladi (LAN/Wi-Fi'dagi istalgan kishi) — shuning uchun FAQAT tablo
  // ko'rsatadigan maydonlar qaytadi: mijoz telefoni, manzili, ismi, izoh, taomlar va summalar
  // (to'liq Order DTO) bu yerdan hech qachon chiqmasin.
  @Get('data')
  async data(): Promise<QueueBoardOrder[]> {
    const list = await this.orders.findActive();
    return list
      .filter((o) => o.status !== OrderStatus.Closed)
      .map((o) => ({
        id: o.id,
        status: o.status,
        type: orderTypeOf(o),
        queueNumber: o.queueNumber ?? null,
        tableNumber: o.tableNumber ?? null,
        checkNo: o.checkNo ?? null,
        openedAt: o.openedAt,
      }));
  }
}
