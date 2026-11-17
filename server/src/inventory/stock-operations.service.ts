import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  COUNT_ITEMS_REQUIRED_MESSAGE,
  COUNT_VALUE_INVALID_MESSAGE,
  PRODUCTION_INPUTS_REQUIRED_MESSAGE,
  PRODUCTION_OUTPUT_REQUIRED_MESSAGE,
  PRODUCTION_SELF_MESSAGE,
  PRODUCT_NOT_FOUND_MESSAGE,
  Product,
  Purchase,
  STOCK_QTY_INVALID_MESSAGE,
  STOCK_QTY_POSITIVE_MESSAGE,
  StockMovement,
  nextAvgCost,
  roundStockCost,
  roundStockQty,
  stockNotEnoughMessage,
} from '@hardweb-pos/shared';
import { ProductEntity, PurchaseEntity, SupplierEntity } from '../entities';
import { AdjustDto, CountDto, ProductionDto, PurchaseDto, PurchasesQuery } from './dto';
import { InventoryActor } from './inventory-access';
import { InventoryService } from './inventory.service';
import {
  COUNT_LABEL,
  PRODUCTION_LABEL,
  applyDateRange,
  nonNegativeCost,
  nonNegativeQty,
  nonZeroQty,
  optionalText,
  positiveInt,
  positiveQty,
  productOr404,
  purchaseLabel,
  queryStr,
  supplierReturnLabel,
  toPurchase,
} from './inventory-rules';
import { MovementContext, MovementEntry, StockLedgerService } from './stock-ledger.service';
import { SuppliersService } from './suppliers.service';

/**
 * Qoldiqni o'zgartiradigan sklad hujjatlari (0.3.3): kirim, ta'minotchiga vozvrat, chiqim/tuzatish,
 * inventarizatsiya va ishlab chiqarish. Har biri BITTA tranzaksiya; qoldiq faqat StockLedgerService
 * orqali o'zgaradi, tekshiruvlar esa shu tranzaksiyada o'qilgan qoldiq bo'yicha.
 */
