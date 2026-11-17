import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { EntityManager, Repository } from 'typeorm';
import {
  PaginatedMovements,
  ProductUnit,
  StockMovement,
  StockMovementType,
  roundStockCost,
  roundStockQty,
} from '@hardweb-pos/shared';
import { StockMovementEntity } from '../entities';
import { MovementsQuery } from './dto';
import { applyDateRange, positiveInt, queryStr, toStockMovement } from './inventory-rules';

/** Bitta amalning barcha harakatlari uchun umumiy: kim, qaysi hujjat, izoh */
export interface MovementContext {
  userId?: string | null;
  userName?: string | null;
  /** bog'liq hujjat id: buyurtma, kirim, partiya (inventarizatsiya / ishlab chiqarish) */
  reference?: string | null;
  /** odam o'qiydigan nom: "Stol 5 · №12", "Kirim: Baraka" … */
  referenceLabel?: string | null;
  note?: string | null;
}

/** Bitta mahsulot qoldig'ining o'zgarishi */
export interface MovementEntry {
  productId: string;
  type: StockMovementType;
  /** ishorali o'zgarish: + kirdi, − chiqdi (0 — harakat yozilmaydi) */
  delta?: number;
  /** mutlaq qoldiq (inventarizatsiya): farq shu tranzaksiyada o'qilgan qoldiqdan (farq 0 — harakat yo'q) */
  setTo?: number;
  /** birlik tannarxi; berilmasa — mahsulotning o'rtacha tannarxi */
  unitCost?: number;
  /** mahsulotning yangi o'rtacha tannarxi (kirim, ishlab chiqarish) — qoldiq bilan bitta UPDATE'da */
  avgCost?: number;
}

/** UPDATE ... RETURNING natijasi: yangi qoldiq va jurnal uchun nom/birlik/tannarx */
interface BalanceRow {
  stock: number | string | null;
  name: string;
  unit: ProductUnit;
  avg_cost: number | string | null;
}

/** Bir INSERT'dagi harakatlar soni (SQLite parametrlar chegarasidan ancha past) */
const INSERT_CHUNK = 50;
const MAX_PAGE = 1_000_000;

/**
 * Ombor harakatlari jurnali (0.3.3). Qoldiq FAQAT shu yerdagi applyMovements orqali o'zgaradi —
 * kirim, vozvrat, chiqim, tuzatish, inventarizatsiya, ishlab chiqarish, sotuv va chek vozvrati.
 */
@Injectable()
export class StockLedgerService {
  constructor(
    @InjectRepository(StockMovementEntity)
    private readonly movements: Repository<StockMovementEntity>,
  ) {}

  /**
   * Qoldiqni o'zgartirishning YAGONA yo'li. Tranzaksiya ichida chaqiriladi (`manager` — tranzaksiya
   * menejeri). Har yozuv uchun: 1) qoldiq atomar yangilanadi (stock = ROUND(stock + d, 3) yoki
   * inventarizatsiyada mutlaq qiymat), 2) yangi qoldiq o'sha UPDATE'ning o'zidan o'qiladi (RETURNING),
   * 3) jurnalga balance_after bilan harakat yoziladi. Mahsulot topilmasa yoki o'zgarish 0 bo'lsa —
   * o'tkazib yuboriladi. Yozilgan harakatlar kiritish tartibida qaytariladi.
   */
  async applyMovements(
    manager: EntityManager,
    entries: MovementEntry[],
    ctx: MovementContext = {},
  ): Promise<StockMovement[]> {
    const createdAt = new Date();
    const rows: StockMovementEntity[] = [];
    for (const entry of entries) {
      const changed = entry.setTo !== undefined ? await setBalance(manager, entry) : await addBalance(manager, entry);
      if (!changed) continue;
      rows.push(
        manager.create(StockMovementEntity, {
          id: randomUUID(),
          productId: entry.productId,
          productName: changed.row.name,
          unit: changed.row.unit,
          type: entry.type,
          quantity: changed.delta,
          balanceAfter: roundStockQty(changed.row.stock),
          unitCost: roundStockCost(entry.unitCost ?? changed.row.avg_cost),
          reference: ctx.reference ?? null,
          referenceLabel: ctx.referenceLabel ?? null,
          note: ctx.note ?? null,
          userId: ctx.userId ?? null,
          userName: ctx.userName ?? null,
          createdAt,
        }),
      );
    }
    await insertMovements(manager, rows);
    return rows.map(toStockMovement);
  }

