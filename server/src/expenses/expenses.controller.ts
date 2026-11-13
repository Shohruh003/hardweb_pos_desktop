import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ExpenseEntity } from '../entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CashMovementKind, UserRole, roundSum } from '@hardweb-pos/shared';
import { inRangeSql, rangeParams, resolveDay, resolveRange } from '../reports/report-dates';

export const EXPENSE_AMOUNT_MESSAGE = 'Summa noto‘g‘ri (butun so‘m, 1 dan 1 000 000 000 gacha)';
export const EXPENSE_KIND_MESSAGE = 'Turi noto‘g‘ri (kirim yoki chiqim)';
export const EXPENSE_NOTE_MESSAGE = 'Izoh juda uzun (300 belgigacha)';
export const EXPENSE_NOT_FOUND_MESSAGE = 'Yozuv topilmadi';

const KINDS: CashMovementKind[] = ['kirim', 'chiqim'];

class CreateExpenseDto {
  @IsInt({ message: EXPENSE_AMOUNT_MESSAGE })
  @Min(1, { message: EXPENSE_AMOUNT_MESSAGE })
  @Max(1_000_000_000, { message: EXPENSE_AMOUNT_MESSAGE })
  amount: number;

  @IsOptional()
  @IsString({ message: EXPENSE_NOTE_MESSAGE })
  @MaxLength(300, { message: EXPENSE_NOTE_MESSAGE })
  note?: string;

  // Berilmasa — chiqim (eski mijozlar faqat rasxod yuboradi)
  @IsOptional()
  @IsIn(KINDS, { message: EXPENSE_KIND_MESSAGE })
  kind?: CashMovementKind;
}

/** Ro'yxat qatori (summa — butun so'm, son ko'rinishida) */
function view(e: ExpenseEntity) {
  return {
    id: e.id,
    amount: roundSum(e.amount),
    kind: (e.kind === 'kirim' ? 'kirim' : 'chiqim') as CashMovementKind,
    note: e.note ?? null,
    cashierId: e.cashierId,
    cashierName: e.cashierName ?? null,
    createdAt: e.createdAt,
  };
}

/** So'rov parametri (takrorlansa — birinchisi), bo'sh bo'lsa undefined */
function queryStr(v: unknown): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  return s ? s : undefined;
}

// Kassa harakatlari: kirim / chiqim (B33). Kassir kiritadi, administrator va direktor ham ko'radi;
// o'chirish — faqat direktor (superadmin).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Cashier, UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
@Controller('expenses')
export class ExpensesController {
  constructor(
    @InjectRepository(ExpenseEntity)
    private readonly expenses: Repository<ExpenseEntity>,
  ) {}

  /**
   * ?from=YYYY-MM-DD&to=YYYY-MM-DD (mahalliy, ikkalasi kiradi) yoki eski ?date=YYYY-MM-DD; hech biri
   * bo'lmasa — bugun. ?kind=kirim|chiqim — bitta tur (berilmasa — ikkalasi).
   * Javob: { items, total, kirim, chiqim }. total — eski mijozlar bilan moslik uchun: kind berilsa
   * o'sha tur yig'indisi, berilmasa CHIQIM (rasxod) yig'indisi ("Sof tushum = tushum − rasxod").
   */
  @Get()
  async list(@Query() q: Record<string, unknown>) {
    const kindRaw = queryStr(q.kind);
    if (kindRaw !== undefined && !KINDS.includes(kindRaw as CashMovementKind)) {
      throw new BadRequestException(EXPENSE_KIND_MESSAGE);
    }
    const kind = kindRaw as CashMovementKind | undefined;
    const range =
      queryStr(q.from) !== undefined || queryStr(q.to) !== undefined
        ? resolveRange(q.from, q.to)
        : resolveDay(q.date);

    const qb = this.expenses
      .createQueryBuilder('e')
      .where(inRangeSql('e.created_at'), rangeParams(range))
      .orderBy('e.createdAt', 'DESC');
    if (kind === 'kirim') qb.andWhere("e.kind = 'kirim'");
    else if (kind === 'chiqim') qb.andWhere("(e.kind IS NULL OR e.kind <> 'kirim')");
    const rows = (await qb.getMany()).map(view);

    const kirim = rows.filter((r) => r.kind === 'kirim').reduce((s, r) => s + r.amount, 0);
    const chiqim = rows.filter((r) => r.kind === 'chiqim').reduce((s, r) => s + r.amount, 0);
    return {
      from: range.from,
      to: range.to,
      items: rows,
      total: kind === 'kirim' ? kirim : chiqim,
      kirim,
      chiqim,
    };
  }

  @Post()
  async create(@Body() dto: CreateExpenseDto, @Request() req: any) {
    const saved = await this.expenses.save(
      this.expenses.create({
        amount: dto.amount,
        kind: dto.kind === 'kirim' ? 'kirim' : 'chiqim',
        note: dto.note?.trim() || null,
        cashierId: req.user.id,
        cashierName: req.user.name ?? null,
      }),
    );
    return view(saved);
  }

  // Xato kiritilgan yozuvni o'chirish — faqat direktor (kassa hisobiga ta'sir qiladi)
  @Roles(UserRole.Director, UserRole.SuperAdmin)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const row = await this.expenses.findOne({ where: { id } });
    if (!row) throw new NotFoundException(EXPENSE_NOT_FOUND_MESSAGE);
    await this.expenses.delete(id);
    return { ok: true };
  }
}
