import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  PRODUCT_NAME_REQUIRED_MESSAGE,
  PRODUCT_NAME_TAKEN_MESSAGE,
  PRODUCT_NOT_FOUND_MESSAGE,
  Product,
  RecipeItem,
  STOCK_QTY_INVALID_MESSAGE,
  STOCK_UNIT_LOCKED_MESSAGE,
  StockMovement,
  productInRecipesMessage,
  roundStockCost,
  roundStockQty,
  stockNotEnoughMessage,
} from '@hardweb-pos/shared';
import { MenuItemEntity, ProductEntity, RecipeItemEntity } from '../entities';
import { CreateProductDto, RecipeLineDto, UpdateProductDto } from './dto';
import { InventoryActor } from './inventory-access';
import {
  PRODUCT_UNIT_INVALID_MESSAGE,
  cleanName,
  isProductUnit,
  nameKey,
  nonNegativeCost,
  nonNegativeQty,
  productOr404,
} from './inventory-rules';
import { MovementContext, StockLedgerService } from './stock-ledger.service';

/** Buyurtmadagi taom: retsept bo'yicha ayirish va band qilish hisobi uchun */
export interface OrderLine {
  menuItemId: string;
  quantity: number;
}

/**
 * Sklad (ombor) — mahsulotlar, taom retseptlari va buyurtmalar bilan bog'liqlik: to'lovda sotuv
 * harakatlari, chek vozvratida qaytarish, buyurtmada ortiqcha sotishni tekshirish. Sklad ixtiyoriy:
 * mahsuloti yoki retsepti yo'q restoran uchun bu yerdagi hech bir tekshiruv va ayirish ishlamaydi.
 * Kirim, vozvrat, chiqim, inventarizatsiya, ishlab chiqarish — StockOperationsService.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(RecipeItemEntity)
    private readonly recipes: Repository<RecipeItemEntity>,
    private readonly ledger: StockLedgerService,
  ) {}

  // =============================================================================================
  // Mahsulotlar
  // =============================================================================================

  async listProducts(): Promise<Product[]> {
    const list = await this.products.find();
    const views = await this.productViews(this.products.manager, list, true);
    return views.sort((a, b) => a.name.localeCompare(b.name, 'uz'));
  }

  /** Yangi mahsulot. Boshlang'ich qoldiq > 0 bo'lsa — 'initial' harakati (jurnal shundan boshlanadi) */
  async createProduct(dto: CreateProductDto, actor: InventoryActor): Promise<Product> {
    const name = cleanName(dto.name);
    if (!name) throw new BadRequestException(PRODUCT_NAME_REQUIRED_MESSAGE);
    if (!isProductUnit(dto.unit)) throw new BadRequestException(PRODUCT_UNIT_INVALID_MESSAGE);
    const unit = dto.unit;
    const stock = dto.stock == null ? 0 : nonNegativeQty(dto.stock, STOCK_QTY_INVALID_MESSAGE);
    const minStock = dto.minStock == null ? 0 : nonNegativeQty(dto.minStock, STOCK_QTY_INVALID_MESSAGE);
    const avgCost = dto.unitCost == null ? 0 : nonNegativeCost(dto.unitCost);
    return this.dataSource.transaction(async (m) => {
      await assertProductNameFree(m, name);
      const product = await m.save(m.create(ProductEntity, { name, unit, stock: 0, minStock, avgCost }));
      if (stock > 0) {
        await this.ledger.applyMovements(m, [{ productId: product.id, type: 'initial', delta: stock }], {
          userId: actor.id,
          userName: actor.name,
        });
      }
      return this.productView(m, product.id);
    });
  }

  /**
   * Nom, birlik, minimal qoldiq. Qoldiq bu yerda O'ZGARMAYDI (faqat harakatlar orqali). Birlik — faqat
   * harakatlari yo'q va qoldig'i 0 mahsulotda (aks holda eski miqdorlar boshqa birlikda bo'lib qoladi).
   */
  async updateProduct(id: string, dto: UpdateProductDto): Promise<Product> {
    return this.dataSource.transaction(async (m) => {
      const product = await productOr404(m, id);
      const patch: Partial<ProductEntity> = {};
      if (dto.name != null) {
        const name = cleanName(dto.name);
        if (!name) throw new BadRequestException(PRODUCT_NAME_REQUIRED_MESSAGE);
        if (name !== product.name) {
          await assertProductNameFree(m, name, id);
          patch.name = name;
        }
      }
      if (dto.minStock != null) patch.minStock = nonNegativeQty(dto.minStock, STOCK_QTY_INVALID_MESSAGE);
      if (dto.unit != null && dto.unit !== product.unit) {
        if (!isProductUnit(dto.unit)) throw new BadRequestException(PRODUCT_UNIT_INVALID_MESSAGE);
        const [view] = await this.productViews(m, [product]);
        if (view.hasHistory || view.stock !== 0) throw new BadRequestException(STOCK_UNIT_LOCKED_MESSAGE);
        patch.unit = dto.unit;
      }
      if (Object.keys(patch).length) await m.update(ProductEntity, id, patch);
      return this.productView(m, id);
    });
  }

  /**
   * Retseptda ishlatilgan mahsulot o'chirilmaydi. Harakatlari va kirimlari qoladi (nom nusxasi bilan).
   * Yo'q mahsulotni o'chirish ham — ok.
   */
  async deleteProduct(id: string): Promise<{ ok: true }> {
    return this.dataSource.transaction(async (m) => {
      const dishes = (await recipeDishCounts(m, [id])).get(id) ?? 0;
      if (dishes > 0) throw new BadRequestException(productInRecipesMessage(dishes));
      // Qolgan retsept qatorlari — o'chirilgan taomlarniki (yetim): ular ham tozalanadi
      await m.delete(RecipeItemEntity, { productId: id });
      await m.delete(ProductEntity, { id });
      return { ok: true as const };
    });
  }

  /** Bitta mahsulot javob shaklida (tranzaksiya ichida ham) yoki 404 */
  async productView(m: EntityManager, id: string): Promise<Product> {
    const [view] = await this.productViews(m, [await productOr404(m, id)]);
    return view;
  }

  /**
   * Mahsulotlar javob shaklida: o'rtacha tannarx, nechta (mavjud) taom retseptida ishlatilgani va
   * harakatlari borligi ('initial'dan boshqa harakat yoki kirim). all=true — butun ro'yxat (IN'siz).
   */
  private async productViews(m: EntityManager, list: ProductEntity[], all = false): Promise<Product[]> {
    if (!list.length) return [];
    const ids = all ? null : list.map((p) => p.id);
    const dishes = await recipeDishCounts(m, ids);
    const history = await productsWithHistory(m, ids);
    return list.map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      stock: roundStockQty(p.stock),
      minStock: roundStockQty(p.minStock),
      avgCost: roundStockCost(p.avgCost),
      recipeCount: dishes.get(p.id) ?? 0,
      hasHistory: history.has(p.id),
    }));
  }

  // =============================================================================================
  // Retseptlar
  // =============================================================================================

  // Bir taomning retsepti (mahsulot nomi/birligi bilan)
  async getRecipe(menuItemId: string): Promise<RecipeItem[]> {
    const items = await this.recipes.find({ where: { menuItemId } });
    if (items.length === 0) return [];
    const prods = await this.products.find({ where: { id: In(items.map((r) => r.productId)) } });
    const byId = new Map(prods.map((p) => [p.id, p]));
    return items.map((r) => ({
      id: r.id,
      menuItemId: r.menuItemId,
      productId: r.productId,
      amount: roundStockQty(r.amount),
      productName: byId.get(r.productId)?.name,
      productUnit: byId.get(r.productId)?.unit,
    }));
  }

  /**
   * Taom retseptini to'liq almashtirish — bitta tranzaksiyada (yarim saqlangan retsept qolmasin).
   * 0 / bo'sh qatorlar tashlab ketiladi, bir mahsulot ikki marta kelsa — miqdorlari qo'shiladi.
   * Yo'q mahsulot — 404.
   */
  async setRecipe(menuItemId: string, items: RecipeLineDto[]): Promise<RecipeItem[]> {
    const lines = new Map<string, number>();
    for (const it of items || []) {
      const amount = roundStockQty(it?.amount);
      if (!it?.productId || !(amount > 0)) continue;
      lines.set(it.productId, roundStockQty((lines.get(it.productId) ?? 0) + amount));
    }
    await this.dataSource.transaction(async (m) => {
      if (lines.size) {
        const found = await m.count(ProductEntity, { where: { id: In([...lines.keys()]) } });
        if (found !== lines.size) throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
      }
      await m.delete(RecipeItemEntity, { menuItemId });
      if (lines.size) {
        await m.save(
          [...lines].map(([productId, amount]) => m.create(RecipeItemEntity, { menuItemId, productId, amount })),
        );
      }
    });
    return this.getRecipe(menuItemId);
  }

  // =============================================================================================
  // Buyurtmalar bilan bog'liqlik
  // =============================================================================================

  /**
   * Ortiqcha sotishni oldini olish (buyurtma yaratishda): yangi taomlarga kerakli mahsulot qoldiq
   * minus ochiq buyurtmalarda band qilinganidan oshmasin. Faqat retseptli taomlar — retseptsiz taom
   * va mahsulotsiz restoran uchun tekshiruv yo'q.
   */
  async assertStockAvailable(newItems: OrderLine[], reservedItems: OrderLine[]): Promise<void> {
    const allMenuIds = [...new Set([...newItems, ...reservedItems].map((i) => i.menuItemId))];
    if (allMenuIds.length === 0) return;
    const recipes = await this.recipes.find({ where: { menuItemId: In(allMenuIds) } });
    if (recipes.length === 0) return; // retseptsiz taomlar — cheklovsiz

    const need = needByProduct(recipes, newItems);
    if (need.size === 0) return;
    const reserved = needByProduct(recipes, reservedItems);

    const products = await this.products.find({ where: { id: In([...need.keys()]) } });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const [productId, needed] of need) {
      const p = byId.get(productId);
      if (!p) continue;
      const available = Number(p.stock) - (reserved.get(productId) || 0);
      if (needed > available + 1e-6) {
        throw new BadRequestException(stockNotEnoughMessage(p.name, available, p.unit));
      }
    }
  }

  /**
   * Sotuv (to'lov tranzaksiyasida): taomlar retsepti bo'yicha har mahsulotga bitta 'sale' harakati
   * (tannarx — o'rtacha). Qoldiq manfiyga tushishi mumkin: to'lov hech qachon sklad sababli to'xtamaydi.
   * ctx: kassir, reference = buyurtma id, referenceLabel = buyurtma nomi (orderStockLabel).
   */
  async deductForOrder(manager: EntityManager, items: OrderLine[], ctx: MovementContext): Promise<StockMovement[]> {
    const menuIds = [...new Set((items || []).map((i) => i.menuItemId))];
    if (menuIds.length === 0) return [];
    const recipes = await manager.find(RecipeItemEntity, { where: { menuItemId: In(menuIds) } });
    if (recipes.length === 0) return [];
    const entries = [...needByProduct(recipes, items)].map(([productId, amount]) => ({
      productId,
      type: 'sale' as const,
      delta: -roundStockQty(amount),
    }));
    return this.ledger.applyMovements(manager, entries, ctx);
  }

  /**
   * Chek vozvratida mahsulotlarni skladga qaytarish (returnStock): buyurtmaning 'sale' harakatlari aynan
   * teskari 'refund' harakatlari bilan — o'sha mahsulotlar, miqdorlar va tannarx. Sotuv harakati yo'q
   * (retseptsiz taomlar yoki jurnaldan oldingi chek) — hech narsa. Ikkinchi marta qaytarilmaydi.
   */
  async returnSaleStock(manager: EntityManager, orderId: string, ctx: MovementContext): Promise<StockMovement[]> {
    if ((await this.ledger.findByReference(manager, orderId, 'refund')).length) return [];
    const sales = await this.ledger.findByReference(manager, orderId, 'sale');
    const byProduct = new Map<string, { qty: number; cost: number }>();
    for (const s of sales) {
      const qty = -Number(s.quantity) || 0;
      const cur = byProduct.get(s.productId) ?? { qty: 0, cost: 0 };
      cur.qty += qty;
      cur.cost += qty * (Number(s.unitCost) || 0);
      byProduct.set(s.productId, cur);
    }
    const entries = [...byProduct].map(([productId, v]) => ({
      productId,
      type: 'refund' as const,
      delta: roundStockQty(v.qty),
      unitCost: v.qty ? v.cost / v.qty : 0,
    }));
    return this.ledger.applyMovements(manager, entries, ctx);
  }
}

