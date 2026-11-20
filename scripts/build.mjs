// Bundles the game into dist/ (index.html + game.js). With --serve it
// also starts a small local web server for testing.
import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');

export async function buildGame({ minify = true } = {}) {
  await mkdir(dist, { recursive: true });
  await build({
    entryPoints: [join(root, 'src/main.js')],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    minify,
    sourcemap: false,
    outfile: join(dist, 'game.js'),
    logLevel: 'warning',
  });
  await cp(join(root, 'src/index.html'), join(dist, 'index.html'));
  await cp(join(root, 'src/static'), dist, { recursive: true });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function serve(port = 8080) {
  const server = createServer(async (req, res) => {
    try {
      let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (p.endsWith('/') || p === '\\') p = join(p, 'index.html');
      const file = join(dist, p);
      if (!file.startsWith(dist)) throw new Error('outside');
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
  await buildGame({ minify: !process.argv.includes('--serve') });
  if (process.argv.includes('--serve')) {
    await serve(8080);
    console.log('Rustwater running at http://localhost:8080');
  } else {
    console.log('Built dist/');
  }
}
