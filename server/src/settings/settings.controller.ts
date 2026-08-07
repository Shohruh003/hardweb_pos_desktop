import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@hardweb-pos/shared';
import { SettingsService } from './settings.service';
import { TelegramService } from '../telegram/telegram.service';

class SettingsDto {
  @IsOptional() @IsString() restaurantName?: string;
  @IsOptional() @IsString() telegramToken?: string;
  @IsOptional() @IsString() telegramChatId?: string;
  @IsOptional() @IsString() dailyReportTime?: string;
}

// Restoran sozlamalari — Direktor va SuperAdmin boshqaradi (Telegram token va h.k.)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Director, UserRole.SuperAdmin)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly telegram: TelegramService,
  ) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Patch()
  update(@Body() dto: SettingsDto) {
    return this.settings.update(dto);
  }

  // Chat id'ni avtomatik aniqlash (direktor botga /start yozgan bo'lishi kerak)
  @Post('telegram-detect')
  async detectChat(@Body() body: { token?: string }) {
    const chatId = await this.telegram.detectChatId(body?.token);
    if (chatId) {
      await this.settings.update({ telegramChatId: chatId });
    }
    return { chatId };
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
    await this.telegram.sendDailyReport();
    return { ok: true };
  }
}
