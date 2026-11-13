import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsEntity } from '../entities';
import { PosSettingsController, SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [TypeOrmModule.forFeature([SettingsEntity]), TelegramModule],
  controllers: [SettingsController, PosSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