// ---- Yordamchilar ----

/** Retseptlar bo'yicha har mahsulotga kerakli miqdor (taom soni × retsept miqdori, yig'indi) */
function needByProduct(recipes: RecipeItemEntity[], items: OrderLine[]): Map<string, number> {
  const byMenu = new Map<string, RecipeItemEntity[]>();
  for (const r of recipes) {
    const arr = byMenu.get(r.menuItemId);
    if (arr) arr.push(r);
    else byMenu.set(r.menuItemId, [r]);
  }
  const need = new Map<string, number>();
  for (const it of items || []) {
    const qty = Number(it.quantity) || 0;
    for (const r of byMenu.get(it.menuItemId) ?? []) {
      need.set(r.productId, (need.get(r.productId) || 0) + Number(r.amount) * qty);
    }
  }
  return need;
}

/** Mahsulot nomi band emas (katta-kichik harf va bo'shliqlarsiz) — aks holda 400 */
async function assertProductNameFree(m: EntityManager, name: string, exceptId?: string): Promise<void> {
  const key = nameKey(name);
  const rows = await m.find(ProductEntity, { select: { id: true, name: true } });
  if (rows.some((p) => p.id !== exceptId && nameKey(p.name) === key)) {
    throw new BadRequestException(PRODUCT_NAME_TAKEN_MESSAGE);
  }
}

