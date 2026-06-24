# HardWeb POS — Restoran uchun lokal POS tizimi (Desktop)

Restoranlar uchun **lokal tarmoqda (Wi-Fi/LAN)** ishlaydigan Point of Sale tizimi.
Ofitsiant, oshxona (KDS), kassa va admin — har zalda desktop terminallar; hisobotlar bulut orqali masofadan.

> TZ (`../hardweb_pos_tz/`) dastlab mobil ilova uchun yozilgan edi. Loyiha egasi bilan
> kelishilgan holda **desktop ilova** sifatida, o'sha TZ strukturasi bo'yicha quriladi.

## Arxitektura

```
RESTORAN LOKAL TARMOG'I (Wi-Fi / LAN)
│
├─ [Ofitsiant terminali]  ─┐
├─ [Kassa terminali]       ─┤  Electron + React ilovalar (bitta ilova, rolga qarab ekran)
├─ [KDS terminali]         ─┘  LAN orqali lokal serverga ulanadi
│
└─> ASOSIY KOMPYUTER (Lokal server)
       ├─ NestJS Backend API
       ├─ PostgreSQL  (lokal asosiy baza)
       └─ Socket.IO   (real-time: buyurtma → KDS → navbat)
              │
              ├─> [Navbat ekrani / TV]  (brauzer web-sahifa)
              │
              └─> Internet → BULUT (subdomen: restoran-nomi.poscloud.uz)
                              └─> Direktor hisobotlari (brauzer, masofadan)
```

## Texnologiyalar

| Qatlam | Texnologiya |
|---|---|
| Desktop terminallar | Electron + React + TypeScript + Vite + Tailwind |
| Lokal server | NestJS + TypeScript |
| Ma'lumotlar bazasi | PostgreSQL (TypeORM) |
| Real-time | Socket.IO (WebSocket) |
| Chek printeri | ESC/POS (`node-thermal-printer`) |
| Autentifikatsiya | JWT |
| Bulut | NestJS + PostgreSQL, multi-tenant subdomen |

## Papkalar (monorepo — npm workspaces)

```
hardweb_pos_desktop/
├── shared/    # Umumiy TypeScript turlar: DB modellari, enumlar, socket eventlar
├── server/    # Lokal server (NestJS + PostgreSQL + Socket.IO)
└── desktop/   # Electron + React terminal ilovasi (kassa / KDS / ofitsiant / admin)
```

## Boshlash

1. PostgreSQL o'rnatilgan bo'lishi kerak (hozircha o'rnatilmagan).
2. `npm install` (root'da — barcha workspace'lar uchun)
3. `server/.env` ni `server/.env.example` dan nusxalab sozlang
4. Server: `npm run dev:server`
5. Desktop: `npm run dev:desktop`

## Bosqichlar (TZ yo'l xaritasi bo'yicha)

1. ✅ Backend + ma'lumotlar bazasi + WebSocket (asos)
2. 🟡 Ofitsiant ekrani ✅ · offline rejim ⬜
3. 🟡 Oshxona ekrani (KDS) ✅ · Kassa + chek preview ✅ · ESC/POS fizik printer ⬜
4. ✅ Navbat ekrani (`/queue`) + Administrator paneli
5. ⬜ Bulut sinxronlash (subdomen) + Direktor hisobotlari
6. ⬜ Fiskal modul: QR-kodli chek + aksiz skaneri

### Navbat ekranini ochish (TV/brauzer)

Server ishga tushgach, istalgan TV yoki brauzerda:

```
http://<server-ip>:3000/queue
```

Ilova o'rnatish va internet kerak emas — socket.io serverning o'zidan keladi.

## Dizayn

Ko'k rang ishlatilmaydi. To'q fon + yorqin (deyarli oq) matn + emerald accent.
Ranglar `shared/src/theme.ts` da markazlashtirilgan.
