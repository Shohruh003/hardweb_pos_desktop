import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsOptional, IsString } from 'class-validator';
import { CustomerEntity } from '../entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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

// Mijozlar (CRM) — barchasi tizimga kirgan foydalanuvchiga ochiq (ofitsiant biriktiradi),
// boshqaruv (qo'shish/tahrir/o'chirish) 'customers' ruxsatiga bog'liq (frontendda tekshiriladi).
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
  create(@Body() dto: CustomerDto) {
    return this.customers.save(
      this.customers.create({ name: dto.name, phone: dto.phone ?? '', note: dto.note ?? null }),
    );
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: CustomerPatchDto) {
    await this.customers.update(id, dto);
    return this.customers.findOne({ where: { id } });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.customers.delete(id);
    return { ok: true };
  }
}
