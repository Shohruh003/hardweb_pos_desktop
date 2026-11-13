import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Ma'lumotlarni saqlash siyosati: cheklar/buyurtmalar tarixidan faqat
// oxirgi 2 oyliknikini saqlaymiz, undan eskisi avtomatik o'chiriladi.
@Injectable()
export class MaintenanceService implements OnModuleInit {
  private readonly logger = new Logger('Maintenance');
  private readonly RETENTION_MONTHS = 2;

  constructor(private readonly dataSource: DataSource) {}

  onModuleInit() {
    // Boshda bir marta + keyin har 24 soatda
    setTimeout(() => this.cleanup(), 10 * 1000);
    setInterval(() => this.cleanup(), 24 * 60 * 60 * 1000);
  }

  async cleanup() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - this.RETENTION_MONTHS);
    const iso = cutoff.toISOString();
    // Eski buyurtmalar — LEKIN qaytarilmagan qarzi ("Qarzga") bor cheklar saqlanadi (B34): aks holda
    // 2 oydan eski qarz chek bilan birga qarzlar ro'yxatidan jimgina yo'qolardi
    const oldOrders = `SELECT id FROM orders WHERE opened_at < ? AND id NOT IN (
      SELECT p.order_id FROM payments p WHERE p.debtor_name IS NOT NULL AND p.debt_repaid_at IS NULL)`;
    try {
      // Bog'liq jadvallardan boshlab, keyin buyurtmalarni o'chiramiz (FK tartibi)
      await this.dataSource.query(
        `DELETE FROM excise_codes WHERE order_item_id IN (
           SELECT oi.id FROM order_items oi WHERE oi.order_id IN (${oldOrders}))`,
        [iso],
      );
      await this.dataSource.query(
        `DELETE FROM fiscal_docs WHERE order_id IN (${oldOrders})`,
        [iso],
      );
      await this.dataSource.query(
        `DELETE FROM payments WHERE order_id IN (${oldOrders})`,
        [iso],
      );
      await this.dataSource.query(
        `DELETE FROM order_items WHERE order_id IN (${oldOrders})`,
        [iso],
      );
      const res = await this.dataSource.query(
        `DELETE FROM orders WHERE id IN (${oldOrders})`,
        [iso],
      );
      const count = Array.isArray(res) ? res.length : res?.affected ?? 0;
      // Eski rasxodlarni ham tozalaymiz
      await this.dataSource.query(
        `DELETE FROM expenses WHERE created_at < ?`,
        [iso],
      );
      this.logger.log(
        `Tozalash: 2 oydan eski ma'lumotlar o'chirildi (buyurtmalar ~${count})`,
      );
    } catch (e) {
      this.logger.warn(`Tozalash xatosi: ${(e as Error).message}`);
    }
  }
}
