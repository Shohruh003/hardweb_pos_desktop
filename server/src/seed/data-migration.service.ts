import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { UserRole } from '@hardweb-pos/shared';
import { SettingsEntity, UserEntity } from '../entities';

/** Joriy ma'lumot versiyasi (settings.data_version) */
export const DATA_VERSION = 4;

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
