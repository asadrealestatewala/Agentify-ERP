// The Resend connection as the Super Admin sees it: is the key saved and does it work, which capabilities it has (send, domains,
// webhooks, usage), is our webhook registered and have events arrived, and is inbound reply detection configured.
// Every call goes through the swappable provider, so tests use a recorded/fake one. The API key is never returned or logged.
import { getSetting, setSetting } from './platformConfig.js';
import { emailProvider, providerConfigured } from './emailProvider.js';
import { webhookStatus } from './emailLog.js';
import { inboundDomain } from './emailInbound.js';
import { syncProviderUsage } from './tenantEmail.js';
import { bad } from '../util.js';

export const WEBHOOK_PATH = '/api/platform/webhooks/resend';
/** Delivery events plus inbound mail. Opens and clicks are deliberately not subscribed: nothing here uses them. */
export const WEBHOOK_EVENTS = ['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed', 'email.received'];

const json = (k) => { try { return JSON.parse(getSetting(k) || 'null'); } catch { return null; } };
const stamp = (nowMs = Date.now()) => new Date(nowMs).toISOString();
const msg = (e) => String(e?.message || e || 'failed').slice(0, 240);

export function connectionStatus(baseUrl) {
  const key = getSetting('resend_api_key');
  const wh = webhookStatus();
  return {
    key: { saved: !!(key || process.env.RESEND_API_KEY), source: key ? 'console' : process.env.RESEND_API_KEY ? 'server environment' : null, last4: key ? key.slice(-4) : null },
    last_test: json('resend_connection_test'),
    webhook: { url: baseUrl ? `${baseUrl}${WEBHOOK_PATH}` : null, secret_saved: !!getSetting('resend_webhook_secret'), registered: json('resend_webhook_registration'), events: WEBHOOK_EVENTS, last_event_at: wh.last_event_at, last_event_type: wh.last_event_type, last_mail_at: wh.last_mail_at },
    inbound: { domain: inboundDomain(), on: !!inboundDomain(), webhook_event: 'email.received', last_mail_at: wh.last_mail_at, receiving_domains: (json('resend_connection_test')?.checks?.domains?.list || []).filter((d) => d.receiving && d.status === 'verified').map((d) => d.name) },
    usage: { at: json('email_provider_usage')?.at || null, error: getSetting('email_provider_usage_error') || null },
    provider: emailProvider().name || 'resend',
  };
}

/** Try each capability on its own so the console can say exactly what works. Nothing is sent. */
export async function testConnection(actor, nowMs = Date.now()) {
  if (!providerConfigured()) throw bad('Save your Resend API key in Integrations first.');
  const out = { at: stamp(nowMs), by: actor, checks: {} };
  const attempt = async (name, fn) => { try { out.checks[name] = { ok: true, ...(await fn()) }; } catch (e) { out.checks[name] = { ok: false, kind: e.kind || 'error', error: msg(e) }; } };
  await attempt('domains', async () => { const r = await emailProvider().listDomains(); const d = r?.data || []; const cap = (x, k) => x.capabilities?.[k] === 'enabled' || x.capabilities?.[k] === true; return { count: d.length, verified: d.filter((x) => x.status === 'verified').length, list: d.map((x) => ({ name: x.name, status: x.status, sending: cap(x, 'sending'), receiving: cap(x, 'receiving') })).filter((x) => x.name) }; });
  await attempt('webhooks', async () => { const r = await emailProvider().listWebhooks(); return { count: (r?.data || []).length }; });
  await attempt('usage', async () => { const r = await syncProviderUsage(nowMs); if (!r.ok) throw new Error(r.error); return {}; });
  const ok = Object.values(out.checks);
  out.ok = ok.every((c) => c.ok);
  out.summary = out.ok ? 'The key works for domains, webhooks and usage.'
    : out.checks.domains.kind === 'restricted_key' ? 'This key can only send email. Create a key with full access to manage domains, webhooks and usage.'
    : out.checks.domains.kind === 'config' ? 'Resend refused this key. Check that it was copied correctly and has not been deleted.'
    : 'Some checks failed. See the details below.';
  setSetting('resend_connection_test', JSON.stringify(out));
  return out;
}

