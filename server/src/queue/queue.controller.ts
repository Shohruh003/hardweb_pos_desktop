import { Controller, Get, Header } from '@nestjs/common';
import { OrderStatus } from '@hardweb-pos/shared';
import { OrdersService } from '../orders/orders.service';
import { QUEUE_HTML } from './queue.html';

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

  // Boshlang'ich ma'lumot: faol (yopilmagan) buyurtmalar
  @Get('data')
  async data() {
    const list = await this.orders.findActive();
    return list.filter((o) => o.status !== OrderStatus.Closed);
  }
}
