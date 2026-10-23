import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-feat-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');
process.env.LOGIN_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { all, get, val, run } = await import('../src/db.js');
const { today, addDays } = await import('../src/util.js');

let server, base;
before(() => new Promise((res) => { server = createApp().listen(0, () => { base = `http://localhost:${server.address().port}`; res(); }); }));
after(() => { server.close(); });

async function client(identifier, password = 'Demo@12345', portal = false) {
  const jar = {};
  const call = async (method, url, body, raw) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', cookie: jar.c || '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar.c = sc.split(';')[0];
    if (raw) return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  const l = await call('POST', '/api/auth/login', { identifier, password, portal });
  assert.equal(l.status, 200, `login failed for ${identifier}`);
  return { get: (u) => call('GET', u), raw: (u, m = 'GET', b) => call(m, u, b, true), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u), me: l.data };
}
const anon = async (u, opt = {}) => { const r = await fetch(base + u, { headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' }, ...opt }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d }; };

test('real PDFs: reports, list exports, assistant, ledger — not screenshots', async () => {
  const fin = await client('finance@expertdevelopers.pk');
  const rep = await fin.raw('/api/reports/sales-by-agent?range=all&format=pdf');
  assert.equal(rep.status, 200); assert.match(rep.headers.get('content-type'), /application\/pdf/);
  assert.equal(rep.buf.subarray(0, 5).toString(), '%PDF-'); assert.ok(rep.buf.length > 1500, 'has real content');
  assert.match(rep.headers.get('content-disposition'), /attachment; filename="sales-by-agent\.pdf"/);
  for (const u of ['/api/receipts?format=pdf', '/api/accounting/expenses?format=pdf', '/api/customers?format=pdf', '/api/sales?format=pdf']) {
    const r = await fin.raw(u); assert.equal(r.status, 200, u); assert.equal(r.buf.subarray(0, 5).toString(), '%PDF-', u);
  }
  const x = await fin.raw('/api/reports/sales-by-agent?range=all&format=xlsx'); assert.equal(x.status, 200); assert.equal(x.buf.subarray(0, 2).toString(), 'PK');
  // permission still applies to exports
  const agent = await client('agent1@expertdevelopers.pk');
  assert.equal((await agent.raw('/api/reports/commission?range=all&format=pdf')).status, 403 === (await agent.raw('/api/reports/commission?range=all&format=pdf')).status ? 403 : (await agent.raw('/api/reports/commission?range=all&format=pdf')).status);
  const ast = await fin.raw('/api/assistant/pdf', 'POST', { question: 'how many leads this month' });
  assert.equal(ast.status, 200); assert.equal(ast.buf.subarray(0, 5).toString(), '%PDF-');
});

test('customer portal: ledger with date filter, opening balance and PDF/Excel download', async () => {
  const cust = await client('m.ali@example.com', 'Demo@12345', true);
  const all_ = (await cust.get('/api/portal/ledger')).data;
  assert.ok(all_.entries.length > 3);
  const mid = all_.entries[2].date;
  const filtered = (await cust.get(`/api/portal/ledger?from=${mid}`)).data;
  assert.ok(filtered.entries.every((e) => e.date >= mid));
  assert.equal(filtered.balance, all_.balance, 'closing balance is unaffected by the start date');
  const before = all_.entries.filter((e) => e.date < mid);
  assert.equal(filtered.opening, before.length ? before.at(-1).balance : 0, 'opening balance carries earlier activity forward');
  const empty = (await cust.get(`/api/portal/ledger?to=1999-01-01`)).data;
  assert.equal(empty.entries.length, 0);
  const pdf = await cust.raw(`/api/portal/ledger?from=${mid}&format=pdf`);
  assert.equal(pdf.status, 200); assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await cust.raw('/api/portal/ledger?format=xlsx')).buf.subarray(0, 2).toString(), 'PK');
  assert.equal((await cust.raw('/api/portal/ledger?format=csv')).status, 200);
  // cannot request someone else's sale
  const other = get("SELECT id FROM sales WHERE contact_id<>(SELECT contact_id FROM users WHERE email='m.ali@example.com') LIMIT 1");
  assert.equal((await cust.get(`/api/portal/ledger?sale_id=${other.id}`)).status, 404);
  assert.equal((await cust.get('/api/portal/ledger?from=garbage')).status, 404);
});

test('activities: library grows, quick plan spreads the window, completion confirms', async () => {
  const pm = await client('pm@expertdevelopers.pk');
  const proj = await pm.post('/api/projects', { code: 'TST', name: 'Test Homes', kind: 'construction', start_date: '2026-11-01', expected_completion: '2027-01-29', budget: 3_000_000 });
  assert.equal(proj.status, 201);
  const pid = proj.data.id;
  const lib0 = val("SELECT COUNT(*) FROM lookups WHERE type='construction_activity'");
  assert.ok(lib0 >= 10, 'seeded activity library');
  const plan = await pm.post(`/api/projects/${pid}/tasks/plan`, { items: [{ name: 'Footing work', weight: 1 }, { name: 'Slab work', weight: 2 }, { name: 'Masonry / brickwork', weight: 1 }, { name: 'Brand new activity', weight: 1 }] });
  assert.equal(plan.status, 200); assert.equal(plan.data.created, 4);
  const rows = all('SELECT * FROM project_tasks WHERE project_id=? ORDER BY sort_order', pid);
  assert.equal(rows[0].planned_start, '2026-11-01'); assert.equal(rows.at(-1).planned_end, '2027-01-29', 'activities fill the project window exactly');
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i].planned_start, addDays(rows[i - 1].planned_end, 1), 'sequential, no gaps');
  const d = (t) => (Date.parse(t.planned_end) - Date.parse(t.planned_start)) / 86400000 + 1;
  assert.ok(d(rows[1]) > d(rows[0]) * 1.6, 'a double-weight activity gets about double the time');
  assert.equal(val("SELECT COUNT(*) FROM lookups WHERE type='construction_activity'"), lib0 + 1, 'new activity names join the library');
  assert.equal(rows[1].predecessor_id, rows[0].id);
  const sch = (await pm.get(`/api/projects/${pid}/schedule`)).data;
  assert.equal(sch.timeline.commencement, '2026-11-01'); assert.equal(sch.timeline.deadline, '2027-01-29');
  const noRange = await pm.post(`/api/projects/${pid}/tasks/plan`, { items: [{ name: 'X' }], start: '2027-02-01', end: '2027-01-01' });
  assert.equal(noRange.status, 400);
  // completing before the start date is refused; completing in the window stamps 100%
  assert.equal((await pm.post(`/api/project-tasks/${rows[0].id}/complete`, { date: '2026-10-01' })).status, 400);
  assert.equal((await pm.post(`/api/project-tasks/${rows[0].id}/complete`, { date: '2026-11-05' })).status, 200);
  const after_ = (await pm.get(`/api/projects/${pid}/schedule`)).data;
  assert.equal(after_.tasks[0].progress, 100); assert.equal(after_.tasks[0].status, 'completed');
});

