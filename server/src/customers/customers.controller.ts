import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsOptional, IsString } from 'class-validator';
import { CustomerEntity } from '../entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FORBIDDEN_MESSAGE } from '../auth/user-view';
import { can, isAdminRole } from '../orders/order-rules';

class CustomerDto {
  @IsString() name: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() note?: string;
}

class CustomerPatchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() note?: string;
}

/**
 * Mijozlarni boshqarish (qo'shish / tahrir / o'chirish) — faqat 'customers' ruxsati yoki
 * administrator / direktor. UI'da ham faqat Boshqaruv -> Mijozlar bo'limi (shu ruxsat bilan) qo'shadi;
 * ofitsiant va kassa mavjud mijozni tanlaydi xolos.
 */
function assertCanManageCustomers(req: any): void {
  if (can(req?.user, 'customers') || isAdminRole(req?.user)) return;
  throw new ForbiddenException(FORBIDDEN_MESSAGE);
}

// Mijozlar (CRM): ro'yxat — barcha tizimga kirgan xodimlarga (ofitsiant/kassa buyurtmaga biriktiradi),
// boshqaruv — assertCanManageCustomers.
@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(
    @InjectRepository(CustomerEntity)
    private readonly customers: Repository<CustomerEntity>,
  ) {}

  @Get()
  findAll() {
    return this.customers.find({ order: { createdAt: 'DESC' } });
  }

  @Post()
  create(@Body() dto: CustomerDto, @Request() req: any) {
    assertCanManageCustomers(req);
    return this.customers.save(
      this.customers.create({ name: dto.name, phone: dto.phone ?? '', note: dto.note ?? null }),
    );
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: CustomerPatchDto, @Request() req: any) {
    assertCanManageCustomers(req);
    await this.customers.update(id, dto);
    return this.customers.findOne({ where: { id } });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) {
    assertCanManageCustomers(req);
    await this.customers.delete(id);
    return { ok: true };
  }
}
