import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-themes-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { get, all } = await import('../src/db.js');
const { SITE_THEMES, THEME_BUILD_KEYS, themeById } = await import('../../shared/siteThemes.js');
const { DEMO_PHOTOS, DEMO_NAMED } = await import('../../client/src/site/demoContent.js');
const { SECTION_TYPE_NAMES } = await import('../../shared/sectionTypes.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function admin() {
  const jar = {};
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'X-Requested-With': 'ERP', 'Content-Type': 'application/json', cookie: jar.c || '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  assert.equal((await call('POST', '/api/auth/login', { identifier: 'admin@expertdevelopers.pk', password: 'Demo@12345' })).status, 200);
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b) };
}
const anon = async (u) => (await fetch(base + u, { headers: { 'X-Requested-With': 'ERP' } })).json();
// what the editor sends for a workspace without listing photos: each theme block as a section, pictures from the sample photos
// (the editor also merges the block defaults)
const sectionsOf = (theme, slug) => theme.pages.find((p) => p.slug === slug).blocks.map((b, i) => {
  const props = Object.fromEntries(Object.entries(b.props).filter(([k]) => !THEME_BUILD_KEYS.includes(k)));
  if (b.props.photo !== undefined && ['hero', 'imagetext', 'cta'].includes(b.type)) props.image = DEMO_NAMED[b.props.demo] || DEMO_PHOTOS[b.props.photo % DEMO_PHOTOS.length];
  if (b.type === 'gallery') props.images = DEMO_PHOTOS.map((src) => ({ src, caption: '' }));
  return { id: `${theme.id}-${slug}-${i}`, type: b.type, props };
});