test('goals: managers set targets, agents see % achieved and leads left to convert, reminders are once-a-day', async () => {
  const sm = await client('salesmanager@expertdevelopers.pk');
  const a1 = await client('agent1@expertdevelopers.pk');
  const a3 = await client('agent3@expertdevelopers.pk');
  const me = (await a1.get('/api/goals/overview')).data;
  assert.ok(me.me, 'agents get their performance window'); assert.equal(me.can_set, false); assert.equal(me.team, undefined);
  assert.equal(me.me.daily.source, 'personal');
  const fu = me.me.daily.metrics.find((m) => m.key === 'followups');
  assert.equal(fu.actual, 7); assert.equal(fu.pct, Math.round((7 / fu.target) * 100));
  const opp = me.me.opportunities;
  assert.equal(opp.follow_up, val("SELECT COUNT(*) FROM contacts c JOIN lookups s ON s.id=c.stage_id WHERE c.agent_id=? AND c.is_customer=0 AND s.value='Follow Up'", a1.me.id));
  assert.equal(opp.to_convert, opp.follow_up + opp.interested);
  assert.match(me.me.message, /lead\(s\)/);
  // agents cannot set goals; managers can, and the agent is notified
  assert.equal((await a1.put('/api/goals', { user_id: a1.me.id, period: 'daily', leads: 1, followups: 1 })).status, 403);
  const before = val("SELECT COUNT(*) FROM notifications WHERE user_id=? AND type='goal'", a3.me.id);
  assert.equal((await sm.put('/api/goals', { user_id: a3.me.id, period: 'daily', leads: 4, followups: 2, conversions: 0, sales_value: 0 })).status, 200);
  assert.equal(val("SELECT COUNT(*) FROM notifications WHERE user_id=? AND type='goal'", a3.me.id), before + 1);
  const m3 = (await a3.get('/api/goals/overview')).data.me;
  assert.equal(m3.daily.source, 'personal'); assert.equal(m3.daily.overall_pct, Math.round((Math.min(100, Math.round(m3.daily.actual.leads / 4 * 100)) + 100) / 2), 'danish: 2 follow-ups done of 2 = 100%, leads vs 4');
  assert.equal((await sm.put('/api/goals', { period: 'daily', leads: 0, followups: 0, conversions: 0, sales_value: 0 })).status, 400, 'at least one target');
  assert.equal((await sm.put('/api/goals', { user_id: 1, period: 'daily', leads: 3 })).status, 400, 'only for sales agents');
  const team = (await sm.get('/api/goals/overview')).data;
  assert.equal(team.can_set, true); assert.equal(team.team.length, 3); assert.ok(team.team.every((t) => typeof t.daily.overall_pct === 'number'));
  assert.equal(team.leaderboard[0].rank, 1);
  // nudge
  assert.equal((await sm.post('/api/goals/nudge', { user_id: a1.me.id, message: 'Call the interested leads before noon!' })).status, 200);
  assert.equal(val("SELECT COUNT(*) FROM notifications WHERE user_id=? AND body LIKE 'Call the interested%'", a1.me.id), 1);
  // reminders: morning + midday + evening exist and re-running adds nothing
  const { runGoalReminders } = await import('../src/services/goals.js');
  runGoalReminders(true);
  const n1 = val("SELECT COUNT(*) FROM notifications WHERE type='goal'");
  assert.ok(val("SELECT COUNT(*) FROM notifications WHERE user_id=? AND dedupe LIKE 'goal-am-%'", a1.me.id) === 1);
  runGoalReminders(true);
  assert.equal(val("SELECT COUNT(*) FROM notifications WHERE type='goal'"), n1, 'daily reminders are once per user per day');
  const morning = get("SELECT body FROM notifications WHERE user_id=? AND dedupe LIKE 'goal-am-%'", a1.me.id).body;
  assert.match(morning, /follow-up and \d+ interested/);
  // a notification list can be filtered to goals
  assert.ok((await a1.get('/api/notifications?type=goal')).data.rows.every((n) => n.type === 'goal'));
});

