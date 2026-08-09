import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { ProductEntity, PurchaseEntity, RecipeItemEntity } from '../entities';
import { Product, Purchase, RecipeItem } from '@hardweb-pos/shared';

export interface CreateProductInput {
  name: string;
  unit: Product['unit'];
  stock?: number;
  minStock?: number;
}

export interface CreatePurchaseInput {
  productId: string;
  supplier: string;
  quantity: number;
  unitPrice: number;
  note?: string;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(RecipeItemEntity)
    private readonly recipes: Repository<RecipeItemEntity>,
    @InjectRepository(PurchaseEntity)
    private readonly purchases: Repository<PurchaseEntity>,
  ) {}

  private toProduct(p: ProductEntity): Product {
    return {
      id: p.id,
      name: p.name,
      unit: p.unit,
      stock: Number(p.stock),
      minStock: Number(p.minStock),
    };
  }

  async listProducts(): Promise<Product[]> {
    const list = await this.products.find({ order: { name: 'ASC' } });
    return list.map((p) => this.toProduct(p));
  }

  async createProduct(dto: CreateProductInput): Promise<Product> {
    const p = this.products.create({
      name: dto.name,
      unit: dto.unit,
      stock: dto.stock ?? 0,
      minStock: dto.minStock ?? 0,
    });
    return this.toProduct(await this.products.save(p));
  }

  async updateProduct(
    id: string,
    dto: Partial<CreateProductInput>,
  ): Promise<Product> {
    const p = await this.products.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Mahsulot topilmadi');
    Object.assign(p, dto);
    return this.toProduct(await this.products.save(p));
  }

  async deleteProduct(id: string): Promise<{ ok: boolean }> {
    // Bu mahsulotga bog'liq retsept qatorlarini ham o'chiramiz
    await this.recipes.delete({ productId: id });
    await this.products.delete(id);
    return { ok: true };
  }

  // Ombor qoldig'ini o'zgartirish (kirim +, chiqim -)
  async adjustStock(id: string, delta: number): Promise<Product> {
    const p = await this.products.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Mahsulot topilmadi');
    p.stock = Number(p.stock) + Number(delta);
    return this.toProduct(await this.products.save(p));
  }

  // --- Kirim (ta'minot) ---
  private toPurchase(p: PurchaseEntity): Purchase {
    return {
      id: p.id,
      productId: p.productId,
      productName: p.productName,
      unit: p.unit,
      supplier: p.supplier,
      quantity: Number(p.quantity),
      unitPrice: Number(p.unitPrice),
      total: Number(p.total),
      note: p.note,
      createdAt: p.createdAt?.toISOString?.() ?? String(p.createdAt),
    };
  }

  async listPurchases(productId?: string): Promise<Purchase[]> {
    const where = productId ? { productId } : {};
    const list = await this.purchases.find({
      where,
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return list.map((p) => this.toPurchase(p));
  }

  // Kirim qo'shish — mahsulot ombori shu miqdorga oshadi + kirim tarixga yoziladi
  async createPurchase(dto: CreatePurchaseInput): Promise<Purchase> {
    const product = await this.products.findOne({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    const quantity = Number(dto.quantity) || 0;
    const unitPrice = Number(dto.unitPrice) || 0;
    if (quantity <= 0) throw new BadRequestException('Miqdor 0 dan katta bo‘lishi kerak');

    const purchase = this.purchases.create({
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      supplier: (dto.supplier || '').trim(),
      quantity,
      unitPrice,
      total: Math.round(quantity * unitPrice * 100) / 100,
      note: dto.note?.trim() || null,
    });
    const saved = await this.purchases.save(purchase);
    // Ombor qoldig'ini oshiramiz
    product.stock = Number(product.stock) + quantity;
    await this.products.save(product);
    return this.toPurchase(saved);
  }

  // Ombor yetarliligini tekshirish (ortiqcha sotishни oldini olish).
  // newItems — yangi qo'shilayotgan taomlar; reservedItems — barcha ochiq
  // buyurtmalarda band qilingan taomlar (hali to'lanmagan). Yetmasa xato beradi.
  async assertStockAvailable(
    newItems: { menuItemId: string; quantity: number }[],
    reservedItems: { menuItemId: string; quantity: number }[],
  ): Promise<void> {
    const allMenuIds = [
      ...new Set(
        [...newItems, ...reservedItems].map((i) => i.menuItemId),
      ),
    ];
    if (allMenuIds.length === 0) return;
    const recipes = await this.recipes.find({
      where: { menuItemId: In(allMenuIds) },
    });
    if (recipes.length === 0) return; // retseptsiz taomlar — cheklovsiz

    const recByMenu = new Map<string, RecipeItemEntity[]>();
    for (const r of recipes) {
      const arr = recByMenu.get(r.menuItemId) ?? [];
      arr.push(r);
      recByMenu.set(r.menuItemId, arr);
    }
    const sumNeed = (items: { menuItemId: string; quantity: number }[]) => {
      const m = new Map<string, number>();
      for (const it of items) {
        const rs = recByMenu.get(it.menuItemId);
        if (!rs) continue;
        for (const r of rs) {
          m.set(
            r.productId,
            (m.get(r.productId) || 0) + Number(r.amount) * Number(it.quantity),
          );
        }
      }
      return m;
    };

    const need = sumNeed(newItems);
    if (need.size === 0) return;
    const reserved = sumNeed(reservedItems);

    const products = await this.products.find({
      where: { id: In([...need.keys()]) },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const [productId, needed] of need) {
      const p = byId.get(productId);
      if (!p) continue;
      const available = Number(p.stock) - (reserved.get(productId) || 0);
      if (needed > available + 1e-6) {
        const av = Math.max(0, Math.round(available * 1000) / 1000);
        throw new BadRequestException(
          `Omborda yetarli emas: ${p.name} — mavjud ${av} ${p.unit}`,
        );
      }
    }
  }

  // Bir taomning retsepti (mahsulot nomi/birligi bilan)
  async getRecipe(menuItemId: string): Promise<RecipeItem[]> {
    const items = await this.recipes.find({ where: { menuItemId } });
    if (items.length === 0) return [];
    const prods = await this.products.find({
      where: { id: In(items.map((r) => r.productId)) },
    });
    const byId = new Map(prods.map((p) => [p.id, p]));
    return items.map((r) => ({
      id: r.id,
      menuItemId: r.menuItemId,
      productId: r.productId,
      amount: Number(r.amount),
      productName: byId.get(r.productId)?.name,
      productUnit: byId.get(r.productId)?.unit,
    }));
  }

  // Taom retseptini to'liq almashtirish (eskilarini o'chirib, yangilarini yozamiz)
  async setRecipe(
    menuItemId: string,
    items: { productId: string; amount: number }[],
  ): Promise<RecipeItem[]> {
    await this.recipes.delete({ menuItemId });
    const valid = (items || []).filter(
      (i) => i.productId && Number(i.amount) > 0,
    );
    if (valid.length) {
      await this.recipes.save(
        valid.map((i) =>
          this.recipes.create({
            menuItemId,
            productId: i.productId,
            amount: Number(i.amount),
          }),
        ),
      );
    }
    return this.getRecipe(menuItemId);
  }

  // Taom(lar) sotilganda mahsulotlarni skladdan ayirish (to'lov tranzaksiyasida).
  // items: buyurtmadagi taomlar (menuItemId + quantity).
  async deductForOrder(
    manager: EntityManager,
    items: { menuItemId: string; quantity: number }[],
  ): Promise<void> {
    const menuIds = [...new Set((items || []).map((i) => i.menuItemId))];
    if (menuIds.length === 0) return;
    const recipes = await manager.find(RecipeItemEntity, {
      where: { menuItemId: In(menuIds) },
    });
    if (recipes.length === 0) return;

    // Har mahsulot bo'yicha jami ayiriladigan miqdorni yig'amiz
    const need = new Map<string, number>();
    for (const it of items) {
      const qty = Number(it.quantity) || 0;
      for (const r of recipes) {
        if (r.menuItemId !== it.menuItemId) continue;
        need.set(
          r.productId,
          (need.get(r.productId) || 0) + Number(r.amount) * qty,
        );
      }
    }
    if (need.size === 0) return;

    const products = await manager.find(ProductEntity, {
      where: { id: In([...need.keys()]) },
    });
    for (const p of products) {
      p.stock = Number(p.stock) - (need.get(p.id) || 0);
      await manager.save(p);
    }
  }
}
