// Navbat ekrani (mijozlar uchun tablo) — TZ 7-bo'lim.
// Mustaqil web-sahifa: istalgan TV/brauzerda http://<server>:3000/queue da ochiladi.
// socket.io klienti serverning o'zidan (/socket.io/socket.io.js) yuklanadi — CDN/internet kerak emas.

export const QUEUE_HTML = /* html */ `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Navbat ekrani</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #15181E; color: #F4F6F8;
    font-family: 'Segoe UI', system-ui, sans-serif;
    height: 100vh; overflow: hidden;
  }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 40px; border-bottom: 1px solid #2D333D;
  }
  header .brand { font-size: 28px; font-weight: 800; color: #059669; }
  header .clock { font-size: 24px; color: #A8B0BD; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; height: calc(100vh - 82px); }
  .col { padding: 24px 32px; overflow: auto; }
  .col.cooking { border-right: 1px solid #2D333D; }
  .col h2 { font-size: 30px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px; }
  .col.cooking h2 { color: #F59E0B; }
  .col.ready h2 { color: #22C55E; }
  .dot { width: 16px; height: 16px; border-radius: 50%; }
  .col.cooking .dot { background: #F59E0B; }
  .col.ready .dot { background: #22C55E; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; }
  .card {
    background: #1F242D; border: 2px solid #2D333D; border-radius: 18px;
    padding: 24px 12px; text-align: center;
  }
  .card .label { font-size: 16px; color: #A8B0BD; margin-bottom: 6px; }
  .card .num { font-size: 56px; font-weight: 800; line-height: 1; }
  .col.ready .card { border-color: #22C55E; animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.0); }
    50% { box-shadow: 0 0 0 8px rgba(34,197,94,0.18); }
  }
  .empty { color: #A8B0BD; font-size: 20px; margin-top: 20px; }
  .status { position: fixed; bottom: 12px; right: 16px; font-size: 13px; color: #A8B0BD; }
</style>
</head>
<body>
  <header>
    <div class="brand">HardWeb Restoran</div>
    <div class="clock" id="clock"></div>
  </header>
  <div class="columns">
    <div class="col cooking">
      <h2><span class="dot"></span> Tayyorlanmoqda</h2>
      <div class="grid" id="cooking"></div>
      <div class="empty" id="cooking-empty">Hozircha buyurtma yo‘q</div>
    </div>
    <div class="col ready">
      <h2><span class="dot"></span> Tayyor — olib keting</h2>
      <div class="grid" id="ready"></div>
      <div class="empty" id="ready-empty">Hozircha tayyor buyurtma yo‘q</div>
    </div>
  </div>
  <div class="status" id="conn">Ulanmoqda...</div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    var orders = {}; // id -> order

    function render() {
      var list = Object.values(orders);
      var cooking = list.filter(function (o) {
        return o.status === 'qabul_qilindi' || o.status === 'tayyorlanmoqda';
      });
      var ready = list.filter(function (o) { return o.status === 'tayyor'; });

      fill('cooking', cooking);
      fill('ready', ready);
      document.getElementById('cooking-empty').style.display = cooking.length ? 'none' : 'block';
      document.getElementById('ready-empty').style.display = ready.length ? 'none' : 'block';
    }

    function fill(id, arr) {
      arr.sort(function (a, b) { return (a.openedAt || '').localeCompare(b.openedAt || ''); });
      var html = arr.map(function (o) {
        var n = o.queueNumber || o.tableNumber || '—';
        return '<div class="card"><div class="label">Stol</div><div class="num">' + n + '</div></div>';
      }).join('');
      document.getElementById(id).innerHTML = html;
    }

    function upsert(o) { if (o) { orders[o.id] = o; render(); } }
    function remove(o) { if (o && orders[o.id]) { delete orders[o.id]; render(); } }

    // Boshlang'ich ma'lumot
    fetch('/queue/data').then(function (r) { return r.json(); }).then(function (data) {
      data.forEach(function (o) { orders[o.id] = o; });
      render();
    }).catch(function () {});

    // Real-time
    var socket = io();
    var conn = document.getElementById('conn');
    socket.on('connect', function () { conn.textContent = 'Ulangan ✓'; });
    socket.on('disconnect', function () { conn.textContent = 'Aloqa uzildi...'; });
    socket.on('order:created', function (p) { upsert(p.order); });
    socket.on('order:updated', function (p) { upsert(p.order); });
    socket.on('order:closed', function (p) { remove(p.order); });

    // Soat
    function tick() {
      var d = new Date();
      document.getElementById('clock').textContent =
        d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
    }
    tick(); setInterval(tick, 1000);
  </script>
</body>
</html>`;