/**
 * Mahsulot nechta taom retseptida ishlatilgan — faqat mavjud taomlar (o'chirilgan taomning qolib ketgan
 * retsept qatorlari hisobga olinmaydi). ids = null — barcha mahsulotlar.
 */
async function recipeDishCounts(m: EntityManager, ids: string[] | null): Promise<Map<string, number>> {
  if (ids && !ids.length) return new Map();
  const qb = m
    .createQueryBuilder(RecipeItemEntity, 'r')
    .innerJoin(MenuItemEntity, 'mi', 'mi.id = r.menuItemId')
    .select('r.productId', 'productId')
    .addSelect('COUNT(DISTINCT r.menuItemId)', 'dishes')
    .groupBy('r.productId');
  if (ids) qb.where('r.productId IN (:...ids)', { ids });
  const rows = await qb.getRawMany<{ productId: string; dishes: number | string }>();
  return new Map(rows.map((r) => [r.productId, Number(r.dishes) || 0]));
}

/** Harakatlari bor mahsulotlar: 'initial'dan boshqa harakat yoki kirim/vozvrat qatori. ids = null — hammasi */
async function productsWithHistory(m: EntityManager, ids: string[] | null): Promise<Set<string>> {
  if (ids && !ids.length) return new Set();
  const qb = m
    .createQueryBuilder(ProductEntity, 'p')
    .select('p.id', 'id')
    .where(
      new Brackets((w) =>
        w
          .where("EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.product_id = p.id AND sm.type <> 'initial')")
          .orWhere('EXISTS (SELECT 1 FROM purchases pu WHERE pu.product_id = p.id)'),
      ),
    );
  if (ids) qb.andWhere('p.id IN (:...ids)', { ids });
  const rows = await qb.getRawMany<{ id: string }>();
  return new Set(rows.map((r) => r.id));
}
