// Botlinkd WhatsApp gateway adapter. Botlinkd documents the OFFICIAL WhatsApp Business Cloud API (the number is onboarded with
// Meta inside the Botlinkd dashboard). It has no QR / WhatsApp Web session API. What its public docs give us:
//   send     POST https://botlinkd.com/api/whatsapp/message  (multipart form: appkey, authkey, to, message)
//   receive  an "External Webhook" URL set per platform in the Botlinkd dashboard; JSON `message.received` events, optional
//            per-platform HMAC-SHA256 signing (header name and exact signed string are NOT documented).
// The response body of the send call is not documented either, so success is "HTTP 2xx and no error field". Nothing here
// retries a send (a retry could message a customer twice). The provider is swappable so tests never touch the network.
import crypto from 'node:crypto';

export const SEND_URL = () => process.env.BOTLINKD_API_URL || 'https://botlinkd.com/api/whatsapp/message';
/** Template messages: POST /api/whatsapp/template, form fields appkey, authkey, to, template, language, body_params[0..n] (docs: Template Message). */
export const TEMPLATE_URL = () => process.env.BOTLINKD_TEMPLATE_URL || SEND_URL().replace(/\/message$/, '/template');
export const SIGNATURE_HEADERS = ['x-botlinkd-signature', 'x-signature', 'x-webhook-signature', 'x-hub-signature-256'];

/** Errors carry a `kind` so the screens can say what to do: auth, limit, recipient, template, platform, temporary. */
export function classifyError(message, status) {
  const m = String(message || '');
  const kind = /authentic|unauthori|invalid (app|auth)|app ?key|auth ?key/i.test(m) || status === 401 || status === 403 ? 'auth'
    : /service window|customer service|24.?hour|window (is )?closed/i.test(m) ? 'window'
    : /limit|quota|allowance/i.test(m) || status === 429 ? 'limit'
    : /recipient|invalid number|not a valid/i.test(m) ? 'recipient'
    : /template/i.test(m) ? 'template'
    : /platform/i.test(m) ? 'platform'
    : 'temporary';
  const e = new Error(m.slice(0, 240) || `Botlinkd answered ${status}`);
  e.kind = kind; e.status = status;
  return e;
}

async function post(url, form) {
    let res;
    try { res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(15_000), redirect: 'error' }); }
    catch (e) { throw classifyError(`Could not reach Botlinkd (${e.name === 'TimeoutError' ? 'timed out' : 'network error'})`, 0); }
    let body = null; try { body = await res.json(); } catch { /* not JSON */ }
    const failed = !res.ok || body?.success === false || body?.status === false || /^(error|failed)$/i.test(String(body?.status || '')) || !!body?.error;
    if (failed) throw classifyError(body?.message || body?.error || body?.msg || `Botlinkd answered ${res.status}`, res.status);
    return { ref: String(body?.message_id || body?.id || body?.data?.id || body?.data?.message_id || '') || null };
}
const realProvider = {
  name: 'botlinkd',
  sendText({ appkey, authkey, to, message }) {
    const form = new FormData();
    form.append('appkey', appkey); form.append('authkey', authkey); form.append('to', to); form.append('message', message);
    return post(SEND_URL(), form);
  },
  /** `params` are the template's body values in placeholder order. */
  sendTemplate({ appkey, authkey, to, template, language, params = [] }) {
    const form = new FormData();
    form.append('appkey', appkey); form.append('authkey', authkey); form.append('to', to); form.append('template', template); form.append('language', language || 'en');
    params.forEach((v, i) => form.append(`body_params[${i}]`, String(v)));
    return post(TEMPLATE_URL(), form);
  },
};
let provider = realProvider;
export const whatsappProvider = () => provider;
/** Tests install a fake; pass null to restore the real one. */
export const setWhatsappProvider = (p) => { provider = p || realProvider; };

/** International digits only, 7 to 15 of them (WhatsApp ids are numbers without + or spaces). */
export function cleanNumber(v) {
  const d = String(v || '').replace(/[\s()+-]/g, '');
  if (!/^[1-9]\d{6,14}$/.test(d)) return null;
  return d;
}

const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
/** HMAC-SHA256 over the exact request bytes, hex or base64, with or without a "sha256=" prefix, in any of the usual headers. */
export function verifySignature(secret, rawBody, headers) {
  if (!secret || !rawBody) return false;
  const mac = crypto.createHmac('sha256', secret).update(rawBody);
  const raw = mac.digest();
  const want = [raw.toString('hex'), raw.toString('base64')];
  for (const h of SIGNATURE_HEADERS) {
    const v = headers?.[h];
    if (!v) continue;
    const got = String(v).trim().replace(/^sha256=/i, '');
    if (want.some((w) => safeEq(w, got) || safeEq(w.toLowerCase(), got.toLowerCase()))) return true;
  }
  return false;
}
export const signBody = (secret, rawBody) => crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
