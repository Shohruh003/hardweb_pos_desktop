import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  ProductUnit,
  ROLE_FORBIDDEN_CAPABILITIES,
  UserRole,
  capabilitiesForRole,
  defaultCapabilitiesForRole,
  roundStockCost,
  roundStockQty,
} from '@hardweb-pos/shared';
import {
  PurchaseEntity,
  SettingsEntity,
  StockMovementEntity,
  SupplierEntity,
  SupplierPaymentEntity,
  UserEntity,
} from '../entities';
import { cleanName, nameKey } from '../inventory/inventory-rules';
import { insertMovements } from '../inventory/stock-ledger.service';

/** Joriy ma'lumot versiyasi (settings.data_version) */
export const DATA_VERSION = 6;

/** Sklad jurnalidagi birinchi ('initial') harakat izohi — v6 migratsiya paytidagi qoldiq */
export const INITIAL_STOCK_NOTE = 'Sklad jurnali boshlanishidagi qoldiq';

/**
 * Bir martalik ma'lumot yangilanishlari (sxema emas — sxemani TypeORM synchronize qiladi).
 * Server har ishga tushganda, seed'dan KEYIN (onApplicationBootstrap — barcha onModuleInit,
 * jumladan SeedService tugagach) bajariladi. settings.data_version bo'yicha: bajarilgan qadam
 * qayta bajarilmaydi (idempotent), toza baza va demo seed bilan ham ishlaydi. Xato bo'lsa
 * tranzaksiya bekor qilinadi, server ishlashda davom etadi va keyingi ishga tushishda qayta uriniladi.
 */
