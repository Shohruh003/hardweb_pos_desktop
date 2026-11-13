import { Logger, OnModuleInit } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import type { EventEmitter } from 'events';
import {
  SOCKET_EVENTS,
  Order,
  OrderVoidedPayload,
  PrintFailedPayload,
  PrintRecoveredPayload,
  Receipt,
} from '@hardweb-pos/shared';
import { StationPrintService } from '../printing/station-print.service';

// Real-time markaz: KDS, navbat ekrani, kassa va ofitsiantlar shu yerga ulanadi (TZ 2.2).
// Boshqa modullar (masalan menyu — stop list) ham shu gateway orqali xabar yuboradi (OrdersModule eksport qiladi).
@WebSocketGateway({ cors: { origin: true } })
export class OrdersGateway implements OnModuleInit {
  private readonly logger = new Logger('OrdersGateway');

  @WebSocketServer()
  server: Server;

  constructor(private readonly stationPrint: StationPrintService) {}

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

  /** Socket server hali ko'tarilmagan bo'lsa (ishga tushish payti) — jim o'tkazib yuboramiz */
  private emit(event: string, payload: unknown): void {
    try {
      this.server?.emit(event, payload);
    } catch (e) {
      this.logger.warn(`${event} yuborilmadi: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  emitOrderCreated(order: Order) {
    this.emit(SOCKET_EVENTS.ORDER_CREATED, { order });
  }

  emitOrderUpdated(order: Order) {
    this.emit(SOCKET_EVENTS.ORDER_UPDATED, {
      orderId: order.id,
      status: order.status,
      order,
    });
  }

  emitOrderClosed(order: Order) {
    this.emit(SOCKET_EVENTS.ORDER_CLOSED, { order });
  }

  // Hisob (schot) chekini printerli terminalda (kassa) chop etish (relay)
  emitPrintBill(order: Order) {
    this.emit(SOCKET_EVENTS.PRINT_BILL, { order });
  }

  // To'lov chekini printerli terminalda (kassa) chop etish (relay)
  emitPrintReceipt(receipt: Receipt) {
    this.emit(SOCKET_EVENTS.PRINT_RECEIPT, { receipt });
  }

  // Bo'lim (oshxona/bar...) printeriga chek chiqmadi — hammaga yuboriladi,
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
