import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  SUPPLIER_IN_USE_MESSAGE,
  SUPPLIER_NAME_REQUIRED_MESSAGE,
  SUPPLIER_NAME_TAKEN_MESSAGE,
  SUPPLIER_NOT_FOUND_MESSAGE,
  SUPPLIER_PAYMENT_AMOUNT_MESSAGE,
  SUPPLIER_PAYMENT_NOT_FOUND_MESSAGE,
  Supplier,
  SupplierPayment,
} from '@hardweb-pos/shared';
import { PurchaseEntity, SupplierEntity, SupplierPaymentEntity } from '../entities';
import { SupplierDto, SupplierPaymentDto, SupplierPaymentsQuery } from './dto';
import { InventoryActor } from './inventory-access';
import {
  cleanName,
  isoOf,
  nameKey,
  optionalText,
  positiveInt,
  purchaseLabel,
  queryStr,
  supplierReturnLabel,
  toSupplierPayment,
} from './inventory-rules';

/** Legacy GET /inventory/supplier-balances qatori */
export interface SupplierBalanceRow {
  supplier: string;
  purchased: number;
  paid: number;
  debt: number;
  count: number;
}

/** Kirim / vozvrat / to'lovdagi ta'minotchi: ro'yxatdan (id) yoki nomi bilan */
export interface SupplierRef {
  supplierId?: unknown;
  supplier?: unknown;
}

