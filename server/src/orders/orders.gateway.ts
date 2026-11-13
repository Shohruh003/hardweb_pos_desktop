import {
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import {
  SOCKET_EVENTS,
  Order,
  PrintFailedPayload,
  Receipt,
} from '@hardweb-pos/shared';

// Real-time markaz: KDS, navbat ekrani va ofitsiantlar shu yerga ulanadi (TZ 2.2)
@WebSocketGateway({ cors: { origin: true } })
export class OrdersGateway {
  @WebSocketServer()
  server: Server;

  emitOrderCreated(order: Order) {
    this.server.emit(SOCKET_EVENTS.ORDER_CREATED, { order });
  }

  emitOrderUpdated(order: Order) {
    this.server.emit(SOCKET_EVENTS.ORDER_UPDATED, {
      orderId: order.id,
      status: order.status,
      order,
    });
  }

  emitOrderClosed(order: Order) {
    this.server.emit(SOCKET_EVENTS.ORDER_CLOSED, { order });
  }

  // Hisob (schot) chekini printerli terminalда (kassa) chop etish (relay)
  emitPrintBill(order: Order) {
    this.server.emit(SOCKET_EVENTS.PRINT_BILL, { order });
  }

  // To'lov chekini printerli terminalда (kassa) chop etish (relay)
  emitPrintReceipt(receipt: Receipt) {
    this.server.emit(SOCKET_EVENTS.PRINT_RECEIPT, { receipt });
  }

  // Bo'lim (oshxona/bar...) printeriga chek chiqmadi — hammaga yuboriladi,
  // kassa ekrani ogohlantirish ko'rsatadi (taom og'zaki yetkazilsin)
  emitPrintFailed(payload: PrintFailedPayload) {
    this.server.emit(SOCKET_EVENTS.PRINT_FAILED, payload);
  }
}
