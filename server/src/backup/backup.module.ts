import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsEntity } from '../entities';
import { TelegramBackupService } from './telegram-backup.service';

// Bazaning kunlik zaxira nusxasi Telegram'ga (0.3.3)
@Module({
  imports: [TypeOrmModule.forFeature([SettingsEntity])],
  providers: [TelegramBackupService],
  exports: [TelegramBackupService],
})
export class BackupModule {}
