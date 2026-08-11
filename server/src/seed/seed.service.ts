import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

import {
  CategoryEntity,
  MenuItemEntity,
  OrderEntity,
  OrderItemEntity,
  PaymentEntity,
  ProductEntity,
  RecipeItemEntity,
  StationEntity,
  TableEntity,
  UserEntity,
} from '../entities';
import {
  MenuUnit,
  OrderItemStatus,
  OrderStatus,
  PaymentType,
  ProductUnit,
  TableStatus,
  UserRole,
} from '@hardweb-pos/shared';

// Dev rejimda boshlang'ich ma'lumotlar (SEED_ON_START=true bo'lsa).
// Prezentatsiya uchun "to'la" ko'rinishi kerak — ko'p menyu, stollar,
// bir necha ofitsiant va ~80 ta tarixiy buyurtma generatsiya qilinadi.
@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger('Seed');

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    @InjectRepository(MenuItemEntity)
    private readonly menuItems: Repository<MenuItemEntity>,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(PaymentEntity)
    private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(RecipeItemEntity)
    private readonly recipeItems: Repository<RecipeItemEntity>,
    @InjectRepository(StationEntity)
    private readonly stations: Repository<StationEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    if (process.env.SEED_ON_START !== 'true') return;

    const userCount = await this.users.count();
    if (userCount > 0) {
      this.logger.log('Ma’lumotlar mavjud — seed o‘tkazib yuborildi');
      return;
    }

    this.logger.log('Boshlang‘ich ma’lumotlar yuklanmoqda...');

    const staff = await this.seedUsers();
    const tables = await this.seedTables();
    const stations = await this.seedStations();
    const menu = await this.seedMenu(stations);
    await this.seedInventory(menu);
    // Demo buyurtmalar/tarix — faqat demo rejimda (real restoranda toza start + tez).
    if (process.env.SEED_DEMO !== 'false') {
      await this.seedHistory(staff, tables, menu);
      await this.seedActiveOrders(staff, tables, menu);
    }

    this.logger.log(
      'Seed tayyor. Login: ofitsiant/oshpaz/kassir/admin/direktor — parol: 1234',
    );
  }

  // ---- Xodimlar (bir nechta ofitsiant — filtrlar chiroyli ko'rinishi uchun) ----
  private async seedUsers() {
    const passwordHash = await bcrypt.hash('1234', 10);
    // Har rol uchun standart ruxsatlar (capabilities). Direktor/SuperAdmin — barchasi avtomatik.
    const W = ['waiter'];
    const K = ['kitchen'];
    const C = ['cashier', 'history', 'revenue'];
    const A = ['history', 'reports', 'menu', 'inventory', 'stations', 'tables', 'staff', 'devices', 'terminals', 'settings', 'refund', 'cashier'];
    // Har bir xodim UNIKAL 4 xonali PIN bilan kiradi
    const rows = await this.users.save([
      { name: 'Aziz Karimov', role: UserRole.Waiter, login: 'ofitsiant', pin: '1111', passwordHash, active: true, permissions: W },
      { name: 'Kamola Yusupova', role: UserRole.Waiter, login: 'kamola', pin: '2222', passwordHash, active: true, permissions: W },
      { name: 'Jasur Rahimov', role: UserRole.Waiter, login: 'jasur', pin: '3333', passwordHash, active: true, permissions: W },
      { name: 'Nodira Salimova', role: UserRole.Waiter, login: 'nodira', pin: '4444', passwordHash, active: true, permissions: W },
      { name: 'Bekzod Toshev', role: UserRole.Cook, login: 'oshpaz', pin: '5555', passwordHash, active: true, permissions: K },
      { name: 'Dilnoza Ergasheva', role: UserRole.Cashier, login: 'kassir', pin: '1234', passwordHash, active: true, permissions: C },
      { name: 'Malika Nazarova', role: UserRole.Cashier, login: 'kassir2', pin: '4321', passwordHash, active: true, permissions: ['cashier'] },
      { name: 'Sardor Admin', role: UserRole.Admin, login: 'admin', pin: '9999', passwordHash, active: true, permissions: A },
      { name: 'Direktor', role: UserRole.Director, login: 'direktor', pin: '0000', passwordHash, active: true },
      { name: 'Super Admin (vendor)', role: UserRole.SuperAdmin, login: 'superadmin', pin: '7777', passwordHash, active: true },
    ] as Partial<UserEntity>[]);
    return {
      waiters: rows.filter((u) => u.role === UserRole.Waiter),
      cashier: rows.find((u) => u.role === UserRole.Cashier)!,
    };
  }

  // ---- Stollar (3 zal) ----
  private async seedTables() {
    const rows: Partial<TableEntity>[] = [];
    let n = 1;
    for (; n <= 10; n++) rows.push({ number: n, hall: 'Asosiy zal', capacity: 4, status: TableStatus.Free });
    for (; n <= 16; n++) rows.push({ number: n, hall: 'VIP zal', capacity: 6, status: TableStatus.Free });
    for (; n <= 24; n++) rows.push({ number: n, hall: 'Yozgi terrasa', capacity: 4, status: TableStatus.Free });
    return this.tables.save(rows);
  }

  // ---- Bo'limlar (sexlar) ----
  private async seedStations() {
    return this.stations.save([
      { name: 'Oshxona', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 1 },
      { name: 'Bar', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 2 },
      { name: 'Somsaxona', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 3 },
      { name: 'Novvoyxona', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 4 },
    ] as Partial<StationEntity>[]);
  }

  // ---- Menyu (6 kategoriya, ~36 taom) ----
  private async seedMenu(stations: StationEntity[]) {
    const [milliy, issiq, salat, fastfud, shirinlik, ichimlik] =
      await this.categories.save([
        { name: 'Milliy taomlar', sortOrder: 1 },
        { name: 'Issiq taomlar', sortOrder: 2 },
        { name: 'Salatlar', sortOrder: 3 },
        { name: 'Fastfud', sortOrder: 4 },
        { name: 'Shirinliklar', sortOrder: 5 },
        { name: 'Ichimliklar', sortOrder: 6 },
      ] as Partial<CategoryEntity>[]);

    const items: Partial<MenuItemEntity>[] = [
      // Milliy
      { name: 'Osh (palov)', price: 35000, categoryId: milliy.id },
      { name: 'Toy oshi', price: 42000, categoryId: milliy.id },
      { name: 'Norin', price: 38000, categoryId: milliy.id },
      { name: 'Manti (6 dona)', price: 30000, categoryId: milliy.id },
      { name: 'Somsa (tandir)', price: 12000, categoryId: milliy.id },
      { name: 'Dimlama', price: 40000, categoryId: milliy.id },
      // Issiq
      { name: 'Lag‘mon', price: 32000, categoryId: issiq.id },
      { name: 'Qovurma lag‘mon', price: 36000, categoryId: issiq.id },
      { name: 'Shashlik (mol)', price: 28000, categoryId: issiq.id },
      { name: 'Shashlik (qo‘y)', price: 32000, categoryId: issiq.id },
      { name: 'Tovuq shashlik', price: 24000, categoryId: issiq.id },
      { name: 'Kabob', price: 30000, categoryId: issiq.id },
      { name: 'Qovurilgan go‘sht', price: 200000, categoryId: issiq.id, unit: MenuUnit.Weight },
      { name: 'Sho‘rva', price: 26000, categoryId: issiq.id },
      { name: 'Mastava', price: 24000, categoryId: issiq.id },
      // Salatlar
      { name: 'Achchiq-chuchuk', price: 18000, categoryId: salat.id },
      { name: 'Sezar salat', price: 34000, categoryId: salat.id },
      { name: 'Olivye', price: 28000, categoryId: salat.id },
      { name: 'Vinegret', price: 22000, categoryId: salat.id },
      { name: 'Grecha salat', price: 30000, categoryId: salat.id },
      { name: 'Bahor salati', price: 20000, categoryId: salat.id },
      // Fastfud
      { name: 'Gamburger', price: 32000, categoryId: fastfud.id },
      { name: 'Chizburger', price: 36000, categoryId: fastfud.id },
      { name: 'Lavash', price: 28000, categoryId: fastfud.id },
      { name: 'Hot-dog', price: 20000, categoryId: fastfud.id },
      { name: 'Free kartoshka', price: 18000, categoryId: fastfud.id },
      { name: 'Tovuq strips', price: 30000, categoryId: fastfud.id },
      // Shirinliklar
      { name: 'Tort bo‘lagi', price: 22000, categoryId: shirinlik.id },
      { name: 'Muzqaymoq', price: 15000, categoryId: shirinlik.id },
      { name: 'Chak-chak', price: 18000, categoryId: shirinlik.id },
      { name: 'Pirog', price: 16000, categoryId: shirinlik.id },
      // Ichimliklar
      { name: 'Ko‘k choy', price: 8000, categoryId: ichimlik.id },
      { name: 'Qora choy', price: 8000, categoryId: ichimlik.id },
      { name: 'Coca-Cola 0.5', price: 12000, categoryId: ichimlik.id },
      { name: 'Fanta 0.5', price: 12000, categoryId: ichimlik.id },
      { name: 'Ayron', price: 10000, categoryId: ichimlik.id },
      { name: 'Kompot', price: 9000, categoryId: ichimlik.id },
      // Aksizli — kassada kodi skanerlanishi shart (TZ F-8.5)
      { name: 'Pivo 0.5', price: 22000, categoryId: ichimlik.id, exciseRequired: true },
    ];
    // Har taomни bo'limga biriktiramiz (ichimlik->Bar, somsa->Somsaxona,
    // pirog/tort->Novvoyxona, qolgani->Oshxona)
    const stById = (name: string) => stations.find((s) => s.name === name)?.id ?? null;
    const oshxona = stById('Oshxona');
    const bar = stById('Bar');
    const somsaxona = stById('Somsaxona');
    const novvoyxona = stById('Novvoyxona');
    const stationFor = (it: Partial<MenuItemEntity>): string | null => {
      const n = (it.name || '').toLowerCase();
      if (it.categoryId === ichimlik.id) return bar;
      if (n.includes('somsa')) return somsaxona;
      if (n.includes('pirog') || n.includes('tort') || n.includes('non')) return novvoyxona;
      return oshxona;
    };
    const favNames = new Set([
      'Osh (palov)', 'Lag‘mon', 'Shashlik (mol)', 'Somsa (tandir)', 'Coca-Cola 0.5', 'Choy',
    ]);
    return this.menuItems.save(
      items.map((i) => ({
        available: true,
        exciseRequired: false,
        stationId: stationFor(i),
        favorite: favNames.has(i.name ?? ''),
        ...i,
      })) as Partial<MenuItemEntity>[],
    );
  }

  // ---- Sklad (ombor): mahsulotlar + bir necha taom retsepti ----
  private async seedInventory(menu: MenuItemEntity[]) {
    const P = ProductUnit;
    const products = await this.products.save([
      { name: 'Guruch', unit: P.Kg, stock: 50, minStock: 10 },
      { name: 'Go‘sht (mol)', unit: P.Kg, stock: 30, minStock: 8 },
      { name: 'Sabzi', unit: P.Kg, stock: 25, minStock: 5 },
      { name: 'Piyoz', unit: P.Kg, stock: 20, minStock: 5 },
      { name: 'Yog‘', unit: P.Litr, stock: 15, minStock: 3 },
      { name: 'Un', unit: P.Kg, stock: 40, minStock: 10 },
      { name: 'Non', unit: P.Dona, stock: 100, minStock: 20 },
      { name: 'Kartoshka', unit: P.Kg, stock: 35, minStock: 8 },
      { name: 'Tovuq', unit: P.Kg, stock: 18, minStock: 5 },
    ] as Partial<ProductEntity>[]);

    const prod = (name: string) => products.find((p) => p.name === name)!.id;
    const dish = (name: string) => menu.find((m) => m.name === name);

    // Retseptlar: taomning 1 birligiga ketadigan miqdor (mahsulot birligida)
    const recipes: { dish: string; lines: [string, number][] }[] = [
      { dish: 'Osh (palov)', lines: [['Guruch', 0.2], ['Go‘sht (mol)', 0.15], ['Sabzi', 0.1], ['Piyoz', 0.05], ['Yog‘', 0.05]] },
      { dish: 'Qovurilgan go‘sht', lines: [['Go‘sht (mol)', 1], ['Yog‘', 0.05], ['Piyoz', 0.1]] }, // 1 kg taomga
      { dish: 'Lag‘mon', lines: [['Un', 0.15], ['Go‘sht (mol)', 0.1], ['Sabzi', 0.1], ['Piyoz', 0.05]] },
      { dish: 'Manti (6 dona)', lines: [['Un', 0.2], ['Go‘sht (mol)', 0.15], ['Piyoz', 0.1]] },
      { dish: 'Gamburger', lines: [['Non', 1], ['Go‘sht (mol)', 0.12], ['Kartoshka', 0.1]] },
      { dish: 'Tovuq shashlik', lines: [['Tovuq', 0.25], ['Piyoz', 0.05]] },
    ];

    const rows: Partial<RecipeItemEntity>[] = [];
    for (const r of recipes) {
      const d = dish(r.dish);
      if (!d) continue;
      for (const [pname, amount] of r.lines) {
        rows.push({ menuItemId: d.id, productId: prod(pname), amount });
      }
    }
    if (rows.length) await this.recipeItems.save(rows);
    this.logger.log(`Sklad: ${products.length} mahsulot, ${rows.length} retsept qatori`);
  }

  // ---- Tarix: ~80 ta yopilgan buyurtma (oxirgi ~20 kun) ----
  private async seedHistory(
    staff: { waiters: UserEntity[]; cashier: UserEntity },
    tables: TableEntity[],
    menu: MenuItemEntity[],
  ) {
    const COUNT = 80;
    const payTypes = [PaymentType.Cash, PaymentType.Card, PaymentType.QR];
    const timeUpdates: { id: string; opened: Date; closed: Date }[] = [];

    for (let i = 0; i < COUNT; i++) {
      const table = pick(tables);
      const waiter = pick(staff.waiters);
      const itemCount = 1 + Math.floor(Math.random() * 4); // 1..4 xil taom
      const chosen = sample(menu, itemCount);

      const items = chosen.map((mi) =>
        this.dataSource.manager.create(OrderItemEntity, {
          menuItemId: mi.id,
          menuItemName: mi.name,
          price: Number(mi.price),
          quantity: 1 + Math.floor(Math.random() * 3),
          note: null,
          status: OrderItemStatus.Ready,
          exciseRequired: mi.exciseRequired,
          exciseCode: mi.exciseRequired ? randomExcise() : null,
        }),
      );
      const total = items.reduce((s, it) => s + it.price * it.quantity, 0);

      // Vaqt: oxirgi 20 kun ichida, ish soatlari (11:00–23:00)
      const daysAgo = Math.floor(Math.random() * 20);
      const opened = new Date();
      opened.setDate(opened.getDate() - daysAgo);
      opened.setHours(11 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60), 0, 0);
      const closed = new Date(opened.getTime() + (20 + Math.floor(Math.random() * 70)) * 60000);

      const order = await this.orders.save(
        this.orders.create({
          tableId: table.id,
          waiterId: waiter.id,
          status: OrderStatus.Closed,
          closedAt: closed,
          items,
        }),
      );
      timeUpdates.push({ id: order.id, opened, closed });

      await this.payments.save(
        this.payments.create({
          orderId: order.id,
          amount: total,
          type: pick(payTypes),
          cashierId: staff.cashier.id,
        }),
      );
    }

    // openedAt @CreateDateColumn bo'lgani uchun insertda "hozir" bo'ladi —
    // tarix chiroyli taqsimlanishi uchun orqaga suramiz.
    for (const u of timeUpdates) {
      await this.orders.query(
        'UPDATE orders SET opened_at = ?, closed_at = ? WHERE id = ?',
        [u.opened.toISOString(), u.closed.toISOString(), u.id],
      );
    }
    this.logger.log(`Tarix: ${COUNT} ta yopilgan buyurtma yaratildi`);
  }

  // ---- Faol buyurtmalar (KDS/kassa demo uchun) ----
  private async seedActiveOrders(
    staff: { waiters: UserEntity[]; cashier: UserEntity },
    tables: TableEntity[],
    menu: MenuItemEntity[],
  ) {
    const statuses = [OrderStatus.Accepted, OrderStatus.Cooking, OrderStatus.Ready];
    const busyTables = sample(tables, 6);
    for (let i = 0; i < busyTables.length; i++) {
      const table = busyTables[i];
      const waiter = pick(staff.waiters);
      const chosen = sample(menu, 1 + Math.floor(Math.random() * 3));
      const status = statuses[i % statuses.length];
      const itemStatus =
        status === OrderStatus.Ready
          ? OrderItemStatus.Ready
          : status === OrderStatus.Cooking
            ? OrderItemStatus.Cooking
            : OrderItemStatus.Pending;

      const items = chosen.map((mi) =>
        this.dataSource.manager.create(OrderItemEntity, {
          menuItemId: mi.id,
          menuItemName: mi.name,
          price: Number(mi.price),
          quantity: 1 + Math.floor(Math.random() * 2),
          note: null,
          status: itemStatus,
          exciseRequired: mi.exciseRequired,
          exciseCode: null,
        }),
      );
      await this.orders.save(
        this.orders.create({ tableId: table.id, waiterId: waiter.id, status, items }),
      );
      table.status = TableStatus.Busy;
      await this.tables.save(table);
    }
    this.logger.log(`Faol: ${busyTables.length} ta buyurtma (KDS demo)`);
  }
}

// ---- yordamchilar ----
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function sample<T>(arr: T[], k: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < k && copy.length; i++) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}
function randomExcise(): string {
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 10);
  return s;
}
