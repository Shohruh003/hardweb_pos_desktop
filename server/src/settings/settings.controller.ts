import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PaymentMethod, PosSettings, UserRole } from '@hardweb-pos/shared';
import { SettingsService } from './settings.service';
import { TelegramService } from '../telegram/telegram.service';
import { TelegramBackupService } from '../backup/telegram-backup.service';
import { validatePaymentMethods } from '../orders/order-rules';
import { isLocalRequest, LOCAL_SETTING_ONLY_MESSAGE } from '../auth/local-request';

const PERCENT_MESSAGE = 'Xizmat haqi foizi 0 dan 100 gacha bo‘lishi kerak';
const SHARE_MESSAGE = 'Ofitsiant ulushi foizi 0 dan 100 gacha bo‘lishi kerak';
const HALL_ORDER_MESSAGE = 'Zallar tartibi noto‘g‘ri';
const DELIVERY_FEE_DEFAULT_MESSAGE = 'Yetkazish narxi 0 dan 1 000 000 gacha bo‘lishi kerak';

class SettingsDto {
  @IsOptional() @IsString() restaurantName?: string;
  @IsOptional() @IsString() telegramToken?: string;
  @IsOptional() @IsString() telegramChatId?: string;
  @IsOptional() @IsString() dailyReportTime?: string;
  // Kunlik zaxira nusxani Telegram'ga yuborish (yoqilgan / o'chirilgan)
  @IsOptional()
  @IsBoolean({ message: 'Zaxira nusxa sozlamasi noto‘g‘ri (true yoki false)' })
  telegramBackup?: boolean;

  // Stolga buyurtmalarga avtomatik xizmat haqi foizi (masalan 6)
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: PERCENT_MESSAGE })
  @Min(0, { message: PERCENT_MESSAGE })
  @Max(100, { message: PERCENT_MESSAGE })
  serviceDineInPercent?: number;

  // Ofitsiant ulushi: stolga buyurtmalar summasidan foiz (masalan 5) — ofitsiantlar hisoboti uchun
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: SHARE_MESSAGE })
  @Min(0, { message: SHARE_MESSAGE })
  @Max(100, { message: SHARE_MESSAGE })
  waiterSharePercent?: number;

  // Zallar tartibi (ofitsiant/kassa ekranida shu tartibda)
  @IsOptional()
  @IsArray({ message: HALL_ORDER_MESSAGE })
  @IsString({ each: true, message: HALL_ORDER_MESSAGE })
  hallOrder?: string[];

  // Yangi yetkazish buyurtmasining standart yetkazish narxi (butun so'm)
  @IsOptional()
  @IsInt({ message: DELIVERY_FEE_DEFAULT_MESSAGE })
  @Min(0, { message: DELIVERY_FEE_DEFAULT_MESSAGE })
  @Max(1_000_000, { message: DELIVERY_FEE_DEFAULT_MESSAGE })
  deliveryFeeDefault?: number;

  // To'lov usullari ro'yxati (to'liq ro'yxat yuboriladi; null — standart ro'yxatga qaytish).
  // Ichki tekshiruv (kalit, nom, toifa, faol naqd usul) — validatePaymentMethods.
  // B35: faqat server kompyuterining o'zidan o'zgartiriladi
  @IsOptional()
  @IsBoolean({ message: 'Direktor kirishi sozlamasi noto‘g‘ri (true yoki false)' })
  directorLocalOnly?: boolean;

  @ValidateIf((o: SettingsDto) => o.paymentMethods !== null && o.paymentMethods !== undefined)
  @IsArray({ message: 'To‘lov turlari ro‘yxati noto‘g‘ri' })
  paymentMethods?: PaymentMethod[] | null;
}

// Restoran sozlamalari — Direktor va SuperAdmin boshqaradi (Telegram token va h.k.)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Director, UserRole.SuperAdmin)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly telegram: TelegramService,
    private readonly backup: TelegramBackupService,
  ) {}

  // localRequest (B35) — so'rov server kompyuterining o'zidanmi: "Direktor faqat server
  // kompyuteridan kiradi" sozlamasini faqat shunda o'zgartirish mumkin (renderer tugmani o'chiradi)
  @Get()
  async get(@Req() req: any) {
    return { ...(await this.settings.getView()), localRequest: isLocalRequest(req) };
  }

  @Patch()
  async update(@Body() dto: SettingsDto, @Req() req: any) {
    if (dto.paymentMethods !== undefined && dto.paymentMethods !== null) {
      const problem = validatePaymentMethods(dto.paymentMethods);
      if (problem) throw new BadRequestException(problem);
    }
    const localRequest = isLocalRequest(req);
    if (dto.directorLocalOnly !== undefined && !localRequest) {
      // O'zgarmagan qiymatni qayta yuborish xato emas — faqat o'zgartirish taqiqlanadi
      const current = (await this.settings.get()).directorLocalOnly !== false;
      if (dto.directorLocalOnly !== current) throw new ForbiddenException(LOCAL_SETTING_ONLY_MESSAGE);
      delete dto.directorLocalOnly;
    }
    await this.settings.update(dto);
    return { ...(await this.settings.getView()), localRequest };
  }

  // Chat id'ni avtomatik aniqlash (direktor botga /start yozgan bo'lishi kerak)
  @Post('telegram-detect')
  async detectChat(@Body() body: { token?: string }) {
    const chatId = await this.telegram.detectChatId(body?.token);
    if (chatId) {
      // Yangi qabul qiluvchi ro'yxatga QO'SHILADI — avvalgilar (ega, boshqa direktor) o'chib ketmasin
      const current = String((await this.settings.get()).telegramChatId ?? '')
        .split(/[\s,;]+/)
        .map((c) => c.trim())
        .filter(Boolean);
      if (!current.includes(chatId)) {
        await this.settings.update({ telegramChatId: [...current, chatId].join(', ') });
      }
    }
    return { chatId };
  }

  // Bazaning zaxira nusxasini hoziroq Telegram'ga yuborish (sinov / qo'lda)
  @Post('telegram-backup')
  async sendBackup() {
    return this.backup.run();
  }

  // Telegram ulanishini tekshirish — sinov xabari yuboradi
  @Post('telegram-test')
  async testTelegram() {
    const ok = await this.telegram.sendMessage(
      '✅ DasturXon — Telegram ulanish sinovi muvaffaqiyatli!',
    );
    return { ok };
  }

  // Kunlik hisobotni hoziroq yuborish (sinov)
  @Post('telegram-report')
  async sendReport() {
    // ok:false — token/chat id noto'g'ri yoki Telegram javob bermadi (sabab server logida)
    const ok = await this.telegram.sendDailyReport();
    return { ok };
  }
}

// POS sozlamalari (xizmat haqi foizi, zallar tartibi, restoran nomi) — tizimga kirgan
// ISTALGAN xodim o'qiydi (ofitsiant, kassir, oshpaz). Alohida controller: SettingsController'ning
// sinf darajasidagi @Roles (faqat direktor) bu marshrutga ta'sir qilmasin.
@UseGuards(JwtAuthGuard)
@Controller('settings/pos')
export class PosSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(): Promise<PosSettings> {
    return this.settings.getPos();
  }
}
