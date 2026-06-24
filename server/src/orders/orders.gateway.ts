import {
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { SOCKET_EVENTS, Order } from '@hardweb-pos/shared';

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
}
