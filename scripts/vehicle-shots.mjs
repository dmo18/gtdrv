// Renders vehicle line-ups and effect action shots in headless Chromium
// (SwiftShader) to check the vehicle models and effects by eye.
// Usage: node scripts/vehicle-shots.mjs [shotName ...]
// Output: dist/vehicle-shots/<shot>.png and triangle / draw-call stats.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = join(root, 'dist', 'vehicle-shots');
await mkdir(out, { recursive: true });
await build({
  entryPoints: [join(root, 'scripts', 'vehicle-shots-entry.js')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: join(out, 'harness.js'),
  logLevel: 'warning',
});
await writeFile(join(out, 'index.html'), '<!doctype html><html><body style="margin:0;background:#000"><canvas id="c" width="1280" height="720" style="width:1280px;height:720px"></canvas><script type="module" src="harness.js"></script></body></html>');

const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://x').pathname === '/harness.js' ? 'harness.js' : 'index.html';
    const data = await readFile(join(out, name));
    res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : 'text/html', 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => {
    failed = true;
    console.error('page error:', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error('console:', m.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const all = await page.evaluate(() => window.shotNames);
  const want = process.argv.slice(2).length ? process.argv.slice(2) : all;
  console.log('triangles per car:', JSON.stringify(await page.evaluate(() => window.stats())));
  for (const name of want) {
    const t0 = Date.now();
    const r = await page.evaluate((n) => window.shot(n), name);
    const file = join(out, name + '.png');
    await page.locator('#c').screenshot({ path: file });
    console.log(name, r ? JSON.stringify(r) : '', `${Date.now() - t0} ms ->`, file);
  }
} finally {
  await browser.close();
  server.close();
}
if (failed) process.exit(1);
