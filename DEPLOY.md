# DasturXon — restoranga o‘rnatish qo‘llanmasi

> Kassa kompyuteriga **bitta `.exe`** o‘rnatiladi: ilova + server (NestJS) + baza (SQLite, bitta fayl).
> Docker, Node yoki alohida server kerak emas. Talab: **Windows 10/11, 64-bit**, hamma qurilmalar bitta lokal tarmoqda.

## Qaysi kompyuterga qaysi installer

| Kompyuter | Installer | Vazifasi |
|---|---|---|
| Kassa (asosiy, **faqat 1 ta**) | `DasturXon-Server-0.1.0.exe` | Server + baza + telefonlar uchun web (8080) |
| Monobloklar (ofitsiant, oshxona KDS, 2-kassa) | `DasturXon-Terminal-0.1.0.exe` | Serversiz, kassaga ulanadi |
| Ofitsiant telefonlari | — (brauzer) | `http://<kassa-IP>:8080` yoki QR |
| Ko‘rgazma / sotuv | `DasturXon-DEMO-0.1.0.exe` | Soxta ma’lumot, **restoranga o‘rnatilmaydi** |

**Taqiqlar:**
- Kassaga DEMO yoki Terminal o‘rnatmang — uchalasining ilova identifikatori bir xil, kassadagi Server o‘rnatmasini almashtirib yuboradi.
- Monobloklarga Server o‘rnatmang — har biri alohida baza bo‘lib qoladi (stollar/buyurtmalar umumiy bo‘lmaydi).
- `scripts\start-server.bat` va `scripts\install-autostart.bat` eskirgan (Docker davri) — ishlatmang.

---

## 1. Installerlarni yig‘ish (dasturchi kompyuterida)

Hammasi **bitta commit**dan, `desktop\` papkasida:

```bat
cd desktop
npm run dist
```
`dist` o‘zi: `shared` → `server` (nest) build → `.server-bundle` (prod `node_modules` + `@hardweb-pos/shared` + `node.exe`) → paketni bundled `node.exe` bilan **repo’siz** yuklab tekshiradi → installer. Biror qadam xato bersa, to‘xtaydi (`[bundle] XATO: ...`).

**Tekshiruv — `dist:client`dan OLDIN** (`release\win-unpacked` har buildda qayta yoziladi). Quyidagilar bo‘lishi shart (`desktop\release\win-unpacked\resources\`):
- `server\dist\main.js`, `runtime\node.exe`, `allow-firewall.bat`
- `server\node_modules\@nestjs\core\package.json`, `server\node_modules\reflect-metadata\package.json`
- `server\node_modules\better-sqlite3\build\Release\better_sqlite3.node`
- `server\node_modules\@hardweb-pos\shared\dist\index.js`

Repo’dan tashqarida sinov (server repo `node_modules`’isiz ishlashini ko‘rsatadi):
```bat
xcopy /e /i /q desktop\release\win-unpacked\resources C:\dxtest\resources
cd /d C:\dxtest\resources\server
set PORT=3999
set DB_FILE=C:\dxtest\test.db
set SEED_DEMO=false
set LICENSE_ENFORCE=false
set JWT_SECRET=sinov
..\runtime\node.exe dist\main.js
```
Brauzerda `http://127.0.0.1:3999/api/license/status` → JSON chiqsa — paket to‘g‘ri. `Ctrl+C`, `C:\dxtest`ni o‘chiring.

