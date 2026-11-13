import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { Response } from 'express';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { CategoryEntity, MenuItemEntity } from '../entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FORBIDDEN_MESSAGE, RequestUser } from '../auth/user-view';
import { OrdersGateway } from '../orders/orders.gateway';
import { MenuItem, MenuUnit, SOCKET_EVENTS, UserRole, hasCapability } from '@hardweb-pos/shared';
import { decodeStoredImage, menuImageUrl, normalizeUploadedImage } from './menu-image';

const ITEM_NOT_FOUND_MESSAGE = 'Taom topilmadi';
const CATEGORY_ORDER_MESSAGE = 'Kategoriyalar ro‘yxati noto‘g‘ri';
const AVAILABILITY_MESSAGE = 'Taom holati noto‘g‘ri (available: true yoki false)';

class CategoryDto {
  @IsString() name: string;
  @IsOptional() @IsNumber() sortOrder?: number;
}

class CategoryPatchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() sortOrder?: number;
}

class CategoryOrderDto {
  @IsArray({ message: CATEGORY_ORDER_MESSAGE })
  @IsUUID('all', { each: true, message: CATEGORY_ORDER_MESSAGE })
  ids: string[];
}

class MenuItemDto {
  @IsString() name: string;
  @IsNumber() @Min(0) price: number;
  @IsUUID() categoryId: string;
  // Rasm: 'data:image/(jpeg|png|webp);base64,…' (1 500 000 belgigacha); null/'' — rasmsiz
  @IsOptional() @IsString() image?: string | null;
  @IsOptional() @IsString() ingredients?: string;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsBoolean() exciseRequired?: boolean;
  @IsOptional() @IsEnum(MenuUnit) unit?: MenuUnit;
  @IsOptional() @IsString() stationId?: string;
  @IsOptional() @IsBoolean() favorite?: boolean;
}

class MenuItemPatchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsUUID() categoryId?: string;
  // Rasm: yangi data URL — almashtiriladi; '' yoki null — o'chiriladi; berilmasa — o'zgarmaydi
  @IsOptional() @IsString() image?: string | null;
  @IsOptional() @IsString() ingredients?: string;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsBoolean() exciseRequired?: boolean;
  @IsOptional() @IsEnum(MenuUnit) unit?: MenuUnit;
  @IsOptional() @IsString() stationId?: string;
  @IsOptional() @IsBoolean() favorite?: boolean;
}

// Stop list (B29): taom tugadi / qaytdi
class AvailabilityDto {
  @IsBoolean({ message: AVAILABILITY_MESSAGE }) available: boolean;
}

/** Stop list: 'cashier' ruxsati yoki administrator / direktor / superadmin (direktor — hasCapability orqali) */
function assertCanToggleAvailability(user: RequestUser | undefined): void {
  if (hasCapability(user, 'cashier') || user?.role === UserRole.Admin) return;
  throw new ForbiddenException(FORBIDDEN_MESSAGE);
}

/** null qilib bo'ladigan taom maydonlari (qolganlari NOT NULL — null kelsa e'tiborsiz) */
const NULLABLE_ITEM_FIELDS = new Set(['stationId', 'ingredients']);

/** Rasm bor-yo'qligi — base64 matnini o'qimasdan (SQLite typeof() qiymat kontentini yuklamaydi) */
const HAS_IMAGE_SQL = "CASE WHEN typeof(m.image) = 'text' THEN 1 ELSE 0 END";

/** Entity -> API taom: rasmning o'zi (base64) YO'Q, o'rniga imageUrl (yoki null) */
function toMenuItem(m: MenuItemEntity, hasImage: boolean): MenuItem {
  return {
    id: m.id,
    name: m.name,
    price: Number(m.price),
    categoryId: m.categoryId,
    stationId: m.stationId ?? null,
    imageUrl: hasImage ? menuImageUrl(m.id, m.imageVersion) : null,
    ingredients: m.ingredients ?? null,
    available: !!m.available,
    exciseRequired: !!m.exciseRequired,
    unit: m.unit ?? MenuUnit.Piece,
    favorite: !!m.favorite,
  };
}

