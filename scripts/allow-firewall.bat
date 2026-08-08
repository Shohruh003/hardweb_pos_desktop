@echo off
REM ============================================================
REM  DasturXon server portiga (3100) Windows Firewall ruxsati.
REM  Boshqa kompyuterlardagi terminallar ulanishi uchun.
REM  O'NG tugma -> "Run as administrator" bilan bir marta ishga tushiring.
REM ============================================================
netsh advfirewall firewall delete rule name="DasturXon 3100" >nul 2>&1
netsh advfirewall firewall add rule name="DasturXon 3100" dir=in action=allow protocol=TCP localport=3100 profile=any

if errorlevel 1 (
  echo.
  echo XATO: Administrator sifatida ishga tushiring.
) else (
  echo.
  echo TAYYOR: 3100-portga ruxsat berildi. Endi zal kompyuteri ulana oladi.
)
echo.
pause