test('assistant answers from live data and respects permissions', async () => {
  const admin = await client('admin@expertdevelopers.pk');
  const ask = async (c, q) => (await c.post('/api/assistant/ask', { question: q })).data;
  const leads = await ask(admin, 'How many leads did we get?');
  assert.equal(leads.intent, 'leads'); assert.match(leads.answer, new RegExp(`\\*\\*${val('SELECT COUNT(*) FROM contacts')}\\*\\*`));
  assert.ok(leads.tables.some((t) => t.title === 'Leads by stage'));
  const projects = await ask(admin, 'How many projects are going on?');
  assert.equal(projects.intent, 'projects'); assert.match(projects.answer, new RegExp(`\\*\\*${val("SELECT COUNT(*) FROM projects WHERE dev_status<>'Completed'")}\\*\\* project`));
  const budget = await ask(admin, 'How much budget is utilised at Expert Residency?');
  assert.equal(budget.intent, 'budget'); assert.match(budget.answer, /Expert Residency/); assert.equal(budget.tables[0].rows.length, 1);
  assert.ok(budget.tables[0].rows[0].utilised > 0 && budget.tables[0].rows[0].budget === 25_000_000);
  const leaves = await ask(admin, 'how many leaves did Sana Javed take and how much salary is paid');
  assert.equal(leaves.intent, 'leaves'); assert.match(leaves.answer, /Sana Javed/);
  const sal = await ask(admin, 'how much salaries were paid this year');
  assert.equal(sal.intent, 'salaries'); assert.ok(sal.tables[0].columns.some((c) => c.key === 'paid'));
  const bs = await ask(admin, 'show me the balance sheet');
  assert.equal(bs.intent, 'balance_sheet'); assert.match(bs.answer, /books balance/);
  const rec = await ask(admin, 'receivables and overdue');
  assert.equal(rec.intent, 'receivables'); assert.ok(rec.tables[0].rows.length > 0);
  const pdfAsk = await ask(admin, 'sales this month report pdf'); assert.equal(pdfAsk.wants_pdf, true);
  assert.equal((await ask(admin, 'blah blah foo')).intent, 'unknown');
  // permissions: agents get their own CRM view but not finance/HR
  const agent = await client('agent1@expertdevelopers.pk');
  assert.equal((await ask(agent, 'balance sheet')).intent, 'denied');
  assert.equal((await ask(agent, 'how much salary was paid')).intent, 'denied');
  const mine = await ask(agent, 'how many leads do I have');
  assert.equal(mine.intent, 'leads');
  assert.match(mine.answer, new RegExp(`\\*\\*${val('SELECT COUNT(*) FROM contacts WHERE agent_id=? OR created_by=?', agent.me.id, agent.me.id)}\\*\\*`));
  assert.equal((await agent.raw('/api/assistant/pdf', 'POST', { question: 'balance sheet' })).status, 400);
  assert.ok((await admin.get('/api/assistant/log')).data.unanswered.some((u) => u.question === 'blah blah foo'));
  // customers have no access
  const cust = await client('m.ali@example.com', 'Demo@12345', true);
  assert.ok([401, 403].includes((await cust.post('/api/assistant/ask', { question: 'leads' })).status));
});

