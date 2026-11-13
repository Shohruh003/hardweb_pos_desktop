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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Receipt } from '@hardweb-pos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FORBIDDEN_MESSAGE } from '../auth/user-view';
import { HistoryQuery, OrdersService } from './orders.service';
import {
  AddExciseDto,
  CancelOrderDto,
  ChangeOrderTypeDto,
  ChangeWaiterDto,
  CreateOrderDto,
  DeliveryInfoDto,
  ItemPriceDto,
  MoveTableDto,
  PayMultiDto,
  PayOrderDto,
  RefundDto,
  RemoveItemsDto,
  SetCustomerDto,
  SetNoteDto,
  SplitOrderDto,
  UpdateOrderStatusDto,
} from './dto';
import {
  PRICE_FORBIDDEN_MESSAGE,
  VOID_FORBIDDEN_MESSAGE,
  WAITER_CHANGE_FORBIDDEN_MESSAGE,
  can,
  canChangeWaiter,
  canOperateOrders,
  canViewAllHistory,
  canVoid,
} from './order-rules';

// Ruxsat (capability) tekshiruvi. req.user = { id, role, name, permissions } —
// JwtStrategy uni har so'rovda bazadan o'qiydi; Direktor/SuperAdmin barcha ruxsatga ega.
function assertCapability(req: any, capability: string): void {
  if (!can(req?.user, capability)) {
    throw new ForbiddenException(FORBIDDEN_MESSAGE);
  }
}

