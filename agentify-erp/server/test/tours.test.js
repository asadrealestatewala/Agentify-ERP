import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Creative Studio: brand profile, brand story, post images, credits, safety, reports, tenant separation.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-creative-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const dbm = await import('../src/db.js');


import { TOURS, tourText } from '../../shared/help/tours.js';
import { GUIDES, searchKnowledge } from '../../shared/guides.js';

let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); dbm.closeDbs(); });
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    const ch = []; res.on('data', (c) => ch.push(c));
    res.on('end', () => { let d; try { d = JSON.parse(Buffer.concat(ch).toString()); } catch { d = null; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

const clientSrc = (() => {
  const out = []; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.jsx?$/.test(f.name)) out.push(fs.readFileSync(p, 'utf8')); } };
  walk(new URL('../../client/src', import.meta.url).pathname); return out.join('\n');
})();

test('every tour step points at a data-tour marker that exists in the client', () => {
  for (const [id, t] of Object.entries(TOURS)) {
    assert.ok(t.steps.length > 0, id);
    for (const s of t.steps) {
      assert.ok(s.title && s.text, `${id}/${s.target} needs a title and text`);
      assert.ok(clientSrc.includes(`data-tour="${s.target}"`), `${id}: no data-tour="${s.target}" in client/src`);
      assert.ok(!/console|super admin|platform admin/i.test(`${s.title} ${s.text}`), `${id}: tenant text mentions the console`);
    }
  }
});

test('every tour has a guide, and Ask can find the tour guide', () => {
  for (const [id, t] of Object.entries(TOURS)) assert.ok(GUIDES[t.guide], `${id}: guide ${t.guide} missing`);
  assert.ok(tourText('main').includes('Ask'));
  assert.equal(searchKnowledge('how do I take the tour').some((h) => JSON.stringify(h).includes('product-tour') || JSON.stringify(h).includes('tour')), true);
});

test('seen-the-tour is saved on the account and follows the person', async () => {
  const su = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug: 'tour', company_name: 'Tour Realty', admin_name: 'Owner', admin_email: 'owner@tour.test', admin_password: 'Tenant@12345', region: 'PK' });
  assert.equal(su.status, 201);
  const host = 'tour.erp.test';
  const l1 = await call(host, 'POST', '/api/auth/login', { identifier: 'owner@tour.test', password: 'Tenant@12345' });
  assert.deepEqual(l1.data.tour_seen, {});
  const put = await call(host, 'PUT', '/api/auth/tour', { tour: 'main' }, { cookie: l1.cookie });
  assert.equal(put.status, 200); assert.equal(put.data.tour_seen.main, TOURS.main.version);
  const l2 = await call(host, 'POST', '/api/auth/login', { identifier: 'owner@tour.test', password: 'Tenant@12345' }); // another device
  assert.equal(l2.data.tour_seen.main, TOURS.main.version);
  assert.equal((await call(host, 'PUT', '/api/auth/tour', { tour: 'nope' }, { cookie: l1.cookie })).status, 400);
  assert.equal((await call(host, 'PUT', '/api/auth/tour', { tour: 'main', seen: false }, { cookie: l1.cookie })).data.tour_seen.main, undefined);
  assert.equal((await call(host, 'PUT', '/api/auth/tour', { tour: 'main' })).status, 401);
});
