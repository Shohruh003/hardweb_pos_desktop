@echo off
setlocal EnableExtensions DisableDelayedExpansion
REM ======================================================================
REM  DasturXon - Windows Firewall sozlamasi (faqat KASSA / server kompyuteri)
REM
REM  Nima qiladi (necha marta ishga tushirilsa ham xavfsiz - qoidalar
REM  har safar o'chirilib, qaytadan yaratiladi):
REM   1) Kiruvchi TCP 3100 (server API + Socket.IO: terminallar, telefonlar,
REM      TV navbat ekrani) va TCP 8080 (ofitsiant telefonlari uchun web)
REM      portlarini BARCHA tarmoq profillarida ochadi.
REM   2) Windows "ruxsat berasizmi?" oynasida "Bekor qilish / Otmena" bosilganda
REM      DasturXon.exe va resources\runtime\node.exe uchun yaratilgan
REM      BLOKLOVCHI qoidalarni o'chiradi (bloklash har qanday ruxsatdan ustun).
REM   3) O'rnatilgan papka topilsa (%LOCALAPPDATA%\Programs\@hardweb-posdesktop
REM      yoki ...\DasturXon) - shu ikki dastur uchun ruxsat qoidasini qo'shadi.
REM
REM  Administrator huquqi kerak: oddiy ikki marta bosilsa, o'zi UAC orqali
REM  ruxsat so'raydi. Matnlar ataylab ASCII (cmd oynasida harflar buzilmasin).
REM  Fayl oxiridagi PowerShell qismi shu fayldan o'qib bajariladi.
REM  Belgi (label/goto) ishlatilmagan - LF qator oxirlarida ham to'g'ri ishlaydi.
REM ======================================================================
title DasturXon - Firewall sozlamasi

set "SYS=%SystemRoot%\System32"
set "NETSH=%SystemRoot%\System32\netsh.exe"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "SELF=%~f0"
set "SELFDIR=%~dp0"
REM PowerShell '...' satri ichida apostrof ikkilanadi (masalan C:\Users\G'ayrat)
set "SELF_PS=%SELF:'=''%"
set "SELFDIR_PS=%SELFDIR:'=''%"
set "FAILED="

REM --- Administrator (yuqori daraja) tekshiruvi: S-1-16-12288 = High Mandatory Level
"%SYS%\whoami.exe" /groups | "%SYS%\find.exe" "S-1-16-12288" >nul 2>&1
if errorlevel 1 if /i not "%~1"=="--elevated" (
  echo Administrator huquqi kerak - ruxsat so'ralmoqda...
  "%PS%" -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process -FilePath '%SELF_PS%' -ArgumentList '--elevated' -Verb RunAs -ErrorAction Stop; exit 0 } catch { exit 1 }"
  if not errorlevel 1 exit /b 0
)
"%SYS%\whoami.exe" /groups | "%SYS%\find.exe" "S-1-16-12288" >nul 2>&1
if errorlevel 1 (
  echo.
  echo XATO: Administrator huquqi olinmadi.
  echo Faylni sichqonchaning O'NG tugmasi bilan bosing va
  echo "Run as administrator" / "Zapusk ot imeni administratora" ni tanlang.
  echo.
  pause
  exit /b 1
)

echo.
echo ==============================================================
echo   DasturXon - Windows Firewall sozlamasi
echo ==============================================================
echo.
echo [1/2] Portlar ochilmoqda...
"%NETSH%" advfirewall firewall delete rule name="DasturXon 3100" >nul 2>&1
"%NETSH%" advfirewall firewall add rule name="DasturXon 3100" dir=in action=allow protocol=TCP localport=3100 profile=any enable=yes description="DasturXon server API va Socket.IO - terminallar, telefonlar, TV" >nul 2>&1
if errorlevel 1 (
  set "FAILED=1"
  echo   [XATO]  TCP 3100 uchun qoida qo'shilmadi
) else (
  echo   [OK]    TCP 3100 ochildi - server API, barcha tarmoq profillari
)
"%NETSH%" advfirewall firewall delete rule name="DasturXon 8080" >nul 2>&1
"%NETSH%" advfirewall firewall add rule name="DasturXon 8080" dir=in action=allow protocol=TCP localport=8080 profile=any enable=yes description="DasturXon web - ofitsiant telefonlari uchun" >nul 2>&1
if errorlevel 1 (
  set "FAILED=1"
  echo   [XATO]  TCP 8080 uchun qoida qo'shilmadi
) else (
  echo   [OK]    TCP 8080 ochildi - telefonlar uchun web, barcha tarmoq profillari
)

echo.
echo [2/2] Dastur qoidalari tekshirilmoqda - bir necha soniya...
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command "$t = [IO.File]::ReadAllText('%SELF_PS%'); $i = $t.LastIndexOf('#==DASTURXON-PS=='); if ($i -lt 0) { Write-Host '  [XATO]  PowerShell qismi topilmadi'; exit 3 }; & ([ScriptBlock]::Create($t.Substring($i))) -ScriptDir '%SELFDIR_PS%.'"
if errorlevel 1 set "FAILED=1"

echo.
echo ==============================================================
if defined FAILED (
  echo   DIQQAT: ba'zi qoidalar qo'yilmadi - yuqoridagi [XATO] qatorlarini o'qing.
) else (
  echo   TAYYOR. Windows Firewall DasturXon uchun sozlandi.
)
echo ==============================================================
echo   Tekshirish - terminal yoki telefon brauzerida oching:
echo     http://KASSA-IP:3100/api/license/status   - JSON chiqishi kerak
echo     http://KASSA-IP:8080                      - kirish sahifasi
echo.
pause
if defined FAILED exit /b 1
exit /b 0

