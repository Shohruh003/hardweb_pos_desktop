import { Logger, OnModuleInit } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server } from 'socket.io';
import { PrintersStatusPayload, SOCKET_EVENTS } from '@hardweb-pos/shared';
import { PRINT_EVENTS, StationPrintService } from './station-print.service';
import { STAFF_ROOM } from '../auth/socket-auth';

// Printerlar holati (B26): StationPrintService holat o'zgarganini aytganda (printer javob bermay
// qoldi / qayta ulandi / navbatdagi cheklar soni o'zgardi) — 'printers:status' xodimlarga (STAFF_ROOM)
// yuboriladi (kassa va admin ekranidagi holat qatori yangilanadi). Tokensiz ulanishlar (TV, login
// ekrani) printer manzillarini olmaydi.
//
// Sozlama OrdersGateway bilan AYNAN bir xil: Nest bitta port uchun bitta Socket.IO serverni
// ishlatadi va qaysi gateway birinchi yaratilsa, server o'shaning sozlamasi bilan ochiladi.
// 'failed' / 'recovered' hodisalarini OrdersGateway uzatadi — bu yerda faqat 'status'.
@WebSocketGateway({ cors: { origin: true } })
export class PrintingGateway implements OnModuleInit {
  private readonly logger = new Logger('PrintingGateway');

  @WebSocketServer()
  server: Server;

  constructor(private readonly print: StationPrintService) {}

  onModuleInit(): void {
    this.print.events.on(PRINT_EVENTS.Status, (payload: PrintersStatusPayload) => {
      try {
        // Socket server hali ko'tarilmagan bo'lsa (ishga tushish payti) — jim o'tkazib yuboramiz:
        // ekranlar ulanganda holatni GET /printing/status orqali o'zlari oladi
        this.server?.to(STAFF_ROOM).emit(SOCKET_EVENTS.PRINTERS_STATUS, payload);
      } catch (e) {
        this.logger.warn(`printers:status yuborilmadi: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }
}
