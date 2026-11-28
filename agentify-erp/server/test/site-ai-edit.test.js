import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-aiedit-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'test.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'), ERP_SECRETS_KEY: 'test-secrets-key-0123456789', LOGIN_LIMIT: '1000' });

const { createApp } = await import('../src/index.js');
const { get, run, uploadDir } = await import('../src/db.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const { platformDb } = await import('../src/platform.js');
const edit = await import('../src/services/siteAiEdit.js');
const claude = await import('../src/services/anthropicGateway.js');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let server, base, answer, seen = [];
const realFetch = globalThis.fetch;
before(() => new Promise((res) => {
  server = createApp().listen(0, () => {
    base = `http://localhost:${server.address().port}`;
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.startsWith(base)) return realFetch(url, opts);
      if (u.includes('open.er-api.com')) return new Response(JSON.stringify({ rates: { PKR: 281.5 } }), { status: 200 });
      if (u.startsWith('https://api.anthropic.com/v1/messages')) {
        const body = JSON.parse(opts.body); seen.push(body);
        return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(typeof answer === 'function' ? answer(body) : answer) }], usage: { input_tokens: 2000, output_tokens: 500 } }), { status: 200 });
      }
      if (u.includes(':generateContent')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }], usageMetadata: {} }), { status: 200 });
      throw new Error(`unexpected fetch ${u}`);
    };
    res();
  });
}));
after(() => { globalThis.fetch = realFetch; server.close(); });

async function client(identifier, password = 'Demo@12345') {
  const jar = {};
  const call = async (method, url, body) => {
    const r = await realFetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie: jar.c || '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  assert.equal((await call('POST', '/api/auth/login', { identifier, password })).status, 200);
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b) };
}
const homeSections = async (a) => { const list = (await a.get('/api/site-admin/pages')).data; const home = list.find((p) => p.slug === 'home'); return (await a.get(`/api/site-admin/pages/${home.id}`)).data; };
const aiRows = () => platformDb().prepare("SELECT * FROM ai_usage WHERE feature='website_ai' ORDER BY id").all();

test('without the platform Claude key the editor says it is not available', async () => {
  const a = await client('admin@expertdevelopers.pk');
  const st = (await a.get('/api/site-admin/ai-edit/status')).data;
  assert.equal(st.available, false);
  const page = await homeSections(a);
  const r = await a.post('/api/site-admin/ai-edit', { message: 'Make the hero friendlier', sections: page.sections, config: {} });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /not available/i);
  assert.equal(aiRows().length, 0, 'a call that never started is not logged');
});

