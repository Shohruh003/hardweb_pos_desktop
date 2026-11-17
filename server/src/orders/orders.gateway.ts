import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DataSource } from 'typeorm';
import type { EventEmitter } from 'events';
import {
  SOCKET_EVENTS,
  Order,
  OrderCreatedPayload,
  OrderVoidedPayload,
  PrintFailedPayload,
  PrintRecoveredPayload,
  Receipt,
} from '@hardweb-pos/shared';
import { StationPrintService } from '../printing/station-print.service';
import {
  PUBLIC_ROOM,
  QUEUE_CHANGED_EVENT,
  SocketAuth,
  STAFF_ROOM,
  socketTokenOf,
} from '../auth/socket-auth';

// Real-time markaz: KDS, kassa, ofitsiantlar va navbat tablosi shu yerga ulanadi (TZ 2.2).
// Ulanishda token tekshiriladi (handshake.auth.token, zaxira — ?token=): yaroqli bo'lsa ulanish
// STAFF_ROOM'ga, aks holda PUBLIC_ROOM'ga qo'shiladi (ulanish rad etilmaydi — login ekrani va TV ham
// aloqa holatini bilsin). Xona faqat ulanishda belgilanadi: renderer token o'zgarganda qayta ulanadi.
// Boshqa modullar (masalan menyu — stop list) ham shu gateway orqali xabar yuboradi (OrdersModule eksport qiladi).
@WebSocketGateway({ cors: { origin: true } })
export class OrdersGateway implements OnModuleInit, OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger('OrdersGateway');
  private readonly socketAuth: SocketAuth;

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly stationPrint: StationPrintService,
    config: ConfigService,
    dataSource: DataSource,
  ) {
    this.socketAuth = new SocketAuth(config, dataSource);
  }

  /**
   * Token ulanish OCHILISHIDAN OLDIN (middleware) tekshiriladi: mijozga 'connect' kelgan paytda xona
   * aniq bo'ladi va hech bir hodisa oraliqda adashib qolmaydi. Middleware hech qachon xato qaytarmaydi.
   * (Nest ikkala gateway — OrdersGateway va PrintingGateway — uchun bitta Socket.IO serverni ishlatadi.)
   */
  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.socketAuth
        .verify(socketTokenOf(socket.handshake), socket.handshake.address)
        .catch(() => null)
        .then((user) => {
          socket.data.staff = !!user;
          next();
        });
    });
  }

  handleConnection(socket: Socket): void {
    void socket.join(socket.data?.staff === true ? STAFF_ROOM : PUBLIC_ROOM);
  }

  /**
   * Bo'lim cheklari navbati (StationPrintService) hodisalarini socket'ga uzatamiz:
   *  'failed'    -> print:failed     (chek chiqmadi / 3 soat ichida chiqmadi — kassa ogohlantiradi)
   *  'recovered' -> print:recovered  (chiqmay turgan chek printer tiklangach chiqdi)
   * Buyurtmalar servisi o'zi print:failed yubormaydi — har bir xabar faqat shu yerdan bir marta ketadi.
   * ('status' -> printers:status hodisasini PrintingGateway uzatadi — bu yerda emas, ikki marta ketmasin.)
   */
  onModuleInit(): void {
    const events = (this.stationPrint as unknown as { events?: EventEmitter }).events;
    if (!events || typeof events.on !== 'function') {
      this.logger.warn('Bo‘lim cheklari hodisalari topilmadi — print:failed / print:recovered yuborilmaydi');
      return;
    }
    events.on('failed', (payload: PrintFailedPayload) => this.emitPrintFailed(payload));
    events.on('recovered', (payload: PrintRecoveredPayload) => this.emitPrintRecovered(payload));
  }

  /** Faqat xodimlarga (STAFF_ROOM). Socket server hali ko'tarilmagan bo'lsa (ishga tushish payti) — jim o'tkazib yuboramiz */
  private emit(event: string, payload: unknown): void {
    try {
      this.server?.to(STAFF_ROOM).emit(event, payload);
    } catch (e) {
      this.logger.warn(`${event} yuborilmadi: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Navbat tablosiga (PUBLIC_ROOM) yuksiz signal: buyurtma ochildi / holati o'zgardi / yopildi */
  private pingQueue(): void {
    try {
      this.server?.to(PUBLIC_ROOM).emit(QUEUE_CHANGED_EVENT);
    } catch (e) {
      this.logger.warn(`${QUEUE_CHANGED_EVENT} yuborilmadi: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** source 'split' — hisob bo'lishdan paydo bo'lgan yangi hisob (yangi taom yo'q, kassa cheki chiqmaydi) */
  emitOrderCreated(order: Order, source?: OrderCreatedPayload['source']) {
    const payload: OrderCreatedPayload = source ? { order, source } : { order };
    this.emit(SOCKET_EVENTS.ORDER_CREATED, payload);
    this.pingQueue();
  }

  emitOrderUpdated(order: Order) {
    this.emit(SOCKET_EVENTS.ORDER_UPDATED, {
      orderId: order.id,
      status: order.status,
      order,
    });
    this.pingQueue();
  }

  emitOrderClosed(order: Order) {
    this.emit(SOCKET_EVENTS.ORDER_CLOSED, { order });
    this.pingQueue();
  }

  // Hisob (schot) chekini printerli terminalda (kassa) chop etish (relay)
  emitPrintBill(order: Order) {
    this.emit(SOCKET_EVENTS.PRINT_BILL, { order });
  }

  // To'lov chekini printerli terminalda (kassa) chop etish (relay)
  emitPrintReceipt(receipt: Receipt) {
    this.emit(SOCKET_EVENTS.PRINT_RECEIPT, { receipt });
  }

  // Bo'lim (oshxona/bar...) printeriga chek chiqmadi — barcha xodimlarga yuboriladi,
  // kassa ekrani ogohlantirish ko'rsatadi (taom og'zaki yetkazilsin)
  emitPrintFailed(payload: PrintFailedPayload) {
    this.emit(SOCKET_EVENTS.PRINT_FAILED, payload);
  }

  // Chiqmay turgan chek printer tiklangach chiqdi — kassa "kechikkan chek chiqdi" deb ko'rsatadi
  emitPrintRecovered(payload: PrintRecoveredPayload) {
    this.emit(SOCKET_EVENTS.PRINT_RECOVERED, payload);
  }

  // Otkaz: yuborilgan taom(lar) yoki butun hisob bekor qilindi — KDS qizil ogohlantirish ko'rsatadi
  emitOrderVoided(payload: OrderVoidedPayload) {
    this.emit(SOCKET_EVENTS.ORDER_VOIDED, payload);
  }

  // Menyu o'zgardi (stop list: taom tugadi / qaytdi) — ekranlar menyuni qayta yuklaydi
  emitMenuChanged(payload: { itemId: string; available?: boolean } & Record<string, unknown>) {
    this.emit(SOCKET_EVENTS.MENU_CHANGED, payload);
  }
}
