// First-party, privacy-conscious website analytics for the public marketing site (platform host only).
//
// * Browser events are accepted only with the visitor's consent and never when the browser sends Do Not Track or
//   Global Privacy Control. Identifiers are random ids made in the browser (no cookies, no fingerprinting); IP addresses
//   and user agents are not stored. Paths are stored without query strings; campaign tags (utm_*) are kept separately.
// * Server events (signup_completed, checkout_started, subscription_activated, demo_requested) are counted for every
//   visitor, but carry a visitor/session id only when the visitor consented.
// * Kept apart from tenant ERP data: these rows live in the platform database and never in a workspace.
// * Optional Google Analytics 4: when a measurement id is saved in the console, the browser also sends the same events
//   to GA4, again only after consent.
import { platformDb } from '../platform.js';
import { bad } from '../util.js';

const pdb = () => platformDb();
export const ANALYTICS_SCHEMA = `
CREATE TABLE IF NOT EXISTS analytics_events(
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), name TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'web', visitor_id TEXT, session_id TEXT,
  path TEXT, landing_page TEXT, referrer_host TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, channel TEXT, product TEXT, plan TEXT, tenant_id INTEGER, props TEXT);
CREATE INDEX IF NOT EXISTS idx_an_ts ON analytics_events(ts);
CREATE INDEX IF NOT EXISTS idx_an_name_ts ON analytics_events(name, ts);
CREATE INDEX IF NOT EXISTS idx_an_session ON analytics_events(session_id, ts);
`;
export const WEB_EVENTS = ['page_view', 'product_page_view', 'pricing_view', 'signup_started', 'demo_form_view', 'cta_start_trial', 'cta_book_demo', 'cta_founding_customer', 'cta_explore_crm', 'tour_tab', 'market_select'];
export const SERVER_EVENTS = ['signup_completed', 'demo_requested', 'checkout_started', 'subscription_activated'];
const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const SEARCH = /(^|\.)(google|bing|yahoo|duckduckgo|baidu|yandex|ecosia)\./i;
const SOCIAL = /(^|\.)(facebook|fb|instagram|linkedin|lnkd|twitter|x|t\.co|youtube|tiktok|pinterest|reddit|whatsapp)\./i;

let ready = false;
const ensure = () => { if (!ready) { pdb().exec(ANALYTICS_SCHEMA); ready = true; } };

