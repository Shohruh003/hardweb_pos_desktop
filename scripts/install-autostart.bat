@echo off
REM ============================================================
REM  DasturXon serverni Windows'ga avtomatik ishga tushirishga qo'shadi.
REM  Bu faylni O'NG tugma -> "Run as administrator" bilan bir marta ishga tushiring.
REM  Kompyuterga har kirilganda (logon) server o'zi ishga tushadi.
REM ============================================================
set SCRIPT=%~dp0start-server.bat

schtasks /Create /TN "DasturXon Server" /TR "cmd /c \"%SCRIPT%\"" /SC ONLOGON /RL HIGHEST /F

if errorlevel 1 (
  echo.
  echo XATO: Vazifa qo'shilmadi. Faylni administrator sifatida ishga tushiring.
) else (
  echo.
  echo TAYYOR: "DasturXon Server" avtomatik ishga tushirishga qo'shildi.
  echo Kompyuter qayta yonganda server o'zi ishga tushadi.
  echo Hozir sinab ko'rish uchun: schtasks /Run /TN "DasturXon Server"
)
echo.
pause
