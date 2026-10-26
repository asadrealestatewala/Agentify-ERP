// Provider adapter for tenant e-mail (Resend). One object with a small surface so the rest of the code, and every test, can
// swap it: `setEmailProvider(fake)`. The API key stays server-side (platform settings, encrypted) and is never returned.
//
// Errors thrown by send() carry `kind`:
//   'rate_limited'  429, retry later (err.retryAfterSec)
//   'transient'     5xx or network failure before any answer: safe to retry with the same idempotency key
//   'ambiguous'     the request may have been accepted (timeout): reconcile before retrying or releasing quota
//   'definitive'    the provider refused this message (validation, unverified sender): release quota, do not retry
//   'config'        no key / key refused: nothing was sent, pause the queue
import { getSetting } from './platformConfig.js';

const API = 'https://api.resend.com';
const apiKey = () => getSetting('resend_api_key') || process.env.RESEND_API_KEY || null;
export const providerConfigured = () => !!apiKey();

const fail = (kind, message, extra = {}) => Object.assign(new Error(message), { kind, ...extra });

async function call(method, path, { body, idem, timeoutMs = 15_000, ambiguousOnTimeout = false } = {}) {
  const key = apiKey();
  if (!key) throw fail('config', 'The e-mail provider is not connected (no API key saved).');
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method, signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'agentify-erp/1.0', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw fail(e.name === 'TimeoutError' && ambiguousOnTimeout ? 'ambiguous' : 'transient', e.name === 'TimeoutError' ? 'The provider took too long to answer.' : 'Could not reach the provider.');
  }
  let data = null; try { data = await res.json(); } catch { /* empty body */ }
  if (res.ok) return data;
  const msg = String(data?.message || data?.error?.message || `Provider answered ${res.status}`).slice(0, 300);
  if (res.status === 429) throw fail('rate_limited', msg, { retryAfterSec: Number(res.headers.get('retry-after')) || 5 });
  if (res.status === 401 || res.status === 403) {
    // Resend answers a send-only key with "restricted_api_key" on every non-send endpoint: say so, it is a different fix from a wrong key
    if (/restricted/i.test(`${data?.name || ''} ${msg}`)) throw fail('restricted_key', 'This API key can only send email. Domains, webhooks and usage need a key with full access.');
    throw fail('config', 'The provider refused the saved API key. Check it in Integrations, or create a new one.');
  }
  if (res.status === 409 || res.status === 425) throw fail('transient', msg); // idempotent request still in flight
  if (res.status >= 500) throw fail(ambiguousOnTimeout ? 'ambiguous' : 'transient', msg);
  throw fail('definitive', msg);
}

export const resendProvider = {
  name: 'resend',
  /** Hand one message to the provider. The idempotency key makes a retry within the provider's window harmless. */
  async send(msg, { idempotencyKey }) {
    const out = await call('POST', '/emails', { idem: idempotencyKey, ambiguousOnTimeout: true, body: {
      from: msg.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}), ...(msg.headers ? { headers: msg.headers } : {}), ...(msg.tags ? { tags: msg.tags } : {}),
    } });
    return { id: out?.id || null };
  },
  /** Did the provider accept a message we sent with this idempotency key? Used after an ambiguous timeout. Resend has no
   *  lookup by idempotency key, so we search the recent list by recipient+subject; the caller treats `null` as "not found". */
  async findSent({ to, subject, sinceIso }) {
    const out = await call('GET', '/emails?limit=100');
    const hit = (out?.data || []).find((e) => (Array.isArray(e.to) ? e.to : [e.to]).map((x) => String(x).toLowerCase()).includes(String(to).toLowerCase()) && e.subject === subject && (!sinceIso || String(e.created_at) >= sinceIso));
    return hit ? { id: hit.id } : null;
  },
  createDomain: (name, region) => call('POST', '/domains', { body: { name, ...(region ? { region } : {}) } }),
  getDomain: (id) => call('GET', `/domains/${encodeURIComponent(id)}`),
  verifyDomain: (id) => call('POST', `/domains/${encodeURIComponent(id)}/verify`, { body: {} }),
  removeDomain: (id) => call('DELETE', `/domains/${encodeURIComponent(id)}`),
  /** Account usage and limits as Resend documents them. Plan names, invoices and prices are NOT part of it. */
  getUsage: () => call('GET', '/usage'),
  listDomains: () => call('GET', '/domains'),
  listWebhooks: () => call('GET', '/webhooks'),
  /** Registers our endpoint. The answer carries the signing secret (whsec_...) when the provider returns it. */
  createWebhook: (endpoint, events) => call('POST', '/webhooks', { body: { endpoint, events } }),
  getWebhook: (id) => call('GET', `/webhooks/${encodeURIComponent(id)}`),
  /** Change the events of a webhook that already exists (the endpoint and its signing secret stay as they are). */
  updateWebhook: (id, events) => call('PATCH', `/webhooks/${encodeURIComponent(id)}`, { body: { events } }),
  /** A received (inbound) e-mail with headers, for reply detection. */
  getReceived: (id) => call('GET', `/emails/receiving/${encodeURIComponent(id)}`),
};

let provider = resendProvider;
export const emailProvider = () => provider;
export const setEmailProvider = (p) => { provider = p || resendProvider; };
