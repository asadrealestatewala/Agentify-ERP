// Integration registry for the platform: what is connected, how it is configured, when it was last tested and what went
// wrong. An integration is only shown as "connected" after a real request to the provider succeeded; saving settings
// alone shows "configured, not tested". Secrets are stored encrypted (platformConfig) and never sent back to the browser.
// Outbound requests go only to https URLs on public addresses (no internal network targets).
import dns from 'node:dns/promises';
import net from 'node:net';
import { platformDb } from '../platform.js';
import { getSetting, setSetting, mask } from './platformConfig.js';
import { stripeView, stripeConfig } from './platformConfig.js';
import { testConnection } from './stripe.js';
import { setMailConfig, setMailLogger, sendMail, layout } from './mailer.js';
import { logSent } from './emailLog.js';
import { listBackups } from './backup.js';
import { bad, HttpError } from '../util.js';
import { PROVIDERS as OAUTH, appCreds, saveAppCreds, clearAppCreds, testAppCreds } from './oauthApps.js';

const pdb = () => platformDb();
export const INTEGRATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS integration_events(id INTEGER PRIMARY KEY, integration TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT, actor TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_integration_events ON integration_events(integration, id);
`;
let ready = false;
const ensure = () => { if (!ready) { pdb().exec(INTEGRATION_SCHEMA); ready = true; } };

export function logEvent(integration, action, outcome, detail = null, actor = null) {
  ensure();
  pdb().prepare('INSERT INTO integration_events(integration,action,outcome,detail,actor) VALUES(?,?,?,?,?)').run(integration, action, outcome, detail ? String(detail).slice(0, 500) : null, actor);
}
const lastTest = (id) => { ensure(); return pdb().prepare("SELECT outcome, detail, created_at FROM integration_events WHERE integration=? AND action='test' ORDER BY id DESC LIMIT 1").get(id) || null; };
const lastConfigAt = (id) => { ensure(); return pdb().prepare("SELECT created_at FROM integration_events WHERE integration=? AND action='configure' ORDER BY id DESC LIMIT 1").get(id)?.created_at || null; };

// ---------------------------------------------------------------- email delivery uses the console settings first, then env
setMailConfig(() => {
  const from = getSetting('mail_from') || process.env.MAIL_FROM || null;
  // automated mail is sent from no-reply@; replies go to the monitored inbox (hello@ on our own domain unless the console says otherwise)
  const replyTo = getSetting('mail_reply_to') || (from && /@agentifyerp\.co>?\s*$/i.test(from) ? 'hello@agentifyerp.co' : null);
  return { key: getSetting('resend_api_key') || process.env.RESEND_API_KEY || null, from, replyTo };
});
setMailLogger(logSent);

/** Only https URLs whose host resolves to public addresses. */
export async function assertPublicHttps(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw bad('Enter a full https:// URL'); }
  if (u.protocol !== 'https:') throw bad('Only https:// URLs are allowed');
  if (u.username || u.password) throw bad('URLs with credentials are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw bad('That host name could not be resolved'); });
  const priv = (ip) => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) || ip === '::1' || /^f[cd]|^fe80|^::ffff:(10|127|192\.168)\./i.test(ip);
  if (addrs.some((a) => priv(a.address))) throw bad('Internal network addresses are not allowed');
  return u.toString();
}

const state = (configured, test) => (!configured ? 'not_configured' : !test ? 'configured' : test.outcome === 'success' ? 'connected' : 'error');

/** Every integration with its real state. */
export function registry() {
  const resendKey = getSetting('resend_api_key') || process.env.RESEND_API_KEY;
  const stripe = stripeView();
  const ga = getSetting('ga4_measurement_id');
  const hook = getSetting('alerts_webhook_url');
  const backups = listBackups();
  const items = [
    { id: 'email', name: 'Transactional email (Resend)', category: 'Messaging', purpose: 'Verification, invitations, password resets, receipts, trial and renewal reminders.',
      configured: !!resendKey, settings: { api_key: mask(getSetting('resend_api_key')), from: getSetting('mail_from') || process.env.MAIL_FROM || '', reply_to: getSetting('mail_reply_to') || '', webhook_secret: mask(getSetting('resend_webhook_secret')), env_key: !!process.env.RESEND_API_KEY && !getSetting('resend_api_key') }, test: lastTest('email'),
      note: resendKey ? null : 'Without a key, emails are only written to the server log. Invitation and reset links are shown to the admin instead.' },
    { id: 'stripe', name: 'Card payments (Stripe)', category: 'Payments', purpose: 'Hosted checkout, recurring card billing, customer portal and signed webhooks.',
      configured: !!stripe.ready, settings: { mode: stripe.mode }, test: lastTest('stripe'), manage: '/platform/billing/stripe' },
    { id: 'ga4', name: 'Google Analytics 4', category: 'Analytics', purpose: 'Optional second destination for website events, only after visitor consent.',
      configured: !!ga, settings: { measurement_id: ga || '' }, test: null, note: ga ? 'Google does not offer a way to verify a measurement ID from the server; check Realtime in Google Analytics after accepting cookies on the website.' : 'First-party analytics work without it.' },
    { id: 'alerts', name: 'Alerts webhook (Slack, Teams or similar)', category: 'Monitoring', purpose: 'Sends server errors, failed background jobs, failed payments and webhook errors to a chat channel.',
      configured: !!hook, settings: { url: mask(hook) }, test: lastTest('alerts') },
    { id: 'backups', name: 'Database backups', category: 'Reliability', purpose: 'Scheduled snapshots of the platform and every workspace database.',
      configured: process.env.BACKUP_ENABLED !== '0', settings: {}, test: backups[0] ? { outcome: backups[0].errors?.length ? 'error' : 'success', detail: backups[0].errors?.join('; ') || `Last snapshot ${backups[0].name}`, created_at: backups[0].created_at } : null, manage: '/platform/backups' },
    ...Object.entries(OAUTH).map(([p, d]) => ({ id: `oauth_${p}`, name: `${d.label} app (sign-in and connections)`, category: 'Customer integrations', purpose: p === 'google' ? 'Lets customers sign in with Google and connect Google Calendar.' : p === 'apple' ? 'Lets customers sign in with Apple.' : `Lets customers connect ${d.label} to post and schedule content.`,
      configured: !!appCreds(p), settings: { client_id: appCreds(p)?.client_id || '', redirect: 'https://<your main domain>/api/platform/oauth/' + p + '/callback', developer_console: d.console }, test: lastTest(`oauth_${p}`),
      note: `Register one app in the ${d.label} developer console, with the redirect address above. ${p === 'google' ? 'Add the Calendar API and the calendar.events scope.' : ''}` })),
    { id: 'sms', name: 'SMS / WhatsApp provider', category: 'Messaging', purpose: 'Text reminders to customers.', configured: false, settings: {}, test: null, available: false,
      note: 'No provider adapter is installed yet. Staff can send WhatsApp messages from the app with click-to-chat links.' },
  ];
  return items.map((i) => ({ ...i, state: i.available === false ? 'not_available' : i.id === 'stripe' && !i.test && i.configured ? 'configured' : state(i.configured, i.test), configured_at: lastConfigAt(i.id),
    events: (ensure(), pdb().prepare('SELECT action, outcome, detail, actor, created_at FROM integration_events WHERE integration=? ORDER BY id DESC LIMIT 10').all(i.id)) }));
}

export async function configure(id, b, actor) {
  if (id === 'email') {
    if (b.api_key) { if (b.api_key && !/^re_[A-Za-z0-9_]{10,}$/.test(b.api_key)) throw bad('A Resend API key starts with re_'); setSetting('resend_api_key', b.api_key || null, { secret: true, by: actor }); }
    if (b.from !== undefined) { if (b.from && !/^[^<>]{0,60}<?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(b.from)) throw bad('From must look like: Agentify ERP <no-reply@yourdomain.com>'); setSetting('mail_from', b.from || null, { by: actor }); }
    if (b.webhook_secret) { if (!/^whsec_[A-Za-z0-9+/=_-]{16,}$/.test(String(b.webhook_secret).trim())) throw bad('A Resend webhook signing secret starts with whsec_'); setSetting('resend_webhook_secret', String(b.webhook_secret).trim(), { secret: true, by: actor }); }
    if (b.reply_to !== undefined) { const r = String(b.reply_to || '').trim(); if (r && !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/.test(r)) throw bad('Reply-To must be one e-mail address'); setSetting('mail_reply_to', r || null, { by: actor }); }
  } else if (id === 'ga4') {
    const v = String(b.measurement_id || '').trim().toUpperCase();
    if (v && !/^G-[A-Z0-9]{4,16}$/.test(v)) throw bad('A GA4 measurement ID looks like G-XXXXXXXXXX');
    setSetting('ga4_measurement_id', v || null, { by: actor });
  } else if (id === 'alerts') {
    if (!b.url) throw bad('Enter the webhook URL (use Disconnect to remove it)');
    setSetting('alerts_webhook_url', await assertPublicHttps(b.url), { secret: true, by: actor });
  } else if (id.startsWith('oauth_') && OAUTH[id.slice(6)]) {
    saveAppCreds(id.slice(6), b, actor);
  } else throw new HttpError(400, 'This integration is configured on its own page');
  logEvent(id, 'configure', 'success', `Settings saved: ${Object.keys(b).filter((k) => !/key|url/.test(k)).join(', ') || 'credentials'}`, actor);
  return registry().find((i) => i.id === id);
}

export async function disconnect(id, actor) {
  if (id === 'email') { setSetting('resend_api_key', null); setSetting('mail_from', null); setSetting('resend_webhook_secret', null); setSetting('mail_reply_to', null); }
  else if (id === 'ga4') setSetting('ga4_measurement_id', null);
  else if (id === 'alerts') setSetting('alerts_webhook_url', null);
  else if (id.startsWith('oauth_') && OAUTH[id.slice(6)]) clearAppCreds(id.slice(6));
  else throw new HttpError(400, 'This integration cannot be disconnected here');
  logEvent(id, 'disconnect', 'success', 'Credentials removed', actor);
  return registry().find((i) => i.id === id);
}

/** A real request to the provider. Only a success marks the integration as connected. */
export async function test(id, actor, { to } = {}) {
  let outcome = 'error', detail = '';
  try {
    if (id === 'email') {
      if (!(getSetting('resend_api_key') || process.env.RESEND_API_KEY)) throw new Error('No API key saved');
      const ok = await sendMail({ to, subject: 'Agentify ERP: email test', ...layout({ heading: 'Email delivery works', lines: ['This test was sent from the platform console.'] }), type: 'test' });
      if (!ok) throw new Error('The provider did not accept the message (check the key and the From domain)');
      outcome = 'success'; detail = `Test email accepted by the provider for ${to}`;
    } else if (id === 'stripe') {
      const r = await testConnection(stripeConfig().secret_key);
      if (!r.ok) throw new Error(r.error);
      outcome = 'success'; detail = `Stripe answered (${r.livemode ? 'live' : 'test'} mode)`;
    } else if (id === 'alerts') {
      const url = getSetting('alerts_webhook_url');
      if (!url) throw new Error('No webhook URL saved');
      await assertPublicHttps(url);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Agentify ERP: alerts webhook test' }), signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!res.ok) throw new Error(`The webhook answered ${res.status}`);
      outcome = 'success'; detail = `Webhook answered ${res.status}`;
    } else if (id.startsWith('oauth_') && OAUTH[id.slice(6)]) {
      detail = await testAppCreds(id.slice(6)); outcome = 'success';
    } else throw new Error('This integration has no test');
  } catch (e) { detail = e.message || String(e); }
  logEvent(id, 'test', outcome, detail, actor);
  return { ok: outcome === 'success', detail, integration: registry().find((i) => i.id === id) };
}

let lastAlert = 0;
/** Post an operational alert to the configured webhook (at most one per minute; never throws). */
export async function sendAlert(text) {
  try {
    const url = getSetting('alerts_webhook_url');
    if (!url || Date.now() - lastAlert < 60_000) return false;
    lastAlert = Date.now();
    await assertPublicHttps(url);
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `Agentify ERP: ${String(text).slice(0, 900)}` }), signal: AbortSignal.timeout(10_000), redirect: 'error' });
    logEvent('alerts', 'send', res.ok ? 'success' : 'error', res.ok ? String(text).slice(0, 200) : `Webhook answered ${res.status}`);
    return res.ok;
  } catch (e) { try { logEvent('alerts', 'send', 'error', e.message); } catch { /* db closed */ } return false; }
}