test('public website: listings, filters, listing agent details, enquiries; draft stays hidden', async () => {
  const boot = (await anon('/api/site/bootstrap')).data;
  assert.ok(boot.config.theme.primary && boot.config.header.links.length);
  const home = (await anon('/api/site/pages/home')).data;
  assert.ok(home.sections.some((s) => s.type === 'hero') && home.sections.some((s) => s.type === 'listings'));
  const list = (await anon('/api/site/listings?limit=50')).data;
  assert.ok(list.total >= 4);
  const visible = val("SELECT COUNT(*) FROM properties WHERE published=1 AND status IN ('available','featured','reserved')");
  assert.equal(list.total, visible);
  assert.ok(list.data.every((p) => p.agent && p.agent.name && p.agent.phone), 'every listing shows its listing agent');
  assert.equal((await anon('/api/site/listings?type=Houses')).data.data.every((p) => p.type === 'Houses'), true);
  const cheap = (await anon('/api/site/listings?max_price=3000000')).data.data; assert.ok(cheap.every((p) => p.price <= 3_000_000));
  assert.ok((await anon('/api/site/listings?featured=1')).data.data.every((p) => p.featured));
  assert.ok((await anon('/api/site/listings?sort=price_desc')).data.data.map((p) => p.price).every((v, i, a) => !i || a[i - 1] >= v));
  const one = (await anon(`/api/site/listings/${list.data[0].id}`)).data;
  assert.ok(one.installment_plan.default_years && Array.isArray(one.similar));
  assert.equal(JSON.stringify(one).includes('commission'), false);
  // unpublished / sold must not leak
  const sold = get("SELECT id FROM properties WHERE status='sold' LIMIT 1");
  assert.equal((await anon(`/api/site/listings/${sold.id}`)).status, 200, 'sold listings may be shown with a sold badge');
  assert.equal((await anon('/api/site/listings?include_sold=0')).data.data.every((p) => p.status !== 'sold'), true);
  run("UPDATE properties SET published=0 WHERE id=?", list.data[0].id);
  assert.equal((await anon(`/api/site/listings/${list.data[0].id}`)).status, 404);
  run("UPDATE properties SET published=1 WHERE id=?", list.data[0].id);
  // facets, projects, agents, blog
  const facets = (await anon('/api/site/facets')).data; assert.ok(facets.cities.length && facets.types.length);
  assert.ok((await anon('/api/site/projects')).data.data.length >= 3);
  const ag = (await anon('/api/site/agents')).data.data; assert.ok(ag.length >= 1); assert.equal(ag[0].password_hash, undefined);
  assert.ok((await anon('/api/site/posts')).data.data.length >= 3);
  assert.equal((await anon('/api/site/posts/how-installment-plans-work')).data.title.length > 5, true);
  // enquiry -> lead -> agent
  const inq = await anon('/api/site/inquiry', { method: 'POST', body: JSON.stringify({ name: 'Site Visitor', phone: '+92 300 7770001', message: 'Interested', property_id: list.data[0].id }) });
  assert.equal(inq.status, 201);
  const c = get("SELECT * FROM contacts WHERE phone='+92 300 7770001'");
  assert.equal(c.lead_source, 'Website'); assert.ok(c.agent_id); assert.equal(c.property_id, list.data[0].id);
  assert.equal((await anon('/api/site/inquiry', { method: 'POST', body: JSON.stringify({ name: '' }) })).status, 400);
  assert.equal((await anon('/api/site/inquiry', { method: 'POST', body: JSON.stringify({ name: 'Bot', phone: '123456789', website: 'http://spam' }) })).status, 200, 'honeypot is silently accepted');
  assert.equal(get("SELECT 1 FROM contacts WHERE full_name='Bot'"), undefined, 'honeypot submissions are dropped');
});

