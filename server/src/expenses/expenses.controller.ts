import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ExpenseEntity } from '../entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@hardweb-pos/shared';

class CreateExpenseDto {
  @IsNumber() @Min(1) amount: number;
  @IsOptional() @IsString() note?: string;
}

// Kassir rasxodlari — kassir kiritadi, direktor/admin ham ko'radi
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Cashier, UserRole.Admin, UserRole.Director)
@Controller('expenses')
export class ExpensesController {
  constructor(
    @InjectRepository(ExpenseEntity)
    private readonly expenses: Repository<ExpenseEntity>,
  ) {}

  // ?date=YYYY-MM-DD (berilmasa — bugun)
  @Get()
  async list(@Query('date') date?: string) {
    const day = date ? new Date(date) : new Date();
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    const rows = await this.expenses.find({
      where: { createdAt: Between(start, end) },
      order: { createdAt: 'DESC' },
    });
    const total = rows.reduce((s, e) => s + Number(e.amount), 0);
    return { items: rows, total };
  }

  @Post()
  async create(@Body() dto: CreateExpenseDto, @Request() req: any) {
    const saved = await this.expenses.save(
      this.expenses.create({
        amount: dto.amount,
        note: dto.note ?? null,
        cashierId: req.user.id,
        cashierName: req.user.name ?? null,
      }),
    );
    return saved;
  }
}