So‘ng Terminal va (kerak bo‘lsa) DEMO:
```bat
npm run dist:client
npm run dist:mock
```
Natija `desktop\release\` da: `DasturXon-Server-0.1.0.exe`, `DasturXon-Terminal-0.1.0.exe`, `DasturXon-DEMO-0.1.0.exe`.
Fleshkaga: Server va Terminal installerlari + `scripts\allow-firewall.bat`.

---

## 2. Kassa kompyuteri (Server)

1. **Tayyorgarlik:** vaqt mintaqasi **(UTC+05:00) Toshkent** + vaqtni avtomatik sinxronlash (barcha kompyuterlarda); quvvat sozlamasi — **uyquga ketmasin**; routerda kassaga **statik IP** (DHCP reservation), masalan `192.168.1.10`. Har kuni ishlaydigan Windows hisobidan o‘rnating (o‘rnatma shu foydalanuvchiga bo‘ladi); avto-kirish (auto-logon) yoqilsa, kompyuter yonganda dastur o‘zi ochiladi.
2. **Oldin shu kompyuterda DasturXon (DEMO yoki eski build) ishlagan bo‘lsa:** dasturni yoping va `%APPDATA%\@hardweb-pos\desktop\data\dasturxon.db` faylini o‘chiring (yoki boshqa joyga ko‘chiring). Aks holda eski demo ma’lumotlar qoladi — yangi baza faqat bo‘sh holatda yaratiladi.
3. `DasturXon-Server-0.1.0.exe` ni ishga tushiring. SmartScreen chiqsa: **«Подробнее» → «Выполнить в любом случае»** (More info → Run anyway). O‘rnatiladi va o‘zi ochiladi (birinchi start ~10 s).
4. **Firewall:** Windows so‘rasa — **«Разрешить доступ»** (ikkala tarmoq turini belgilang), hech qachon «Отмена» bosmang. Keyin baribir **`allow-firewall.bat`** ni ishga tushiring (ikki marta bosing → UAC «Да»). U TCP **3100** va **8080** ni barcha profillarda ochadi va «Отмена» sabab paydo bo‘lgan bloklarni olib tashlaydi. Necha marta ishga tushirsa ham xavfsiz. Fayl o‘rnatilgan papkada ham bor: `%LOCALAPPDATA%\Programs\@hardweb-posdesktop\resources\allow-firewall.bat`.
5. **Birinchi kirish:** «Direktor (login/parol) bilan kirish» → login **`direktor`**, parol **`1234`** → dastur darhol **yangi parol** so‘raydi (4–64 belgi). Yangi parolni yozib, xavfsiz joyda saqlang. Bazada boshqa foydalanuvchi, stol, menyu yo‘q — hammasini restoran ma’lumoti bilan kiritasiz.
6. **Sozlash** (Boshqaruv):
   - **Stollar** (zal + raqam), **Kategoriyalar**, **Menyu** (narx, birlik, bo‘lim). Taom rasmi ≤ ~70 KB.
   - **Bo‘limlar** (oshxona, bar, somsaxona…): har biriga printer IP, port `9100`, kenglik 80 mm = `48` / 58 mm = `32` → **«Sinov»** tugmasi bilan tekshiring. Bo‘lim cheklarini endi **kassa (server) o‘zi** chop etadi: telefon va terminal buyurtmalari ham chiqadi, qo‘shimcha taom faqat o‘zi «QO'SHIMCHA» sarlavhasi bilan chiqadi. Shuning uchun **kassa kompyuteri** har bir bo‘lim printeriga TCP 9100 orqali yeta olishi kerak (bitta tarmoq). Chop etilmasa, ekranlarda ogohlantirish chiqadi.
   - **Qurilmalar** (kassa kompyuterida): chek printeri — USB (Windows printer nomi) yoki LAN IP, 80 mm = `48` → Saqlash → «Sinov cheki». Bu yerdagi «Oshxona printerlari (LAN)» ro‘yxatini ishlatmang — bo‘lim printerlari faqat **Bo‘limlar**da.
   - **Xodimlar:** har xodimga ism, rol va takrorlanmaydigan **4 xonali PIN**. Ofitsiant, oshpaz, kassir PIN bilan kiradi. Boshqa direktor/administratorga login+parolni faqat direktor beradi — u birinchi kirishda parolini o‘zi almashtiradi.
   - **Sozlamalar → Telegram:** bot token (@BotFather) + raqamli Telegram ID’lar (vergul bilan; har bir qabul qiluvchi avval botga `/start` yozsin) → Saqlash → «Sinov». Kunlik hisobot vaqtida kassa yoqiq bo‘lsin.
7. **Ish vaqtida:** kassa kompyuterida **«Kassa»** ekrani ochiq tursin — printersiz terminallardan kelgan «Schot» va cheklar shu ekran orqali chop etiladi.
8. **Kassa ilovasini yopmang** — u butun restoranning serveri. X bosilsa «Kassani yopish» oynasi chiqadi → **«Bekor qilish»**. Server kutilmaganda to‘xtasa, ilova uni o‘zi qayta ishga tushiradi (2–30 s). 10 daqiqada 5 martadan ko‘p to‘xtasa «Server ishlamayapti» oynasi chiqadi → «Qayta urinish»; takrorlansa — kompyuterni qayta yoqing va `server.log`ni yuboring (7-bo‘lim).

## 3. Monobloklar (Terminal)

1. Faqat `DasturXon-Terminal-0.1.0.exe` ni o‘rnating (SmartScreen — 2-bo‘lim, 3-band).
2. «Serverga ulanmoqda» ekranida **«⚙ Server manzili»** → kassa IP’sini yozing: `192.168.1.10` (yoki `http://192.168.1.10:3100`) → Ulanish. Manzil o‘zi to‘g‘rilanadi (`http://` va `:3100` qo‘shiladi) va ilova qayta yuklanadi. Kirgandan keyin yuqoridagi belgi **«Ulangan»** (yashil) bo‘lishi kerak.
3. Xodim PIN bilan kiradi. 5 marta noto‘g‘ri PIN → «Juda ko‘p noto‘g‘ri urinish…» — 1 daqiqa kuting.
4. Sensorli klaviatura: Windows sozlamalarida «klaviatura ulanmaganda sensorli klaviaturani ko‘rsatish»ni yoqing.

## 4. Ofitsiant telefonlari va TV

