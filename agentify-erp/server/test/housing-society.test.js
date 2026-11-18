import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-society-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { run, get } = await import('../src/db.js');
const { validateSections } = await import('../src/services/siteValidate.js');
const { themeById } = await import('../../shared/siteThemes.js');
const { SECTION_TYPE_NAMES } = await import('../../shared/sectionTypes.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });
const anon = async (u) => (await fetch(base + u, { headers: { 'X-Requested-With': 'ERP' } })).json();

test('the Society theme exists, keeps the brand teal and uses only registered blocks', () => {
  const t = themeById('society');
  assert.ok(t);
  assert.equal(t.design.theme.primary.toLowerCase(), '#0e7c6b');
  const types = new Set(t.pages.flatMap((p) => p.blocks.map((b) => b.type)));
  for (const x of ['societystats', 'constructionprogress', 'blocktable', 'approvals', 'leadership', 'listings']) assert.ok(types.has(x), x);
  for (const x of types) assert.ok(SECTION_TYPE_NAMES.includes(x));
});

test('society blocks ship with empty figures: nothing invented', () => {
  const t = themeById('society');
  const blocks = t.pages.flatMap((p) => p.blocks).filter((b) => ['societystats', 'blocktable', 'approvals'].includes(b.type));
  assert.ok(blocks.length >= 3);
  for (const b of blocks) assert.ok(!/\d{2,}/.test(JSON.stringify(b.props)), `${b.type} carries no numbers`);
});

test('the new blocks pass the page validator', () => {
  const sections = [
    { id: 'a1', type: 'societystats', props: { title: 'At a glance', as_of: '30 June 2026', items: [{ value: '1,200', label: 'Plots delivered', note: '' }] } },
    { id: 'a2', type: 'constructionprogress', props: { title: 'Progress', limit: 4, show_updates: true } },
    { id: 'a3', type: 'blocktable', props: { title: 'Blocks', live_available: true, rows: [{ block: 'A', sizes: '5, 10 Marla', plots: '120', status: 'Possession started' }] } },
    { id: 'a4', type: 'approvals', props: { title: 'Approvals', items: [{ title: 'NOC', authority: 'Authority', number: 'X-1', status: 'approved', date: '2026', href: '' }] } },
  ];
  validateSections(sections);
  assert.equal(sections.length, 4);
});

test('public endpoints give only website-visible published updates and aggregate block counts', async () => {
  const now = new Date().toISOString();
  run("INSERT INTO projects(id,code,name,site_visible,created_at) VALUES(901,'S-1','Visible Phase',1,?)", now);
  run("INSERT INTO projects(id,code,name,site_visible,created_at) VALUES(902,'S-2','Hidden Phase',0,?)", now);
  run("INSERT INTO dev_updates(project_id,update_date,title,kind,progress,description,published,created_at) VALUES(901,'2026-11-01','Roads laid','Progress',40,'Phase one roads',1,?)", now);
  run("INSERT INTO dev_updates(project_id,update_date,title,kind,progress,description,published,created_at) VALUES(901,'2026-11-02','Draft note','Progress',41,'x',0,?)", now);
  run("INSERT INTO dev_updates(project_id,update_date,title,kind,progress,description,published,created_at) VALUES(902,'2026-11-03','Hidden project note','Progress',10,'x',1,?)", now);
  const u = (await anon('/api/site/project-updates?limit=10')).data.map((x) => x.title);
  assert.ok(u.includes('Roads laid'));
  assert.ok(!u.includes('Draft note'));
  assert.ok(!u.includes('Hidden project note'));
  run("INSERT INTO properties(code,title,block,status,published,total_price,net_price,created_at) VALUES('SP-1','Plot 1',' ZZ ','available',1,1,1,?)", now);
  run("INSERT INTO properties(code,title,block,status,published,total_price,net_price,created_at) VALUES('SP-2','Plot 2','ZZ','sold',1,1,1,?)", now);
  const c = (await anon('/api/site/block-counts')).data.find((x) => x.block === 'ZZ');
  assert.equal(c.available, 1);
  assert.ok(get('SELECT 1 FROM projects WHERE id=901'));
});
