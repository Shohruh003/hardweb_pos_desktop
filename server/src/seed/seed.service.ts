import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager, Raw } from 'typeorm';
import * as bcrypt from 'bcryptjs';

import {
  CategoryEntity,
  CustomerEntity,
  MenuItemEntity,
  OrderEntity,
  OrderItemEntity,
  PaymentEntity,
  ProductEntity,
  RecipeItemEntity,
  SettingsEntity,
  StationEntity,
  TableEntity,
  UserEntity,
} from '../entities';
import {
  MenuUnit,
  OrderItemStatus,
  OrderStatus,
  OrderType,
  PaymentType,
  ProductUnit,
  TableStatus,
  UserRole,
  calcOrderTotals,
} from '@hardweb-pos/shared';
import { safeCompare } from '../auth/user-view';
import { LicenseService } from '../license/license.service';
import { businessDateOf } from '../orders/order-rules';

/** Real rejimdagi yagona boshlang'ich foydalanuvchi (parol vaqtinchalik — birinchi kirishda almashtiriladi) */
const REAL_DIRECTOR = { name: 'Direktor', login: 'direktor', password: '1234' };
/** Demo xodimlarning umumiy paroli */
const DEMO_PASSWORD = '1234';
const BCRYPT_COST = 10;
/** Demo: stolga buyurtmalarning xizmat haqi foizi (faqat demo seed'da; real bazada 0 — direktor qo'yadi) */
const DEMO_SERVICE_PERCENT = 10;
/** Demo: ofitsiant ulushi foizi (ofitsiantlar hisoboti uchun; real bazada 0 — direktor qo'yadi) */
const DEMO_WAITER_SHARE_PERCENT = 5;

/** Demo mijozlar (CRM) — yetkazishda telefon bo'yicha avtomatik topiladi */
const DEMO_CUSTOMERS = [
  { name: 'Aziza Karimova', phone: '+998 90 111 22 33', note: 'Doimiy mijoz — achchiq qalampirsiz' },
  { name: 'Botir Xolmatov', phone: '93 555 66 77', note: null },
];
/** Demo yetkazish manzillari (telefon -> manzil) */
const DEMO_DELIVERY = [
  { phone: '+998901112233', address: 'Chilonzor tumani, 9-kvartal, 12-uy, 45-xonadon' },
  { phone: '+998935556677', address: 'Yunusobod, 4-mavze, 17-uy (2-podyezd, 3-qavat)' },
  { phone: '+998977001020', address: 'Mirzo Ulug‘bek, Buyuk Ipak Yo‘li 154, ofis 7' },
];

/** SEED_DEMO=false — real restoran (toza baza); boshqa har qanday qiymat yoki yo'q — demo */
function isRealMode(): boolean {
  return (process.env.SEED_DEMO ?? '').trim().toLowerCase() === 'false';
}