// Buyurtma bilan ishlash (stol, tur, bo'lish, schot, yetkazish): ofitsiant yoki kassir
function assertOperate(req: any): void {
  if (!canOperateOrders(req?.user)) {
    throw new ForbiddenException(FORBIDDEN_MESSAGE);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // Ochiq buyurtmalar — barcha turlar; ?type=stol|olib_ketish|yetkazish — bitta tur
  @Get()
  findActive(@Query('type') type?: string) {
    return this.orders.findActive(type);
  }

  // DIQQAT: statik GET marshrutlar ':id' dan OLDIN turishi shart (aks holda 'history' /
  // 'delivery-lookup' buyurtma id'si deb qabul qilinadi).

  // Cheklar tarixi (B25). Filtrlar: ?from=&to= (mahalliy sana/vaqt, yopilgan vaqt bo'yicha), type,
  // hall, tableNumber, waiterId, cashierId, paymentType, refunded, minTotal, maxTotal, q, status,
  // page, limit; eski: dateFrom, dateTo, search. Javobda summary {count, total}.
  // Ruxsat: 'history' / admin — hammasi; oshxona — ko'radi; ofitsiant — faqat o'zinikini.
  @Get('history')
  history(@Query() query: HistoryQuery, @Request() req: any) {
    return this.orders.history(query, req.user);
  }

  // Telefon bo'yicha oldingi yetkazish (manzilni avtomatik to'ldirish): DeliveryLookup | null.
  // null aniq JSON 'null' bo'lib qaytadi (bo'sh javob emas).
  @Get('delivery-lookup')
  async deliveryLookup(@Query('phone') phone: unknown, @Res() res: Response) {
    // ?phone= takrorlansa — birinchisi
    const raw = Array.isArray(phone) ? phone[0] : phone;
    const result = await this.orders.deliveryLookup(raw == null ? undefined : String(raw));
    res.json(result);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }

  // Yopilgan chek nusxasi (qayta chop etish) — 'history' ruxsati yoki administrator / direktor
  @Get(':id/receipt')
  receipt(@Param('id') id: string, @Request() req: any) {
    if (!canViewAllHistory(req?.user)) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }
    return this.orders.receiptOf(id);
  }

  @Post()
  create(@Body() dto: CreateOrderDto, @Request() req: any) {
    // Terminal tanlagan ofitsiant bo'lsa o'sha, aks holda kirgan foydalanuvchi.
    // req.user — narxni qo'lda o'zgartirish ruxsatini tekshirish uchun (B31).
    return this.orders.create(dto, dto.waiterId || req.user.id, req.user);
  }

  // Oshxona holatlari (qabul_qilindi | tayyorlanmoqda | tayyor). "yopildi" — faqat to'lov orqali.
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.orders.updateStatus(id, dto);
  }

  // Yetkazish ma'lumotlari (telefon, manzil, izoh, yetkazish narxi) — ofitsiant yoki kassa ruxsati bilan
  @Patch(':id/delivery')
  updateDelivery(
    @Param('id') id: string,
    @Body() dto: DeliveryInfoDto,
    @Request() req: any,
  ) {
    assertOperate(req);
    return this.orders.updateDelivery(id, dto);
  }

  // Yuborilgan qator narxini o'zgartirish (B31) — faqat 'void' ruxsati (kassir / administrator / direktor)
  @Patch(':id/items/:itemId/price')
  setItemPrice(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ItemPriceDto,
    @Request() req: any,
  ) {
    if (!canVoid(req?.user)) throw new ForbiddenException(PRICE_FORBIDDEN_MESSAGE);
    return this.orders.setItemPrice(id, itemId, dto, req.user);
  }

  // Schot so'raldi — stol "hisob kutilmoqda" bo'ladi (ofitsiant bosadi)
  @Post(':id/request-bill')
  requestBill(@Param('id') id: string) {
    return this.orders.requestBill(id);
  }

  // Schot mijozga berildi ("chek berildi", B23) — chop etilgandan keyin (printer bo'lmasa ham)
  @Post(':id/bill-printed')
  billPrinted(@Param('id') id: string, @Request() req: any) {
    assertOperate(req);
    return this.orders.markBillPrinted(id);
  }

  // Chekka izoh qo'shish/o'zgartirish (Примечание)
  @Post(':id/note')
  setNote(@Param('id') id: string, @Body() dto: SetNoteDto) {
    return this.orders.setNote(id, dto?.note);
  }

  // Buyurtmaga mijoz (CRM) biriktirish/o'zgartirish
  @Post(':id/customer')
  setCustomer(@Param('id') id: string, @Body() dto: SetCustomerDto) {
    return this.orders.setCustomer(id, dto?.customerId);
  }

  // Otkaz (B19): yuborilgan taomlarni (qisman miqdor bilan) bekor qilish — faqat 'void' ruxsati.
  // To'lovi bor hisob bo'shab qolsa yoki qolgan summa to'langandan kam bo'lsa — 400.
  @Post(':id/remove-items')
  removeItems(@Param('id') id: string, @Body() dto: RemoveItemsDto, @Request() req: any) {
    if (!canVoid(req?.user)) throw new ForbiddenException(VOID_FORBIDDEN_MESSAGE);
    return this.orders.removeItems(id, dto, req.user);
  }

  // Hisobni bekor qilish (otkaz) — to'lanmagan buyurtmani o'chiradi; stolda boshqa hisob qolmasa
  // stol bo'shaydi. Hisobda to'lov bo'lsa — 400. Faqat 'void' ruxsati.
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelOrderDto, @Request() req: any) {
    if (!canVoid(req?.user)) throw new ForbiddenException(VOID_FORBIDDEN_MESSAGE);
    return this.orders.cancel(id, dto?.reason ?? null, req.user);
  }

  // Hisobni bo'lish (B18) — tanlangan taomlar yangi yoki shu stoldagi boshqa hisobga
  @Post(':id/split')
  split(@Param('id') id: string, @Body() dto: SplitOrderDto, @Request() req: any) {
    assertOperate(req);
    return this.orders.split(id, dto);
  }

  // Buyurtma turini o'zgartirish (B22): Stolga / Olib ketish / Yetkazib berish
  @Post(':id/change-type')
  changeType(@Param('id') id: string, @Body() dto: ChangeOrderTypeDto, @Request() req: any) {
    assertOperate(req);
    return this.orders.changeType(id, dto);
  }

  // Hisobni boshqa stolga ko'chirish (smenit stol) — faqat stolga buyurtma; band stolga — qo'shimcha hisob
  @Post(':id/move-table')
  moveTable(@Param('id') id: string, @Body() dto: MoveTableDto, @Request() req: any) {
    assertOperate(req);
    return this.orders.moveTable(id, dto.tableId);
  }

  // Buyurtma ofitsiantini o'zgartirish (smenit ofitsant) — faqat kassir yoki administrator / direktor
  @Post(':id/change-waiter')
  changeWaiter(@Param('id') id: string, @Body() dto: ChangeWaiterDto, @Request() req: any) {
    if (!canChangeWaiter(req?.user)) {
      throw new ForbiddenException(WAITER_CHANGE_FORBIDDEN_MESSAGE);
    }
    return this.orders.changeWaiter(id, dto.waiterId);
  }

  // Hisob chekini kassa (printerli terminal) chop etsin (relay)
  @Post(':id/print-bill')
  printBill(@Param('id') id: string) {
    return this.orders.printBillRelay(id);
  }

  // To'lov chekini kassa (printerli terminal) chop etsin (relay).
  // Printersiz terminalda to'lov qilinganda chek kassadan chiqadi.
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
    @Body() dto: RefundDto,
    @Request() req: any,
  ) {
    if (!can(req?.user, 'refund')) {
      throw new ForbiddenException('Vozvrat qilish ruxsati yo‘q');
    }
    return this.orders.refund(id, dto?.reason ?? '', req.user.id, req.user.name);
  }

  // Kassa: to'lov (bo'lib to'lash — qisman yoki to'liq). To'liq bo'lganda chek chiqadi.
  // Faqat 'cashier' (kassa) ruxsati bor xodim.
  @Post(':id/pay')
  pay(
    @Param('id') id: string,
    @Body() dto: PayOrderDto,
    @Request() req: any,
  ) {
    assertCapability(req, 'cashier');
    return this.orders.pay(id, dto, req.user.id);
  }

  // Kassa: bir nechta usul bilan birdaniga to'lash (B30) — bitta tranzaksiya. Faqat 'cashier'.
  @Post(':id/pay-multi')
  payMulti(
    @Param('id') id: string,
    @Body() dto: PayMultiDto,
    @Request() req: any,
  ) {
    assertCapability(req, 'cashier');
    return this.orders.payMulti(id, dto, req.user.id);
  }

  // Buyurtma to'lovlari ro'yxati (bo'lib to'lash)
  @Get(':id/payments')
  getPayments(@Param('id') id: string) {
    return this.orders.getPayments(id);
  }

  // Qisman to'lovni bekor qilish (chek yopilmagan bo'lsa) — faqat 'cashier' ruxsati bilan
  @Delete(':id/payments/:paymentId')
  deletePayment(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Request() req: any,
  ) {
    assertCapability(req, 'cashier');
    return this.orders.deletePayment(id, paymentId);
  }
}
