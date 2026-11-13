// Serverni mustaqil paket qiladi (dist + prod node_modules + shared + node.exe),
// so'ng electron-builder uni ilovaga (extraResources) qo'shadi.
//
// Natija (desktop/ ichida, git'ga kirmaydi):
//   .server-bundle/dist/**                      — nest build natijasi
//   .server-bundle/package.json                 — server bog'liqliklari (versiyalar sinalgan holatga qotirilgan)
//   .server-bundle/node_modules/**              — prod bog'liqliklar + @hardweb-pos/shared (dist)
//   .runtime/node.exe                           — serverni ishga tushiradigan Node (better-sqlite3 ABI'siga mos)
//
// MUHIM: electron-builder har bir FileSet'ning ILDIZIDAGI node_modules papkasini tashlab yuboradi
// (app-builder-lib/out/util/filter.js). Shuning uchun electron-builder.real.json'da
// ".server-bundle/node_modules" -> "server/node_modules" alohida yozilgan. Uni olib tashlamang!
//
// Har bir qadam xato bersa — skript darhol to'xtaydi (exit 1) va `npm run dist` zanjiri uziladi:
// chala paket bilan installer yaratilmaydi.
import { execFileSync, execSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktop = join(__dirname, '..');
const root = join(desktop, '..');
const serverSrc = join(root, 'server');
const sharedSrc = join(root, 'shared');
const bundle = join(desktop, '.server-bundle');
const runtime = join(desktop, '.runtime');
const runtimeNode = join(runtime, 'node.exe');

/** Aniq xabar bilan to'xtash — `npm run dist` zanjiri shu yerda uziladi */
function fail(message) {
  console.error('');
  console.error('[bundle] XATO: ' + message);
  console.error('[bundle] Server paketi YIG‘ILMADI — installer yaratmang.');
  process.exit(1);
}

/** Buyruqni ishga tushiradi; nol bo'lmagan kod bilan tugasa — fail() */
function run(title, command, cwd) {
  console.log(`[bundle] ${title}...`);
  try {
    execSync(command, { cwd, stdio: 'inherit' });
  } catch (e) {
    fail(`"${title}" muvaffaqiyatsiz (kod ${e?.status ?? '?'}): ${command}`);
  }
}

/** Fayl/papka bo'lishi shart — bo'lmasa fail() */
function mustExist(path, what) {
  if (!existsSync(path)) fail(`${what} topilmadi: ${path}`);
}

// 0) Muhit: kassa va monobloklar — Windows 10 x64. node.exe shu Node'dan nusxalanadi,
//    better-sqlite3 ham shu Node uchun o'rnatiladi — boshqa platformada yig'ish noto'g'ri paket beradi.
if (process.platform !== 'win32' || process.arch !== 'x64') {
  fail(`server paketi faqat Windows x64 Node bilan yig‘iladi (hozir: ${process.platform}/${process.arch})`);
}
console.log(`[bundle] Node ${process.version} (ABI ${process.versions.modules}), ${process.execPath}`);

// 1) shared — server shared/dist'ni ishlatadi: avval uni yangilaymiz (eski dist bilan paket chiqmasin)
run('shared build (tsc)', 'npm run build:shared', root);
mustExist(join(sharedSrc, 'dist', 'index.js'), 'shared/dist/index.js');

// 2) server — nest build (dist avval tozalanadi: nest-cli deleteOutDir)
run('server build (nest)', 'npm run build', serverSrc);
mustExist(join(serverSrc, 'dist', 'main.js'), 'server/dist/main.js');

console.log('[bundle] tozalash...');
rmSync(bundle, { recursive: true, force: true });
mkdirSync(bundle, { recursive: true });

console.log('[bundle] dist nusxalash...');
cpSync(join(serverSrc, 'dist'), join(bundle, 'dist'), { recursive: true });

// 3) package.json — @hardweb-pos/* workspace bog'liqliklarini olib tashlaymiz (qo'lda nusxalaymiz).
//    Lockfile yo'q, shuning uchun to'g'ridan-to'g'ri bog'liqliklarni repo'da o'rnatilgan (sinalgan)
//    versiyaga qotiramiz — aks holda har build registry'dan yangi versiya olib kelishi mumkin.
//    O'rnatilgan versiya server diapazoniga mos kelmasa (boshqa workspace'niki bo'lsa) — diapazon qoladi.
let satisfies = null;
try {
  satisfies = createRequire(join(root, 'package.json'))('semver').satisfies;
} catch {
  console.warn('[bundle] ogohlantirish: semver topilmadi — versiyalar qotirilmaydi (diapazonlar ishlatiladi)');
}
const pkg = JSON.parse(readFileSync(join(serverSrc, 'package.json'), 'utf8'));
for (const [d, range] of Object.entries(pkg.dependencies || {})) {
  if (d.startsWith('@hardweb-pos/')) {
    delete pkg.dependencies[d];
    continue;
  }
  const installed = [join(serverSrc, 'node_modules', d, 'package.json'), join(root, 'node_modules', d, 'package.json')].find(
    (p) => existsSync(p),
  );
  const version = installed ? JSON.parse(readFileSync(installed, 'utf8')).version : null;
  if (version && satisfies && satisfies(version, range)) {
    pkg.dependencies[d] = version;
  } else if (satisfies) {
    console.warn(`[bundle] ogohlantirish: ${d} — repo'dagi versiya (${version ?? 'yo‘q'}) "${range}" ga mos emas, diapazon ishlatiladi`);
  }
}
delete pkg.devDependencies;
pkg.scripts = { start: 'node dist/main.js' };
writeFileSync(join(bundle, 'package.json'), JSON.stringify(pkg, null, 2));
console.log('[bundle] bog‘liqliklar:', Object.entries(pkg.dependencies).map(([k, v]) => `${k}@${v}`).join(', '));

// 4) prod bog'liqliklar (better-sqlite3 native — joriy Node uchun prebuild yuklanadi)
run('prod dependencies (npm install --omit=dev)', 'npm install --omit=dev --no-audit --no-fund --loglevel=error', bundle);

console.log('[bundle] shared nusxalash...');
const sharedDest = join(bundle, 'node_modules', '@hardweb-pos', 'shared');
mkdirSync(sharedDest, { recursive: true });
cpSync(join(sharedSrc, 'dist'), join(sharedDest, 'dist'), { recursive: true });
cpSync(join(sharedSrc, 'package.json'), join(sharedDest, 'package.json'));

// 5) node.exe — serverni ishga tushiradigan runtime (better-sqlite3 shu Node ABI'si uchun o'rnatildi)
console.log('[bundle] node.exe nusxalash...');
rmSync(runtime, { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });
mustExist(process.execPath, 'joriy node.exe');
cpSync(process.execPath, runtimeNode);

// 6) Tekshiruv — paketda hamma narsa borligi va u REPO'SIZ ishlashi.
//    Avval shu bug bo'lgan: paketda node_modules yo'q edi, lekin repo ichidan ishga tushirilganda
//    Node yuqoridagi repo node_modules'idan topib olardi. Shuning uchun quyidagi tekshiruvda modul
//    qidirish faqat .server-bundle ichi bilan cheklanadi.
console.log('[bundle] tekshiruv...');
const required = [
  join(bundle, 'dist', 'main.js'),
  join(bundle, 'node_modules', 'reflect-metadata', 'package.json'),
  join(bundle, 'node_modules', '@nestjs', 'core', 'package.json'),
  join(bundle, 'node_modules', 'typeorm', 'package.json'),
  join(bundle, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  join(bundle, 'node_modules', '@hardweb-pos', 'shared', 'dist', 'index.js'),
  join(bundle, 'node_modules', '@hardweb-pos', 'shared', 'package.json'),
  runtimeNode,
];
for (const d of Object.keys(pkg.dependencies)) required.push(join(bundle, 'node_modules', d, 'package.json'));
for (const p of required) mustExist(p, 'paket fayli');

// Bundled node.exe bilan: native better-sqlite3 yuklanadi va so'rov bajaradi, keyin butun server
// moduli (dist/app.module.js — barcha controller/service/entity'lar) talab qilinadi. Server ko'tarilmaydi,
// bazaga ulanilmaydi. Server kodida server/package.json'da yo'q (faqat repo ildizida "hoist" bo'lgan)
// paket ishlatilgan bo'lsa — shu yerda ushlanadi.
const checkScript = `
const Module = require('module');
const path = require('path');
const base = path.resolve(process.cwd()).toLowerCase() + path.sep;
const orig = Module._nodeModulePaths;
Module._nodeModulePaths = function (from) {
  return orig.call(this, from).filter((p) => p.toLowerCase().startsWith(base));
};
const req = Module.createRequire(path.join(process.cwd(), 'dist', 'main.js'));
req('reflect-metadata');
const Database = req('better-sqlite3');
const db = new Database(':memory:');
const row = db.prepare('select 41 + 1 as x').get();
db.close();
if (!row || row.x !== 42) throw new Error('better-sqlite3 noto‘g‘ri javob berdi');
req('@hardweb-pos/shared');
req('./app.module');
console.log('[bundle] tekshiruv OK: node ' + process.version + ', ABI ' + process.versions.modules + ', better-sqlite3 + server modullari yuklandi');
process.exit(0);
`;
try {
  execFileSync(runtimeNode, ['-e', checkScript], {
    cwd: bundle,
    stdio: 'inherit',
    timeout: 120000,
    env: { ...process.env, NODE_PATH: '' },
  });
} catch (e) {
  fail(
    'paket bundled node.exe bilan yuklanmadi (yetishmayotgan modul yoki better-sqlite3 ABI mos emas). ' +
      'Yuqoridagi xabarni ko‘ring. ' +
      (e?.status != null ? `kod ${e.status}` : String(e?.message ?? e)),
  );
}

console.log('[bundle] tayyor:', bundle);
