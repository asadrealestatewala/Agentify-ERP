// Optional QR ("WhatsApp Web") gateway. This is UNOFFICIAL: WhatsApp can restrict or ban a number that is linked this way, and
// nobody here can reverse that. Botlinkd does not offer it, so it needs a separate gateway service that the Super Admin sets up
// (a self-hosted worker or a provider). The platform only speaks this small HTTP contract; nothing provider-specific lives here.
//
//   POST   {url}/sessions               { session_id, webhook_url, webhook_secret }  -> 2xx
//   GET    {url}/sessions/{id}          -> { status: 'qr'|'connecting'|'connected'|'disconnected', qr_image?: 'data:image/png;base64,…', number?: '44…' }
//   DELETE {url}/sessions/{id}          -> 2xx
//   POST   {url}/sessions/{id}/messages { to, text } -> { id? }
//   GET    {url}/health                 -> 2xx
// Requests carry `Authorization: Bearer <token>`. Incoming customer messages are POSTed by the gateway to `webhook_url` in the
// same JSON shape and HMAC-SHA256 signing (header X-Signature) that the Botlinkd webhook uses, so one receiver handles both.
import { getSetting } from '../services/platformConfig.js';
import { classifyError } from './botlinkd.js';

export const gatewayConfig = () => ({ enabled: getSetting('whatsapp_qr_enabled') === '1', url: (getSetting('whatsapp_qr_gateway_url') || '').replace(/\/+$/, ''), token: getSetting('whatsapp_qr_gateway_token') || '' });
export const gatewayReady = () => { const c = gatewayConfig(); return c.enabled && !!c.url && !!c.token; };

async function call(method, path, body) {
  const c = gatewayConfig();
  if (!c.url || !c.token) throw classifyError('The QR gateway is not set up', 0);
  let res;
  try { res = await fetch(`${c.url}${path}`, { method, headers: { Authorization: `Bearer ${c.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000), redirect: 'error' }); }
  catch (e) { throw classifyError(`Could not reach the QR gateway (${e.name === 'TimeoutError' ? 'timed out' : 'network error'})`, 0); }
  let data = null; try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw classifyError(data?.error || data?.message || `The QR gateway answered ${res.status}`, res.status);
  return data || {};
}
const realGateway = {
  name: 'http',
  health: () => call('GET', '/health'),
  createSession: ({ sessionId, webhookUrl, secret }) => call('POST', '/sessions', { session_id: sessionId, webhook_url: webhookUrl, webhook_secret: secret }),
  getSession: (id) => call('GET', `/sessions/${encodeURIComponent(id)}`),
  deleteSession: (id) => call('DELETE', `/sessions/${encodeURIComponent(id)}`),
  async sendText({ sessionId, to, message }) { const r = await call('POST', `/sessions/${encodeURIComponent(sessionId)}/messages`, { to, text: message }); return { ref: r.id ? String(r.id) : null }; },
};
let gateway = realGateway;
export const qrGateway = () => gateway;
export const setQrGateway = (g) => { gateway = g || realGateway; };
