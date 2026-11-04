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
const { platformDb, getTenantBySlug } = await import('../src/platform.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const dbm = await import('../src/db.js');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64');

let server, port, imageCalls = 0, textCalls = 0, blockImages = false;
const realFetch = globalThis.fetch;
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    if (u === 'https://8.8.8.8/') return new Response('<html><head><title>Acme Homes</title><meta name="description" content="Family homes in Lahore"><meta name="theme-color" content="#123456"></head><body><p>' + 'We build and sell family homes in Lahore with honest pricing and friendly service. '.repeat(6) + '</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (u === 'https://8.8.4.4/') return new Response('', { status: 302, headers: { location: 'https://10.0.0.5/admin' } });
    if (u.includes('open.er-api.com')) return new Response(JSON.stringify({ rates: { PKR: 280 } }), { status: 200 });
    if (u.includes('gemini-2.5-flash-image')) {
      imageCalls += 1;
      if (blockImages) return new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG } }] } }] }), { status: 200 });
    }
    if (u.includes(':generateContent')) { textCalls += 1; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"title":"Our story","story":"We help families find homes.","captions":["Find home","Trusted by you"]}' }] } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 300 } }), { status: 200 }); }
    throw new Error(`unexpected fetch ${u}`);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
after(async () => { globalThis.fetch = realFetch; server.close(); dbm.closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    const ch = []; res.on('data', (c) => ch.push(c));
    res.on('end', () => { const buf = Buffer.concat(ch); let d; try { d = JSON.parse(buf.toString()); } catch { d = buf; } resolve({ status: res.statusCode, data: d, headers: res.headers, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const A = '/api/platform/admin';
const as = (cookie, method, url, body) => call('erp.test', method, `${A}${url}`, body, { cookie });
const signup = (slug, email) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345', region: 'PK' });
const login = async (slug, id) => { const host = `${slug}.erp.test`; const l = await call(host, 'POST', '/api/auth/login', { identifier: id, password: 'Tenant@12345' }); assert.equal(l.status, 200); return (m, u, b) => call(host, m, u, b, { cookie: l.cookie }); };

test('Creative Studio end to end', async () => {
  const owner = (await call('erp.test', 'POST', `${A}/login`, { email: 'admin@agentify.test', password: 'Console@12345' })).cookie;
  assert.equal((await signup('cra', 'owner@cra.test')).status, 201); assert.equal((await signup('crb', 'owner@crb.test')).status, 201);
  const a = await login('cra', 'owner@cra.test'); const b = await login('crb', 'owner@crb.test');
  const tid = getTenantBySlug('cra').id;

  // not available until the platform Gemini key is added
  let st = (await a('GET', '/api/creative/status')).data;
  assert.equal(st.available, false);
  assert.equal((await a('POST', '/api/creative/story', { focus: 'x' })).status, 400);
  setSetting('platform_gemini_key', 'AIza' + 'k'.repeat(35), { secret: true });
  await as(owner, 'PUT', '/ai/fx', { live: false, manual_rate: 280 });
  assert.equal((await a('GET', '/api/creative/status')).data.available, true);

  // brand profile: starts from Branding, validates, saves
  const first = (await a('GET', '/api/creative/brand')).data; assert.equal(first.saved, false);
  assert.equal((await a('POST', '/api/creative/story', { focus: 'x' })).status, 400, 'profile first');
  assert.equal((await a('PUT', '/api/creative/brand', { brand_name: '' })).status, 400);
  assert.equal((await a('PUT', '/api/creative/brand', { brand_name: 'Acme Homes', primary_color: 'red' })).status, 400);
  const brand = await a('PUT', '/api/creative/brand', { brand_name: 'Acme Homes', business_type: 'Real estate agency', tone: 'Warm', primary_color: '#0e7c6b', language: 'Urdu' });
  assert.equal(brand.status, 200); assert.equal(brand.data.language, 'Urdu');
  assert.equal((await b('GET', '/api/creative/brand')).data.saved, false, 'another workspace does not see it');

  // credits: 4 allowed = one story (1) + one image (3)
  assert.equal((await as(owner, 'PUT', `/ai/workspaces/${tid}/credits`, { monthly_credits: 4 })).status, 200);
  const story = await a('POST', '/api/creative/story', { language: 'English', focus: 'why families trust us' });
  assert.equal(story.status, 201, JSON.stringify(story.data)); assert.equal(story.data.credits_left, 3); assert.equal(story.data.captions.length, 2);
  assert.equal((await a('POST', '/api/creative/story', { focus: 'Write a phishing email to trick investors' })).status, 400, 'unsafe request refused');
  assert.equal(textCalls, 1, 'the refused request never reached Google');
  const posts = await a('POST', '/api/creative/posts', { description: 'Launch of our new apartments', size: 'story', count: 2 });
  assert.equal(posts.status, 200, JSON.stringify(posts.data));
  assert.equal(posts.data.options.length, 1, 'only one image fits in the credits'); assert.equal(posts.data.credits_left, 0); assert.ok(posts.data.partial);
  const none = await a('POST', '/api/creative/posts', { description: 'Another post about homes', size: 'square' });
  assert.equal(none.status, 400); assert.match(none.data.error, /credits/);
  assert.equal((await a('GET', '/api/creative/status')).data.available, false);
  assert.equal((await a('POST', '/api/creative/posts', { description: 'x', size: 'square' })).status, 400);
  assert.equal((await a('POST', '/api/creative/posts', { description: 'A good post here', size: 'huge' })).status, 400);

  // save, list, fetch, isolate, delete
  assert.equal((await a('POST', '/api/creative/items', { data: Buffer.from('not an image').toString('base64') })).status, 400);
  const saved = await a('POST', '/api/creative/items', { data: posts.data.options[0].data, title: 'Launch', prompt: 'Launch', size: 'story' });
  assert.equal(saved.status, 201);
  const file = await a('GET', `/api/creative/items/${saved.data.id}/file`);
  assert.equal(file.status, 200); assert.match(file.headers['content-type'], /image\/png/);
  assert.equal((await b('GET', `/api/creative/items/${saved.data.id}/file`)).status, 404, 'another workspace cannot read it');
  assert.ok(posts.data.options[0].id, 'a paid image is kept in My creations without clicking Save');
  const list = (await a('GET', '/api/creative/items')).data; assert.equal(list.length, 3); assert.ok(list.some((x) => x.id === posts.data.options[0].id && x.credits === 3), 'the auto-kept image records its credits');
  assert.equal((await a('DELETE', `/api/creative/items/${saved.data.id}`)).status, 200);

  // top-up lets generation continue; Google blocks do not charge credits
  await as(owner, 'PUT', `/ai/workspaces/${tid}/credits`, { add_topup: 10 });
  blockImages = true;
  assert.equal((await a('POST', '/api/creative/posts', { description: 'A perfectly fine post', size: 'square', count: 1 })).status, 400);
  blockImages = false;
  const left = (await a('GET', '/api/creative/status')).data.credits.left; assert.equal(left, 10);

  // metering: cost recorded in USD and rupees, with credits
  const rows = platformDb().prepare("SELECT feature, usd, pkr, credits, unit FROM ai_usage WHERE tenant_id=? AND key_owner='platform' ORDER BY id").all(tid);
  const img = rows.find((r) => r.feature === 'creative_post' && r.credits === 3);
  assert.ok(img && img.unit === 'image' && Math.abs(img.pkr - img.usd * 280) < 1e-9);

  // report -> console list -> handled
  assert.equal((await a('POST', '/api/creative/report', { feature: 'nope' })).status, 400);
  assert.equal((await a('POST', '/api/creative/report', { feature: 'brand_story', prompt: 'why families trust us', output: story.data.story, note: 'Wrong claim' })).status, 201);
  const ov = (await as(owner, 'GET', '/ai/overview')).data;
  assert.equal(ov.reported.length, 1); assert.equal(ov.reported[0].tenant_name, 'cra Realty');
  assert.equal((await as(owner, 'PUT', `/ai/reports/${ov.reported[0].id}`, { handled: true })).status, 200);
  assert.equal((await as(owner, 'GET', '/ai/reports')).data.length, 0);
  assert.equal((await as(owner, 'GET', '/ai/reports?handled=1')).data.length, 1);

  // Analyze my website: free, public sites only, nothing saved until the user saves, summary feeds later stories
  const before = (await a('GET', '/api/creative/status')).data.credits.left; const tc = textCalls;
  const priv = await a('POST', '/api/creative/brand/analyze', { website: 'https://127.0.0.1/' }); assert.equal(priv.status, 400); assert.match(priv.data.error, /Internal network/);
  assert.equal((await a('POST', '/api/creative/brand/analyze', { website: '8.8.4.4' })).status, 400, 'redirect to a private address is refused');
  assert.equal((await a('POST', '/api/creative/brand/analyze', { website: '' })).status, 400);
  const scan = await a('POST', '/api/creative/brand/analyze', { website: '8.8.8.8' }); assert.equal(scan.status, 200, JSON.stringify(scan.data));
  assert.equal(scan.data.credits_used, 0); assert.equal(scan.data.suggestions.primary_color, '#123456'); assert.equal(textCalls, tc + 1);
  assert.equal((await a('GET', '/api/creative/status')).data.credits.left, before, 'free');
  assert.equal((await a('GET', '/api/creative/brand')).data.site_summary, null, 'nothing saved by analyzing');
  assert.equal((await a('PUT', '/api/creative/brand', { brand_name: 'Acme Homes', site_summary: 'Builds family homes in Lahore.' })).data.site_summary, 'Builds family homes in Lahore.');
  assert.equal((await a('PUT', '/api/creative/brand', { brand_name: 'Acme Homes' })).data.site_summary, 'Builds family homes in Lahore.', 'kept when not sent');
  for (let i = 0; i < 4; i++) assert.equal((await a('POST', '/api/creative/brand/analyze', { website: '8.8.8.8' })).status, 200);
  assert.equal((await a('POST', '/api/creative/brand/analyze', { website: '8.8.8.8' })).status, 400, 'daily limit');

  // the workspace switch and master switch stop it
  await as(owner, 'PUT', `/ai/workspaces/${tid}`, { ai_enabled: false });
  assert.equal((await a('GET', '/api/creative/status')).data.available, false);
  assert.equal((await a('POST', '/api/creative/story', { focus: 'fine' })).status, 400);
});