@Injectable()
export class StockOperationsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PurchaseEntity)
    private readonly purchases: Repository<PurchaseEntity>,
    private readonly ledger: StockLedgerService,
    private readonly suppliers: SuppliersService,
    private readonly inventory: InventoryService,
  ) {}

  // =============================================================================================
  // Kirim va ta'minotchiga vozvrat
  // =============================================================================================

  /** Kirimlar (vozvratlar — manfiy qatorlar) — eng yangisi birinchi; limit ≤ 500 (standart 200) */
  async listPurchases(query: PurchasesQuery): Promise<Purchase[]> {
    const qb = this.purchases.createQueryBuilder('p');
    const productId = queryStr(query.productId);
    if (productId) qb.andWhere('p.productId = :productId', { productId });
    const supplierId = queryStr(query.supplierId);
    if (supplierId) qb.andWhere('p.supplierId = :supplierId', { supplierId });
    applyDateRange(qb, 'p.createdAt', query.from, query.to);
    const rows = await qb
      .orderBy('p.createdAt', 'DESC')
      .addOrderBy('p.rowid', 'DESC')
      .limit(positiveInt(query.limit, 200, 500))
      .getMany();
    return rows.map(toPurchase);
  }

  /**
   * Kirim: kirim qatori (summa — butun so'm), o'rtacha tannarx (nextAvgCost: narx 0 bo'lsa o'zgarmaydi)
   * va 'purchase' harakati (+, tannarx = kirim narxi) — bitta tranzaksiyada.
   */
  async createPurchase(dto: PurchaseDto, actor: InventoryActor): Promise<Purchase> {
    const quantity = positiveQty(dto.quantity, STOCK_QTY_POSITIVE_MESSAGE);
    const unitPrice = nonNegativeCost(dto.unitPrice);
    const note = optionalText(dto.note);
    return this.dataSource.transaction(async (m) => {
      const product = await productOr404(m, dto.productId);
      const supplier = await this.suppliers.resolve(m, dto, false);
      const purchase = await savePurchaseRow(m, product, supplier, {
        quantity,
        unitPrice,
        total: Math.round(quantity * unitPrice),
        note,
      });
      const avgCost = nextAvgCost(Number(product.stock), Number(product.avgCost), quantity, unitPrice);
      await this.ledger.applyMovements(
        m,
        [{ productId: product.id, type: 'purchase', delta: quantity, unitCost: unitPrice, avgCost }],
        this.context(actor, purchase.id, purchaseLabel(purchase.supplier), note),
      );
      return toPurchase(purchase);
    });
  }

  /**
   * Ta'minotchiga vozvrat: qoldiq yetarli bo'lishi shart. Narx berilmasa (yoki ≤ 0) — o'rtacha tannarx.
   * Manfiy kirim qatori (qarz kamayadi) va 'return' harakati (−); o'rtacha tannarx o'zgarmaydi.
   */
  async createReturn(dto: PurchaseDto, actor: InventoryActor): Promise<Purchase> {
    const quantity = positiveQty(dto.quantity, STOCK_QTY_POSITIVE_MESSAGE);
    const note = optionalText(dto.note);
    return this.dataSource.transaction(async (m) => {
      const product = await productOr404(m, dto.productId);
      assertEnoughStock(product, quantity);
      const supplier = await this.suppliers.resolve(m, dto, false);
      const price =
        typeof dto.unitPrice === 'number' && dto.unitPrice > 0
          ? roundStockCost(dto.unitPrice)
          : roundStockCost(product.avgCost);
      const ret = await savePurchaseRow(m, product, supplier, {
        quantity: -quantity,
        unitPrice: price,
        total: -Math.round(quantity * price) || 0,
        note: note ? `↩️ Vozvrat · ${note}` : '↩️ Vozvrat',
      });
      await this.ledger.applyMovements(
        m,
        [{ productId: product.id, type: 'return', delta: -quantity, unitCost: price }],
        this.context(actor, ret.id, supplierReturnLabel(ret.supplier), note),
      );
      return toPurchase(ret);
    });
  }

  // =============================================================================================
  // Chiqim / tuzatish, inventarizatsiya, ishlab chiqarish
  // =============================================================================================

  /**
   * Chiqim (writeoff: buzildi, yo'qoldi, xodim ovqati) — faqat manfiy va qoldiq yetarli bo'lsa;
   * tuzatish (adjust) — +/−. Tur berilmasa: + — tuzatish, − — chiqim. Yangilangan mahsulot qaytadi.
   */
  async adjust(id: string, dto: AdjustDto, actor: InventoryActor): Promise<Product> {
    const delta = nonZeroQty(dto.delta, STOCK_QTY_INVALID_MESSAGE);
    const type = dto.type ?? (delta > 0 ? 'adjust' : 'writeoff');
    if (type === 'writeoff' && delta > 0) throw new BadRequestException(STOCK_QTY_INVALID_MESSAGE);
    const note = optionalText(dto.note);
    return this.dataSource.transaction(async (m) => {
      const product = await productOr404(m, id);
      if (type === 'writeoff') assertEnoughStock(product, -delta);
      await this.ledger.applyMovements(m, [{ productId: id, type, delta }], this.context(actor, null, null, note));
      return this.inventory.productView(m, id);
    });
  }

  /**
   * Inventarizatsiya: sanalgan HAQIQIY qoldiq (mutlaq), bitta tranzaksiyada. Farq shu tranzaksiyada
   * o'qilgan qoldiqdan hisoblanadi: farq 0 — harakat yo'q, aks holda 'count' harakati (ishorali farq).
   * Barcha qatorlar bitta partiya (reference) — "Inventarizatsiya". Takror yuborilsa — hech narsa
   * o'zgarmaydi. Bir mahsulot ikki marta kelsa — oxirgi qiymat olinadi.
   */
  async count(dto: CountDto, actor: InventoryActor): Promise<{ changed: number; movements: StockMovement[] }> {
    const items = Array.isArray(dto.items) ? dto.items : [];
    if (!items.length) throw new BadRequestException(COUNT_ITEMS_REQUIRED_MESSAGE);
    const actual = new Map<string, number>();
    for (const raw of items) {
      const item = (raw ?? {}) as { productId?: unknown; actual?: unknown };
      const value = nonNegativeQty(item.actual, COUNT_VALUE_INVALID_MESSAGE);
      if (typeof item.productId !== 'string' || !item.productId) throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
      actual.set(item.productId, value);
    }
    const note = optionalText(dto.note);
    return this.dataSource.transaction(async (m) => {
      await assertProductsExist(m, [...actual.keys()]);
      const movements = await this.ledger.applyMovements(
        m,
        [...actual].map(([productId, setTo]) => ({ productId, type: 'count' as const, setTo })),
        this.context(actor, randomUUID(), COUNT_LABEL, note),
      );
      return { changed: movements.length, movements };
    });
  }

  /**
   * Ishlab chiqarish (yarim tayyor mahsulot: qiyma, xamir, sous…): ketgan mahsulotlar 'production_out'
   * (−, o'z o'rtacha tannarxida), tayyor mahsulot 'production_in' (+). Tayyor mahsulot birlik tannarxi =
   * Σ(ketgan miqdor × tannarx) / chiqqan miqdor; o'rtacha tannarxi nextAvgCost bilan. Bitta tranzaksiya,
   * bitta partiya — "Ishlab chiqarish".
   */
  async produce(dto: ProductionDto, actor: InventoryActor): Promise<{ movements: StockMovement[] }> {
    const outputQty = roundStockQty(typeof dto.outputQty === 'number' ? dto.outputQty : NaN);
    const outputId = typeof dto.outputProductId === 'string' ? dto.outputProductId : '';
    if (!outputId || !(outputQty > 0)) throw new BadRequestException(PRODUCTION_OUTPUT_REQUIRED_MESSAGE);
    const inputs = productionInputs(dto.inputs);
    if (!inputs.size) throw new BadRequestException(PRODUCTION_INPUTS_REQUIRED_MESSAGE);
    if (inputs.has(outputId)) throw new BadRequestException(PRODUCTION_SELF_MESSAGE);
    const note = optionalText(dto.note);

    return this.dataSource.transaction(async (m) => {
      const output = await m.findOne(ProductEntity, { where: { id: outputId } });
      if (!output) throw new BadRequestException(PRODUCTION_OUTPUT_REQUIRED_MESSAGE);
      const used = await m.find(ProductEntity, { where: { id: In([...inputs.keys()]) } });
      if (used.length !== inputs.size) throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
      const byId = new Map(used.map((p) => [p.id, p]));

      const entries: MovementEntry[] = [];
      let totalCost = 0;
      for (const [productId, qty] of inputs) {
        const p = byId.get(productId) as ProductEntity;
        assertEnoughStock(p, qty);
        const cost = roundStockCost(p.avgCost);
        totalCost += qty * cost;
        entries.push({ productId, type: 'production_out', delta: -qty, unitCost: cost });
      }
      const unitCost = roundStockCost(totalCost / outputQty);
      const avgCost = nextAvgCost(Number(output.stock), Number(output.avgCost), outputQty, unitCost);
      entries.push({ productId: output.id, type: 'production_in', delta: outputQty, unitCost, avgCost });

      const movements = await this.ledger.applyMovements(
        m,
        entries,
        this.context(actor, randomUUID(), PRODUCTION_LABEL, note),
      );
      return { movements };
    });
  }

  private context(
    actor: InventoryActor,
    reference: string | null,
    referenceLabel: string | null,
    note: string | null,
  ): MovementContext {
    return { userId: actor.id, userName: actor.name, reference, referenceLabel, note };
  }
}

