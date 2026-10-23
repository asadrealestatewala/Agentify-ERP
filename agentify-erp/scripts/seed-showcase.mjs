// Fills the local showcase workspaces (shotre-pk, shotre-us, shotre-uk, shotre-ae, shotre-ca) with a believable working
// set of leads, agents and follow-ups through the app's own API, so the marketing screenshots show the real screens with
// something on them. Local development data only: never run against a live workspace.
//   node scripts/seed-showcase.mjs                  (server on http://localhost:4000, Chrome at the usual path)
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PASSWORD = 'Realty@2026x';
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' };
const AGENTS = [['Sara Malik', 'sara'], ['Jonas Carter', 'jonas'], ['Nadia Hussain', 'nadia']];
const LEADS = [
  ['Amelia Grant', 'Website', 'Interested', 0, 'High'], ['Omar Haddad', 'Zameen.com', 'Contacted', 1, 'Medium'], ['Priya Shah', 'Referral', 'Follow Up', 0, 'High'],
  ['Daniel Brooks', 'Facebook', 'Non Contacted', 2, 'Medium'], ['Hana Yusuf', 'Walk-in', 'Interested', 1, 'Medium'], ['Lucas Meyer', 'Website', 'Contacted', 2, 'Low'],
  ['Fatima Noor', 'Instagram', 'Follow Up', 0, 'High'], ['Ethan Wells', 'Phone Call', 'Non Contacted', 1, 'Medium'], ['Mira Kapoor', 'Agent Network', 'Contacted', 2, 'Medium'],
  ['Samuel Osei', 'Website', 'Non Contacted', 0, 'High'], ['Chloe Martin', 'Referral', 'Follow Up', 1, 'Medium'], ['Yusuf Rahman', 'OLX', 'Interested', 2, 'High'],
  ['Elena Rossi', 'Exhibition', 'Contacted', 0, 'Low'], ['Tariq Aziz', 'Website', 'Follow Up', 2, 'High'],
];
const TASKS = [['Call back about the 2-bed viewing', -1], ['Send floor plans and payment plan', 0], ['Confirm Thursday viewing', 0], ['Share the revised offer', 1], ['Follow up after the viewing', 2], ['Request documents for the booking', 3]];
const iso = (d) => { const t = new Date(); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
const call = (m, u, b) => page.evaluate(async (m, u, b, h) => { const r = await fetch(u, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return { s: r.status, d: JSON.parse(t) }; } catch { return { s: r.status, d: t }; } }, m, u, b, H);

for (const cc of ['pk', 'us', 'uk', 'ae', 'ca']) {
  const ws = `shotre-${cc}`;
  await page.goto(`http://${ws}.localhost:4000/login`, { waitUntil: 'networkidle2' });
  const login = await call('POST', '/api/auth/login', { identifier: `sana@${ws}.test`, password: PASSWORD });
  if (login.s !== 200) { console.log(ws, 'login failed', login.s); continue; }
  const roles = (await call('GET', '/api/settings/roles')).d;
  const agentRole = (Array.isArray(roles) ? roles : roles.rows || []).find((r) => r.name === 'Sales Agent');
  const agentIds = [];
  for (const [name, handle] of AGENTS) {
    const email = `${handle}@${ws}.test`;
    const made = await call('POST', '/api/settings/users', { name, email, password: PASSWORD, role_id: agentRole.id });
    const list = (await call('GET', '/api/settings/users')).d;
    const u = (Array.isArray(list) ? list : list.rows || []).find((x) => x.email === email);
    agentIds.push(u?.id);
    if (made.s !== 201 && made.s !== 400) console.log(ws, 'agent', name, made.s, JSON.stringify(made.d).slice(0, 80));
  }
  const stages = (await call('GET', '/api/pipeline')).d.stages || [];
  const stageId = (v) => stages.find((s) => s.value === v)?.id;
  const existing = (await call('GET', '/api/contacts?type=lead&limit=200')).d.rows || [];
  const ids = [];
  for (const [i, [name, source, stage, a, prio]] of LEADS.entries()) {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`;
    const have = existing.find((c) => c.email === email);
    // amounts are stored in minor units (cents), so 180,000 is 18,000,000
    const budget = (180 + i * 35) * 1000 * 100;
    if (have) { ids.push(have.id); await call('PUT', `/api/contacts/${have.id}`, { budget }); continue; }
    const r = await call('POST', '/api/contacts', { full_name: name, phone: `+1 555 01${String(10 + i).padStart(2, '0')}`, email, lead_source: source, agent_id: agentIds[a], priority: prio, budget, followup_date: iso((i % 5) - 1), type: 'lead' });
    if (r.s !== 201 && r.s !== 200) { console.log(ws, 'lead', name, r.s, JSON.stringify(r.d).slice(0, 100)); continue; }
    const id = r.d.id; ids.push(id);
    if (stageId(stage)) await call('PUT', '/api/pipeline/move', { contact_id: id, stage_id: stageId(stage) });
  }
  const have = (await call('GET', '/api/tasks?status=open')).d.length;
  if (have < 4) for (const [i, [title, d]] of TASKS.entries()) await call('POST', '/api/tasks', { entity_type: 'contact', entity_id: ids[i % ids.length], title, due_date: iso(d), assigned_to: agentIds[i % 3] });
  console.log(ws, 'agents', agentIds.filter(Boolean).length, 'leads', ids.length);
}
await browser.close();