// Boshlang'ich ma'lumotlar (SEED_ON_START=true bo'lsa, faqat bo'sh bazada).
//  • Real rejim (SEED_DEMO=false): FAQAT Direktor (login: direktor, vaqtinchalik parol: 1234,
//    birinchi kirishda almashtiriladi). Stol, bo'lim, menyu, sklad, buyurtma — yo'q: restoran
//    o'zinikini kiritadi.
//  • Demo rejim: prezentatsiya uchun "to'la" ko'rinish — ko'p menyu, stollar, bir necha
//    ofitsiant, sklad + retseptlar, ~80 ta tarixiy va 6 ta faol buyurtma.
// Hammasi BITTA tranzaksiyada: yarim yo'lda xato bo'lsa hech narsa yozilmaydi va keyingi
// ishga tushishda seed qaytadan toza bajariladi.
@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger('Seed');

  constructor(
    private readonly dataSource: DataSource,
    private readonly license: LicenseService,
  ) {}

  async onModuleInit() {
    if (process.env.SEED_ON_START !== 'true') return;
    const real = isRealMode();

    const seeded = await this.dataSource.transaction(async (manager) => {
      // Idempotent: kamida bitta foydalanuvchi bo'lsa — baza ishlatilmoqda, tegmaymiz
      if ((await manager.count(UserEntity)) > 0) return false;
      if (real) await this.seedReal(manager);
      else await this.seedDemo(manager);
      return true;
    });

    if (!seeded) {
      this.logger.log('Ma’lumotlar mavjud — seed o‘tkazib yuborildi');
      if (real) await this.secureLeftoverDemoData();
      return;
    }

    if (real) {
      this.logger.log(
        `Real rejim: faqat Direktor yaratildi (login: ${REAL_DIRECTOR.login}, vaqtinchalik parol: ${REAL_DIRECTOR.password} — birinchi kirishda almashtiriladi)`,
      );
    } else {
      this.logger.log(
        `Seed tayyor. Login: ofitsiant/oshpaz/kassir/admin/direktor — parol: ${DEMO_PASSWORD}`,
      );
    }
  }

  // ---- Real rejim: faqat Direktor ----
  private async seedReal(manager: EntityManager) {
    const passwordHash = await bcrypt.hash(REAL_DIRECTOR.password, BCRYPT_COST);
    await manager.save(
      manager.create(UserEntity, {
        name: REAL_DIRECTOR.name,
        role: UserRole.Director,
        login: REAL_DIRECTOR.login,
        pin: null,
        passwordHash,
        active: true,
        permissions: null,
        mustChangePassword: true,
      }),
    );
  }

  // Real rejimda eski demo baza qolib ketgan bo'lsa (oldingi DEMO yoki eski Server o'rnatishidan —
  // baza %APPDATA%da, qayta o'rnatishda o'chmaydi). Belgisi — demo seed'dagi vendor SuperAdmin.
  // Ma'lumot avtomatik O'CHIRILMAYDI, lekin hamma biladigan demo parollar bilan ishlab ketmaslik uchun:
  //  1) vendor SuperAdmin (login superadmin / 1234) bloklanadi — direktor uni o'chira olmaydi;
  //  2) paroli hali demo '1234' bo'lgan har bir faol xodim keyingi kirishda parolni almashtiradi;
  //  3) GET /license/status -> demoData: true — login ekranida qizil ogohlantirish chiqadi.
  private async secureLeftoverDemoData() {
    const users = this.dataSource.getRepository(UserEntity);
    const vendors = (
      await users.find({
        where: {
          login: Raw((alias) => `LOWER(${alias}) = 'superadmin'`),
        },
      })
    ).filter((u) => /vendor/i.test(u.name ?? ''));
    if (vendors.length === 0) return;

    this.license.setDemoDataDetected(true);
    this.logger.warn(
      'Diqqat: bazada demo ma’lumotlar topildi (demo xodimlar, menyu, buyurtmalar). Real ish uchun toza baza bilan boshlang: dasturni yoping va %APPDATA%\\@hardweb-pos\\desktop\\data\\dasturxon.db faylini o‘chiring.',
    );

    // 1) Vendor SuperAdmin — bloklanadi (faol direktor bo'lsagina: tizim rahbarsiz qolmasin)
    const activeDirectors = await users.count({
      where: { role: UserRole.Director, active: true },
    });
    for (const vendor of vendors) {
      if (!vendor.active) continue;
      if (activeDirectors > 0) {
        await users.update(vendor.id, { active: false });
        this.logger.warn(`Demo vendor hisobi bloklandi: ${vendor.name} (login: ${vendor.login})`);
      } else {
        this.logger.warn(
          `Demo vendor hisobi bloklanmadi — faol direktor yo‘q: ${vendor.name} (login: ${vendor.login})`,
        );
      }
    }

    // 2) Demo paroli ('1234') hali o'zgarmagan faol xodimlar — keyingi kirishda almashtirish majburiy
    const candidates = await users.find({
      where: { active: true, mustChangePassword: false },
    });
    const flagged: string[] = [];
    for (const user of candidates) {
      if (!user.passwordHash) continue;
      if (await safeCompare(DEMO_PASSWORD, user.passwordHash)) {
        await users.update(user.id, { mustChangePassword: true });
        flagged.push(user.name);
      }
    }
    if (flagged.length > 0) {
      this.logger.warn(
        `Paroli demo '${DEMO_PASSWORD}' bo‘lgan ${flagged.length} ta xodim keyingi kirishda parolni almashtiradi: ${flagged.join(', ')}`,
      );
    }
  }

  // ---- Demo rejim: to'liq prezentatsiya ma'lumotlari ----
  private async seedDemo(manager: EntityManager) {
    this.logger.log('Boshlang‘ich (demo) ma’lumotlar yuklanmoqda...');
    await this.seedSettings(manager);
    const staff = await this.seedUsers(manager);
    const tables = await this.seedTables(manager);
    const stations = await this.seedStations(manager);
    const menu = await this.seedMenu(manager, stations);
    await this.seedInventory(manager, menu);
    const customers = await this.seedCustomers(manager);
    await this.seedHistory(manager, staff, tables, menu);
    await this.seedTakeawayHistory(manager, staff, menu);
    await this.seedActiveOrders(manager, staff, tables, menu);
    await this.seedOpenTakeaway(manager, staff, menu, customers);
  }

  // ---- Sozlamalar: stolga buyurtmalarga xizmat haqi (faqat demo) ----
  private async seedSettings(manager: EntityManager) {
    const repo = manager.getRepository(SettingsEntity);
    const s = (await repo.findOne({ where: { id: 'main' } })) ?? repo.create({ id: 'main' });
    s.serviceDineInPercent = DEMO_SERVICE_PERCENT;
    // Ofitsiantlar hisobotida ulush ko'rinsin (demo): stolga buyurtmalar summasidan 5%
    s.waiterSharePercent = DEMO_WAITER_SHARE_PERCENT;
    await repo.save(s);
  }

  // ---- Mijozlar (CRM) ----
  private async seedCustomers(manager: EntityManager) {
    return manager
      .getRepository(CustomerEntity)
      .save(DEMO_CUSTOMERS.map((c) => ({ ...c })) as Partial<CustomerEntity>[]);
  }

  // ---- Xodimlar (bir nechta ofitsiant — filtrlar chiroyli ko'rinishi uchun) ----
  private async seedUsers(manager: EntityManager) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);
    // Har rol uchun standart ruxsatlar (capabilities). Direktor/SuperAdmin — barchasi avtomatik.
    // Kassir olib ketish / yetkazish buyurtmalarini ham ochadi — 'waiter' ruxsati bilan.
    // Otkaz ('void') — faqat kassir va administratorda (ofitsiantda yo'q) — B19.
    const W = ['waiter'];
    const K = ['kitchen'];
    const C = ['cashier', 'waiter', 'void', 'history', 'revenue'];
    const A = ['history', 'reports', 'menu', 'inventory', 'stations', 'tables', 'staff', 'devices', 'terminals', 'settings', 'refund', 'void', 'cashier'];
    // Har bir xodim UNIKAL 4 xonali PIN bilan kiradi (demo parollarini almashtirish shart emas)
    const rows = await manager.getRepository(UserEntity).save([
      { name: 'Aziz Karimov', role: UserRole.Waiter, login: 'ofitsiant', pin: '1111', passwordHash, active: true, permissions: W },
      { name: 'Kamola Yusupova', role: UserRole.Waiter, login: 'kamola', pin: '2222', passwordHash, active: true, permissions: W },
      { name: 'Jasur Rahimov', role: UserRole.Waiter, login: 'jasur', pin: '3333', passwordHash, active: true, permissions: W },
      { name: 'Nodira Salimova', role: UserRole.Waiter, login: 'nodira', pin: '4444', passwordHash, active: true, permissions: W },
      { name: 'Bekzod Toshev', role: UserRole.Cook, login: 'oshpaz', pin: '5555', passwordHash, active: true, permissions: K },
      { name: 'Dilnoza Ergasheva', role: UserRole.Cashier, login: 'kassir', pin: '1234', passwordHash, active: true, permissions: C },
      { name: 'Malika Nazarova', role: UserRole.Cashier, login: 'kassir2', pin: '4321', passwordHash, active: true, permissions: ['cashier', 'waiter', 'void'] },
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
  private async seedTables(manager: EntityManager) {
    const rows: Partial<TableEntity>[] = [];
    let n = 1;
    for (; n <= 10; n++) rows.push({ number: n, hall: 'Asosiy zal', capacity: 4, status: TableStatus.Free });
    for (; n <= 16; n++) rows.push({ number: n, hall: 'VIP zal', capacity: 6, status: TableStatus.Free });
    for (; n <= 24; n++) rows.push({ number: n, hall: 'Yozgi terrasa', capacity: 4, status: TableStatus.Free });
    return manager.getRepository(TableEntity).save(rows);
  }

  // ---- Bo'limlar (sexlar) ----
  private async seedStations(manager: EntityManager) {
    return manager.getRepository(StationEntity).save([
      { name: 'Oshxona', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 1 },
      { name: 'Bar', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 2 },
      { name: 'Somsaxona', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 3 },
      { name: 'Novvoyxona', printerHost: '', printerPort: 9100, printerWidth: 48, sortOrder: 4 },
    ] as Partial<StationEntity>[]);
  }

  // ---- Menyu (6 kategoriya, ~36 taom) ----
  private async seedMenu(manager: EntityManager, stations: StationEntity[]) {
    const [milliy, issiq, salat, fastfud, shirinlik, ichimlik] =
      await manager.getRepository(CategoryEntity).save([
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
    // Har taomni bo'limga biriktiramiz (ichimlik->Bar, somsa->Somsaxona,
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
    return manager.getRepository(MenuItemEntity).save(
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
  private async seedInventory(manager: EntityManager, menu: MenuItemEntity[]) {
    const P = ProductUnit;
    const products = await manager.getRepository(ProductEntity).save([
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
    if (rows.length) await manager.getRepository(RecipeItemEntity).save(rows);
    this.logger.log(`Sklad: ${products.length} mahsulot, ${rows.length} retsept qatori`);
  }

  // ---- Tarix: ~80 ta yopilgan buyurtma (oxirgi ~20 kun) ----
  private async seedHistory(
    manager: EntityManager,
    staff: { waiters: UserEntity[]; cashier: UserEntity },
    tables: TableEntity[],
    menu: MenuItemEntity[],
  ) {
    const COUNT = 80;
    const payTypes = [PaymentType.Cash, PaymentType.Card, PaymentType.QR];
    const orders = manager.getRepository(OrderEntity);
    const payments = manager.getRepository(PaymentEntity);
    const timeUpdates: { id: string; opened: Date; closed: Date }[] = [];

    for (let i = 0; i < COUNT; i++) {
      const table = pick(tables);
      const waiter = pick(staff.waiters);
      const itemCount = 1 + Math.floor(Math.random() * 4); // 1..4 xil taom
      const chosen = sample(menu, itemCount);

      const items = chosen.map((mi) =>
        manager.create(OrderItemEntity, {
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
      // To'langan summa = chek summasi (stolga — demo xizmat haqi bilan, butun so'm)
      const total = calcOrderTotals(items, 0, DEMO_SERVICE_PERCENT).total;

      // Vaqt: oxirgi 20 kun ichida, ish soatlari (11:00–23:00)
      const daysAgo = Math.floor(Math.random() * 20);
      const opened = new Date();
      opened.setDate(opened.getDate() - daysAgo);
      opened.setHours(11 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60), 0, 0);
      const closed = new Date(opened.getTime() + (20 + Math.floor(Math.random() * 70)) * 60000);

      const order = await orders.save(
        orders.create({
          type: OrderType.DineIn,
          tableId: table.id,
          waiterId: waiter.id,
          status: OrderStatus.Closed,
          closedAt: closed,
          businessDate: businessDateOf(opened),
          servicePercent: DEMO_SERVICE_PERCENT,
          items,
        }),
      );
      timeUpdates.push({ id: order.id, opened, closed });

      await payments.save(
        payments.create({
          orderId: order.id,
          amount: total,
          type: pick(payTypes),
          cashierId: staff.cashier.id,
        }),
      );
    }

    // openedAt/createdAt @CreateDateColumn bo'lgani uchun insertda "hozir" bo'ladi —
    // tarix chiroyli taqsimlanishi uchun orqaga suramiz: buyurtma ochilgan/yopilgan vaqt
    // va to'lov vaqti (= yopilgan vaqt, aks holda "bugungi tushum" sun'iy oshib ketadi).
    // Format TypeORM bilan bir xil (UTC 'YYYY-MM-DD HH:MM:SS.SSS') — sana filtrlari to'g'ri ishlaydi.
    for (const u of timeUpdates) {
      await manager.query('UPDATE orders SET opened_at = ?, closed_at = ? WHERE id = ?', [
        toDbDatetime(u.opened),
        toDbDatetime(u.closed),
        u.id,
      ]);
      await manager.query('UPDATE payments SET created_at = ? WHERE order_id = ?', [
        toDbDatetime(u.closed),
        u.id,
      ]);
    }
    this.logger.log(`Tarix: ${COUNT} ta yopilgan buyurtma yaratildi`);
  }

  // ---- Tarix: olib ketish / yetkazish (o'tgan kunlar, har kun 1 dan raqamlangan) ----
  private async seedTakeawayHistory(
    manager: EntityManager,
    staff: { waiters: UserEntity[]; cashier: UserEntity },
    menu: MenuItemEntity[],
  ) {
    const payTypes = [PaymentType.Cash, PaymentType.Card, PaymentType.QR];
    const orders = manager.getRepository(OrderEntity);
    const payments = manager.getRepository(PaymentEntity);
    let created = 0;

    for (let daysAgo = 1; daysAgo <= 6; daysAgo++) {
      // Shu kunning buyurtma vaqtlari (o'sish tartibida) — raqam shu tartibda 1, 2, 3...
      const count = 3 + Math.floor(Math.random() * 3);
      const times: Date[] = [];
      for (let k = 0; k < count; k++) {
        const t = new Date();
        t.setDate(t.getDate() - daysAgo);
        t.setHours(11 + Math.floor(Math.random() * 11), Math.floor(Math.random() * 60), 0, 0);
        times.push(t);
      }
      times.sort((a, b) => a.getTime() - b.getTime());

      for (let k = 0; k < times.length; k++) {
        const opened = times[k];
        const closed = new Date(opened.getTime() + (10 + Math.floor(Math.random() * 30)) * 60000);
        const delivery = Math.random() < 0.35;
        const dest = pick(DEMO_DELIVERY);
        const items = sample(menu, 1 + Math.floor(Math.random() * 3)).map((mi) =>
          manager.create(OrderItemEntity, {
            menuItemId: mi.id,
            menuItemName: mi.name,
            price: Number(mi.price),
            quantity: 1 + Math.floor(Math.random() * 2),
            note: null,
            status: OrderItemStatus.Ready,
            exciseRequired: mi.exciseRequired,
            exciseCode: mi.exciseRequired ? randomExcise() : null,
          }),
        );
        const order = await orders.save(
          orders.create({
            type: delivery ? OrderType.Delivery : OrderType.Takeaway,
            tableId: null,
            waiterId: staff.cashier.id,
            status: OrderStatus.Closed,
            closedAt: closed,
            queueNumber: k + 1,
            businessDate: businessDateOf(opened),
            phone: delivery ? dest.phone : null,
            address: delivery ? dest.address : null,
            items,
          }),
        );
        await payments.save(
          payments.create({
            orderId: order.id,
            amount: calcOrderTotals(items).total, // olib ketish/yetkazish — xizmat haqisiz
            type: pick(payTypes),
            cashierId: staff.cashier.id,
          }),
        );
        // Vaqtlarni orqaga surish (seedHistory bilan bir xil format)
        await manager.query('UPDATE orders SET opened_at = ?, closed_at = ? WHERE id = ?', [
          toDbDatetime(opened),
          toDbDatetime(closed),
          order.id,
        ]);
        await manager.query('UPDATE payments SET created_at = ? WHERE order_id = ?', [
          toDbDatetime(closed),
          order.id,
        ]);
        created++;
      }
    }
    this.logger.log(`Tarix: ${created} ta olib ketish / yetkazish buyurtmasi`);
  }

  // ---- Bugungi ochiq olib ketish (#1, #2) va yetkazish (#3) buyurtmalari ----
  private async seedOpenTakeaway(
    manager: EntityManager,
    staff: { waiters: UserEntity[]; cashier: UserEntity },
    menu: MenuItemEntity[],
    customers: CustomerEntity[],
  ) {
    const orders = manager.getRepository(OrderEntity);
    const today = businessDateOf();
    const dest = DEMO_DELIVERY[0];
    // Yetkazish telefoni CRM'dagi mijozga mos — xuddi server create()dagidek bog'lanadi
    const customer = customers.find((c) => c.name === DEMO_CUSTOMERS[0].name) ?? null;
    const plan: {
      type: OrderType;
      status: OrderStatus;
      phone?: string;
      address?: string;
      note?: string;
    }[] = [
      { type: OrderType.Takeaway, status: OrderStatus.Accepted },
      { type: OrderType.Takeaway, status: OrderStatus.Cooking, phone: '+998935556677' },
      {
        type: OrderType.Delivery,
        status: OrderStatus.Accepted,
        phone: dest.phone,
        address: dest.address,
        note: 'Eshik oldida qo‘ng‘iroq qiling',
      },
    ];
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      const itemStatus =
        p.status === OrderStatus.Cooking ? OrderItemStatus.Cooking : OrderItemStatus.Pending;
      const items = sample(menu, 2 + Math.floor(Math.random() * 2)).map((mi) =>
        manager.create(OrderItemEntity, {
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
      const isDelivery = p.type === OrderType.Delivery;
      await orders.save(
        orders.create({
          type: p.type,
          tableId: null,
          waiterId: staff.cashier.id,
          status: p.status,
          queueNumber: i + 1,
          businessDate: today,
          phone: p.phone ?? null,
          address: p.address ?? null,
          note: p.note ?? null,
          customerId: isDelivery ? customer?.id ?? null : null,
          customerName: isDelivery ? customer?.name ?? null : null,
          items,
        }),
      );
    }
    this.logger.log('Faol: 2 ta olib ketish + 1 ta yetkazish buyurtmasi');
  }

  // ---- Faol buyurtmalar (KDS/kassa demo uchun) ----
  private async seedActiveOrders(
    manager: EntityManager,
    staff: { waiters: UserEntity[]; cashier: UserEntity },
    tables: TableEntity[],
    menu: MenuItemEntity[],
  ) {
    const orders = manager.getRepository(OrderEntity);
    const tableRepo = manager.getRepository(TableEntity);
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
        manager.create(OrderItemEntity, {
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
      await orders.save(
        orders.create({
          type: OrderType.DineIn,
          tableId: table.id,
          waiterId: waiter.id,
          status,
          businessDate: businessDateOf(),
          servicePercent: DEMO_SERVICE_PERCENT,
          items,
        }),
      );
      table.status = TableStatus.Busy;
      await tableRepo.save(table);
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
// TypeORM (better-sqlite3) Date'ni shu formatda yozadi: UTC 'YYYY-MM-DD HH:MM:SS.SSS'
function toDbDatetime(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}
