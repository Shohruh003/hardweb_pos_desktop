// Navbat ekrani (mijozlar uchun tablo) — TZ 7-bo'lim.
// Mustaqil web-sahifa: istalgan TV/brauzerda http://<kassa-IP>:3100/queue da ochiladi.
// socket.io klienti serverning o'zidan (/socket.io/socket.io.js) yuklanadi — CDN/internet kerak emas.
// Tablo tokensiz ulanadi (OrdersGateway PUBLIC_ROOM): unga faqat yuksiz 'queue:changed' signali keladi,
// ma'lumot esa doim GET /queue/data dan (shaxsiy ma'lumotsiz, summalarsiz) o'qiladi.
// Kartochka: olib ketish / yetkazish — "Olib ketish" / "Yetkazish" + "#12", stolga — "Stol" + "5".

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
    <div class="brand">DasturXon</div>
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

    // Kartochka yozuvi: olib ketish / yetkazish — kunlik raqam "#12", stolga — stol raqami
    function cardOf(o) {
      if (o.type === 'olib_ketish' || o.type === 'yetkazish') {
        var label = o.type === 'olib_ketish' ? 'Olib ketish' : 'Yetkazish';
        return { label: label, num: o.queueNumber != null ? '#' + o.queueNumber : '#?' };
      }
      return { label: 'Stol', num: o.tableNumber != null ? String(o.tableNumber) : '—' };
    }

    function fill(id, arr) {
      arr.sort(function (a, b) { return (a.openedAt || '').localeCompare(b.openedAt || ''); });
      var html = arr.map(function (o) {
        var c = cardOf(o);
        return '<div class="card"><div class="label">' + c.label + '</div><div class="num">' + c.num + '</div></div>';
      }).join('');
      document.getElementById(id).innerHTML = html;
    }

    // To'liq ro'yxat (boshida, har signalda va har qayta ulanishda). Faqat eng oxirgi so'rov
    // javobi qo'llanadi — kech kelgan eski javob yangisining ustiga yozilmasin.
    var loadSeq = 0;
    function load() {
      var seq = ++loadSeq;
      fetch('/queue/data', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (data) {
        if (seq !== loadSeq) return;
        var next = {};
        (Array.isArray(data) ? data : []).forEach(function (o) { next[o.id] = o; });
        orders = next;
        render();
      }).catch(function () {});
    }
    load();

    // Ketma-ket signallar (masalan oshxona bir nechta buyurtmani birdan "tayyor" qilsa) — bitta so'rov
    var loadTimer = null;
    function scheduleLoad() {
      if (loadTimer) return;
      loadTimer = setTimeout(function () { loadTimer = null; load(); }, 300);
    }

    // Real-time: tablo login'siz ochiladi, shuning uchun server unga buyurtmalarning o'zini emas, faqat
    // yuksiz "queue:changed" signalini yuboradi (mijoz telefoni/manzili va summalar bu yerga kelmaydi) —
    // ro'yxat har signalda /queue/data dan qayta o'qiladi.
    var socket = io();
    var conn = document.getElementById('conn');
    var connectedOnce = false;
    socket.on('connect', function () {
      conn.textContent = 'Ulangan ✓';
      if (connectedOnce) load();
      connectedOnce = true;
    });
    socket.on('disconnect', function () { conn.textContent = 'Aloqa uzildi...'; });
    socket.on('queue:changed', scheduleLoad);
    // Zaxira: signal yo'qolgan bo'lsa ham tablo bir daqiqada o'zini tuzatadi
    setInterval(load, 60000);

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
