import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { Allow, IsArray, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { OrderEntity, TableEntity } from '../entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrderStatus, UserRole } from '@hardweb-pos/shared';
import { SettingsService } from '../settings/settings.service';
import { hallComparator, normalizeHallList } from './hall-order';

/** Bir martada yaratiladigan stollar soni chegarasi (POST /tables/bulk) */
const BULK_MAX = 200;

const HALL_NAME_MESSAGE = 'Zal nomini kiriting';
const HALL_LIST_MESSAGE = 'Zallar ro‘yxati noto‘g‘ri';
const RANGE_MESSAGE = 'Stol raqamlari oralig‘i noto‘g‘ri';
const HALL_PERCENT_MESSAGE = 'Foiz 0 dan 100 gacha bo‘lishi kerak';
/** Bitta zalda bir xil raqamli ikkita stol bo'lmaydi (ofitsiant/kassa qaysi biri ekanini ajrata olmaydi) */
const duplicateTableMessage = (n: number) => `Bu zalda ${n}-stol allaqachon bor`;

/** Foiz qiymati to'g'rimi (0..100, chekli son) */
const validPercent = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

class TableDto {
  @IsInt() @Min(1) number: number;
  @IsString() hall: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}

class TablePatchDto {
  @IsOptional() @IsInt() @Min(1) number?: number;
  @IsOptional() @IsString() hall?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}

class HallOrderDto {
  @IsArray({ message: HALL_LIST_MESSAGE })
  @IsString({ each: true, message: HALL_LIST_MESSAGE })
  halls: string[];
}

class HallRenameDto {
  @IsString({ message: HALL_NAME_MESSAGE }) from: string;
  @IsString({ message: 'Yangi zal nomini kiriting' }) to: string;
}

class HallDeleteDto {
  @IsString({ message: HALL_NAME_MESSAGE }) hall: string;
}

class TableBulkDto {
  @IsString({ message: HALL_NAME_MESSAGE }) hall: string;
  @IsInt({ message: RANGE_MESSAGE }) @Min(1, { message: RANGE_MESSAGE }) from: number;
  @IsInt({ message: RANGE_MESSAGE }) @Min(1, { message: RANGE_MESSAGE }) to: number;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  // Yangi zal uchun alohida xizmat haqi foizi (ixtiyoriy; berilmasa — umumiy foiz)
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: HALL_PERCENT_MESSAGE })
  @Min(0, { message: HALL_PERCENT_MESSAGE })
  @Max(100, { message: HALL_PERCENT_MESSAGE })
  servicePercent?: number;
}

// Zalning alohida xizmat haqi foizi: percent — 0..100, null — o'chirish (umumiy foiz qo'llanadi).
// percent maydoni tekshiruvi controllerda (null ruxsat etilgani uchun).
class HallServiceDto {
  @IsString({ message: HALL_NAME_MESSAGE }) hall: string;
  @Allow() percent?: number | null;
}

const ADMIN_ROLES = [UserRole.Admin, UserRole.Director, UserRole.SuperAdmin];

@UseGuards(JwtAuthGuard)
@Controller('tables')
export class TablesController {
  constructor(
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    private readonly settings: SettingsService,
    private readonly dataSource: DataSource,
  ) {}

  // Stollar ro'yxati va holati (TZ F-1.2): zallar sozlamadagi tartibda (ro'yxatda yo'qlari —
  // oxirida, alifbo bo'yicha), har zal ichida stol raqami bo'yicha
  @Get()
  async findAll() {
    const rows = await this.tables.find();
    const { hallOrder } = await this.settings.get();
    const cmp = hallComparator(hallOrder);
    return rows.sort((a, b) => cmp(a.hall, b.hall) || a.number - b.number);
  }

  // --- Boshqaruv (faqat admin) — TZ F-4.2 ---
  // Statik marshrutlar (hall-order, hall/rename, hall/delete, bulk) ':id' marshrutlaridan OLDIN.

  // Zallar tartibi: {halls: [...]} -> {ok, hallOrder}
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Put('hall-order')
  async setHallOrder(@Body() dto: HallOrderDto) {
    const saved = await this.settings.update({ hallOrder: normalizeHallList(dto.halls) });
    return { ok: true, hallOrder: normalizeHallList(saved.hallOrder) };
  }

  // Zalning alohida xizmat haqi foizi: {hall, percent} -> {ok, hallServicePercent}.
  // percent: 0..100 — shu zalga yangi ochiladigan hisoblarga; null — o'chirish (umumiy foiz).
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Put('hall-service')
  async setHallService(@Body() dto: HallServiceDto) {
    const hall = (dto.hall ?? '').trim();
    if (!hall) throw new BadRequestException(HALL_NAME_MESSAGE);
    const percent = dto.percent;
    if (percent !== null && !validPercent(percent)) {
      throw new BadRequestException(HALL_PERCENT_MESSAGE);
    }
    const hallServicePercent = await this.settings.setHallServicePercent(hall, percent);
    return { ok: true, hallServicePercent };
  }

  // Zal nomini o'zgartirish — barcha stollarda, zallar tartibida va zal xizmat haqi foizida
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Post('hall/rename')
  async renameHall(@Body() dto: HallRenameDto) {
    const from = dto.from;
    const to = (dto.to ?? '').trim();
    if (!to) throw new BadRequestException('Yangi zal nomini kiriting');
    if (to === from) return { ok: true, updated: 0 };

    // Boshqa zal shu nom bilan bormi (katta-kichik harfdan qat'i nazar; o'zi hisobga olinmaydi)
    const halls = await this.distinctHalls();
    const clash = halls.some(
      (h) => h !== from && h.trim().toLowerCase() === to.toLowerCase(),
    );
    if (clash) throw new BadRequestException('Bunday zal allaqachon bor');

    const updated = await this.tables.count({ where: { hall: from } });
    if (updated > 0) await this.tables.update({ hall: from }, { hall: to });

    await this.settings.renameHall(from, to);
    return { ok: true, updated };
  }