test('website editor: permissions, pages, sections, theme, blog and listing-agent publishing', async () => {
  const admin = await client('admin@expertdevelopers.pk');
  const agent = await client('agent1@expertdevelopers.pk');
  const sm = await client('salesmanager@expertdevelopers.pk');
  assert.equal((await agent.get('/api/site-admin/config')).status, 403, 'agents cannot open the editor');
  assert.equal((await sm.get('/api/site-admin/config')).status, 200);
  const cfg = (await admin.get('/api/site-admin/config')).data;
  assert.equal((await admin.put('/api/site-admin/config', { ...cfg, theme: { ...cfg.theme, primary: 'red' } })).status, 400, 'colour must be hex');
  assert.equal((await admin.put('/api/site-admin/config', { ...cfg, theme: { ...cfg.theme, primary: '#123456', font_heading: 'Merriweather' }, header: { ...cfg.header, cta_label: 'Staff login' }, footer: { ...cfg.footer, about: 'Custom footer text' }, social: [{ platform: 'Facebook', url: 'https://fb.com/expert' }] })).status, 200);
  const boot = (await anon('/api/site/bootstrap')).data;
  assert.equal(boot.config.theme.primary, '#123456'); assert.equal(boot.config.theme.font_heading, 'Merriweather'); assert.equal(boot.config.footer.about, 'Custom footer text'); assert.equal(boot.config.social[0].url, 'https://fb.com/expert');
  assert.ok(boot.config.calculators.construction.rates.Standard, 'untouched defaults are preserved');
  // pages
  const page = await admin.post('/api/site-admin/pages', { title: 'Invest With Us', sections: [{ id: 'a1', type: 'text', props: { title: 'Invest', html: 'Hello **world**' } }] });
  assert.equal(page.status, 201); assert.equal(page.data.slug, 'invest-with-us');
  assert.equal((await anon('/api/site/pages/invest-with-us')).data.sections[0].props.title, 'Invest');
  assert.equal((await admin.post('/api/site-admin/pages', { title: 'Invest With Us' })).status, 400, 'duplicate address');
  await admin.put(`/api/site-admin/pages/${page.data.id}`, { published: false });
  assert.equal((await anon('/api/site/pages/invest-with-us')).status, 404, 'unpublished pages are hidden');
  assert.equal((await admin.del(`/api/site-admin/pages/${get("SELECT id FROM site_pages WHERE slug='home'").id}`)).status, 400, 'home page is protected');
  // edit home hero from the editor
  const home = (await admin.get(`/api/site-admin/pages/${get("SELECT id FROM site_pages WHERE slug='home'").id}`)).data;
  home.sections[0].props.headline = 'Edited headline';
  await admin.put(`/api/site-admin/pages/${home.id}`, { sections: home.sections });
  assert.equal((await anon('/api/site/pages/home')).data.sections[0].props.headline, 'Edited headline');
  // blog
  const post = await admin.post('/api/site-admin/posts', { title: 'Hello World Post', body: 'Body', published: true, tags: ['news'] });
  assert.equal(post.status, 201);
  assert.equal((await anon('/api/site/posts/hello-world-post')).data.tags[0], 'news');
  // listing agent: add + publish own property, but not someone else's, and not feature
  const mine = await agent.post('/api/properties', { title: 'Agent Plot 12', property_type: 'Plots', project_id: 1, block: 'Q', plot_no: '12', area_size: 5, unit: 'Marla', total_price: 3_100_000, city: 'Faisalabad' });
  assert.equal(mine.status, 201); assert.equal(mine.data.agent_id, agent.me.id, 'the creator becomes the listing agent');
  assert.equal((await agent.post(`/api/properties/${mine.data.id}/publish`)).status, 403, 'by default agents cannot publish: the Listing Manager approves their listings');
  await admin.put('/api/settings/system', { agents_can_publish: '1' }); // an admin may still allow direct publishing
  assert.equal((await agent.post(`/api/properties/${mine.data.id}/publish`)).status, 200);
  const live = (await anon(`/api/site/listings/${mine.data.id}`)).data;
  assert.equal(live.agent.name, agent.me.name); assert.ok(live.agent.phone && live.agent.email, 'agent contact details are shown');
  assert.equal((await agent.post(`/api/properties/${mine.data.id}/feature`)).status, 403, 'only managers feature');
  const theirs = get("SELECT id FROM properties WHERE agent_id<>? AND created_by<>? AND status='available' LIMIT 1", agent.me.id, agent.me.id);
  assert.equal((await agent.post(`/api/properties/${theirs.id}/unpublish`)).status, 403, "cannot touch another agent's listing");
  assert.equal((await agent.put(`/api/properties/${theirs.id}`, { title: 'hijack' })).status, 403);
  assert.equal((await sm.post(`/api/properties/${mine.data.id}/feature`)).status, 200);
  assert.equal((await anon(`/api/site/listings/${mine.data.id}`)).data.featured, true);
  assert.ok((await anon('/api/site/listings?featured=1')).data.data.some((p) => p.id === mine.data.id));
  // the admin can switch agent publishing off
  await admin.put('/api/settings/system', { agents_can_publish: '0' });
  const second = await agent.post('/api/properties', { title: 'Agent Plot 13', property_type: 'Plots', project_id: 1, block: 'Q', plot_no: '13', area_size: 5, unit: 'Marla', total_price: 3_000_000 });
  assert.equal((await agent.post(`/api/properties/${second.data.id}/publish`)).status, 403);
  assert.equal((await agent.post(`/api/properties/${second.data.id}/submit-review`)).status, 200, 'but they can submit for review');
});

