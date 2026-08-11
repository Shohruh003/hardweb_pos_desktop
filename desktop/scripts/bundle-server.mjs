// Serverni mustaqil paket qiladi (dist + prod node_modules + shared + node.exe),
// so'ng electron-builder uni ilovaga (extraResources) qo'shadi.
import { execSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktop = join(__dirname, '..');
const root = join(desktop, '..');
const serverSrc = join(root, 'server');
const sharedSrc = join(root, 'shared');
const bundle = join(desktop, '.server-bundle');
const runtime = join(desktop, '.runtime');

console.log('[bundle] server build (shared + nest)...');
execSync('npm run build', { cwd: serverSrc, stdio: 'inherit' });

console.log('[bundle] tozalash...');
rmSync(bundle, { recursive: true, force: true });
mkdirSync(bundle, { recursive: true });

console.log('[bundle] dist nusxalash...');
cpSync(join(serverSrc, 'dist'), join(bundle, 'dist'), { recursive: true });

// package.json — @hardweb-pos/* workspace bog'liqliklarini olib tashlaymiz (qo'lda nusxalaymiz)
const pkg = JSON.parse(readFileSync(join(serverSrc, 'package.json'), 'utf8'));
for (const d of Object.keys(pkg.dependencies || {})) {
  if (d.startsWith('@hardweb-pos/')) delete pkg.dependencies[d];
}
delete pkg.devDependencies;
pkg.scripts = { start: 'node dist/main.js' };
writeFileSync(join(bundle, 'package.json'), JSON.stringify(pkg, null, 2));

console.log('[bundle] prod dependencies (better-sqlite3 native)...');
execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', {
  cwd: bundle,
  stdio: 'inherit',
});

console.log('[bundle] shared nusxalash...');
const sharedDest = join(bundle, 'node_modules', '@hardweb-pos', 'shared');
mkdirSync(sharedDest, { recursive: true });
cpSync(join(sharedSrc, 'dist'), join(sharedDest, 'dist'), { recursive: true });
cpSync(join(sharedSrc, 'package.json'), join(sharedDest, 'package.json'));

console.log('[bundle] node.exe nusxalash...');
rmSync(runtime, { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });
const nodeExe = process.execPath; // tizim node.exe (better-sqlite3 prebuild shunga mos)
if (existsSync(nodeExe)) cpSync(nodeExe, join(runtime, 'node.exe'));

console.log('[bundle] tayyor:', bundle);