#==DASTURXON-PS== Bu qatordan pastdagi qism PowerShell'da bajariladi (cmd bu yergacha kelmaydi).
param([string]$ScriptDir = '')
$ErrorActionPreference = 'Continue'
$failed = $false

# 1) DasturXon o'rnatilgan papka(lar)ini topish. O'rnatma per-user:
#    %LOCALAPPDATA%\Programs\@hardweb-posdesktop. Administrator boshqa hisobdan kirgan
#    bo'lsa ham topilishi uchun barcha foydalanuvchi profillari ko'riladi.
$names = @('@hardweb-posdesktop', 'DasturXon')
$cands = New-Object System.Collections.Generic.List[string]
if ($ScriptDir) { $cands.Add((Join-Path $ScriptDir '..')) }
foreach ($n in $names) {
  if ($env:LOCALAPPDATA) { $cands.Add((Join-Path $env:LOCALAPPDATA ('Programs\' + $n))) }
}
$usersRoot = Split-Path -Parent $env:USERPROFILE
if ($usersRoot -and (Test-Path -LiteralPath $usersRoot)) {
  foreach ($u in @(Get-ChildItem -LiteralPath $usersRoot -Directory -Force -ErrorAction SilentlyContinue)) {
    foreach ($n in $names) { $cands.Add((Join-Path $u.FullName ('AppData\Local\Programs\' + $n))) }
  }
}
foreach ($pf in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
  if ($pf) { $cands.Add((Join-Path $pf 'DasturXon')) }
}
$dirs = @()
foreach ($c in $cands) {
  try {
    if (Test-Path -LiteralPath (Join-Path $c 'DasturXon.exe')) {
      $full = [IO.Path]::GetFullPath($c).TrimEnd('\')
      if ($dirs -notcontains $full) { $dirs += $full }
    }
  } catch { }
}

# 2) Windows yaratgan BLOKLOVCHI qoidalarni o'chirish (oynada "Bekor qilish" bosilganda
#    paydo bo'ladi, nomi odatda "DasturXon" yoki "Node.js JavaScript Runtime").
$progs = @()
foreach ($d in $dirs) {
  $progs += (Join-Path $d 'DasturXon.exe')
  $progs += (Join-Path $d 'resources\runtime\node.exe')
}
try {
  $filters = @(Get-NetFirewallApplicationFilter -ErrorAction Stop | Where-Object {
      $p = [Environment]::ExpandEnvironmentVariables([string]$_.Program)
      ($p -like '*\@hardweb-posdesktop\*') -or ($p -like '*\Programs\DasturXon\*') -or
      ($p -like '*\DasturXon\DasturXon.exe') -or ($progs -contains $p)
    })
  $removed = 0
  if ($filters.Count -gt 0) {
    foreach ($r in @($filters | Get-NetFirewallRule -ErrorAction SilentlyContinue)) {
      if ($r.Direction -eq 'Inbound' -and $r.Action -eq 'Block') {
        $r | Remove-NetFirewallRule -ErrorAction Stop
        $removed++
        Write-Host ('  [OK]    Bloklovchi qoida o''chirildi: ' + $r.DisplayName)
      }
    }
  }
  if ($removed -eq 0) { Write-Host '  [OK]    Bloklovchi qoida topilmadi' }
} catch {
  $failed = $true
  Write-Host ('  [XATO]  Bloklovchi qoidalarni tekshirib bo''lmadi: ' + $_.Exception.Message)
}

# 3) Dastur bo'yicha ruxsat qoidalari (eski nusxalari o'chirilib, qaytadan yaratiladi)
$ruleApp = 'DasturXon ilova'
$ruleNode = 'DasturXon server (node.exe)'
foreach ($name in @($ruleApp, $ruleNode)) {
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
}
if ($dirs.Count -eq 0) {
  Write-Host '  [!]     DasturXon o''rnatilgan papka topilmadi - faqat port qoidalari qo''yildi.'
  Write-Host '          Avval DasturXon-Server installerini o''rnating, bir marta oching, keyin qayta ishga tushiring.'
}
foreach ($d in $dirs) {
  Write-Host ('  Papka:  ' + $d)
  try {
    New-NetFirewallRule -DisplayName $ruleApp -Description 'DasturXon kassa ilovasi (8080 - telefonlar uchun web)' `
      -Direction Inbound -Action Allow -Program (Join-Path $d 'DasturXon.exe') -Profile Any -Enabled True -ErrorAction Stop | Out-Null
    Write-Host '  [OK]    DasturXon.exe ga ruxsat berildi'
    $node = Join-Path $d 'resources\runtime\node.exe'
    if (Test-Path -LiteralPath $node) {
      New-NetFirewallRule -DisplayName $ruleNode -Description 'DasturXon ichki server (3100 - API va Socket.IO)' `
        -Direction Inbound -Action Allow -Program $node -Profile Any -Enabled True -ErrorAction Stop | Out-Null
      Write-Host '  [OK]    resources\runtime\node.exe ga ruxsat berildi'
    } else {
      Write-Host '  [!]     resources\runtime\node.exe yo''q - bu Server o''rnatmasi emas (Terminal/DEMO kassaga o''rnatilmaydi)'
    }
  } catch {
    $failed = $true
    Write-Host ('  [XATO]  Dastur qoidasi qo''shilmadi: ' + $_.Exception.Message)
  }
}
if ($failed) { exit 1 }
exit 0