/**
 * Make sure our webhook endpoint exists at Resend, without ever creating a second one. Three outcomes, reported as `outcome`:
 *  - created: nothing was registered at our address, so one was created (its signing secret, when returned, is kept encrypted);
 *  - adopted: a webhook at our address already existed and already listens to everything we need, so it is used as it is;
 *  - adopted_updated: it existed but lacked some events; those were added and every event it already had was kept.
 * The signing secret is read from Resend when it offers it. If it does not, the operator saves it through the console's secret
 * field (stored encrypted, never shown back). Rotating the secret at Resend first is fine: whatever is saved last is what counts.
 */
export async function registerWebhook(baseUrl, actor) {
  if (!providerConfigured()) throw bad('Save your Resend API key in Integrations first.');
  if (!/^https:\/\/[^/\s]+\.[^/\s]+/i.test(baseUrl || '') || /localhost|127\.0\.0\.1/.test(baseUrl)) throw bad('Resend can only deliver to a public https address. Open the console on your live domain to register the webhook.');
  const url = `${baseUrl}${WEBHOOK_PATH}`;
  const same = (a) => String(a || '').replace(/\/+$/, '').toLowerCase() === url.toLowerCase();
  const matches = ((await emailProvider().listWebhooks())?.data || []).filter((w) => same(w.endpoint));
  const existing = matches[0] || null;
  let id = existing?.id || null, secret = null, outcome = 'created', added = [];
  if (!existing) {
    const r = await emailProvider().createWebhook(url, WEBHOOK_EVENTS); id = r?.id || null; secret = r?.signing_secret || null;
  } else {
    let have = Array.isArray(existing.events) ? existing.events : null;
    let detail = null;
    if (!have || !existing.signing_secret) { try { detail = await emailProvider().getWebhook(id); } catch { /* the list answer is enough */ } }
    have = Array.isArray(detail?.events) ? detail.events : have;
    secret = existing.signing_secret || detail?.signing_secret || null;
    added = have ? WEBHOOK_EVENTS.filter((e) => !have.includes(e)) : [];
    outcome = 'adopted';
    if (added.length) { await emailProvider().updateWebhook(id, [...have, ...added]); outcome = 'adopted_updated'; }
  }
  if (secret) setSetting('resend_webhook_secret', secret, { secret: true, by: actor });
  const rec = { id, url, at: stamp(), by: actor, created: outcome === 'created', outcome, added_events: added, duplicates: Math.max(0, matches.length - 1), secret_stored: !!secret || !!getSetting('resend_webhook_secret') };
  setSetting('resend_webhook_registration', JSON.stringify(rec));
  return { ...rec, needs_secret: !rec.secret_stored, note: rec.secret_stored ? null : 'Resend did not give us the signing secret. Paste it (starts with whsec_) into the secret field below. You can rotate it in the Resend dashboard first and paste the new one. Until it is saved, events are refused.' };
}

/** Save the signing secret by hand. Encrypted at rest, checked for shape, never returned. */
export function saveWebhookSecret(value, actor) {
  const v = String(value || '').trim();
  if (!/^whsec_[A-Za-z0-9+/=_-]{16,}$/.test(v)) throw bad('A Resend signing secret starts with whsec_');
  setSetting('resend_webhook_secret', v, { secret: true, by: actor });
  return { secret_saved: true };
}

/** Domains already at Resend, and whether they can send and receive. Read only: nothing is created or changed. */
export async function accountDomains() {
  const rows = (await emailProvider().listDomains())?.data || [];
  const cap = (d, k) => d.capabilities?.[k] === 'enabled' || d.capabilities?.[k] === true;
  return rows.map((d) => ({ name: d.name, status: d.status, sending: cap(d, 'sending'), receiving: cap(d, 'receiving') }));
}