  // Zalni o'chirish — barcha stollari bilan. Ochiq buyurtmasi bor zal o'chirilmaydi.
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Post('hall/delete')
  async deleteHall(@Body() dto: HallDeleteDto) {
    const hall = dto.hall;
    const rows = await this.tables.find({ where: { hall } });
    const ids = rows.map((t) => t.id);
    if (ids.length > 0) {
      const open = await this.orders.count({
        where: { tableId: In(ids), status: Not(OrderStatus.Closed) },
      });
      if (open > 0) {
        throw new BadRequestException('Bu zalda ochiq buyurtma bor — avval yoping');
      }
      await this.tables.delete(ids);
    }
    await this.settings.removeHall(hall);
    return { ok: true, deleted: ids.length };
  }

  // Bir zalga ko'p stol qo'shish: {hall, from, to, capacity?, servicePercent?} — zalda yo'q raqamlar
  // yaratiladi; servicePercent berilsa — shu zalning alohida xizmat haqi foizi bo'ladi
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Post('bulk')
  async bulkCreate(@Body() dto: TableBulkDto) {
    const hall = (dto.hall ?? '').trim();
    if (!hall) throw new BadRequestException(HALL_NAME_MESSAGE);
    if (dto.from > dto.to) throw new BadRequestException(RANGE_MESSAGE);
    if (dto.to - dto.from + 1 > BULK_MAX) {
      throw new BadRequestException(`Bir martada ko‘pi bilan ${BULK_MAX} ta stol qo‘shiladi`);
    }
    const existing = new Set(
      (await this.tables.find({ where: { hall } })).map((t) => t.number),
    );
    const rows: Partial<TableEntity>[] = [];
    for (let n = dto.from; n <= dto.to; n++) {
      if (!existing.has(n)) rows.push({ number: n, hall, capacity: dto.capacity ?? 4 });
    }
    if (rows.length > 0) {
      await this.dataSource.transaction((m) => m.getRepository(TableEntity).save(rows));
    }
    if (dto.servicePercent !== undefined && dto.servicePercent !== null) {
      await this.settings.setHallServicePercent(hall, dto.servicePercent);
    }
    return { ok: true, created: rows.length };
  }

  // Bitta stol. Zal nomi chetidagi bo'shliqlarsiz saqlanadi (bulk bilan bir xil); shu zalda shu raqamli
  // stol bo'lsa — 400
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Post()
  async create(@Body() dto: TableDto) {
    const hall = (dto.hall ?? '').trim();
    if (!hall) throw new BadRequestException(HALL_NAME_MESSAGE);
    await this.assertNumberFree(hall, dto.number);
    return this.tables.save(this.tables.create({ ...dto, hall }));
  }

  // Raqam yoki zal o'zgarsa — yangi (zal, raqam) juftligi boshqa stolda band bo'lmasligi kerak.
  // Juftlik o'zgarmasa (masalan faqat o'rindiqlar soni) tekshirilmaydi — eski takror stol ham tahrirlanadi.
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: TablePatchDto) {
    // null — "o'zgarmaydi" (ustunlar NOT NULL)
    const patch: Partial<TableEntity> = {};
    if (dto.number != null) patch.number = dto.number;
    if (dto.hall != null) {
      patch.hall = dto.hall.trim();
      if (!patch.hall) throw new BadRequestException(HALL_NAME_MESSAGE);
    }
    if (dto.capacity != null) patch.capacity = dto.capacity;
    if (patch.number !== undefined || patch.hall !== undefined) {
      const current = await this.tables.findOne({ where: { id } });
      if (current) {
        const hall = patch.hall ?? current.hall;
        const number = patch.number ?? current.number;
        if (hall !== current.hall || number !== current.number) {
          await this.assertNumberFree(hall, number, id);
        }
      }
    }
    // Bo'sh tana — o'zgarish yo'q (TypeORM bo'sh update'da xato beradi)
    if (Object.keys(patch).length > 0) await this.tables.update(id, patch);
    return this.tables.findOne({ where: { id } });
  }

  // Stolni o'chirish — ochiq buyurtmasi bo'lsa mumkin emas
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const open = await this.orders.count({
      where: { tableId: id, status: Not(OrderStatus.Closed) },
    });
    if (open > 0) throw new BadRequestException('Stolda ochiq buyurtma bor');
    await this.tables.delete(id);
    return { ok: true };
  }

  /** Shu zalda shu raqamli boshqa stol bormi (exceptId — tahrirlanayotgan stolning o'zi hisobga olinmaydi) -> 400 */
  private async assertNumberFree(hall: string, number: number, exceptId?: string): Promise<void> {
    const taken = await this.tables.exists({
      where: { hall, number, ...(exceptId ? { id: Not(exceptId) } : {}) },
    });
    if (taken) throw new BadRequestException(duplicateTableMessage(number));
  }

  /** Mavjud zallar nomlari (takrorsiz) */
  private async distinctHalls(): Promise<string[]> {
    const rows = await this.tables
      .createQueryBuilder('t')
      .select('DISTINCT t.hall', 'hall')
      .getRawMany<{ hall: string }>();
    return rows.map((r) => r.hall).filter((h): h is string => typeof h === 'string');
  }
}
