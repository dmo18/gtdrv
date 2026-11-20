// Bundles the game into dist/ (index.html + game.js). With --serve it
// also starts a small local web server for testing.
import { build } from 'esbuild';
import { cp, mkdir, rm, readdir, readFile as read, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultDist = join(root, 'dist');

// Every file under dir, as paths relative to dir with forward slashes.
async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, base)));
    else out.push(p.slice(base.length + 1).split('\\').join('/'));
  }
  return out.sort();
}

// Writes dist/sw.js: the template in public/ with the list of files to
// keep offline and a version that changes whenever any of them changes.
async function writeServiceWorker(dist) {
  const files = (await walk(join(root, 'public'))).filter((f) => f !== 'sw.js');
  const all = ['index.html', 'game.js', ...files];
  const hash = createHash('sha256');
  for (const f of all) hash.update(f).update(await read(join(dist, f)));
  const list = ['./', ...all];
  const template = await read(join(root, 'public/sw.js'), 'utf8');
  const out = template.replace('__VERSION__', hash.digest('hex').slice(0, 12)).replace('const FILES = __FILES__;', `const FILES = ${JSON.stringify(list)};`);
  await writeFile(join(dist, 'sw.js'), out);
}

// outDir lets the Android wrapper build into a clean folder (build/web)
// instead of dist/, which test scripts also write screenshots into.
export async function buildGame({ minify = true, prod = minify, outDir = defaultDist } = {}) {
  const dist = outDir;
  await mkdir(dist, { recursive: true });
  await build({
    entryPoints: [join(root, 'src/main.js')],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    minify,
    sourcemap: false,
    outfile: join(dist, 'game.js'),
    define: { __PROD__: String(prod) },
    logLevel: 'warning',
  });
  await cp(join(root, 'src/index.html'), join(dist, 'index.html'));
  await cp(join(root, 'public'), dist, { recursive: true });
  await writeServiceWorker(dist);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css' };

export function serve(port = 8080, dir = defaultDist) {
  const server = createServer(async (req, res) => {
    try {
      let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (p.endsWith('/') || p === '\\') p = join(p, 'index.html');
      const file = join(dir, p);
      if (!file.startsWith(dir)) throw new Error('outside');
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = process.argv.indexOf('--out');
  const outDir = o > 0 ? resolve(process.argv[o + 1]) : defaultDist;
  if (process.argv.includes('--clean')) await rm(outDir, { recursive: true, force: true });
  await buildGame({ minify: !process.argv.includes('--serve'), outDir });
  if (process.argv.includes('--serve')) {
    await serve(8080);
    console.log('Rustwater running at http://localhost:8080');
  } else {
    console.log(`Built ${outDir}`);
  }
}
