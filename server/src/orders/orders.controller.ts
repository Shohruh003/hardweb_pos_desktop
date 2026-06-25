import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrdersService } from './orders.service';
import {
  AddExciseDto,
  CreateOrderDto,
  PayOrderDto,
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
  @Get('history')
  history(@Query('waiterId') waiterId?: string) {
    return this.orders.history(waiterId);
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

  // Aksiz kodlarini skanerlab saqlash (TZ F-8.6)
  @Post(':id/excise')
  addExcise(@Param('id') id: string, @Body() dto: AddExciseDto) {
    return this.orders.addExciseCodes(id, dto.codes);
  }

  // Kassa: to'lov va hisobni yopish
  @Post(':id/pay')
  pay(
    @Param('id') id: string,
    @Body() dto: PayOrderDto,
    @Request() req: any,
  ) {
    return this.orders.pay(id, dto, req.user.id);
  }
}
