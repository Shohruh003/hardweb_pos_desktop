import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createReadStream, createWriteStream, promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { SettingsEntity } from '../entities';

/** Birinchi tekshiruv — server ishga tushgach (boshqa ishlar tinchigach) */
const FIRST_CHECK_MS = 2 * 60 * 1000;
/** Keyingi tekshiruvlar oralig'i */
const CHECK_EVERY_MS = 10 * 60 * 1000;
/** Muvaffaqiyatsiz urinishdan keyin qayta urinish oralig'i (Telegram ishlamasa spam bo'lmasin) */
const RETRY_AFTER_MS = 60 * 60 * 1000;
/** Telegram Bot API sendDocument chegarasi — 50 MB (biroz zaxira bilan) */
export const TELEGRAM_MAX_BYTES = 49 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 180_000;

export interface BackupResult {
  ok: boolean;
  message: string;
  sizeBytes?: number;
  sentAt?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "HH:MM" -> berilgan kundagi mahalliy vaqt (noto'g'ri qiymat — 23:59) */
function slotOn(day: Date, hhmm: string | null | undefined): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  const h = m ? Math.min(23, Number(m[1])) : 23;
  const mi = m ? Math.min(59, Number(m[2])) : 59;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi, 0, 0);
}

/**
 * Oxirgi "zaxira vaqti" (kunlik hisobot vaqti bilan bir xil): bugungisi hali kelmagan bo'lsa — kechagisi.
 * Shu vaqtdan keyin zaxira yuborilmagan bo'lsa — yuboriladi (kompyuter tunda o'chiq bo'lsa — ertasi kuni
 * yoqilganda).
 */
export function lastBackupSlot(now: Date, hhmm: string | null | undefined): Date {
  const today = slotOn(now, hhmm);
  if (now.getTime() >= today.getTime()) return today;
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return slotOn(y, hhmm);
}

/**
 * Bazaning kunlik zaxira nusxasi Telegram'ga (0.3.3). Kassa kompyuterining diski buzilsa yoki
 * kompyuter almashsa ham savdo tarixi yo'qolmasin: har kuni (kunlik hisobot vaqtidan keyin) bazadan
 * "online" nusxa olinadi, siqiladi (.db.gz) va Telegram sozlamasidagi qabul qiluvchilarga fayl bo'lib
 * yuboriladi. Sozlamada o'chirib qo'yish mumkin (telegramBackup). Hech qachon throw qilmaydi.
 */
