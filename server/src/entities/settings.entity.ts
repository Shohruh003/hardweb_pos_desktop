import { Column, Entity, PrimaryColumn } from 'typeorm';

// Restoran sozlamalari — bitta qatorli konfiguratsiya (id='main').
// Har bir restoran (lokal o'rnatma) o'z sozlamasiga ega: nom, Telegram token va h.k.
@Entity('settings')
export class SettingsEntity {
  @PrimaryColumn({ type: 'varchar', default: 'main' })
  id: string;

  @Column({ name: 'restaurant_name', type: 'varchar', default: 'DasturXon' })
  restaurantName: string;

  @Column({ name: 'telegram_token', type: 'varchar', nullable: true })
  telegramToken: string | null;

  @Column({ name: 'telegram_chat_id', type: 'varchar', nullable: true })
  telegramChatId: string | null;

  @Column({ name: 'daily_report_time', type: 'varchar', default: '23:59' })
  dailyReportTime: string;
}
