// Pakistan regression snapshots. The demo data and the clock are frozen, a fixed list of money-bearing API outputs is
// hashed, and the hashes are compared with test/golden/pk.json, which was recorded BEFORE the multi-region refactor.
// Any change in a Pakistan figure, label or format changes a hash and fails this test.
//   UPDATE_GOLDEN=1 npm test -- test/pk-golden.test.js   re-records (only for an intended, reviewed change)
//   GOLDEN_DUMP=<dir>                                     also writes every body there, to diff a failure
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ERP_FIXED_NOW = '2026-06-15 10:00:00';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-golden-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'golden.db');
process.env.LOGIN_LIMIT = '1000';
delete process.env.ERP_BASE_DOMAIN;

const { createApp } = await import('../src/index.js');
let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

const GOLDEN = new URL('./golden/pk.json', import.meta.url);
const VOLATILE = /(days_overdue|^overdue$|token|hash|secret|api_key|qr_|password|^created_at$|^updated_at$|last_login)/i;
const scrub = (v) => {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter((k) => !VOLATILE.test(k)).map((k) => [k, scrub(v[k])]));
  return v;
};
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

async function client(identifier, password = 'Demo@12345', portal = false) {
  let cookie = '';
  const call = async (url) => {
    const r = await fetch(base + url, { headers: { 'X-Requested-With': 'ERP', cookie } });
    const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
    return { status: r.status, data: d };
  };
  const l = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' }, body: JSON.stringify({ identifier, password, portal }) });
  cookie = (l.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, `login ${identifier}`);
  return call;
}

const STAFF = ['/api/sales?limit=200', '/api/receipts?limit=200', '/api/installments?limit=200', '/api/receivables', '/api/commissions?limit=200', '/api/customers?limit=200',
  '/api/accounting/trial-balance', '/api/accounting/income-statement', '/api/accounting/balance-sheet', '/api/accounting/treasury', '/api/accounting/expenses?limit=200', '/api/accounting/credit-book',
  '/api/accounting/accounts', '/api/accounting/journals?limit=200', '/api/properties?limit=200', '/api/projects', '/api/hrm/payroll', '/api/reports/sales-by-agent', '/api/reports/commission',
  '/api/settings/system', '/api/auth/brand'];

test('Pakistan outputs are identical to the recorded snapshot', async () => {
  const api = await client('admin@expertdevelopers.pk');
  const paths = [...STAFF];
  const sales = (await api('/api/sales?limit=200')).data.rows || [];
  for (const s of sales.slice(0, 6)) paths.push(`/api/sales/${s.id}`, `/api/customers/${s.contact_id}/statement`);
  const receipts = (await api('/api/receipts?limit=200')).data.rows || [];
  for (const r of receipts.slice(0, 4)) paths.push(`/api/receipts/${r.id}`);
  const exps = (await api('/api/accounting/expenses?limit=200')).data.rows || [];
  for (const e of exps.slice(0, 4)) paths.push(`/api/accounting/expenses/${e.id}`);
  const portal = await client('m.ali@example.com', 'Demo@12345', true);
  const portalPaths = ['/api/portal/dashboard', '/api/portal/payments', '/api/portal/ledger'];
  const out = {};
  const dump = process.env.GOLDEN_DUMP;
  if (dump) fs.mkdirSync(dump, { recursive: true });
  for (const [who, list] of [[api, paths], [portal, portalPaths]]) {
    for (const p of list) {
      const r = await who(p);
      const body = typeof r.data === 'string' ? r.data : JSON.stringify(scrub(r.data));
      out[p] = { status: r.status, sha: sha(body), bytes: body.length };
      if (dump) fs.writeFileSync(path.join(dump, p.replace(/[^a-z0-9]+/gi, '_').slice(0, 120) + '.json'), body);
    }
  }
  assert.ok(Object.keys(out).length > 25, 'enough endpoints recorded');
  assert.ok(Object.values(out).filter((o) => o.status === 200).length > 25, 'most endpoints answer');
  if (process.env.UPDATE_GOLDEN === '1') { fs.writeFileSync(GOLDEN, JSON.stringify(out, null, 1)); return; }
  const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const diff = Object.keys({ ...want, ...out }).filter((k) => JSON.stringify(want[k]) !== JSON.stringify(out[k]));
  assert.deepEqual(diff, [], `Pakistan output changed for: ${diff.join(', ')}`);
});