/** Rasmning o'z manzili ('/api/menu/items/<id>/image?v=..' yoki to'liq http://… shakli) */
const OWN_IMAGE_URL_RE = /\/menu\/items\/[^/?#]+\/image(?:[?#]|$)/;

/**
 * So'rovdagi rasm qiymati -> o'zgarish:
 *  undefined — o'zgarmaydi (berilmagan, yoki forma mavjud rasm manzilini qaytarib yuborgan);
 *  null — o'chiriladi ('' yoki null); satr — tekshirilgan data URL (noto'g'ri bo'lsa 400).
 */
function imageChange(image: string | null | undefined): string | null | undefined {
  if (image === undefined) return undefined;
  if (image === null || image.trim() === '') return null;
  if (!/^data:/i.test(image.trim()) && OWN_IMAGE_URL_RE.test(image)) return undefined;
  return normalizeUploadedImage(image);
}

@UseGuards(JwtAuthGuard)
@Controller('menu')
export class MenuController {
  private readonly logger = new Logger('Menu');

  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    @InjectRepository(MenuItemEntity)
    private readonly items: Repository<MenuItemEntity>,
    private readonly dataSource: DataSource,
    // Socket (menu:changed) — OrdersModule eksport qiladi
    private readonly gateway: OrdersGateway,
  ) {}

  // --- O'qish (barcha rollar) ---

  @Get('categories')
  findCategories() {
    return this.categories.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  // Ofitsiant/kassa uchun: BARCHA taomlar `available` belgisi bilan (stop list, B29) — tugagan taom
  // ekranda kulrang "Tugadi" bo'lib turadi va bosilmaydi (server ham buyurtmani rad etadi).
  // Rasm — imageUrl (base64 emas)
  @Get('items')
  findItems() {
    return this.listItems({});
  }

  // Admin uchun: barcha taomlar (mavjud bo'lmaganlar ham)
  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Get('all-items')
  findAllItems() {
    return this.listItems({});
  }

  // --- Boshqaruv (faqat admin) — TZ F-4.1 ---

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Post('categories')
  createCategory(@Body() dto: CategoryDto) {
    return this.categories.save(this.categories.create(dto));
  }

  // Kategoriyalar tartibi: {ids: [...]} — ro'yxatdagilar sortOrder = 1, 2, 3...
  // (statik marshrut — 'categories/:id' dan oldin)
  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Put('categories/order')
  async orderCategories(@Body() dto: CategoryOrderDto) {
    const ids = [...new Set(dto.ids)];
    await this.dataSource.transaction(async (m) => {
      for (let i = 0; i < ids.length; i++) {
        await m.update(CategoryEntity, ids[i], { sortOrder: i + 1 });
      }
    });
    return { ok: true };
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Patch('categories/:id')
  async updateCategory(@Param('id') id: string, @Body() dto: CategoryPatchDto) {
    const patch: Partial<CategoryEntity> = {};
    if (dto.name != null) patch.name = dto.name;
    if (dto.sortOrder != null) patch.sortOrder = dto.sortOrder;
    if (Object.keys(patch).length > 0) await this.categories.update(id, patch);
    return this.categories.findOne({ where: { id } });
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Post('items')
  async createItem(@Body() dto: MenuItemDto) {
    const { image, ...rest } = dto;
    const img = imageChange(image) ?? null;
    const saved = await this.items.save(
      this.items.create({ ...rest, image: img, imageVersion: img ? 1 : 0 }),
    );
    const item = await this.oneItem(saved.id);
    this.emitMenuChanged({ itemId: item.id, available: item.available });
    return item;
  }

  // Stop list (B29): kassir bir bosishda taomni "tugadi" deb belgilaydi yoki qaytaradi.
  // Barcha ekranlar 'menu:changed' orqali menyuni yangilaydi. ('items/:id' dan alohida yo'l)
  @Patch('items/:id/availability')
  async setAvailability(
    @Req() req: { user?: RequestUser },
    @Param('id') id: string,
    @Body() dto: AvailabilityDto,
  ): Promise<MenuItem> {
    assertCanToggleAvailability(req.user);
    const exists = await this.items.exists({ where: { id } });
    if (!exists) throw new NotFoundException(ITEM_NOT_FOUND_MESSAGE);
    await this.items.update(id, { available: dto.available });
    const item = await this.oneItem(id);
    this.logger.log(
      `Stop list: «${item.name}» — ${item.available ? 'qaytdi (bor)' : 'tugadi'} (${req.user?.name ?? '-'})`,
    );
    this.emitMenuChanged({ itemId: item.id, available: item.available });
    return item;
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Patch('items/:id')
  async updateItem(@Param('id') id: string, @Body() dto: MenuItemPatchDto) {
    const current = await this.items
      .createQueryBuilder('m')
      .select('m.id', 'id')
      .addSelect(HAS_IMAGE_SQL, 'has_image')
      .where('m.id = :id', { id })
      .getRawOne<{ id: string; has_image: number }>();
    if (!current) throw new NotFoundException(ITEM_NOT_FOUND_MESSAGE);

    const { image, ...rest } = dto;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      if (value === null && !NULLABLE_ITEM_FIELDS.has(key)) continue;
      patch[key] = value;
    }
    // Rasm: yangi data URL — almashtiriladi, '' / null — o'chiriladi. Har o'zgarishda versiya +1
    // (brauzer keshidagi eski rasm yangi manzil bilan almashadi; versiya hech qachon qaytarilmaydi)
    const img = imageChange(image);
    if (img !== undefined && (img !== null || Number(current.has_image) === 1)) {
      patch.image = img;
      patch.imageVersion = () => 'image_version + 1';
    }
    if (Object.keys(patch).length > 0) {
      await this.items.update(id, patch as any);
    }
    const item = await this.oneItem(id);
    // Narx, nom, rasm yoki mavjudlik o'zgardi — ekranlar menyuni yangilasin
    if (Object.keys(patch).length > 0) this.emitMenuChanged({ itemId: item.id, available: item.available });
    return item;
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Delete('items/:id')
  async deleteItem(@Param('id') id: string) {
    const res = await this.items.delete(id);
    if (res.affected) this.emitMenuChanged({ itemId: id, available: false, deleted: true });
    return { ok: true };
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
  @Delete('categories/:id')
  async deleteCategory(@Param('id') id: string) {
    await this.categories.delete(id);
    return { ok: true };
  }

  /**
   * 'menu:changed' — barcha ekranlarga (ofitsiant, kassa) menyuni qayta yuklash signali.
   * Socket xatosi asosiy amalni (saqlashni) buzmasin.
   */
  private emitMenuChanged(payload: { itemId: string; available: boolean; deleted?: boolean }): void {
    try {
      this.gateway.server?.emit(SOCKET_EVENTS.MENU_CHANGED, payload);
    } catch (e) {
      this.logger.warn(`menu:changed yuborilmadi: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Taomlar ro'yxati — rasm matnisiz (faqat bor-yo'qligi -> imageUrl) */
  private async listItems(opts: { onlyAvailable?: boolean; id?: string }): Promise<MenuItem[]> {
    const qb = this.items.createQueryBuilder('m').addSelect(HAS_IMAGE_SQL, 'has_image');
    if (opts.onlyAvailable) qb.andWhere('m.available = 1');
    if (opts.id) qb.andWhere('m.id = :id', { id: opts.id });
    const { entities, raw } = await qb.getRawAndEntities<{ m_id: string; has_image: number }>();
    const hasImage = new Map(raw.map((r) => [r.m_id, Number(r.has_image) === 1]));
    return entities.map((m) => toMenuItem(m, hasImage.get(m.id) ?? false));
  }

  /** Bitta taom (yaratish/tahrirlash javobi) yoki 404 */
  private async oneItem(id: string): Promise<MenuItem> {
    const [item] = await this.listItems({ id });
    if (!item) throw new NotFoundException(ITEM_NOT_FOUND_MESSAGE);
    return item;
  }
}

// Taom rasmi — OCHIQ marshrut (JWT yo'q): <img> so'rovi Authorization sarlavhasini yubora
// olmaydi. Manzilda ?v=<versiya> bor, shuning uchun javob "o'zgarmas" deb uzoq keshlanadi.
@Controller('menu/items')
export class MenuImageController {
  constructor(
    @InjectRepository(MenuItemEntity)
    private readonly items: Repository<MenuItemEntity>,
  ) {}

  @Get(':id/image')
  async image(@Param('id') id: string, @Res() res: Response) {
    const row = await this.items
      .createQueryBuilder('m')
      .select('m.id')
      .addSelect('m.image') // select:false ustun — aniq so'raladi
      .where('m.id = :id', { id })
      .getOne();
    const img = decodeStoredImage(row?.image);
    // 404 javobi keshlanmaydi (kesh sarlavhalari faqat muvaffaqiyatli javobga qo'yiladi)
    if (!img) throw new NotFoundException('Rasm topilmadi');
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Content-Length', String(img.data.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(img.data);
  }
}
