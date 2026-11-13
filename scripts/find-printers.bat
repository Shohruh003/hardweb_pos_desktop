@echo off
REM ============================================================
REM  DasturXon - tarmoqdagi chek printerlarini qidirish (port 9100).
REM  Administrator shart emas. Hech narsa chop etmaydi.
REM ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0find-printers.ps1"
echo.
pause
