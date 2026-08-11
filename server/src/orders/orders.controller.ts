import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Receipt } from '@hardweb-pos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HistoryQuery, OrdersService } from './orders.service';
import {
  AddExciseDto,
  CreateOrderDto,
  PayOrderDto,
  SetNoteDto,
  UpdateOrderStatusDto,
} from './dto';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  findActive() {
    return this.orders.findActive();
  }

  // Tarix — ':id' dan oldin turishi shart (aks holda 'history' id deb qabul qilinadi)
  // Filtr/pagination: ?page=1&limit=20&waiterId=&status=&dateFrom=&dateTo=&paymentType=&hall=&search=
  @Get('history')
  history(@Query() query: HistoryQuery) {
    return this.orders.history(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateOrderDto, @Request() req: any) {
    // Terminal tanlagan ofitsiant bo'lsa o'sha, aks holda kirgan foydalanuvchi
    return this.orders.create(dto, dto.waiterId || req.user.id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.orders.updateStatus(id, dto);
  }

  // Schot so'raldi — stol "hisob kutilmoqda" bo'ladi (ofitsiant bosadi)
  @Post(':id/request-bill')
  requestBill(@Param('id') id: string) {
    return this.orders.requestBill(id);
  }

  // Chekka izoh qo'shish/o'zgartirish (Примечание)
  @Post(':id/note')
  setNote(@Param('id') id: string, @Body() dto: SetNoteDto) {
    return this.orders.setNote(id, dto?.note);
  }

  // Buyurtmadan ayrim taomlarni olib tashlash (qaytarish)
  @Post(':id/remove-items')
  removeItems(@Param('id') id: string, @Body() dto: { itemIds: string[] }) {
    return this.orders.removeItems(id, dto?.itemIds ?? []);
  }

  // Schotni bekor qilish (annul) — to'lanmagan buyurtmani o'chirib, stolni bo'shatadi
  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.orders.cancel(id);
  }

  // Buyurtmani boshqa stolga ko'chirish (smenit stol)
  @Post(':id/move-table')
  moveTable(@Param('id') id: string, @Body() dto: { tableId: string }) {
    return this.orders.moveTable(id, dto?.tableId);
  }

  // Buyurtma ofitsiantини o'zgartirish (smenit ofitsant)
  @Post(':id/change-waiter')
  changeWaiter(@Param('id') id: string, @Body() dto: { waiterId: string }) {
    return this.orders.changeWaiter(id, dto?.waiterId);
  }

  // Hisob chekini kassa (printerli terminal) chop etsin (relay)
  @Post(':id/print-bill')
  printBill(@Param('id') id: string) {
    return this.orders.printBillRelay(id);
  }

  // To'lov chekini kassa (printerli terminal) chop etsin (relay).
  // Printersiz terminalда to'lov qilinganда chek kassadan chiqadi.
  @Post('print-receipt')
  printReceipt(@Body() receipt: Receipt) {
    return this.orders.printReceiptRelay(receipt);
  }

  // Aksiz kodlarini skanerlab saqlash (TZ F-8.6)
  @Post(':id/excise')
  addExcise(@Param('id') id: string, @Body() dto: AddExciseDto) {
    return this.orders.addExciseCodes(id, dto.codes);
  }

  // Vozvrat — 'refund' ruxsatiga ega xodim (Direktor/SuperAdmin avtomatik ega).
  @Post(':id/refund')
  refund(
    @Param('id') id: string,
    @Body() dto: { reason?: string },
    @Request() req: any,
  ) {
    const perms: string[] = req.user?.permissions ?? [];
    if (!perms.includes('refund')) {
      throw new ForbiddenException('Vozvrat qilish ruxsati yo‘q');
    }
    return this.orders.refund(id, dto.reason ?? '', req.user.id, req.user.name);
  }

  // Kassa: to'lov (bo'lib to'lash — qisman yoki to'liq). To'liq bo'lganda chek chiqadi.
  @Post(':id/pay')
  pay(
    @Param('id') id: string,
    @Body() dto: PayOrderDto,
    @Request() req: any,
  ) {
    return this.orders.pay(id, dto, req.user.id);
  }

  // Buyurtma to'lovlari ro'yxati (bo'lib to'lash)
  @Get(':id/payments')
  getPayments(@Param('id') id: string) {
    return this.orders.getPayments(id);
  }

  // Qisman to'lovni bekor qilish (chek yopilmagan bo'lsa)
  @Delete(':id/payments/:paymentId')
  deletePayment(@Param('id') id: string, @Param('paymentId') paymentId: string) {
    return this.orders.deletePayment(id, paymentId);
  }
}
