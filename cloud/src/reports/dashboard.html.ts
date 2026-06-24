// Direktor paneli — bulut subdomenida brauzerda ochiladi (TZ 5.5, T-3.5).
// Self-contained: login + hisobotlar. Tema lokal ilova bilan bir xil (ko'k yo'q).
export const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HardWeb POS — Direktor</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
  body { background: #15181E; color: #F4F6F8; min-height: 100vh; }
  .muted { color: #A8B0BD; }
  .primary { color: #059669; }
  input, select, button { font-size: 15px; }
  input, select {
    width: 100%; padding: 10px 12px; margin-top: 4px;
    background: #15181E; color: #F4F6F8; border: 1px solid #2D333D; border-radius: 10px; outline: none;
  }
  input:focus, select:focus { border-color: #059669; }
  button.btn {
    background: #059669; color: #fff; border: none; border-radius: 10px;
    padding: 11px 18px; font-weight: 700; cursor: pointer;
  }
  button.tab { background: #1F242D; color: #A8B0BD; border: 1px solid #2D333D; border-radius: 10px; padding: 9px 16px; cursor: pointer; font-weight: 600; }
  button.tab.active { background: #059669; color: #fff; border-color: #059669; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 24px; }
  .login { max-width: 360px; margin: 80px auto; background: #1F242D; border: 1px solid #2D333D; border-radius: 18px; padding: 28px; }
  .row { margin-bottom: 14px; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 22px; }
  .card { background: #1F242D; border: 1px solid #2D333D; border-radius: 14px; padding: 18px; }
  .card .v { font-size: 24px; font-weight: 800; margin-top: 4px; }
  .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .panel { background: #1F242D; border: 1px solid #2D333D; border-radius: 14px; padding: 18px; }
  .panel.wide { grid-column: span 2; }
  .panel h3 { margin-bottom: 14px; }
  .bar-row { margin-bottom: 12px; }
  .bar-top { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 5px; }
  .bar { height: 9px; background: #15181E; border-radius: 6px; overflow: hidden; }
  .bar > span { display: block; height: 100%; border-radius: 6px; }
  .err { background: rgba(239,68,68,0.15); color: #EF4444; padding: 9px 12px; border-radius: 10px; margin-bottom: 12px; font-size: 14px; }
  .hidden { display: none; }
</style>
</head>
<body>
  <!-- Login -->
  <div id="loginView" class="login">
    <div style="text-align:center; margin-bottom:18px;">
      <div class="primary" style="font-size:24px; font-weight:800;">HardWeb POS</div>
      <div class="muted" style="font-size:14px;">Direktor paneli (bulut)</div>
    </div>
    <div id="loginErr" class="err hidden"></div>
    <div class="row"><label class="muted">Restoran (subdomen)</label><input id="subdomain" /></div>
    <div class="row"><label class="muted">Login</label><input id="login" value="direktor" /></div>
    <div class="row"><label class="muted">Parol</label><input id="password" type="password" placeholder="••••" /></div>
    <button class="btn" style="width:100%;" onclick="doLogin()">Kirish</button>
    <div class="muted" style="text-align:center; font-size:12px; margin-top:14px;">Demo: direktor / 1234</div>
  </div>

  <!-- Hisobotlar -->
  <div id="dashView" class="wrap hidden">
    <header>
      <div><span class="primary" style="font-weight:800;">HardWeb POS</span> <span class="muted">/ <span id="tenantName"></span></span></div>
      <div>
        <button class="tab active" data-p="day" onclick="setPeriod('day')">Bugun</button>
        <button class="tab" data-p="week" onclick="setPeriod('week')">7 kun</button>
        <button class="tab" data-p="month" onclick="setPeriod('month')">30 kun</button>
        <button class="tab" onclick="logout()" style="margin-left:10px;">Chiqish</button>
      </div>
    </header>
    <div class="cards">
      <div class="card"><div class="muted">Tushum</div><div class="v primary" id="revenue">—</div></div>
      <div class="card"><div class="muted">Hisoblar soni</div><div class="v" id="ordersCount">—</div></div>
      <div class="card"><div class="muted">O'rtacha chek</div><div class="v" id="avgCheck">—</div></div>
    </div>
    <div class="panels">
      <div class="panel"><h3>To'lov turlari</h3><div id="payments"></div></div>
      <div class="panel"><h3>Ofitsiantlar</h3><div id="waiters"></div></div>
      <div class="panel wide"><h3>Eng ko'p sotilgan taomlar</h3><div id="topItems"></div></div>
    </div>
  </div>

<script>
  var token = localStorage.getItem('cloud_token') || '';
  var period = 'day';

  // Subdomenni hostnamedan aniqlash (demo-restoran.poscloud.uz -> demo-restoran)
  (function () {
    var h = location.hostname;
    var sub = (h === 'localhost' || /^[0-9.]+$/.test(h)) ? 'demo-restoran' : h.split('.')[0];
    document.getElementById('subdomain').value = sub;
    if (token) showDash();
  })();

  function fmt(n) { return new Intl.NumberFormat('uz-UZ').format(n || 0) + " so'm"; }

  function doLogin() {
    var body = {
      subdomain: document.getElementById('subdomain').value.trim(),
      login: document.getElementById('login').value.trim(),
      password: document.getElementById('password').value
    };
    fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) return r.json().then(function (e) { throw new Error(e.message || 'Xato'); }); return r.json(); })
      .then(function (d) {
        token = d.token; localStorage.setItem('cloud_token', token);
        localStorage.setItem('cloud_tenant', d.tenant.name);
        showDash();
      })
      .catch(function (e) {
        var el = document.getElementById('loginErr'); el.textContent = e.message; el.classList.remove('hidden');
      });
  }

  function logout() { token = ''; localStorage.removeItem('cloud_token'); location.reload(); }

  function showDash() {
    document.getElementById('loginView').classList.add('hidden');
    document.getElementById('dashView').classList.remove('hidden');
    document.getElementById('tenantName').textContent = localStorage.getItem('cloud_tenant') || '';
    load();
  }

  function setPeriod(p) {
    period = p;
    var tabs = document.querySelectorAll('.tab[data-p]');
    tabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-p') === p); });
    load();
  }

  function api(path) {
    return fetch('/api/reports/' + path + '?period=' + period, { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { if (r.status === 401) { logout(); throw new Error('401'); } return r.json(); });
  }

  function bars(containerId, rows, color, labelFn, valueFn, max) {
    var html = rows.map(function (x) {
      var pct = Math.max(4, (valueFn(x).raw / max) * 100);
      return '<div class="bar-row"><div class="bar-top"><span class="muted">' + labelFn(x) +
        '</span><span style="font-weight:600;">' + valueFn(x).text + '</span></div>' +
        '<div class="bar"><span style="width:' + pct + '%; background:' + color + ';"></span></div></div>';
    }).join('');
    document.getElementById(containerId).innerHTML = html || '<div class="muted">Ma\\'lumot yo\\'q</div>';
  }

  function load() {
    Promise.all([api('summary'), api('top-items'), api('waiters')]).then(function (res) {
      var s = res[0], top = res[1], w = res[2];
      document.getElementById('revenue').textContent = fmt(s.revenue);
      document.getElementById('ordersCount').textContent = s.ordersCount;
      document.getElementById('avgCheck').textContent = fmt(s.avgCheck);

      var totalPay = Math.max(1, (s.paymentBreakdown || []).reduce(function (a, p) { return a + p.amount; }, 0));
      var labelP = { naqd: 'Naqd', karta: 'Karta', qr: 'QR' };
      bars('payments', s.paymentBreakdown || [], '#059669',
        function (p) { return labelP[p.type] || p.type; },
        function (p) { return { raw: p.amount, text: fmt(p.amount) }; }, totalPay);

      var maxW = Math.max(1, ...(w.length ? w.map(function (x) { return x.revenue; }) : [1]));
      bars('waiters', w, '#8B5CF6',
        function (x) { return x.waiterName + ' · ' + x.ordersCount + ' ta'; },
        function (x) { return { raw: x.revenue, text: fmt(x.revenue) }; }, maxW);

      var maxT = Math.max(1, ...(top.length ? top.map(function (x) { return x.quantity; }) : [1]));
      bars('topItems', top, '#22C55E',
        function (x) { return x.name + ' · ' + x.quantity + ' ta'; },
        function (x) { return { raw: x.quantity, text: fmt(x.sum) }; }, maxT);
    }).catch(function () {});
  }
</script>
</body>
</html>`;