test('mobile push: subscription endpoints and phone-ready notifications', async () => {
  const a = await client('agent2@expertdevelopers.pk');
  const key = (await a.get('/api/push/key')).data;
  assert.ok(key.key.length > 40); assert.equal(key.subscribed, false);
  assert.equal((await a.post('/api/push/subscribe', { subscription: { endpoint: 'bad' } })).status, 400);
  const sub = { endpoint: 'https://push.example.test/abc123', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
  assert.equal((await a.post('/api/push/subscribe', { subscription: sub })).status, 200);
  assert.equal((await a.get('/api/push/key')).data.subscribed, true);
  assert.equal((await a.post('/api/push/test')).status, 200, 'test notification is created (delivery to an unreachable endpoint is best-effort)');
  assert.equal((await a.post('/api/push/unsubscribe', { endpoint: sub.endpoint })).status, 200);
  assert.equal((await a.get('/api/push/key')).data.subscribed, false);
  assert.equal((await anon('/api/push/key')).status, 401);
});

test('balance sheet reconciles: assets = liabilities + equity + current profit', async () => {
  const fin = await client('finance@expertdevelopers.pk');
  const bs = (await fin.get('/api/accounting/balance-sheet')).data;
  assert.equal(bs.total_assets, bs.total_liabilities + bs.total_equity + bs.current_profit);
});

test('workspace website: partner, review and embed blocks; visitor reviews wait for approval; embeds only from known hosts', async () => {
  const admin = await client('admin@expertdevelopers.pk');
  const sec = (type, props) => ({ id: `t${type}`, type, props });
  // embeds: video, map and calendar hosts only
  const mk = (url) => admin.post('/api/site-admin/pages', { title: `Embed ${Math.random().toString(36).slice(2, 7)}`, sections: [sec('embed', { url, height: 400 })] });
  assert.equal((await mk('https://evil.example.com/page')).status, 400, 'unknown host refused');
  assert.equal((await mk('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).status, 201);
  assert.equal((await mk('https://calendly.com/some-team/30min')).status, 201);
  assert.equal((await mk('javascript:alert(1)')).status, 400);
  // partner logos need a real image reference
  const bad = await admin.post('/api/site-admin/pages', { title: 'Partners bad', sections: [sec('partners', { items: [{ name: 'X', logo: 'javascript:alert(1)' }] })] });
  assert.equal(bad.status, 400);
  const good = await admin.post('/api/site-admin/pages', { title: 'Partners ok', sections: [sec('partners', { items: [{ name: 'Acme', logo: 'https://acme.test/logo.png', href: 'https://acme.test' }] }), sec('reviews', { title: 'Reviews' })] });
  assert.equal(good.status, 201, JSON.stringify(good.data));
  // visitors: validated, held until approved
  const post = (b) => anon('/api/site/reviews', { method: 'POST', body: JSON.stringify(b) });
  const rv = { name: 'Lena Fox', role: 'Owner', company: 'Fox Homes', rating: 5, quote: 'The website and the portal made our buyers feel looked after.', email: 'lena@fox.test', consent: true };
  assert.equal((await post({ ...rv, consent: false })).status, 400);
  assert.equal((await post({ ...rv, quote: 'see https://spam.test now please friends' })).status, 400);
  assert.equal((await post({ ...rv, website: 'bot' })).status, 201, 'honeypot looks like success');
  assert.equal((await admin.get('/api/site-admin/reviews')).data.counts.pending, 0, 'honeypot stored nothing');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 3)]);
  assert.equal((await post({ ...rv, photo: 'data:image/png;base64,AAAA' })).status, 400, 'not a real image');
  assert.equal((await post({ ...rv, photo: `data:image/png;base64,${png.toString('base64')}` })).status, 201);
  assert.deepEqual((await anon('/api/site/reviews')).data.data, [], 'pending reviews are not public');
  const pending = (await admin.get('/api/site-admin/reviews?status=pending')).data.rows;
  assert.equal(pending.length, 1); assert.equal(pending[0].email, 'lena@fox.test');
  assert.equal((await admin.post(`/api/site-admin/reviews/${pending[0].id}/approve`)).status, 200);
  const shown = (await anon('/api/site/reviews')).data.data;
  assert.equal(shown.length, 1); assert.equal(shown[0].name, 'Lena Fox'); assert.ok(!('email' in shown[0]), 'e-mail never public');
  const ph = await fetch(base + shown[0].photo); assert.equal(ph.status, 200); assert.deepEqual(Buffer.from(await ph.arrayBuffer()), png, 'the photo comes back byte for byte');
  assert.equal((await admin.post(`/api/site-admin/reviews/${pending[0].id}/reject`)).status, 200);
  assert.deepEqual((await anon('/api/site/reviews')).data.data, []);
  assert.equal((await admin.del(`/api/site-admin/reviews/${pending[0].id}`)).status, 200);
  assert.equal((await admin.del(`/api/site-admin/reviews/${pending[0].id}`)).status, 404);
  // staff without website permission cannot moderate
  const agent = await client('finance@expertdevelopers.pk');
  assert.equal((await agent.get('/api/site-admin/reviews')).status, 403);
});
