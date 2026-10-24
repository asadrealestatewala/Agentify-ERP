// End-to-end check of the plugin against a real WordPress and a real Agentify server (both local). See ../README.md.
// Needs: AGENTIFY_URL (default http://localhost:4100, demo data), WP_URL (default http://localhost:8080), WP_DIR (WordPress folder),
// WP_ADMIN / WP_PASS. Run: node wordpress-plugin/tests/e2e.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const AG = process.env.AGENTIFY_URL || 'http://localhost:4100';
const WP = process.env.WP_URL || 'http://localhost:8080';
const WP_DIR = process.env.WP_DIR;
const ADMIN = process.env.WP_ADMIN || 'admin', PASS = process.env.WP_PASS || 'Adm1n!Pass123';
assert.ok(WP_DIR, 'set WP_DIR to the WordPress folder');

const jar = () => { const c = {}; return { c, set(r) { for (const s of r.headers.getSetCookie?.() || []) { const [kv] = s.split(';'); const i = kv.indexOf('='); c[kv.slice(0, i)] = kv.slice(i + 1); } }, header: () => Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ') }; };
async function http(base, j, method, path, { body, form, headers = {} } = {}) {
  const h = { cookie: j.header(), ...headers };
  let b;
  if (form) { b = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
  else if (body) { b = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const r = await fetch(base + path, { method, headers: h, body: b, redirect: 'manual' });
  j.set(r); const text = await r.text();
  return { status: r.status, text, location: r.headers.get('location') || '', json: () => JSON.parse(text) };
}
const php = (code) => execFileSync('php', ['-r', `define('WP_USE_THEMES',false); require '${WP_DIR}/wp-load.php'; ${code}`], { encoding: 'utf8' }).trim();

// --- Agentify: a connection for the plugin
const ag = jar();
assert.equal((await http(AG, ag, 'POST', '/api/auth/login', { body: { identifier: 'admin@expertdevelopers.pk', password: 'Demo@12345' }, headers: { 'x-requested-with': 'ERP' } })).status, 200);
const made = (await http(AG, ag, 'POST', '/api/website-integrations/connections', { body: { name: 'WP e2e', platform: 'wordpress', scopes: ['leads:write', 'listings:read', 'webhooks:manage'], config: { lead_source: 'WordPress form' } }, headers: { 'x-requested-with': 'ERP' } })).json();
const KEY = made.key; assert.match(KEY, /^agf_\d+_/);

// --- WordPress: sign in, switch the plugin on, fill in the settings page like a person would
const wp = jar();
await http(WP, wp, 'GET', '/wp-login.php'); wp.c.wordpress_test_cookie = 'WP Cookie check';
const login = await http(WP, wp, 'POST', '/wp-login.php', { form: { log: ADMIN, pwd: PASS, 'wp-submit': 'Log In', redirect_to: `${WP}/wp-admin/`, testcookie: '1' } });
assert.equal(login.status, 302, 'WordPress sign-in');
const plugins = await http(WP, wp, 'GET', '/wp-admin/plugins.php');
const act = /href="(plugins\.php\?action=activate&amp;plugin=agentify-connect[^"]+)"/.exec(plugins.text);
if (act) await http(WP, wp, 'GET', '/wp-admin/' + act[1].replace(/&amp;/g, '&'));
const settings = await http(WP, wp, 'GET', '/wp-admin/options-general.php?page=agentify-connect');
assert.match(settings.text, /Agentify Connect/);
const nonce = (html) => /name="_wpnonce" value="([^"]+)"/.exec(html)[1];
const save = await http(WP, wp, 'POST', '/wp-admin/admin-post.php', { form: { action: 'agentify_save', _wpnonce: nonce(settings.text), base_url: AG, api_key: KEY, consent_text: 'I agree to the privacy notice' } });
assert.equal(save.status, 302);
assert.equal((await http(WP, wp, 'POST', '/wp-admin/admin-post.php', { form: { action: 'agentify_save', _wpnonce: nonce(settings.text), base_url: 'http://evil.example', api_key: KEY } })).status, 302);
assert.equal(JSON.parse(php('echo json_encode(Agentify_Client::options()["base_url"]);')), AG, 'a non-https workspace address is refused');
assert.equal((await http(WP, wp, 'POST', '/wp-admin/admin-post.php', { form: { action: 'agentify_save', _wpnonce: 'bad', base_url: AG } })).status, 403, 'settings need a valid nonce');
const afterSave = await http(WP, wp, 'GET', '/wp-admin/options-general.php?page=agentify-connect');
assert.ok(!afterSave.text.includes(KEY) && afterSave.text.includes(KEY.slice(-4)), 'the saved key is never shown again');
const test = await http(WP, wp, 'POST', '/wp-admin/admin-post.php', { form: { action: 'agentify_test', _wpnonce: nonce(afterSave.text.split('agentify_test')[1] || afterSave.text) } });
const noticePage = await http(WP, wp, 'GET', '/wp-admin/options-general.php?page=agentify-connect');
assert.match(noticePage.text, /Connected to|Could not connect/);
assert.match(noticePage.text, /Connected to .*Permissions: leads:write, listings:read, webhooks:manage/s, 'Test connection reaches Agentify');