const clean = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const cleanPath = (p) => { const s = String(p || '').split(/[?#]/)[0]; return /^\/[\w\-/.]{0,190}$/.test(s) ? s : null; };
const hostOf = (u) => { try { return new URL(String(u)).hostname.toLowerCase().replace(/^www\./, '').slice(0, 120); } catch { return null; } };

/** Marketing channel from campaign tags and the referring site. */
export function channelOf({ utm_source, utm_medium, referrer_host }, ownHost = '') {
  const m = String(utm_medium || '').toLowerCase();
  if (/cpc|ppc|paid|display|cpm/.test(m)) return 'Paid';
  if (/email|newsletter/.test(m)) return 'Email';
  if (/social/.test(m)) return 'Social';
  if (utm_source) return 'Campaign';
  if (!referrer_host || (ownHost && referrer_host.endsWith(ownHost))) return 'Direct';
  if (SEARCH.test(referrer_host)) return 'Organic search';
  if (SOCIAL.test(referrer_host)) return 'Social';
  return 'Referral';
}

/** Does the browser ask not to be tracked? */
export const optedOut = (req) => req.headers.dnt === '1' || req.headers['sec-gpc'] === '1';

/** Browser events (POST /api/platform/analytics/collect). Without consent nothing is stored. */
export function collect(req, body, ownHost) {
  ensure();
  if (optedOut(req) || body?.consent !== true) return { stored: 0, reason: 'no_consent' };
  const list = Array.isArray(body.events) ? body.events.slice(0, 20) : [body];
  const visitor = ID_RE.test(String(body.visitor_id || '')) ? body.visitor_id : null;
  const session = ID_RE.test(String(body.session_id || '')) ? body.session_id : null;
  if (!visitor || !session) throw bad('visitor_id and session_id are required');
  let stored = 0;
  const ins = pdb().prepare('INSERT INTO analytics_events(name,source,visitor_id,session_id,path,landing_page,referrer_host,utm_source,utm_medium,utm_campaign,channel,product,plan,props) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const e of list) {
    if (!WEB_EVENTS.includes(e?.name)) continue;
    const ref = hostOf(e.referrer);
    const utm = { utm_source: clean(e.utm_source, 80), utm_medium: clean(e.utm_medium, 80), utm_campaign: clean(e.utm_campaign, 120) };
    ins.run(e.name, 'web', visitor, session, cleanPath(e.path), cleanPath(e.landing_page), ref, utm.utm_source, utm.utm_medium, utm.utm_campaign, channelOf({ ...utm, referrer_host: ref }, ownHost),
      ['real_estate', 'construction'].includes(e.product) ? e.product : null, clean(e.plan, 40), e.where ? JSON.stringify({ where: clean(e.where, 30) }) : null);
    stored += 1;
  }
  return { stored };
}

/** Events the server knows happened (signups, checkouts, activations, demo requests). */
export function recordServerEvent(name, p = {}) {
  try {
    ensure();
    if (!SERVER_EVENTS.includes(name)) return;
    const consent = p.consent === true;
    const visitor = consent && ID_RE.test(String(p.visitor_id || '')) ? p.visitor_id : null;
    const session = consent && ID_RE.test(String(p.session_id || '')) ? p.session_id : null;
    const utm = consent ? { s: clean(p.utm_source, 80), m: clean(p.utm_medium, 80), c: clean(p.utm_campaign, 120) } : { s: null, m: null, c: null };
    pdb().prepare('INSERT INTO analytics_events(name,source,visitor_id,session_id,landing_page,utm_source,utm_medium,utm_campaign,channel,product,plan,tenant_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(name, 'server', visitor, session, consent ? cleanPath(p.landing_page) : null, utm.s, utm.m, utm.c, consent ? channelOf({ utm_source: utm.s, utm_medium: utm.m, referrer_host: hostOf(p.referrer) }) : null,
        ['real_estate', 'construction', 'bundle'].includes(p.product) ? p.product : null, clean(p.plan, 40), p.tenant_id ? Number(p.tenant_id) : null);
  } catch (e) { console.error('[analytics]', e.message); }
}

const rate = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
/**
 * Dashboard for a date range (UTC 'YYYY-MM-DD HH:MM:SS' bounds). Visitor and session figures cover consenting visitors
 * only, which the dashboard states; server-side conversions count everyone.
 */
export function analyticsReport({ from, to, buckets = [], keyExpr }) {
  ensure();
  const W = 'ts>=? AND ts<?';
  const one = (sql, ...a) => pdb().prepare(sql).get(from, to, ...a);
  const rows = (sql, ...a) => pdb().prepare(sql).all(from, to, ...a);
  const pv = one(`SELECT COUNT(*) n, COUNT(DISTINCT visitor_id) v, COUNT(DISTINCT session_id) s FROM analytics_events WHERE ${W} AND name='page_view'`);
  const count = (name) => one(`SELECT COUNT(*) n FROM analytics_events WHERE ${W} AND name=?`, name).n;
  const sessionsWith = (name) => one(`SELECT COUNT(DISTINCT session_id) n FROM analytics_events WHERE ${W} AND name=? AND session_id IS NOT NULL`, name).n;
  // a session's channel and landing page are those of its first page view
  const firsts = rows(`SELECT e.session_id, e.channel, e.landing_page, e.path FROM analytics_events e
    WHERE e.ts>=? AND e.ts<? AND e.name='page_view' AND e.id=(SELECT MIN(id) FROM analytics_events x WHERE x.session_id=e.session_id AND x.name='page_view')`);
  const conv = new Set(rows(`SELECT DISTINCT session_id FROM analytics_events WHERE ${W} AND name='signup_completed' AND session_id IS NOT NULL`).map((r) => r.session_id));
  const demo = new Set(rows(`SELECT DISTINCT session_id FROM analytics_events WHERE ${W} AND name='demo_requested' AND session_id IS NOT NULL`).map((r) => r.session_id));
  const group = (key) => {
    const m = {};
    for (const f of firsts) { const k = f[key] || f.path || '(unknown)'; const g = (m[k] ||= { key: k, sessions: 0, signups: 0, demos: 0 }); g.sessions += 1; if (conv.has(f.session_id)) g.signups += 1; if (demo.has(f.session_id)) g.demos += 1; }
    return Object.values(m).map((g) => ({ ...g, signup_rate: rate(g.signups, g.sessions), demo_rate: rate(g.demos, g.sessions) })).sort((a, b) => b.sessions - a.sessions).slice(0, 20);
  };
  const pages = rows(`SELECT path, COUNT(*) views, COUNT(DISTINCT visitor_id) visitors FROM analytics_events WHERE ${W} AND name='page_view' GROUP BY path ORDER BY views DESC LIMIT 20`);
  const engaged = one(`SELECT COUNT(*) n FROM (SELECT session_id FROM analytics_events WHERE ${W} AND name='page_view' GROUP BY session_id HAVING COUNT(*)>1)`).n;
  const series = keyExpr ? (() => {
    const r1 = rows(`SELECT ${keyExpr('ts')} k, COUNT(DISTINCT session_id) s, COUNT(DISTINCT visitor_id) v FROM analytics_events WHERE ${W} AND name='page_view' GROUP BY k`);
    const r2 = rows(`SELECT ${keyExpr('ts')} k, name, COUNT(*) n FROM analytics_events WHERE ${W} AND name IN ('signup_completed','demo_requested') GROUP BY k, name`);
    return buckets.map((k) => ({ x: k, sessions: r1.find((r) => r.k === k)?.s || 0, visitors: r1.find((r) => r.k === k)?.v || 0, signups: r2.find((r) => r.k === k && r.name === 'signup_completed')?.n || 0, demos: r2.find((r) => r.k === k && r.name === 'demo_requested')?.n || 0 }));
  })() : [];
  const signups = count('signup_completed');
  return {
    note: 'Visitors, sessions, channels and landing pages count only visitors who accepted analytics cookies. Sign-ups, demo requests, checkouts and activations are counted for everyone from server records.',
    visitors: pv.v, sessions: pv.s, page_views: pv.n, engaged_sessions: engaged, engagement_rate: rate(engaged, pv.s), pages_per_session: pv.s ? Math.round((pv.n / pv.s) * 10) / 10 : null,
    funnel: {
      product_page_views: count('product_page_view'), pricing_views: count('pricing_view'), signup_started: sessionsWith('signup_started'), signup_completed: signups,
      demo_requested: count('demo_requested'), checkout_started: count('checkout_started'), subscription_activated: count('subscription_activated'),
      signup_conversion: rate(conv.size, pv.s), demo_conversion: rate(demo.size, pv.s),
    },
    by_product: rows(`SELECT product, name, COUNT(*) n FROM analytics_events WHERE ${W} AND product IS NOT NULL AND name IN ('signup_completed','demo_requested','subscription_activated','product_page_view') GROUP BY product, name`),
    channels: group('channel'), landing_pages: group('landing_page'), pages,
    campaigns: rows(`SELECT utm_source source, utm_medium medium, utm_campaign campaign, COUNT(DISTINCT session_id) sessions FROM analytics_events WHERE ${W} AND utm_source IS NOT NULL GROUP BY 1,2,3 ORDER BY sessions DESC LIMIT 20`),
    series,
  };
}
