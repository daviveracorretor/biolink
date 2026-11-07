/* Visual check harness for the bio-link page.

   Serves the site with a mocked REST layer so every section (catalog, cards, modals,
   admin panel) can be reviewed with realistic data and a real photograph, without
   touching Supabase. Run it with the app's Node:

     PREVIEW_PORT=4300 "$ABACUSAI_BOT_NODE" tools/visual-check.js

   Then open http://localhost:4300/?local=1 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PREVIEW_PORT || 4300);
const properties = JSON.parse(readFileSync(path.join(root, 'tools', 'mock-properties.json'), 'utf8'))
  .map(item => ({ ...item, photos: Array.isArray(item.photos) ? item.photos : [] }));

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/preview-api/properties') return send(res, 200, properties);
  if (url.pathname === '/rest/v1/properties') return send(res, 200, properties);
  if (url.pathname.startsWith('/auth/v1/')) return send(res, 400, { message: 'mock' });
  const file = path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (error, data) => {
    if (error) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, types[path.extname(file)] || 'application/octet-stream');
  });
}).listen(port, () => console.log(`visual check on http://localhost:${port}/?local=1`));
