/* Local preview only: serves the static site and allows editing properties from the panel
   without a Supabase account. This file is never deployed (see .github/workflows/pages.yml). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PREVIEW_PORT || 4173);

const base = { status: 'published', featured: false, display_order: 0, created_at: new Date().toISOString(), price_display: 'total', entry_label: 'Entrada', region: 'Centro, Cascavel', photos: [] };
const sample = overrides => ({ ...base, ...overrides });

let properties = [
  sample({ id: 'a1', title: 'Residencial Mirante', category: 'Planta', code: 'PL-001', featured: true, price: 289000, bedrooms: 2, suites: 1, area: 62.4, parking: 1, display_order: 0,
    description: 'Apartamento na planta com entrega prevista para 2027, a poucos minutos do centro. Acabamento entregue e área de lazer completa.',
    features: { items: ['Piscina', 'Academia', 'Salão de festas'], floor_plans: [{ bedrooms: 2, suites: 1, area: 62.4 }, { bedrooms: 3, suites: 1, area: 78 }] },
    payment: 'Entrada facilitada e financiamento bancário.' }),
  sample({ id: 'a2', title: 'Casa Fácil Cohapar · Jardim Europa', category: 'Cohapar', code: 'CH-001', price_display: 'both', price: 235000, entry_price: 12000, entry_installments: 24, bedrooms: 3, area: 48.9, parking: 1, display_order: 1,
    description: 'Unidade enquadrada no programa Casa Fácil Paraná, com subsídio de até R$ 20 mil para quem atende aos requisitos.', features: { items: ['Casa Fácil Paraná', 'Área de lazer'] } }),
  sample({ id: 'a3', title: 'Loteamento Vale Verde', category: 'Lotes', code: 'LT-001', price_display: 'entry', entry_price: 35000, entry_installments: 36, area: 300, display_order: 2,
    description: 'Lotes com infraestrutura completa, a 8 minutos do centro. Documentação pronta para financiamento.', features: { items: ['Asfalto', 'Rede de água', 'Esgoto'] } }),
  sample({ id: 'a4', title: 'Apartamento Parque das Águas', category: 'Prontos', code: 'PR-001', status: 'reserved', price: 420000, bedrooms: 3, suites: 2, bathrooms: 2, area: 92, parking: 2, display_order: 3,
    description: 'Imóvel pronto para morar, reformado, com vista livre para o parque e duas vagas cobertas.' }),
  sample({ id: 'a5', title: 'Sobrado Residencial Aurora', category: 'Prontos', code: 'PR-002', status: 'sold', price: 690000, bedrooms: 4, suites: 2, bathrooms: 3, area: 168, parking: 2, display_order: 4,
    description: 'Sobrado em condomínio fechado com piscina privativa.' }),
];

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/preview-api/properties') {
    if (req.method === 'GET') return send(res, 200, properties);
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        try {
          const body = JSON.parse(raw || '{}');
          const index = properties.findIndex(item => String(item.id) === String(body.id));
          if (index >= 0) properties[index] = { ...properties[index], ...body };
          else properties.unshift({ ...base, ...body });
          send(res, 200, properties);
        } catch { send(res, 400, { error: 'invalid json' }); }
      });
      return;
    }
    if (req.method === 'DELETE') {
      properties = properties.filter(item => String(item.id) !== String(url.searchParams.get('id')));
      return send(res, 200, properties);
    }
  }
  const file = path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (error, data) => {
    if (error) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, types[path.extname(file)] || 'application/octet-stream');
  });
}).listen(port, () => console.log(`preview on http://localhost:${port}`));
