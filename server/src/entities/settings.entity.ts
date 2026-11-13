import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { PaymentMethod } from '@hardweb-pos/shared';

// Restoran sozlamalari — bitta qatorli konfiguratsiya (id='main').
// Har bir restoran (lokal o'rnatma) o'z sozlamasiga ega: nom, Telegram token va h.k.
// Yangi ustunlar DEFAULT bilan — mavjud bazada synchronize ularni ma'lumot yo'qotmasdan qo'shadi.
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

  // Stolga (zaldagi) yangi buyurtmalarga avtomatik qo'yiladigan xizmat haqi foizi (0..100).
  // Olib ketish / yetkazishda xizmat haqi yo'q.
  @Column({ name: 'service_dine_in_percent', type: 'decimal', precision: 5, scale: 2, default: 0 })
  serviceDineInPercent: number;

  // Ofitsiant ulushi: stolga buyurtmalar summasidan foiz (0..100) — ofitsiantlar hisobotida
  @Column({ name: 'waiter_share_percent', type: 'decimal', precision: 5, scale: 2, default: 0 })
  waiterSharePercent: number;

  // Zallar tartibi (ofitsiant/kassa ekranida shu tartibda chiqadi; ro'yxatda yo'qlari — oxirida, alifbo bo'yicha)
  @Column({ name: 'hall_order', type: 'simple-json', default: '[]' })
  hallOrder: string[];

  // Zal bo'yicha alohida xizmat haqi foizi: {"Banket zal": 10}. Ro'yxatda yo'q zal — umumiy foiz
  // (serviceDineInPercent). Stolga yangi hisob ochilganda qo'llanadi (shared hallServicePercentFor).
  @Column({ name: 'hall_service_percent', type: 'simple-json', default: '{}' })
  hallServicePercent: Record<string, number>;

  // Yangi yetkazish buyurtmasining standart yetkazish narxi (butun so'm; 0 = yo'q)
  @Column({ name: 'delivery_fee_default', type: 'int', default: 0 })
  deliveryFeeDefault: number;

  // To'lov usullari (direktor sozlaydi: nomi, yoqilgan/o'chirilgan, maxsus usul). NULL — standart
  // ro'yxat (shared DEFAULT_PAYMENT_METHODS): Naqd, Terminal (karta), Click, Payme, Qarzga.
  @Column({ name: 'payment_methods', type: 'simple-json', nullable: true })
  paymentMethods: PaymentMethod[] | null;

  // B35: direktor/SuperAdmin faqat server (kassa) kompyuteridan kira oladi. Faqat server
  // kompyuterining o'zidan o'zgartiriladi (PATCH /settings — lokal so'rov)
  @Column({ name: 'director_local_only', type: 'boolean', default: true })
  directorLocalOnly: boolean;

  // Bir martalik ma'lumot yangilanishlari versiyasi (DataMigrationService) — foydalanuvchiga ko'rinmaydi
  @Column({ name: 'data_version', type: 'int', default: 0 })
  dataVersion: number;
}
