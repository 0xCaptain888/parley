import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes } from './site-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/site');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.zip': 'application/zip', '.png': 'image/png', '.svg': 'image/svg+xml', '.webm': 'video/webm' };
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (p === '/index.html') { res.writeHead(308, { Location: '/' }).end(); return; }
  const file = path.resolve(root, '.' + p);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const privatePath = p.split('/').some(part => part.startsWith('.'))
    || /^\/(?:resident|helper|node_modules)(?:\/|$)/.test(p);
  const stat = fs.existsSync(file) ? fs.statSync(file) : null;
  const route = routes.includes(p) || /^\/p\/[1-9]\d*$/.test(p);
  const found = !privatePath && (stat?.isFile() || route);
  const target = found ? stat?.isFile() ? file : path.join(root, 'index.html') : path.join(root, '404.html');
  res.writeHead(found ? 200 : 404, {
    'Content-Type': types[path.extname(target)] || 'application/octet-stream',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self' https: http://127.0.0.1:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  });
  fs.createReadStream(target).pipe(res);
});
server.listen(port, '127.0.0.1', () => console.log(`Parley: http://127.0.0.1:${port}`));
server.on('error', e => { console.error(e.message); process.exitCode = 1; });
