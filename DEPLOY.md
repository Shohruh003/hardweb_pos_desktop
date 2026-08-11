# DasturXon — O'rnatish qo'llanmasi (restoranga)

> Yangi holat: **bitta `.exe`** — server + baza (SQLite) + ilova birga. **Docker, Node,
> alohida qadam kerak emas.** Baza = bitta fayl (backup oson).

## 1. Installerni tayyorlash (biz tomonda)
- **Kassa (asosiy) uchun:** `npm run dist` → `desktop/release/DasturXon-Server-<versiya>.exe`
  (server + baza ichida). Bu kassa/server kompyuteriga o'rnatiladi.
- **Demo/ko'rgazma uchun:** `npm run dist:mock` → `DasturXon-DEMO-<versiya>.exe`
  (serversiz, internetsiz ishlaydi — Telegram/tanishtirish uchun).

> (Litsenziya yoqilganda) super-admin panelda restoran yaratib, **8 xonalik kalitni** oling.

## 2. Kassa (asosiy) kompyuteriga o'rnatish
1. `DasturXon-Server-<versiya>.exe` ni ishga tushiring → o'rnatiladi va ochiladi.
2. Birinchi ochilishda ~15 soniya **"Server ishga tushmoqda"** (baza tayyorlanadi) — kuting.
3. (litsenziya yoqilgan bo'lsa) **8 xonalik kalit** → Faollashtirish.
4. Router sozlamalarida shu kompyuterga **statik IP** bering (masalan `192.168.1.10`),
   DHCP o'zgartirmasligi uchun.
5. Direktor bo'lib kiring (login/parol) → **menyu, stollar/zallar, sexlar (printerlar),
   xodimlar/PIN** ni sozlang.
6. Windows yoqilganda ilova **o'zi ochiladi** (avto-start yoqilgan) — kassa doim ishlaydi.

## 3. Terminallar (ofitsiant / oshxona / boshqa kassa)
1. Har terminalga `DasturXon-Server-<versiya>.exe` ni o'rnating.
2. Kirish oynasida (logoni 5 marta bosib) **"⚙ Server manzili"** → `http://192.168.1.10:3100`.
3. Xodim PIN bilan kiradi.

## 4. Printerlar
- **USB printer** — kassa kompyuteriga ulanadi, "Qurilmalar" bo'limida sozlanadi.
- **LAN printer** — har sex uchun printer IP'si "Bo'limlar (sexlar)" da kiritiladi.
- Har taom o'z sexining printeriga chiqadi; printer yo'q bo'lsa — chek chiqmaydi.

## 5. Zaxira (backup)
Baza — bitta fayl:
`%AppData%\@hardweb-pos\desktop\data\dasturxon.db`
Uni USB/bulutga nusxalash = to'liq zaxira. Yangi kompyuterga ko'chirish uchun shu faylni
o'rniga qo'ying.

## Sozlamalar (ilg'or)
Ichki server env (`desktop/src/main/index.ts` beradi):
- `DB_FILE` — baza fayli (default: userData/data/dasturxon.db)
- `SEED_DEMO=false` — real restoran uchun toza start (demo buyurtmalarsiz)
- `LICENSE_ENFORCE=true` + `CLOUD_URL=https://.../api` — litsenziya nazorati (bulut deploy qilingach)

## Litsenziya / nazorat tizimi
Alohida (maxfiy) repozitoriyalarda: `hardweb_pos_super_admin_backend` (NestJS+Docker) va
`hardweb_pos_super_admin_frontend` (React panel). Mahsulot (bu repo) faqat "kalit yuborib
tekshiradi".
