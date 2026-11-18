import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['style.css', 'text/css; charset=utf-8'],
  ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['service-worker.js', 'text/javascript; charset=utf-8'],
  ...['app', 'engine', 'reference', 'coros', 'cross-training', 'pwa'].map((file) => [`src/${file}.mjs`, 'text/javascript; charset=utf-8']),
  ...['icon-192', 'icon-512', 'icon-maskable-512', 'apple-touch-icon'].map((file) => [`icons/${file}.png`, 'image/png']),
]);
const port = Number(process.env.SUB_T_PORT ?? 4173);
const prefix = process.env.SUB_T_PREVIEW_PREFIX ?? '';

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  const route = pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length + 1) : null;
  const name = route === '' ? 'index.html' : route;
  const type = files.get(name);
  if (!type) {
    response.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(new URL(`../${name}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(data);
  } catch {
    response.writeHead(500).end();
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}${prefix}/`));