// ---- Yordamchilar ----

/** Qoldiq (shu tranzaksiyada o'qilgan) `qty` uchun yetarli — aks holda 400 "Omborda yetarli emas…" */
function assertEnoughStock(product: ProductEntity, qty: number): void {
  const stock = roundStockQty(product.stock);
  if (qty > stock) throw new BadRequestException(stockNotEnoughMessage(product.name, stock, product.unit));
}

/** Barcha mahsulotlar mavjud — aks holda 404 */
async function assertProductsExist(m: EntityManager, ids: string[]): Promise<void> {
  const found = await m.count(ProductEntity, { where: { id: In(ids) } });
  if (found !== ids.length) throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
}

/**
 * Ishlab chiqarishga ketgan mahsulotlar: productId -> miqdor (bir mahsulot ikki marta kelsa — qo'shiladi).
 * Miqdori 0 qatorlar (formadagi bo'sh qator) tashlab ketiladi; manfiy yoki son emas — 400.
 */
function productionInputs(raw: unknown[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of Array.isArray(raw) ? raw : []) {
    const line = (it ?? {}) as { productId?: unknown; quantity?: unknown };
    const qty = nonNegativeQty(line.quantity, STOCK_QTY_POSITIVE_MESSAGE);
    if (qty === 0) continue;
    if (typeof line.productId !== 'string' || !line.productId) throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
    out.set(line.productId, roundStockQty((out.get(line.productId) ?? 0) + qty));
  }
  return out;
}

/** Kirim / vozvrat qatori: mahsulot nomi va birligi, ta'minotchi nomi nusxasi bilan */
function savePurchaseRow(
  m: EntityManager,
  product: ProductEntity,
  supplier: SupplierEntity | null,
  values: { quantity: number; unitPrice: number; total: number; note: string | null },
): Promise<PurchaseEntity> {
  return m.save(
    m.create(PurchaseEntity, {
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      supplier: supplier?.name ?? '',
      supplierId: supplier?.id ?? null,
      ...values,
    }),
  );
}