@Injectable()
export class TelegramBackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TelegramBackup');
  private firstTimer: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;
  private running: Promise<BackupResult> | null = null;
  private lastFailedAt = 0;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SettingsEntity)
    private readonly settings: Repository<SettingsEntity>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    // Oraliqlar faqat sinovlarda o'zgartiriladi (TELEGRAM_BACKUP_FIRST_MS / TELEGRAM_BACKUP_EVERY_MS)
    const first = Number(this.config.get('TELEGRAM_BACKUP_FIRST_MS')) || FIRST_CHECK_MS;
    const every = Number(this.config.get('TELEGRAM_BACKUP_EVERY_MS')) || CHECK_EVERY_MS;
    this.firstTimer = setTimeout(() => void this.tick(), first);
    this.firstTimer.unref?.();
    this.interval = setInterval(() => void this.tick(), every);
    this.interval.unref?.();
  }

  onModuleDestroy() {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.interval) clearInterval(this.interval);
    this.firstTimer = this.interval = null;
  }

  /** Telegram Bot API manzili (sinovlarda — mahalliy soxta server: TELEGRAM_API_BASE) */
  private apiBase(): string {
    const base = String(this.config.get<string>('TELEGRAM_API_BASE', '') || '').trim().replace(/\/+$/, '');
    return base || 'https://api.telegram.org';
  }

  /** Token va qabul qiluvchilar (sozlamadan, bo'lmasa .env) */
  private creds(s: SettingsEntity | null): { token: string; chatIds: string[] } {
    const token = s?.telegramToken || this.config.get<string>('TELEGRAM_BOT_TOKEN', '');
    const raw = s?.telegramChatId || this.config.get<string>('TELEGRAM_CHAT_ID', '');
    const chatIds = String(raw ?? '')
      .split(/[\s,;]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    return { token: String(token ?? '').trim(), chatIds };
  }

  /** Jadval bo'yicha tekshiruv: yoqilgan, Telegram sozlangan va oxirgi zaxira vaqtidan keyin yuborilmagan */
  private async tick(): Promise<void> {
    try {
      if (this.running) return;
      if (this.lastFailedAt && Date.now() - this.lastFailedAt < RETRY_AFTER_MS) return;
      const s = await this.settings.findOne({ where: { id: 'main' } });
      if (!s || s.telegramBackup === false) return;
      const { token, chatIds } = this.creds(s);
      if (!token || chatIds.length === 0) return;
      const last = s.telegramBackupAt ? new Date(s.telegramBackupAt).getTime() : 0;
      const slot = lastBackupSlot(new Date(), s.dailyReportTime);
      if (last >= slot.getTime()) return;
      const res = await this.run();
      if (!res.ok) this.lastFailedAt = Date.now();
    } catch (e) {
      this.logger.warn(`Zaxira tekshiruvida xato: ${(e as Error)?.message ?? e}`);
    }
  }

  /** Zaxira nusxani hoziroq yuborish (bir vaqtda faqat bittasi) */
  run(): Promise<BackupResult> {
    if (this.running) return this.running;
    this.running = this.doRun()
      .catch((e): BackupResult => {
        this.logger.warn(`Zaxira nusxa yuborilmadi: ${(e as Error)?.message ?? e}`);
        return { ok: false, message: 'Zaxira nusxa olib bo‘lmadi — server jurnalini tekshiring' };
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async doRun(): Promise<BackupResult> {
    const s = await this.settings.findOne({ where: { id: 'main' } });
    const { token, chatIds } = this.creds(s);
    if (!token || chatIds.length === 0) {
      return { ok: false, message: 'Telegram sozlanmagan — bot token va chat id kiriting' };
    }
    const db = (this.dataSource.driver as unknown as { databaseConnection?: { backup?: (to: string) => Promise<unknown> } })
      .databaseConnection;
    if (!db || typeof db.backup !== 'function') {
      return { ok: false, message: 'Zaxira nusxa olib bo‘lmadi — baza ulanishi topilmadi' };
    }

    const now = new Date();
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const dir = await fsp.mkdtemp(join(tmpdir(), 'dasturxon-backup-'));
    const name = `dasturxon-${stamp}.db`;
    const dbCopy = join(dir, name);
    const gz = `${dbCopy}.gz`;
    try {
      // Online backup — ish davom etayotganda ham to'liq va izchil nusxa
      await db.backup(dbCopy);
      await pipeline(createReadStream(dbCopy), createGzip({ level: 9 }), createWriteStream(gz));
      const size = (await fsp.stat(gz)).size;
      const mb = (size / 1024 / 1024).toFixed(1).replace('.', ',');
      const restaurant = s?.restaurantName || 'DasturXon';
      const when = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

      if (size > TELEGRAM_MAX_BYTES) {
        const text =
          `⚠️ ${restaurant}: bazaning zaxira nusxasi juda katta (${mb} MB) — Telegram orqali yuborib bo‘lmaydi ` +
          `(chegara 50 MB). Kassa kompyuteridagi zaxira nusxalardan foydalaning yoki fleshkaga ko‘chiring.`;
        await Promise.all(chatIds.map((id) => this.sendText(token, id, text)));
        return { ok: false, message: `Zaxira nusxa juda katta (${mb} MB) — Telegram 50 MB gacha qabul qiladi`, sizeBytes: size };
      }

      const data = await fsp.readFile(gz);
      const caption =
        `🗄 ${restaurant} — bazaning zaxira nusxasi\n${when} · ${mb} MB\n` +
        `Saqlab qo‘ying. Kerak bo‘lsa (kompyuter buzilsa) shu fayldan ma’lumotlar tiklanadi.`;
      const results = await Promise.all(chatIds.map((id) => this.sendDocument(token, id, data, `${name}.gz`, caption)));
      const ok = results.some(Boolean);
      if (!ok) {
        return { ok: false, message: 'Telegram faylni qabul qilmadi — token, chat id va internetni tekshiring', sizeBytes: size };
      }
      await this.settings.update({ id: 'main' }, { telegramBackupAt: now });
      this.lastFailedAt = 0;
      this.logger.log(`Zaxira nusxa Telegram'ga yuborildi (${mb} MB, ${results.filter(Boolean).length}/${chatIds.length})`);
      return { ok: true, message: `Zaxira nusxa Telegram'ga yuborildi (${mb} MB)`, sizeBytes: size, sentAt: now.toISOString() };
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async sendDocument(token: string, chatId: string, data: Buffer, filename: string, caption: string): Promise<boolean> {
    try {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', caption);
      form.append('document', new Blob([new Uint8Array(data)], { type: 'application/gzip' }), filename);
      const res = await fetch(`${this.apiBase()}/bot${token}/sendDocument`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (res.ok) return true;
      const body = (await res.json().catch(() => null)) as { description?: string } | null;
      this.logger.warn(`Telegram zaxira xatosi (${chatId}): ${res.status}${body?.description ? ` — ${body.description}` : ''}`);
      return false;
    } catch (e) {
      this.logger.warn(`Telegram zaxira yuborilmadi (${chatId}): ${(e as Error)?.message ?? e}`);
      return false;
    }
  }

  private async sendText(token: string, chatId: string, text: string): Promise<void> {
    try {
      await fetch(`${this.apiBase()}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      /* e'tiborsiz — asosiy natija qaytariladi */
    }
  }
}
