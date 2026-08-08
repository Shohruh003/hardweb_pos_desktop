@echo off
REM ============================================================
REM  DasturXon server ishga tushirish (kassa kompyuteri uchun)
REM  Kompyuter yonganda avtomatik ishga tushadi (Task Scheduler).
REM  Docker bazani ko'taradi, shared+server build qiladi va serverni yoqadi.
REM ============================================================
cd /d "%~dp0.."

echo [DasturXon] Baza (Docker) ishga tushmoqda...
docker compose up -d

echo [DasturXon] Baza tayyor bo'lishini kutamiz...
:waitdb
docker exec hardweb_pos_db pg_isready -U postgres -d hardweb_pos >nul 2>&1
if errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto waitdb
)

echo [DasturXon] Umumiy kutubxona tayyorlanmoqda...
call npm run build:shared

echo [DasturXon] Server tayyorlanmoqda...
call npm --prefix server run build

echo [DasturXon] Server ishga tushdi — http://%COMPUTERNAME%:3100
node server/dist/main.js