// --- a page with both shortcodes
const pageId = php('echo wp_insert_post(["post_title"=>"Properties","post_name"=>"properties","post_status"=>"publish","post_type"=>"page","post_content"=>"[agentify_listings per_page=\\"3\\"]\\n[agentify_form title=\\"Contact us\\"]"]);');
const visitor = jar();
const page = await http(WP, visitor, 'GET', '/?page_id=' + pageId);
assert.equal(page.status, 200);
assert.ok(!page.text.includes(KEY), 'the key is never in a public page');
assert.match(page.text, /agentify-card/, 'listings are shown');
assert.match(page.text, /name="consent"/, 'the privacy tick-box shows');
const code = /agentify_listing=([^"&]+)/.exec(page.text)[1];
const detail = await http(WP, visitor, 'GET', `/?page_id=${pageId}&agentify_listing=${code}`);
assert.match(detail.text, /Ask about this property/); assert.ok(detail.text.includes(`name="property_ref" value="${decodeURIComponent(code)}"`));
const gone = await http(WP, visitor, 'GET', `/?page_id=${pageId}&agentify_listing=NOPE-404`);
assert.match(gone.text, /no longer available/);

// --- leads
const rnd = () => crypto.randomBytes(4).toString('hex').replace(/[0-9]/g, (d) => 'ghijklmnop'[d]);
const PH = () => `+92 3${Math.floor(Math.random() * 90 + 10)} ${Math.floor(Math.random() * 9000000 + 1000000)}`;
php('global $wpdb; $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE \'_transient%agentify%\'");'); // a clean rate limit for each run
const NAMES = { Zara: `Zara ${rnd()}`, Nadia: `Nadia ${rnd()}`, Bot: `Bot ${rnd()}` };
const PHONES = { Zara: PH() };
const lead = (o) => Object.fromEntries(Object.entries({ action: 'agentify_lead', ag_title: 'Contact us', enquiry_type: 'inquiry', page_url: `${WP}/?page_id=${pageId}`, name: NAMES.Zara, phone: PHONES.Zara, email: '', message: 'Viewing please', consent: '1', ...o }).filter(([, v]) => v !== undefined));
const post = (o) => http(WP, jar(), 'POST', '/wp-admin/admin-post.php', { form: lead(o), headers: { referer: `${WP}/?page_id=${pageId}` } });
const ok = await post({ utm_source: 'google', utm_campaign: 'autumn' });
assert.equal(ok.status, 302); assert.match(ok.location, /agentify=ok/);
const contacts = async (q) => JSON.stringify((await http(AG, ag, 'GET', '/api/contacts?q=' + encodeURIComponent(q), { headers: { 'x-requested-with': 'ERP' } })).json());
assert.ok((await contacts(NAMES.Zara)).includes(NAMES.Zara), 'the lead is in the CRM');
const found = (await http(AG, ag, 'GET', '/api/contacts?q=' + encodeURIComponent(NAMES.Zara), { headers: { 'x-requested-with': 'ERP' } })).json();
const cid = found.rows[0].id;
const ws = (await http(AG, ag, 'GET', `/api/contacts/${cid}/workspace`, { headers: { 'x-requested-with': 'ERP' } })).json();
const at = ws.attribution[0];
assert.equal(at.form, 'WordPress: Contact us'); assert.equal(at.utm.utm_source, 'google'); assert.equal(at.utm.utm_campaign, 'autumn');
assert.equal(at.consent.privacy, true); assert.equal(at.consent.text, 'I agree to the privacy notice'); assert.ok(!('connection_id' in at));
const noConsent = await post({ name: NAMES.Nadia, phone: PH(), consent: undefined });
assert.match(noConsent.location, /agentify=err/); assert.ok(!(await contacts(NAMES.Nadia)).includes(NAMES.Nadia), 'no consent, no lead');
const bot = await post({ name: NAMES.Bot, phone: PH(), website: 'http://spam' });
assert.match(bot.location, /agentify=ok/); assert.ok(!(await contacts(NAMES.Bot)).includes(NAMES.Bot), 'honeypot catches bots without telling them');
const bad = await post({ name: 'Agent 007', phone: PH() });
assert.match(bad.location, /agentify=err/);
const errPage = await http(WP, bad.cookie ? bad : jar(), 'GET', '/?page_id=' + pageId + '&agentify=err');
assert.ok(!/Fatal|Warning:/.test(errPage.text));
const dup = await post({ name: NAMES.Zara, phone: PHONES.Zara, message: 'Viewing please' });
assert.match(dup.location, /agentify=ok/);
const attrib = (await http(AG, ag, 'GET', '/api/website-integrations/connections', { headers: { 'x-requested-with': 'ERP' } })).json();
assert.ok(JSON.stringify(attrib).includes('WP e2e'));

// --- change notifications: only a valid signature clears the cache
const SECRET = 'whsec_test_' + crypto.randomBytes(8).toString('hex');
php(`Agentify_Client::save(["webhook_secret"=>"${SECRET}"]);`);
const body = JSON.stringify({ id: crypto.randomUUID(), type: 'listing.updated', created_at: new Date().toISOString(), data: { id: 1 } });
const sign = (t, s = SECRET) => `t=${t},v1=${crypto.createHmac('sha256', s).update(`${t}.${body}`).digest('hex')}`;
const v = () => php('echo get_option("agentify_cache_v");');
const before = v();
const send = async (sig) => { const r = await fetch(WP + '/?rest_route=/agentify/v1/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'agentify-signature': sig }, body }); return r.status; };
const now = Math.floor(Date.now() / 1000);
assert.equal(await send(sign(now, 'wrong-secret')), 401);
assert.equal(await send(sign(now - 3600)), 401, 'old deliveries are refused');
assert.equal(await send('garbage'), 401);
assert.equal(v(), before, 'refused deliveries change nothing');
assert.equal(await send(sign(now)), 200);
assert.notEqual(v(), before, 'a valid delivery refreshes the listings');
console.log('wordpress plugin e2e: all checks passed');