test('every theme uses only known blocks, has a home page and a valid design', () => {
  assert.ok(SITE_THEMES.length >= 4);
  for (const t of SITE_THEMES) {
    assert.ok(t.pages.some((p) => p.slug === 'home'), `${t.id} has a home page`);
    for (const p of t.pages) for (const b of p.blocks) assert.ok(SECTION_TYPE_NAMES.includes(b.type), `${t.id}/${p.slug}: ${b.type}`);
    assert.match(t.design.theme.primary, /^#[0-9a-f]{6}$/i);
    assert.ok(['light', 'dark', 'transparent'].includes(t.design.header.style));
  }
});

test('sample photos ship with the app and every named sample a theme asks for exists', () => {
  for (const src of [...DEMO_PHOTOS, ...Object.values(DEMO_NAMED)]) {
    assert.match(src, /^\/site\/[\w.-]+$/); // the page validator accepts /site/<file>
    assert.ok(fs.statSync(new URL(`../../client/public${src}`, import.meta.url)).size > 1000, src);
  }
  for (const t of SITE_THEMES) for (const p of t.pages) for (const b of p.blocks) if (b.props.demo) assert.ok(DEMO_NAMED[b.props.demo], `${t.id}/${p.slug}: ${b.props.demo}`);
});

test('installing a theme is a draft: replaced pages keep their old layout in history, taken addresses get a hidden copy', async () => {
  const a = await admin();
  const skyline = SITE_THEMES.find((t) => t.id === 'skyline');
  const home = get("SELECT * FROM site_pages WHERE slug='home'");
  const liveBefore = JSON.stringify((await anon('/api/site/pages/home')).sections);
  const list = (await a.get('/api/site-admin/themes')).data;
  assert.equal(list.themes.length, SITE_THEMES.length);
  const about = list.themes.find((t) => t.id === 'skyline').pages.find((p) => p.slug === 'about');

  // refusals change nothing
  assert.equal((await a.post('/api/site-admin/themes/nope/install', { design: true, pages: [] })).status, 404);
  assert.equal((await a.post('/api/site-admin/themes/skyline/install', { pages: [{ slug: 'pricing', mode: 'add', sections: [] }] })).status, 400);
  assert.equal((await a.post('/api/site-admin/themes/skyline/install', { pages: [{ slug: 'home', mode: 'wipe', sections: [] }] })).status, 400);
  assert.equal((await a.post('/api/site-admin/themes/skyline/install', { design: true, pages: [{ slug: 'home', mode: 'replace', sections: [{ id: 'x', type: 'rawhtml', props: {} }] }] })).status, 400);
  assert.equal((await a.post('/api/site-admin/themes/skyline/install', { design: false, pages: [{ slug: 'home', mode: 'skip' }] })).status, 400);
  assert.equal(get("SELECT sections FROM site_pages WHERE slug='home'").sections, home.sections, 'a refused install changes nothing');
  assert.notEqual((await a.get('/api/site-admin/config')).data.active_theme, 'skyline');

  const r = await a.post('/api/site-admin/themes/skyline/install', { design: true, pages: [
    { slug: 'home', mode: 'replace', sections: sectionsOf(skyline, 'home') },
    { slug: 'about', mode: about.exists ? 'add' : 'add', sections: sectionsOf(skyline, 'about') },
    { slug: 'sell', mode: 'add', sections: sectionsOf(skyline, 'sell') },
    { slug: 'contact', mode: 'skip' },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.design, true);

  const newHome = get("SELECT * FROM site_pages WHERE slug='home'");
  assert.equal(JSON.parse(newHome.sections)[0].props.headline, 'Find the home that fits your life');
  const before = get("SELECT sections FROM site_page_versions WHERE page_id=? AND label='Before the Skyline theme'", home.id);
  assert.equal(before.sections, home.sections, 'the old home layout is in its version history');

  const sell = get("SELECT * FROM site_pages WHERE slug='sell'");
  assert.equal(sell.published, 1); assert.equal(sell.show_in_menu, 1);
  if (about.exists) {
    const copy = get("SELECT * FROM site_pages WHERE slug='about-skyline'");
    assert.ok(copy, 'a taken address gets a copy beside it');
    assert.equal(copy.published, 0, 'and the copy stays hidden');
  }
  assert.ok(!all("SELECT slug FROM site_pages WHERE slug LIKE 'contact-%'").length, 'skipped pages are not added');

  const cfg = (await a.get('/api/site-admin/config')).data;
  assert.equal(cfg.active_theme, 'skyline');
  assert.equal(cfg.header.style, 'transparent');
  assert.equal(cfg.theme.font_heading, 'Montserrat');
  assert.ok(cfg.contact.phone !== undefined && cfg.brand.name, 'the company details are kept');

  // visitors still see the published website until Publish
  assert.equal(JSON.stringify((await anon('/api/site/pages/home')).sections), liveBefore);
  assert.equal((await a.post('/api/site-admin/publish', { label: 'Skyline' })).status, 200);
  assert.equal((await anon('/api/site/pages/home')).sections[0].props.headline, 'Find the home that fits your life');
  assert.equal((await anon('/api/site/bootstrap')).config.header.style, 'transparent');
});

test('header and footer looks only take the known values', async () => {
  const a = await admin();
  const cfg = (await a.get('/api/site-admin/config')).data;
  assert.equal((await a.put('/api/site-admin/config', { ...cfg, header: { ...cfg.header, style: 'x" onmouseover="alert(1)' } })).status, 400);
  assert.equal((await a.put('/api/site-admin/config', { ...cfg, footer: { ...cfg.footer, style: 'neon' } })).status, 400);
  assert.equal((await a.put('/api/site-admin/config', { ...cfg, header: { ...cfg.header, style: 'dark', topbar: true }, footer: { ...cfg.footer, style: 'light' } })).status, 200);
});

// ---- the library: every theme, the two open-source adaptations, and the licence manifest
const FONTS = ['Inter', 'Poppins', 'Roboto', 'Open Sans', 'Montserrat', 'Lato', 'Nunito', 'Playfair Display', 'Merriweather', 'DM Sans', 'Manrope', 'Raleway', 'Work Sans', 'Source Sans 3'];
const PAGES_BEFORE = { skyline: ['home', 'about', 'sell', 'contact'], haven: ['home', 'how-it-works', 'contact'], maison: ['home', 'gallery', 'contact'], homestead: ['home', 'about', 'contact'] };

test('the four original themes keep their ids and pages, and the two new themes are added', () => {
  for (const [id, slugs] of Object.entries(PAGES_BEFORE)) {
    const t = themeById(id);
    assert.ok(t, `${id} is still in the library`);
    assert.deepEqual(t.pages.map((p) => p.slug), slugs, `${id} keeps its pages`);
    assert.equal(t.origin, 'original');
    assert.equal(t.source, undefined);
  }
  assert.deepEqual(SITE_THEMES.slice(0, 4).map((t) => t.id), ['skyline', 'haven', 'maison', 'homestead'], 'the original order is unchanged');
  assert.deepEqual(['horizon', 'urban'].map((id) => !!themeById(id)), [true, true]);
  assert.equal(new Set(SITE_THEMES.map((t) => t.id)).size, SITE_THEMES.length, 'theme ids are unique');
  assert.ok(themeById('horizon').pages.length >= 6 && themeById('urban').pages.length >= 8, 'the new themes are complete multi-page themes');
});

test('every theme has valid design tokens, unique pages, known fonts and real sample pictures', () => {
  for (const t of SITE_THEMES) {
    assert.ok(t.name && t.kind && t.tagline && t.best, `${t.id} is described`);
    assert.ok(['original', 'adaptation'].includes(t.origin), `${t.id} says where it comes from`);
    for (const k of ['primary', 'accent', 'dark', 'bg', 'soft']) assert.match(t.design.theme[k], /^#[0-9a-f]{6}$/i, `${t.id} ${k}`);
    assert.ok(FONTS.includes(t.design.theme.font_heading) && FONTS.includes(t.design.theme.font_body), `${t.id} fonts are in the editor's list`);
    assert.ok(Number.isFinite(t.design.theme.radius));
    assert.ok(['light', 'dark'].includes(t.design.footer.style));
    const slugs = t.pages.map((p) => p.slug);
    assert.equal(new Set(slugs).size, slugs.length, `${t.id} page slugs are unique`);
    assert.equal(slugs[0], 'home');
    for (const p of t.pages) {
      assert.match(p.slug, /^[a-z0-9-]{1,40}$/); assert.ok(p.title && p.blocks.length, `${t.id}/${p.slug}`);
      for (const bk of p.blocks) {
        assert.ok(SECTION_TYPE_NAMES.includes(bk.type), `${t.id}/${p.slug}: ${bk.type}`);
        for (const k of Object.keys(bk.props)) assert.ok(!/^(html|script|onclick|style)$/i.test(k) || k === 'html', `${t.id}/${p.slug}: ${k}`);
        if (bk.props.demo) assert.ok(DEMO_NAMED[bk.props.demo]);
      }
    }
    // every internal link points at a page of this theme or at a built-in site route
    const mine = new Set(slugs);
    const text = JSON.stringify(t.pages);
    for (const m of text.matchAll(/\/site\/p\/([a-z0-9-]+)/g)) assert.ok(mine.has(m[1]), `${t.id} links to a page it does not have: ${m[1]}`);
  }
});

test('open-source adaptations record their source, licence and what was (not) copied; originals record none', () => {
  for (const t of SITE_THEMES.filter((x) => x.origin === 'adaptation')) {
    for (const k of ['name', 'url', 'license', 'copyright', 'reviewed', 'used', 'copied', 'assets']) assert.ok(t.source?.[k], `${t.id} source.${k}`);
    assert.equal(t.source.license, 'MIT');
    assert.match(t.source.url, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
    assert.match(t.source.copied, /^Nothing\./, 'the manifest says no source code or assets were copied');
  }
  assert.deepEqual(SITE_THEMES.filter((t) => t.origin === 'adaptation').map((t) => t.id), ['horizon', 'urban']);
});

test('the theme source manifest lists every theme, its licence and its source', () => {
  const doc = fs.readFileSync(new URL('../../docs/website-themes/THEME_SOURCES.md', import.meta.url), 'utf8');
  for (const t of SITE_THEMES) {
    assert.ok(doc.includes(`\`${t.id}\``), `${t.id} is in the manifest`);
    if (t.source) for (const v of [t.source.url, t.source.license, t.source.copyright]) assert.ok(doc.includes(v), `${t.id}: ${v}`);
  }
});

test('shipped sample pictures are real images', () => {
  for (const src of [...DEMO_PHOTOS, ...Object.values(DEMO_NAMED)]) {
    const head = fs.readFileSync(new URL(`../../client/public${src}`, import.meta.url)).subarray(0, 3);
    assert.deepEqual([...head], [0xff, 0xd8, 0xff], `${src} is a JPEG`);
  }
});

test('every theme installs as a draft: nothing goes live, nothing existing is lost, and the shared definition is never changed', async () => {
  const a = await admin();
  const frozen = JSON.stringify(SITE_THEMES);
  for (const t of SITE_THEMES) {
    const liveBefore = JSON.stringify((await anon('/api/site/pages/home')).sections);
    const homeBefore = get("SELECT * FROM site_pages WHERE slug='home'");
    const pagesBefore = all('SELECT slug FROM site_pages ORDER BY id').map((p) => p.slug);
    const r = await a.post(`/api/site-admin/themes/${t.id}/install`, { design: true, pages: t.pages.map((p) => ({ slug: p.slug, mode: p.slug === 'home' ? 'replace' : 'add', sections: sectionsOf(t, p.slug) })) });
    assert.equal(r.status, 200, `${t.id}: ${JSON.stringify(r.data)}`);
    // the replaced home is in history, previous pages are all still there, the public site is unchanged until Publish
    assert.equal(get('SELECT sections FROM site_page_versions WHERE page_id=? AND label=? ORDER BY id DESC LIMIT 1', homeBefore.id, `Before the ${t.name} theme`).sections, homeBefore.sections, `${t.id}: old home kept in history`);
    for (const slug of pagesBefore) assert.ok(get('SELECT 1 FROM site_pages WHERE slug=?', slug), `${t.id}: ${slug} still exists`);
    assert.equal(JSON.stringify((await anon('/api/site/pages/home')).sections), liveBefore, `${t.id}: visitors see no change before Publish`);
    assert.equal((await a.get('/api/site-admin/config')).data.active_theme, t.id);
    for (const p of t.pages) { // every installed page has its blocks (a taken address gets the theme's copy beside it)
      const row = get('SELECT sections FROM site_pages WHERE slug=?', pagesBefore.includes(p.slug) && p.slug !== 'home' ? `${p.slug}-${t.id}` : p.slug);
      assert.equal(JSON.parse(row.sections).length, p.blocks.length, `${t.id}/${p.slug}`);
    }
    assert.equal((await a.post('/api/site-admin/draft/discard', {})).status, 200); // back to the live website for the next theme
  }
  assert.equal(JSON.stringify(SITE_THEMES), frozen, 'installing never changes the shared theme definitions');
});

test('a theme page with an unknown block or an unsafe picture or link is refused', async () => {
  const a = await admin();
  const horizon = themeById('horizon');
  const good = sectionsOf(horizon, 'contact');
  for (const bad of [
    [...good, { id: 'bad1', type: 'script', props: {} }],
    [{ id: 'bad2', type: 'hero', props: { headline: 'x', image: 'javascript:alert(1)' } }],
    [{ id: 'bad3', type: 'cta', props: { headline: 'x', image: 'data:text/html,<script>alert(1)</script>' } }],
    [{ id: 'bad4', type: 'hero', props: { headline: 'x', cta_href: 'javascript:alert(1)' } }],
  ]) assert.equal((await a.post('/api/site-admin/themes/horizon/install', { design: false, pages: [{ slug: 'contact', mode: 'add', sections: bad }] })).status, 400);
});