@Injectable()
export class DataMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger('DataMigration');

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.migrate();
    } catch (e) {
      this.logger.error(
        `Ma’lumotlarni yangilashda xato (keyingi ishga tushishda qayta uriniladi): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async migrate(): Promise<void> {
    const settingsRepo = this.dataSource.getRepository(SettingsEntity);
    // Sozlamalar qatori bo'lmasa — shu yerda yaratiladi (keyin GET so'rovlar uni parallel yaratmaydi)
    let settings = await settingsRepo.findOne({ where: { id: 'main' } });
    if (!settings) settings = await settingsRepo.save(settingsRepo.create({ id: 'main' }));
    const from = Number(settings.dataVersion) || 0;
    if (from >= DATA_VERSION) return;

    await this.dataSource.transaction(async (m) => {
      if (from < 3) {
        // 0.3.0: kassir olib ketish / yetkazish buyurtmalarini o'zi ochadi — 'waiter' ruxsati qo'shiladi
        const updated = await grantCapability(m, [UserRole.Cashier], 'waiter', { includeEmpty: true });
        // Taom rasmi: bo'sh matn -> NULL (imageUrl faqat haqiqiy rasmi bor taomga beriladi)
        await m.query(
          `UPDATE menu_items SET image = NULL WHERE image IS NOT NULL AND TRIM(image) = ''`,
        );
        this.logger.log(
          updated.length
            ? `v3: ${updated.length} ta kassirga 'waiter' (olib ketish/yetkazish) ruxsati qo‘shildi: ${updated.join(', ')}`
            : 'v3: kassirlar ruxsatlari yangilanishi kerak emas',
        );
      }
      if (from < 4) {
        // 0.3.0 (B19): otkaz (yuborilgan taom / hisobni bekor qilish) endi alohida 'void' ruxsati bilan —
        // kassir va administrator avvalgidek otkaz qila olishi uchun ularga beriladi (ofitsiantlarga YO'Q).
        // Ruxsatlari umuman yo'q (bo'sh) xodimga qo'shilmaydi: direktor uni ataylab o'chirib qo'ygan —
        // yolg'iz 'void' ruxsati unga kerak emas.
        const updated = await grantCapability(m, [UserRole.Cashier, UserRole.Admin], 'void', { includeEmpty: false });
        this.logger.log(
          updated.length
            ? `v4: ${updated.length} ta xodimga 'void' (otkaz) ruxsati qo‘shildi: ${updated.join(', ')}`
            : 'v4: otkaz ruxsatlari yangilanishi kerak emas',
        );
      }
      if (from < 5) {
        // 0.3.3: ofitsiant kassa, tushum, hisobotlar, cheklar tarixi, otkaz va vozvrat ruxsatiga ega emas
        // (restoran talabi). Amalda ular allaqachon ishlamaydi (effectivePermissions) — bazadagi eski
        // belgilar ham tozalanadi, rol keyin o'zgartirilsa qaytib chiqmasin.
        const updated = await stripRoleForbiddenCapabilities(m);
        this.logger.log(
          updated.length
            ? `v5: ${updated.length} ta ofitsiantdan kassa/hisobot ruxsatlari olib tashlandi: ${updated.join(', ')}`
            : 'v5: ofitsiantlar ruxsatlari yangilanishi kerak emas',
        );
      }
      if (from < 6) {
        // 0.3.3 (sklad jurnali): eski erkin matndagi ta'minotchi nomlaridan ta'minotchilar ro'yxati,
        // mahsulotlarning o'rtacha tannarxi (kirimlar tarixidan) va har mahsulotga boshlang'ich qoldiq
        // harakati. Mahsuloti va kirimi yo'q restoranda hech narsa o'zgarmaydi.
        const r = await migrateInventory(m);
        this.logger.log(
          `v6: sklad — ${r.suppliers} ta ta’minotchi (${r.linked} ta kirim/to‘lov bog‘landi), ` +
            `${r.costs} ta mahsulot tannarxi, ${r.initial} ta boshlang‘ich qoldiq`,
        );
      }
      await m.update(SettingsEntity, { id: 'main' }, { dataVersion: DATA_VERSION });
    });
    this.logger.log(`Ma’lumotlar versiyasi: ${from} -> ${DATA_VERSION}`);
  }
}

/**
 * Berilgan rollardagi xodimlarga ruxsat qo'shish (bor bo'lsa — tegilmaydi). Qo'shilganlar ismlari qaytadi.
 * includeEmpty=false — ruxsatlari bo'sh xodim o'tkazib yuboriladi.
 */
async function grantCapability(
  m: EntityManager,
  roles: UserRole[],
  capability: string,
  opts: { includeEmpty: boolean },
): Promise<string[]> {
  const users = await m.find(UserEntity, { where: { role: In(roles) } });
  const updated: string[] = [];
  for (const u of users) {
    const perms = (u.permissions ?? []).map((p) => String(p).trim()).filter(Boolean);
    if (perms.includes(capability)) continue;
    if (!opts.includeEmpty && perms.length === 0) continue;
    await m.update(UserEntity, u.id, { permissions: [...perms, capability] });
    updated.push(u.name);
  }
  return updated;
}

/** Bitta UPDATE ... IN (...) dagi id'lar soni */
const ID_CHUNK = 500;

function chunks<T>(list: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * v6 — sklad jurnali (idempotent: qayta bajarilsa natija o'sha):
 *  1) ta'minotchilar — kirim va to'lovlardagi bo'sh bo'lmagan nomlardan; katta-kichik harf yoki bo'shliq
 *     bilan farq qiladigan nomlar — BITTA ta'minotchi (birinchi uchragan yozuvi). Qatorlarga supplier_id
 *     va ta'minotchining nomi yoziladi (ro'yxat va tarixda nom bir xil ko'rinsin);
 *  2) o'rtacha tannarx — musbat narxli kirimlardan Σ(miqdor × narx) / Σmiqdor; faqat hali 0 bo'lganlarga;
 *  3) birorta harakati yo'q har mahsulotga 'initial' harakati: joriy qoldiq va tannarx bilan.
 */
async function migrateInventory(
  m: EntityManager,
): Promise<{ suppliers: number; linked: number; costs: number; initial: number }> {
  // 1) Ta'minotchilar
  const byKey = new Map<string, SupplierEntity>();
  for (const s of await m.find(SupplierEntity, { order: { createdAt: 'ASC' } })) {
    const key = nameKey(s.name);
    if (key && !byKey.has(key)) byKey.set(key, s);
  }
  // Vaqt tartibida (bir vaqtdagilar: avval kirim, keyin yozilish tartibi) — birinchi uchragan yozuv
  const named = (await m.query(
    `SELECT 'purchase' AS src, rowid AS rn, id, supplier, datetime(created_at) AS at FROM purchases WHERE supplier_id IS NULL
     UNION ALL
     SELECT 'payment' AS src, rowid AS rn, id, supplier, datetime(created_at) AS at FROM supplier_payments WHERE supplier_id IS NULL
     ORDER BY at, src DESC, rn`,
  )) as { src: 'purchase' | 'payment'; id: string; supplier: string | null }[];
  let created = 0;
  const groups = new Map<string, { supplier: SupplierEntity; purchases: string[]; payments: string[] }>();
  for (const row of named) {
    const name = cleanName(row.supplier);
    if (!name) continue;
    let supplier = byKey.get(nameKey(name));
    if (!supplier) {
      supplier = await m.save(m.create(SupplierEntity, { name }));
      byKey.set(nameKey(name), supplier);
      created += 1;
    }
    let group = groups.get(supplier.id);
    if (!group) {
      group = { supplier, purchases: [], payments: [] };
      groups.set(supplier.id, group);
    }
    (row.src === 'purchase' ? group.purchases : group.payments).push(row.id);
  }
  let linked = 0;
  for (const { supplier, purchases, payments } of groups.values()) {
    const patch = { supplierId: supplier.id, supplier: supplier.name };
    for (const ids of chunks(purchases)) await m.update(PurchaseEntity, { id: In(ids) }, patch);
    for (const ids of chunks(payments)) await m.update(SupplierPaymentEntity, { id: In(ids) }, patch);
    linked += purchases.length + payments.length;
  }

  // 2) O'rtacha tannarx (faqat tannarxi hali 0 mahsulotlarga — hisoblangani buzilmasin)
  const sums = (await m.query(
    `SELECT product_id AS id, SUM(quantity * unit_price) AS amount, SUM(quantity) AS qty
     FROM purchases WHERE quantity > 0 AND unit_price > 0 GROUP BY product_id`,
  )) as { id: string; amount: number | string; qty: number | string }[];
  let costs = 0;
  for (const s of sums) {
    const qty = Number(s.qty);
    if (!(qty > 0)) continue;
    const updated = (await m.query(
      'UPDATE products SET avg_cost = ? WHERE id = ? AND COALESCE(avg_cost, 0) = 0 RETURNING id',
      [roundStockCost(Number(s.amount) / qty), s.id],
    )) as unknown[];
    costs += updated.length;
  }

  // 3) Boshlang'ich qoldiq — jurnal shundan boshlanadi (keyingi harakatlar balance_after'i shunga ulanadi)
  const products = (await m.query(
    `SELECT id, name, unit, stock, avg_cost FROM products p
     WHERE NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.product_id = p.id)`,
  )) as { id: string; name: string; unit: ProductUnit; stock: number | string; avg_cost: number | string }[];
  const createdAt = new Date();
  await insertMovements(
    m,
    products.map(
      (p): Partial<StockMovementEntity> => ({
        id: randomUUID(),
        productId: p.id,
        productName: p.name,
        unit: p.unit,
        type: 'initial',
        quantity: roundStockQty(p.stock),
        balanceAfter: roundStockQty(p.stock),
        unitCost: roundStockCost(p.avg_cost),
        reference: null,
        referenceLabel: null,
        note: INITIAL_STOCK_NOTE,
        userId: null,
        userName: null,
        createdAt,
      }),
    ),
  );
  return { suppliers: created, linked, costs, initial: products.length };
}

/**
 * Lavozimga taqiqlangan ruxsatlarni bazadan olib tashlash (ROLE_FORBIDDEN_CAPABILITIES). Faqat shunday
 * ruxsatlari bo'lgan xodim ruxsatsiz qolmasin — unga rolning standart ruxsatlari beriladi.
 * O'zgartirilgan xodimlar ismlari qaytadi.
 */
async function stripRoleForbiddenCapabilities(m: EntityManager): Promise<string[]> {
  const roles = Object.keys(ROLE_FORBIDDEN_CAPABILITIES) as UserRole[];
  if (!roles.length) return [];
  const users = await m.find(UserEntity, { where: { role: In(roles) } });
  const updated: string[] = [];
  for (const u of users) {
    const perms = (u.permissions ?? []).map((p) => String(p).trim()).filter(Boolean);
    let next = capabilitiesForRole(u.role, perms);
    if (next.length === perms.length) continue;
    if (next.length === 0) next = defaultCapabilitiesForRole(u.role);
    await m.update(UserEntity, u.id, { permissions: next });
    updated.push(u.name);
  }
  return updated;
}