- Telefon **kassa bilan bitta Wi-Fi**da bo‘lsin (routerda «client/AP isolation» o‘chiq).
- Kassa ilovasida bosh sahifa → **«📱 Ofitsiant telefoni uchun QR»** → telefonda skanerlang. Yoki brauzerda `http://192.168.1.10:8080`. QR boshqa (virtual adapter) IP ko‘rsatsa — manzilni qo‘lda yozing.
- TV navbat ekrani (ixtiyoriy): `http://192.168.1.10:3100/queue`.

## 5. Qabul qilish sinovi (ishga tushirishdan oldin)

1. Monoblokdan buyurtma (kg taom bilan) → bo‘lim printerida chek, KDS’da ko‘rinadi.
2. Shu stolga yana taom → printerda **faqat yangi taom** «QO'SHIMCHA» bilan chiqadi.
3. Telefondan buyurtma → bo‘lim printeriga chiqadi.
4. «Schot» → kassada naqd + karta bilan bo‘lib to‘lash → chek chop etiladi, stol bo‘shaydi.
5. Cheklar tarixida taomlar va summa to‘g‘ri; kunlik hisobot; Telegram «Sinov».

## 6. Sessiya va xavfsizlik

- Kirish sessiyasi **24 soat**. Tugasa «Sessiya tugadi — qayta kiring» chiqadi — qayta kiriladi (bu normal).
- O‘chirilgan yoki faolsizlantirilgan xodim keyingi amalidayoq tizimdan chiqariladi; rol/ruxsat o‘zgarishi ham darhol kuchga kiradi.
- Fiskal (OFD) integratsiya yo‘q — chop etilgan chek fiskal chek emas.

## 7. Zaxira nusxa va loglar

Hammasi kassa kompyuterida, `%APPDATA%\@hardweb-pos\desktop\` ichida:

| Nima | Joyi |
|---|---|
| Baza | `data\dasturxon.db` |
| Avtomatik zaxiralar | `data\backups\dasturxon-YYYYMMDD-HHMMSS.db` — har ishga tushishda (server ko‘tarilishidan oldin) va kassa tunda ham yoqiq tursa 03:00–06:00 da kuniga bir marta; eng yangi **14 tasi** saqlanadi |
| Server logi | `logs\server.log` (+ `server.log.1`, `server.log.2`; har biri ≤ 5 MB) |
| Ishga tushish logi | `launch-debug.log` |
| JWT siri | `server-config.json` (bazaga qo‘shib saqlang) |

- Avtomatik zaxiralar **o‘sha diskda** turadi: haftada bir marta `data\backups` dagi eng yangi faylni va `server-config.json`ni fleshka/bulutga nusxalang.
- **Tiklash:** kassa ilovasini yoping → `data\dasturxon.db`ni zaxira fayl bilan almashtiring (nomini `dasturxon.db` qiling; yonida `-journal` fayli bo‘lsa, uni `dasturxon.db-journal` qilib qo‘ying) → ilovani oching.
- 2 oydan eski buyurtmalar bazadan avtomatik o‘chiriladi — ularni faqat zaxiradan ko‘rish mumkin.
- Qayta o‘rnatish/yangilash bazani o‘chirmaydi (u `%APPDATA%`da). Yangi versiya: kassada yangi Server installerini eskisi ustidan ishga tushiring (baza server ko‘tarilishidan oldin avtomatik zaxiralanadi), monobloklarda — yangi Terminal installerini.

## 8. Tez yechimlar

| Belgi | Tekshiring |
|---|---|
| Terminal «Oflayn», ulanmaydi | Kassa yoqiqmi; IP to‘g‘rimi; `allow-firewall.bat` ishga tushirilganmi; terminal brauzerida `http://<kassa-IP>:3100/api/license/status` ochiladimi |
| Telefonda sahifa ochilmaydi | Bitta Wi-Fi; 8080 ochiqmi (`allow-firewall.bat`); QR’dagi IP kassa IP’siga tengmi |
| Bo‘lim printeri chiqarmaydi | Bo‘limlar → «Sinov»; printer yoqiq/qog‘oz bor; IP o‘zgarmaganmi (printerga ham statik IP bering) |
| «Sessiya tugadi» | Qayta kiring (24 soatlik sessiya) |
| «Server ishlamayapti» | «Qayta urinish»; takrorlansa kompyuterni qayta yoqing, `logs\server.log`ni yuboring |

## Texnik ma’lumot

Ichki server muhiti (`desktop/src/main/index.ts` beradi): `PORT=3100`, `DB_FILE=<userData>\data\dasturxon.db`, `DB_SYNCHRONIZE=true`, `SEED_ON_START=true`, `SEED_DEMO=false` (bo‘sh bazada faqat `direktor`), `FISCAL_ENABLED=false`, `JWT_EXPIRES_IN=24h`, `LICENSE_ENFORCE=false`. Server `resources\runtime\node.exe` (Node 22) bilan ishlaydi. Litsenziya va bulut sinxronizatsiyasi hozircha o‘chiq.
