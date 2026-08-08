# DasturXon — o'rnatish (ko'p terminal / ko'p etaj)

Ko'p qavatli restoran misoli: har etajda ofitsiant terminali (monoblok), kassa bitta,
baza va server bitta kompyuterda (kassada).

```
        [KASSA kompyuteri]                 [1-etaj]   [2-etaj]   [3-etaj]  ...
        - PostgreSQL (baza, bitta)         terminal   terminal   terminal
        - NestJS server (bitta)   <--Wi-Fi/LAN-------------------------->
        - DasturXon (kassa)                (har biri server IP'ga ulanadi)
        - Check printer (LAN)
```

## 1. Baza va server — faqat kassa kompyuterida (bitta)

- Baza (PostgreSQL) Docker'da, `restart: unless-stopped` — kompyuter yonsa o'zi ko'tariladi.
- Server (NestJS, port **3100**) — barcha terminallar shu bitta serverga ulanadi.
- **Baza bitta** — hamma etaj bir xil ma'lumot ko'radi (stollar, buyurtmalar, sklad, hisobot).

### Serverni avtomatik ishga tushirish (kompyuter yonganda)
1. Docker Desktop: Settings → General → **"Start Docker Desktop when you log in"** yoqing.
2. `scripts\install-autostart.bat` ni **administrator** sifatida bir marta ishga tushiring.
   - Bu "DasturXon Server" nomli vazifa qo'shadi (har logon'da server yoqiladi).
3. Sinash: `schtasks /Run /TN "DasturXon Server"` yoki kompyuterni qayta yoqing.

Windows Firewall — 3100 portga ruxsat (terminallar ulanishi uchun), administrator cmd:
```
netsh advfirewall firewall add rule name="DasturXon 3100" dir=in action=allow protocol=TCP localport=3100
```

## 2. Etajlar (zallar) — universal

- Admin → **Stollar** bo'limida har etaj uchun zal yarating: `1-etaj`, `2-etaj`, `3-etaj` ...
  va stollarni o'sha zalga biriktiring.
- Etaj soni cheklanmagan — nechta bo'lsa shuncha zal qo'shiladi.
- Chek, schot va oshxona chekida **qaysi zal/etaj** ekani yoziladi (universal).

## 3. Har etaj terminali (ofitsiant monobloki)

1. DasturXon'ni o'rnating (`DasturXon-Setup-x.x.x.exe`).
2. Admin → Qurilmalar → **Server manzili** = kassa IP:
   ```
   http://192.168.1.10:3100
   ```
   (kassa IP'sini `ipconfig` orqali biling; hamma bitta Wi-Fi/router'da bo'lsin)
3. Ofitsiant o'z PIN'i bilan kiradi, o'z zalini/stolini tanlaydi.

## 4. Check printer — LAN (tarmoq) orqali

Printerni USB emas, **tarmoqqa** ulang (kabel/Wi-Fi), doimiy IP bering. Har bir
terminalда (kassa + etajlar):

- Admin → Qurilmalar → Ulanish turi: **Tarmoq (LAN)** → Printer IP: `192.168.1.50`, Port: `9100` → Saqlash.

Shunda:
- Ofitsiant istalgan etajdan **Schot** bossa → to'g'ridan-to'g'ri kassadagi printerдан chiqadi.
- Chekда qaysi **stol** va **zal/etaj** ekani ko'rinadi.
- Oshxona cheki ham stol + zal bilan chiqadi (qayerga yetkazish aniq).

> Har etajga alohida printer kerak bo'lsa: Admin → Qurilmalar → **Oshxona printerlari**
> bo'limiga har zal uchun alohida LAN printer IP qo'shiladi.

## Xulosa
- Baza + server: kassada, bitta, avtomatik ishga tushadi.
- Terminallar: har etajda, server IP'ga ulanadi, cheksiz.
- Chek/oshxona cheki: stol + zal/etaj bilan.
- Printer: LAN — har joydan bitta printerga chiqariladi.
