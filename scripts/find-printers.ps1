# DasturXon - tarmoqdagi chek printerlarini qidirish (TCP 9100 porti ochiq qurilmalar).
# Masofadan (AnyDesk) o'rnatishda printer IP manzillarini topish uchun.
# Faqat ulanib ko'radi (hech narsa yubormaydi, printerda chek chiqmaydi).
# Ishga tushirish: find-printers.bat (yoki: powershell -ExecutionPolicy Bypass -File find-printers.ps1)

$ErrorActionPreference = 'SilentlyContinue'
$Port = 9100
$WaitMs = 2000

Write-Host ''
Write-Host '=== DasturXon: tarmoqdagi chek printerlarini qidirish (port 9100) ===' -ForegroundColor Yellow
Write-Host ''

# Kompyuterning IPv4 manzillari (loopback, APIPA va virtual adapterlarsiz)
$addrs = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'
}
if (-not $addrs) {
  Write-Host 'Tarmoq manzili topilmadi. Kompyuter tarmoqqa ulanganmi?' -ForegroundColor Red
  exit 1
}

$bases = @()
foreach ($a in $addrs) {
  $alias = $a.InterfaceAlias
  if ($alias -match 'VirtualBox|VMware|Hyper-V|vEthernet|Loopback|Bluetooth|WSL') { continue }
  $parts = $a.IPAddress.Split('.')
  $base = "$($parts[0]).$($parts[1]).$($parts[2])"
  Write-Host ("Kompyuter: {0}  ({1})" -f $a.IPAddress, $alias)
  if ($bases -notcontains $base) { $bases += $base }
}
$gw = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4DefaultGateway.NextHop
if ($gw) { Write-Host ("Router (gateway): {0}" -f $gw) }
Write-Host ''

$found = @()
foreach ($base in $bases) {
  Write-Host ("Qidirilmoqda: {0}.1 - {0}.254 ..." -f $base)
  $probes = @()
  foreach ($i in 1..254) {
    $ip = "$base.$i"
    $c = New-Object System.Net.Sockets.TcpClient
    $ar = $c.BeginConnect($ip, $Port, $null, $null)
    $probes += [pscustomobject]@{ Ip = $ip; Client = $c; Ar = $ar }
  }
  Start-Sleep -Milliseconds $WaitMs
  foreach ($p in $probes) {
    $open = $false
    if ($p.Ar.IsCompleted) {
      try { $p.Client.EndConnect($p.Ar); $open = $true } catch { $open = $false }
    }
    $p.Client.Close()
    if ($open) { $found += $p.Ip }
  }
}

Write-Host ''
if ($found.Count -eq 0) {
  Write-Host 'Printer topilmadi.' -ForegroundColor Red
  Write-Host 'Tekshiring:'
  Write-Host ' 1) Printer yoqilgan va LAN (Ethernet) kabeli routerga/switchga ulanganmi?'
  Write-Host ' 2) Printer IP manzili boshqa tarmoqda bo''lishi mumkin (masalan 192.168.123.x).'
  Write-Host '    Restorandagi xodim printerni o''chirib, FEED tugmasini bosib turgan holda yoqsin -'
  Write-Host '    "self-test" chekida IP manzil yoziladi. Uni kompyuter tarmog''iga moslash kerak'
  Write-Host '    (Xprinter "Printer Tool" dasturi orqali).'
} else {
  Write-Host ("Topilgan printerlar: {0} ta" -f $found.Count) -ForegroundColor Green
  $neighbors = Get-NetNeighbor -AddressFamily IPv4
  foreach ($ip in $found) {
    $mac = ($neighbors | Where-Object { $_.IPAddress -eq $ip } | Select-Object -First 1).LinkLayerAddress
    if ($mac) { Write-Host ("  {0}:{1}   MAC {2}" -f $ip, $Port, $mac) -ForegroundColor Green }
    else { Write-Host ("  {0}:{1}" -f $ip, $Port) -ForegroundColor Green }
  }
  Write-Host ''
  Write-Host 'Keyingi qadam: DasturXon -> Boshqaruv -> Bo''limlar -> har bo''limga printer IP sini kiriting'
  Write-Host 'va "Sinov" tugmasini bosing. Qaysi printerdan sinov cheki chiqqanini restorandagi xodim aytsin.'
}
Write-Host ''