  /**
   * Jurnal (GET /inventory/movements): mahsulot, tur (vergul bilan bir nechta), sana oralig'i
   * bo'yicha; eng yangisi birinchi (bir vaqtda yozilganlar orasida ham — oxirgi yozilgani, rowid).
   */
  async list(query: MovementsQuery): Promise<PaginatedMovements> {
    const page = positiveInt(query.page, 1, MAX_PAGE);
    const limit = positiveInt(query.limit, 50, 100);
    const qb = this.movements.createQueryBuilder('m');
    const productId = queryStr(query.productId);
    if (productId) qb.andWhere('m.productId = :productId', { productId });
    const types = (queryStr(query.type) ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (types.length) qb.andWhere('m.type IN (:...types)', { types });
    applyDateRange(qb, 'm.createdAt', query.from, query.to);

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('m.createdAt', 'DESC')
      .addOrderBy('m.rowid', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getMany();
    return { items: rows.map(toStockMovement), total, page, limit, hasMore: page * limit < total };
  }

  /** Buyurtmaning (yoki boshqa hujjatning) shu turdagi harakatlari — yozilish tartibida */
  findByReference(manager: EntityManager, reference: string, type: StockMovementType): Promise<StockMovementEntity[]> {
    return manager
      .createQueryBuilder(StockMovementEntity, 'm')
      .where('m.reference = :reference AND m.type = :type', { reference, type })
      .orderBy('m.rowid', 'ASC')
      .getMany();
  }
}

/** Qoldiqqa ishorali o'zgarish qo'shish (bitta atomar UPDATE) */
async function addBalance(m: EntityManager, e: MovementEntry): Promise<{ delta: number; row: BalanceRow } | null> {
  const delta = roundStockQty(e.delta);
  if (delta === 0) return null;
  const row = await updateBalance(m, 'ROUND(COALESCE(stock, 0) + ?, 3)', delta, e);
  return row ? { delta, row } : null;
}

/** Mutlaq qoldiq (inventarizatsiya): farq shu tranzaksiyada o'qilgan qoldiqdan hisoblanadi */
async function setBalance(m: EntityManager, e: MovementEntry): Promise<{ delta: number; row: BalanceRow } | null> {
  const target = roundStockQty(e.setTo);
  const [current] = (await m.query('SELECT stock FROM products WHERE id = ?', [e.productId])) as {
    stock: number | string | null;
  }[];
  if (!current) return null;
  const delta = roundStockQty(target - roundStockQty(current.stock));
  if (delta === 0) return null;
  const row = await updateBalance(m, 'ROUND(?, 3)', target, e);
  return row ? { delta, row } : null;
}

/** UPDATE products ... RETURNING — yangi qoldiq shu so'rovning o'zidan (o'qish va yozish orasida bo'shliq yo'q) */
async function updateBalance(
  m: EntityManager,
  stockSql: string,
  value: number,
  e: MovementEntry,
): Promise<BalanceRow | undefined> {
  const sets = [`stock = ${stockSql}`];
  const params: unknown[] = [value];
  if (e.avgCost !== undefined) {
    sets.push('avg_cost = ?');
    params.push(roundStockCost(e.avgCost));
  }
  params.push(e.productId);
  const rows = (await m.query(
    `UPDATE products SET ${sets.join(', ')} WHERE id = ? RETURNING stock, name, unit, avg_cost`,
    params,
  )) as BalanceRow[];
  return rows[0];
}

/**
 * Harakatlarni jurnalga yozish (bo'laklab, har bo'lak — bitta INSERT; kiritish tartibi = jurnal
 * tartibi). id va created_at oldindan berilgan — qayta o'qish (SELECT) kerak emas. v6 migratsiya ham
 * shundan foydalanadi.
 */
export async function insertMovements(m: EntityManager, rows: Partial<StockMovementEntity>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await m
      .createQueryBuilder()
      .insert()
      .into(StockMovementEntity)
      .values(rows.slice(i, i + INSERT_CHUNK))
      .updateEntity(false)
      .execute();
  }
}
