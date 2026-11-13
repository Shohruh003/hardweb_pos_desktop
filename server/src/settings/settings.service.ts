import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentMethod, PosSettings, clampPercent, roundSum } from '@hardweb-pos/shared';
import { SettingsEntity } from '../entities';
import { normalizeHallList } from '../tables/hall-order';
import { DELIVERY_FEE_MAX, normalizePaymentMethods } from '../orders/order-rules';

/** Restoran nomi bo'sh bo'lsa ko'rsatiladigan nom */
const DEFAULT_RESTAURANT_NAME = 'DasturXon';

/** Foiz: 0..100, 2 xonagacha */
function percent2(value: unknown): number {
  return Math.round(clampPercent(value as number) * 100) / 100;
}

/**
 * Zal bo'yicha xizmat haqi xaritasi -> toza ko'rinish: kalit — bo'sh bo'lmagan zal nomi (chetidagi
 * bo'shliqlarsiz), qiymat — 0..100 foiz (2 xonagacha). Noto'g'ri yozuvlar tashlab yuboriladi.
 */
export function normalizeHallServiceMap(map: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
  for (const [rawHall, rawValue] of Object.entries(map as Record<string, unknown>)) {
    const hall = typeof rawHall === 'string' ? rawHall.trim() : '';
    if (!hall || rawValue === null || rawValue === undefined || rawValue === '') continue;
    const n = Number(rawValue);
    if (!Number.isFinite(n)) continue;
    out[hall] = percent2(n);
  }
  return out;
}

/** Yetkazish narxi: butun so'm, 0..1 000 000 */
function normalizeFee(value: unknown): number {
  return Math.min(DELIVERY_FEE_MAX, Math.max(0, roundSum(value as number)));
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(SettingsEntity)
    private readonly repo: Repository<SettingsEntity>,
  ) {}

  async get(): Promise<SettingsEntity> {
    let s = await this.repo.findOne({ where: { id: 'main' } });
    if (!s) {
      s = await this.repo.save(this.repo.create({ id: 'main' }));
    }
    return s;
  }

  async update(patch: Partial<SettingsEntity>): Promise<SettingsEntity> {
    const s = await this.get();
    const next: Partial<SettingsEntity> = { ...patch };
    // Foizlar 0..100 (2 xonagacha), zallar ro'yxati — toza va takrorsiz
    if (next.serviceDineInPercent !== undefined) {
      next.serviceDineInPercent = percent2(next.serviceDineInPercent);
    }
    if (next.waiterSharePercent !== undefined) {
      next.waiterSharePercent = percent2(next.waiterSharePercent);
    }
    if (next.hallOrder !== undefined) next.hallOrder = normalizeHallList(next.hallOrder);
    if (next.hallServicePercent !== undefined) {
      next.hallServicePercent = normalizeHallServiceMap(next.hallServicePercent);
    }
    if (next.deliveryFeeDefault !== undefined) {
      next.deliveryFeeDefault = normalizeFee(next.deliveryFeeDefault);
    }
    if (next.paymentMethods !== undefined) {
      // null — standart ro'yxatga qaytish; aks holda (controller tekshirgan) toza ro'yxat
      next.paymentMethods =
        next.paymentMethods === null ? null : normalizePaymentMethods(next.paymentMethods);
    }
    Object.assign(s, next, { id: 'main' });
    return this.repo.save(s);
  }

  /** POS ekranlari uchun ochiq sozlamalar (GET /settings/pos) — maxfiy maydonlarsiz */
  async getPos(): Promise<PosSettings> {
    const s = await this.get();
    return toPosSettings(s);
  }

  /** GET /settings — sozlamalar qatori, xaritalar/ro'yxatlar toza ko'rinishda (to'lov usullari — doim ro'yxat) */
  async getView(): Promise<SettingsEntity> {
    const s = await this.get();
    return {
      ...s,
      hallOrder: normalizeHallList(s.hallOrder),
      hallServicePercent: normalizeHallServiceMap(s.hallServicePercent),
      deliveryFeeDefault: normalizeFee(s.deliveryFeeDefault),
      paymentMethods: normalizePaymentMethods(s.paymentMethods),
    };
  }

  /** Faol va nofaol barcha to'lov usullari (sozlamada bo'lmasa — standart ro'yxat) */
  async paymentMethods(): Promise<PaymentMethod[]> {
    return normalizePaymentMethods((await this.get()).paymentMethods);
  }

  /** Zalning alohida xizmat haqi foizini o'rnatish (null — o'chirish, umumiy foiz qo'llanadi) */
  async setHallServicePercent(hall: string, percent: number | null): Promise<Record<string, number>> {
    const s = await this.get();
    const map = normalizeHallServiceMap(s.hallServicePercent);
    const name = hall.trim();
    if (percent === null) delete map[name];
    else map[name] = percent2(percent);
    const saved = await this.update({ hallServicePercent: map });
    return normalizeHallServiceMap(saved.hallServicePercent);
  }

  /**
   * Zal nomi o'zgarganda: zallar tartibidagi nom va alohida xizmat haqi foizi kaliti ham ko'chadi
   * (bitta saqlash bilan).
   */
  async renameHall(from: string, to: string): Promise<void> {
    const s = await this.get();
    const patch: Partial<SettingsEntity> = {};
    const list = normalizeHallList(s.hallOrder);
    if (list.includes(from)) patch.hallOrder = list.map((h) => (h === from ? to : h));
    const map = normalizeHallServiceMap(s.hallServicePercent);
    if (Object.prototype.hasOwnProperty.call(map, from)) {
      const value = map[from];
      delete map[from];
      map[to] = value;
      patch.hallServicePercent = map;
    }
    if (Object.keys(patch).length > 0) await this.update(patch);
  }

  /** Zal o'chirilganda: zallar tartibidan va xizmat haqi xaritasidan ham olib tashlanadi */
  async removeHall(hall: string): Promise<void> {
    const s = await this.get();
    const patch: Partial<SettingsEntity> = {};
    const list = normalizeHallList(s.hallOrder);
    if (list.includes(hall)) patch.hallOrder = list.filter((h) => h !== hall);
    const map = normalizeHallServiceMap(s.hallServicePercent);
    if (Object.prototype.hasOwnProperty.call(map, hall)) {
      delete map[hall];
      patch.hallServicePercent = map;
    }
    if (Object.keys(patch).length > 0) await this.update(patch);
  }
}

/** Sozlama qatori -> PosSettings (Telegram token va h.k. kirmaydi) */
export function toPosSettings(s: Partial<SettingsEntity> | null | undefined): PosSettings {
  return {
    restaurantName: (s?.restaurantName ?? '').trim() || DEFAULT_RESTAURANT_NAME,
    serviceDineInPercent: clampPercent(s?.serviceDineInPercent),
    hallServicePercent: normalizeHallServiceMap(s?.hallServicePercent),
    waiterSharePercent: clampPercent(s?.waiterSharePercent),
    deliveryFeeDefault: normalizeFee(s?.deliveryFeeDefault ?? 0),
    paymentMethods: normalizePaymentMethods(s?.paymentMethods),
    hallOrder: normalizeHallList(s?.hallOrder),
  };
}

/** Restoran nomi (chek sarlavhasi uchun) */
export function restaurantNameOf(s: Partial<SettingsEntity> | null | undefined): string {
  return (s?.restaurantName ?? '').trim() || DEFAULT_RESTAURANT_NAME;
}