/**
 * Ta'minotchilar (0.3.3): ro'yxat va balanslar (olingan − to'langan = qarz), to'lovlar.
 * Balans supplier_id bo'yicha hisoblanadi; ta'minotchisiz kirim va to'lovlar ro'yxatga kirmaydi.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SupplierEntity)
    private readonly suppliers: Repository<SupplierEntity>,
    @InjectRepository(SupplierPaymentEntity)
    private readonly payments: Repository<SupplierPaymentEntity>,
  ) {}

  /** Ta'minotchilar balansi bilan: qarz bo'yicha kamayish tartibida, keyin nom bo'yicha */
  async list(): Promise<Supplier[]> {
    const rows = await this.withBalances(this.suppliers.manager, await this.suppliers.find());
    return rows.sort((a, b) => b.debt - a.debt || a.name.localeCompare(b.name, 'uz'));
  }

  /** Eski shakl (legacy): o'sha raqamlar { supplier, purchased, paid, debt, count } ko'rinishida */
  async legacyBalances(): Promise<SupplierBalanceRow[]> {
    return (await this.list()).map((s) => ({
      supplier: s.name,
      purchased: s.purchased,
      paid: s.paid,
      debt: s.debt,
      count: s.purchasesCount,
    }));
  }

  async create(dto: SupplierDto): Promise<Supplier> {
    const name = cleanName(dto.name);
    if (!name) throw new BadRequestException(SUPPLIER_NAME_REQUIRED_MESSAGE);
    return this.dataSource.transaction(async (m) => {
      if (await this.findByName(m, name)) throw new BadRequestException(SUPPLIER_NAME_TAKEN_MESSAGE);
      const saved = await m.save(
        m.create(SupplierEntity, { name, phone: optionalText(dto.phone), note: optionalText(dto.note) }),
      );
      return this.view(m, saved);
    });
  }

  /** Tahrirlash. Nom o'zgarsa — kirim/to'lov qatorlaridagi nom va jurnaldagi kirim/vozvrat yorliqlari ham */
  async update(id: string, dto: SupplierDto): Promise<Supplier> {
    return this.dataSource.transaction(async (m) => {
      const current = await m.findOne(SupplierEntity, { where: { id } });
      if (!current) throw new NotFoundException(SUPPLIER_NOT_FOUND_MESSAGE);
      const patch: Partial<SupplierEntity> = {};
      if (dto.name != null) {
        const name = cleanName(dto.name);
        if (!name) throw new BadRequestException(SUPPLIER_NAME_REQUIRED_MESSAGE);
        if (name !== current.name) {
          if (await this.findByName(m, name, id)) throw new BadRequestException(SUPPLIER_NAME_TAKEN_MESSAGE);
          patch.name = name;
        }
      }
      if (dto.phone !== undefined) patch.phone = optionalText(dto.phone);
      if (dto.note !== undefined) patch.note = optionalText(dto.note);
      if (Object.keys(patch).length) await m.update(SupplierEntity, id, patch);
      if (patch.name) await renameEverywhere(m, id, patch.name);
      return this.view(m, { ...current, ...patch });
    });
  }

  /** Kirim yoki to'lovi bor ta'minotchi o'chirilmaydi (qarz tarixi yo'qolmasin). Yo'q bo'lsa ham — ok */
  async remove(id: string): Promise<{ ok: true }> {
    return this.dataSource.transaction(async (m) => {
      const used =
        (await m.count(PurchaseEntity, { where: { supplierId: id } })) +
        (await m.count(SupplierPaymentEntity, { where: { supplierId: id } }));
      if (used > 0) throw new BadRequestException(SUPPLIER_IN_USE_MESSAGE);
      await m.delete(SupplierEntity, { id });
      return { ok: true as const };
    });
  }

  // ---- To'lovlar ----

  /** To'lovlar (eng yangisi birinchi), ixtiyoriy ta'minotchi bo'yicha; limit ≤ 500 (standart 200) */
  async listPayments(query: SupplierPaymentsQuery): Promise<SupplierPayment[]> {
    const qb = this.payments.createQueryBuilder('sp');
    const supplierId = queryStr(query.supplierId);
    if (supplierId) qb.where('sp.supplierId = :supplierId', { supplierId });
    const rows = await qb
      .orderBy('sp.createdAt', 'DESC')
      .addOrderBy('sp.rowid', 'DESC')
      .limit(positiveInt(query.limit, 200, 500))
      .getMany();
    return rows.map(toSupplierPayment);
  }

  /** Ta'minotchiga to'lov (qarzni kamaytiradi): summa butun so'm, > 0; ta'minotchi majburiy */
  async addPayment(dto: SupplierPaymentDto, actor: InventoryActor): Promise<SupplierPayment> {
    const amount = typeof dto.amount === 'number' && Number.isFinite(dto.amount) ? Math.round(dto.amount) : 0;
    if (!(amount > 0)) throw new BadRequestException(SUPPLIER_PAYMENT_AMOUNT_MESSAGE);
    const note = optionalText(dto.note);
    return this.dataSource.transaction(async (m) => {
      const supplier = (await this.resolve(m, dto, true)) as SupplierEntity;
      const saved = await m.save(
        m.create(SupplierPaymentEntity, {
          supplier: supplier.name,
          supplierId: supplier.id,
          amount,
          note,
          userName: actor.name,
        }),
      );
      return toSupplierPayment(saved);
    });
  }

  /** To'lovni o'chirish (pul yozuvini bekor qilish — faqat administrator/direktor, controller tekshiradi) */
  async removePayment(id: string): Promise<{ ok: true }> {
    return this.dataSource.transaction(async (m) => {
      const row = await m.findOne(SupplierPaymentEntity, { where: { id } });
      if (!row) throw new NotFoundException(SUPPLIER_PAYMENT_NOT_FOUND_MESSAGE);
      await m.delete(SupplierPaymentEntity, { id });
      return { ok: true as const };
    });
  }

  // ---- Kirim / vozvrat / to'lov uchun ta'minotchini aniqlash ----

  /**
   * supplierId berilsa — shu ta'minotchi (yo'q bo'lsa 404). Aks holda nom: mavjudi katta-kichik harf va
   * bo'shliqlarsiz topiladi, topilmasa — yangisi yaratiladi. Ikkalasi ham bo'sh: required — 400, aks holda
   * null (ta'minotchisiz kirim). Tranzaksiya ichida chaqiriladi.
   */
  async resolve(m: EntityManager, ref: SupplierRef, required: boolean): Promise<SupplierEntity | null> {
    const id = typeof ref.supplierId === 'string' ? ref.supplierId.trim() : '';
    if (id) {
      const found = await m.findOne(SupplierEntity, { where: { id } });
      if (!found) throw new NotFoundException(SUPPLIER_NOT_FOUND_MESSAGE);
      return found;
    }
    const name = cleanName(ref.supplier);
    if (!name) {
      if (required) throw new BadRequestException(SUPPLIER_NAME_REQUIRED_MESSAGE);
      return null;
    }
    return (await this.findByName(m, name)) ?? m.save(m.create(SupplierEntity, { name }));
  }

  /** Nomi bo'yicha (katta-kichik harf va bo'shliqlarsiz) — ta'minotchilar soni kichik, JS'da solishtiramiz */
  private async findByName(m: EntityManager, name: string, exceptId?: string): Promise<SupplierEntity | null> {
    const key = nameKey(name);
    const all = await m.find(SupplierEntity);
    return all.find((s) => s.id !== exceptId && nameKey(s.name) === key) ?? null;
  }

  private async view(m: EntityManager, supplier: SupplierEntity): Promise<Supplier> {
    const [row] = await this.withBalances(m, [supplier]);
    return row;
  }

  /**
   * Balanslar: olingan = kirimlar summasi (vozvrat — manfiy qator), to'langan = to'lovlar, qarz = farq
   * (butun so'm). purchasesCount va lastPurchaseAt — faqat kirimlar (vozvratlarsiz).
   */
  private async withBalances(m: EntityManager, list: SupplierEntity[]): Promise<Supplier[]> {
    if (!list.length) return [];
    const ids = list.map((s) => s.id);
    const bought = await m
      .createQueryBuilder(PurchaseEntity, 'p')
      .select('p.supplierId', 'id')
      .addSelect('COALESCE(SUM(p.total), 0)', 'purchased')
      .addSelect('SUM(CASE WHEN p.quantity > 0 THEN 1 ELSE 0 END)', 'count')
      .addSelect('MAX(CASE WHEN p.quantity > 0 THEN p.createdAt END)', 'last')
      .where({ supplierId: In(ids) })
      .groupBy('p.supplierId')
      .getRawMany<{ id: string; purchased: number | string; count: number | string; last: string | null }>();
    const paid = await m
      .createQueryBuilder(SupplierPaymentEntity, 'sp')
      .select('sp.supplierId', 'id')
      .addSelect('COALESCE(SUM(sp.amount), 0)', 'paid')
      .where({ supplierId: In(ids) })
      .groupBy('sp.supplierId')
      .getRawMany<{ id: string; paid: number | string }>();
    const boughtBy = new Map(bought.map((r) => [r.id, r]));
    const paidBy = new Map(paid.map((r) => [r.id, Math.round(Number(r.paid) || 0)]));
    return list.map((s) => {
      const b = boughtBy.get(s.id);
      const purchased = Math.round(Number(b?.purchased) || 0);
      const paidSum = paidBy.get(s.id) ?? 0;
      return {
        id: s.id,
        name: s.name,
        phone: s.phone ?? null,
        note: s.note ?? null,
        purchased,
        paid: paidSum,
        debt: purchased - paidSum,
        purchasesCount: Number(b?.count) || 0,
        lastPurchaseAt: isoOf(b?.last ?? null),
      };
    });
  }
}

/** Ta'minotchi nomi o'zgardi: kirim/to'lov qatorlaridagi nom nusxasi va jurnaldagi kirim/vozvrat yorliqlari */
async function renameEverywhere(m: EntityManager, supplierId: string, name: string): Promise<void> {
  await m.update(PurchaseEntity, { supplierId }, { supplier: name });
  await m.update(SupplierPaymentEntity, { supplierId }, { supplier: name });
  await m.query(
    `UPDATE stock_movements SET reference_label = CASE type WHEN 'purchase' THEN ? ELSE ? END
     WHERE type IN ('purchase', 'return') AND reference IN (SELECT id FROM purchases WHERE supplier_id = ?)`,
    [purchaseLabel(name), supplierReturnLabel(name), supplierId],
  );
}