test('a proposal is cleaned, previewed data only, metered and not saved', async () => {
  setSetting('anthropic_api_key', `sk-ant-${'x'.repeat(30)}`, { secret: true });
  const a = await client('admin@expertdevelopers.pk');
  assert.equal((await a.get('/api/site-admin/ai-edit/status')).data.available, true);
  const page = await homeSections(a);
  const hero = page.sections.find((s) => s.type === 'hero');
  const testi = page.sections.find((s) => s.type === 'testimonials');
  const before = JSON.stringify(page.sections);
  // a library picture the owner uploaded
  fs.mkdirSync(path.join(uploadDir(), 'media'), { recursive: true });
  fs.writeFileSync(path.join(uploadDir(), 'media', 'logo-test.png'), PNG);
  const logoId = Number(run("INSERT INTO media(entity_type,entity_id,kind,path,caption,sort_order,created_at) VALUES('site',0,'library','media/logo-test.png','my-logo.png',0,datetime('now'))").lastInsertRowid);
  answer = {
    summary: 'Friendlier hero, a FAQ and your logo.', notes: '',
    theme: { primary: '#ffeeaa', accent: '#e11d48', dark: '#10231f', font_heading: 'Poppins', font_body: 'Comic Sans' },
    brand: { name: 'Expert Developers', logo: `asset:${logoId}`, favicon: 'asset:99999' },
    ops: [
      { op: 'update', id: hero.id, props: { headline: 'Welcome home', cta_href: 'javascript:alert(1)', image: 'https://evil.example/x.png', height: 'huge' } },
      ...(testi ? [{ op: 'update', id: testi.id, props: { items: [{ name: 'Fake', quote: 'Great' }] } }] : []),
      { op: 'add', after: 'end', type: 'faq', props: { title: 'Questions', items: [{ q: 'How do I buy?', a: 'Call us.' }] } },
      { op: 'add', after: 'end', type: 'iframe', props: {} },
    ],
  };
  const r = await a.post('/api/site-admin/ai-edit', { message: 'Make the hero friendlier, add an FAQ and use my logo', mode: 'edit', page: { title: 'Home', slug: 'home' }, sections: page.sections, config: {}, asset_ids: [logoId] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const out = r.data;
  const h = out.sections.find((s) => s.id === hero.id);
  assert.equal(h.props.headline, 'Welcome home');
  assert.notEqual(h.props.cta_href, 'javascript:alert(1)', 'unsafe links are dropped');
  assert.notEqual(h.props.image, 'https://evil.example/x.png', 'a picture that is not the workspace\'s own is dropped');
  assert.notEqual(h.props.height, 'huge');
  assert.ok(out.sections.some((s) => s.type === 'faq'));
  assert.ok(!out.sections.some((s) => s.type === 'iframe'));
  if (testi) assert.deepEqual(out.sections.find((s) => s.id === testi.id), testi, 'testimonials are never written by the AI');
  assert.equal(out.config_patch.theme.primary, undefined, 'a light main colour that white text cannot sit on is refused');
  assert.equal(out.config_patch.theme.accent, '#e11d48');
  assert.equal(out.config_patch.theme.dark, '#10231f');
  assert.equal(out.config_patch.theme.font_heading, 'Poppins');
  assert.equal(out.config_patch.theme.font_body, undefined, 'unknown fonts are dropped');
  assert.equal(out.config_patch.brand.logo, 'media/logo-test.png');
  assert.equal(out.config_patch.brand.favicon, undefined);
  assert.ok(out.notes.some((n) => /favicon/.test(n)) && out.notes.some((n) => /main colour/.test(n)));
  assert.equal(out.credits_used, 1);
  // the first message carries the picture the owner chose, as a vision block
  const last = seen.at(-1).messages.at(-1).content;
  assert.ok(last.some((b) => b.type === 'image'), 'the attached logo is shown to Claude');
  assert.equal(seen.at(-1).model, 'claude-sonnet-5-5');
  // nothing was saved
  const after = (await homeSections(a)).sections;
  assert.equal(JSON.stringify(after), before);
  // metered in the platform ledger with a dollar cost
  const row = aiRows().at(-1);
  assert.equal(row.provider, 'anthropic'); assert.equal(row.credits, 1); assert.equal(row.input_tokens, 2000);
  assert.ok(Math.abs(row.usd - (2000 / 1e6) * 2 - (500 / 1e6) * 10) < 1e-9);
});

test('facts are only taken from what the owner wrote, and a redesign uses the stronger model', async () => {
  const a = await client('admin@expertdevelopers.pk');
  const page = await homeSections(a);
  answer = { summary: 'Done', ops: [{ op: 'add', after: 'start', type: 'stats', props: { items: [{ value: '25 years', label: 'In business' }, { value: '9999+', label: 'Invented' }] } }] };
  const r = await a.post('/api/site-admin/ai-edit', { message: 'Add a numbers block saying we have 25 years in business', mode: 'redesign', page: { title: 'Home', slug: 'home' }, sections: page.sections, config: {} });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const stats = r.data.sections[0];
  assert.equal(stats.type, 'stats');
  assert.deepEqual(stats.props.items.map((i) => i.value), ['25 years'], 'an invented number is dropped');
  assert.equal(seen.at(-1).model, 'claude-opus-5-5');
  assert.equal(r.data.credits_used, 3);
});

test('new pictures are created into the library only when allowed, and cost credits', async () => {
  setSetting('platform_gemini_key', `AIza${'x'.repeat(35)}`, { secret: true });
  const a = await client('admin@expertdevelopers.pk');
  const page = await homeSections(a);
  const hero = page.sections.find((s) => s.type === 'hero');
  answer = { summary: 'New hero picture', ops: [{ op: 'update', id: hero.id, props: { image: 'gen:h1' } }], images: [{ key: 'h1', prompt: 'A modern house at sunset', aspect: 'landscape' }] };
  const off = await a.post('/api/site-admin/ai-edit', { message: 'Create a hero picture of a house', page: {}, sections: page.sections, config: {}, allow_images: false });
  assert.equal(off.status, 200);
  assert.equal(off.data.sections.find((s) => s.id === hero.id).props.image, hero.props.image, 'no picture without the tick box');
  const on = await a.post('/api/site-admin/ai-edit', { message: 'Create a hero picture of a house', page: {}, sections: page.sections, config: {}, allow_images: true });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  const img = on.data.sections.find((s) => s.id === hero.id).props.image;
  assert.match(img, /^media\/[0-9a-f]{32}\.png$/);
  assert.ok(fs.existsSync(path.join(uploadDir(), img)));
  assert.ok(get("SELECT 1 FROM media WHERE entity_type='site' AND path=?", img));
  assert.equal(on.data.credits_used, 1 + 3);
  assert.ok(on.data.changes.some((c) => /Created 1 new picture/.test(c)));
});

test('the favicon is a checked image setting', async () => {
  const a = await client('admin@expertdevelopers.pk');
  const cfg = (await a.get('/api/site-admin/config')).data;
  const bad = await a.put('/api/site-admin/config', { ...cfg, brand: { ...cfg.brand, favicon: 'javascript:alert(1)' } });
  assert.equal(bad.status, 400);
  const ok = await a.put('/api/site-admin/config', { ...cfg, brand: { ...cfg.brand, favicon: 'media/logo-test.png' } });
  assert.equal(ok.status, 200);
});

test('the key is stored encrypted and the console view only shows a hint', () => {
  const v = claude.anthropicStatus();
  assert.equal(v.key_added, true);
  assert.match(v.key_hint, /^…x{4}$/);
  assert.equal(JSON.stringify(v).includes('sk-ant'), false);
  assert.ok(edit.contrastOnWhite('#000000') > 20 && edit.contrastOnWhite('#ffffff') < 1.1);
});
