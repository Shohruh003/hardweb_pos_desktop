// TZ bo'yicha tizim enumlari (holatlar, turlar, rollar)

/** Foydalanuvchi rollari (TZ 1.3) */
export enum UserRole {
  Waiter = 'ofitsiant',
  Cook = 'oshpaz',
  Cashier = 'kassir',
  Admin = 'administrator',
  Director = 'direktor',
  SuperAdmin = 'superadmin', // vendor — restoranlarni va sozlamalarni boshqaradi
}

/** Stol holati (TZ F-1.2) */
export enum TableStatus {
  Free = 'bosh', // bo'sh
  Busy = 'band', // band
  AwaitingBill = 'hisob_kutilmoqda', // hisob kutilmoqda
}

/** Buyurtma holati (TZ F-2.3) */
export enum OrderStatus {
  Accepted = 'qabul_qilindi', // qabul qilindi
  Cooking = 'tayyorlanmoqda', // tayyorlanmoqda
  Ready = 'tayyor', // tayyor
  Closed = 'yopildi', // hisob yopilgan
}

/** Buyurtma elementi holati (oshxonada alohida taom) */
export enum OrderItemStatus {
  Pending = 'kutilmoqda',
  Cooking = 'tayyorlanmoqda',
  Ready = 'tayyor',
}

/** Taom o'lchov birligi — donada yoki kiloda sotiladi */
export enum MenuUnit {
  Piece = 'dona', // dona (bo'lakda)
  Weight = 'kg', // kiloda (og'irlik bo'yicha)
}

/** Sklad mahsuloti o'lchov birligi */
export enum ProductUnit {
  Kg = 'kg', // kilogramm
  Gram = 'g', // gramm
  Litr = 'l', // litr
  Ml = 'ml', // millilitr
  Dona = 'dona', // dona
}

/** To'lov turi (TZ F-3.2) */
export enum PaymentType {
  Cash = 'naqd', // naqd
  Card = 'karta', // karta
  QR = 'qr', // QR
}

/** Qurilma turi (TZ F-4.4 / devices) */
export enum DeviceType {
  Printer = 'printer',
  Scanner = 'skaner',
  Display = 'ekran',
}

/** Printer ulanish turi (TZ F-6.2) */
export enum PrinterConnection {
  USB = 'usb',
  Network = 'tarmoq', // LAN/Wi-Fi/IP
  Bluetooth = 'bluetooth',
}
