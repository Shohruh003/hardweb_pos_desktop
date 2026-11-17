import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity, SettingsEntity } from '../entities';
import { PosSettingsController, SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { TelegramModule } from '../telegram/telegram.module';
import { BackupModule } from '../backup/backup.module';

@Module({
  imports: [TypeOrmModule.forFeature([SettingsEntity, ProductEntity]), TelegramModule, BackupModule],
  controllers: [SettingsController, PosSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
