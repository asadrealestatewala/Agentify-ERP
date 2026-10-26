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
    inbound: { domain: inboundDomain(), webhook_event: 'email.received', last_mail_at: wh.last_mail_at },
    usage: { at: json('email_provider_usage')?.at || null, error: getSetting('email_provider_usage_error') || null },
    provider: emailProvider().name || 'resend',
  };
}

/** Try each capability on its own so the console can say exactly what works. Nothing is sent. */
export async function testConnection(actor, nowMs = Date.now()) {
  if (!providerConfigured()) throw bad('Save your Resend API key in Integrations first.');
  const out = { at: stamp(nowMs), by: actor, checks: {} };
  const attempt = async (name, fn) => { try { out.checks[name] = { ok: true, ...(await fn()) }; } catch (e) { out.checks[name] = { ok: false, kind: e.kind || 'error', error: msg(e) }; } };
  await attempt('domains', async () => { const r = await emailProvider().listDomains(); const d = r?.data || []; return { count: d.length, verified: d.filter((x) => x.status === 'verified').length }; });
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
 * Create our webhook endpoint at Resend (or reuse the one already there) and keep its signing secret, encrypted. If Resend does not
 * return the secret on creation, the operator pastes it from the Resend dashboard into Integrations; nothing is guessed.
 */
export async function registerWebhook(baseUrl, actor) {
  if (!providerConfigured()) throw bad('Save your Resend API key in Integrations first.');
  if (!/^https:\/\/[^/\s]+\.[^/\s]+/i.test(baseUrl || '') || /localhost|127\.0\.0\.1/.test(baseUrl)) throw bad('Resend can only deliver to a public https address. Open the console on your live domain to register the webhook.');
  const url = `${baseUrl}${WEBHOOK_PATH}`;
  const existing = ((await emailProvider().listWebhooks())?.data || []).find((w) => w.endpoint === url);
  let id = existing?.id || null, secret = null, created = false;
  if (!existing) { const r = await emailProvider().createWebhook(url, WEBHOOK_EVENTS); id = r?.id || null; secret = r?.signing_secret || null; created = true; }
  if (secret) setSetting('resend_webhook_secret', secret, { secret: true, by: actor });
  const rec = { id, url, at: stamp(), by: actor, created, secret_stored: !!secret || !!getSetting('resend_webhook_secret') };
  setSetting('resend_webhook_registration', JSON.stringify(rec));
  return { ...rec, needs_secret: !rec.secret_stored, note: rec.secret_stored ? null : 'Copy the signing secret (starts with whsec_) from the Resend dashboard under Webhooks and paste it in Integrations. Until then events are refused.' };
}
