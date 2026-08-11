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
    try {
      // Bog'liq jadvallardan boshlab, keyin buyurtmalarni o'chiramiz (FK tartibi)
      await this.dataSource.query(
        `DELETE FROM excise_codes WHERE order_item_id IN (
           SELECT oi.id FROM order_items oi
           JOIN orders o ON oi.order_id = o.id WHERE o.opened_at < ?)`,
        [iso],
      );
      await this.dataSource.query(
        `DELETE FROM fiscal_docs WHERE order_id IN (SELECT id FROM orders WHERE opened_at < ?)`,
        [iso],
      );
      await this.dataSource.query(
        `DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE opened_at < ?)`,
        [iso],
      );
      await this.dataSource.query(
        `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE opened_at < ?)`,
        [iso],
      );
      const res = await this.dataSource.query(
        `DELETE FROM orders WHERE opened_at < ?`,
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
