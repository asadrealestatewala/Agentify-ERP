// Payment gateway adapters. Each provider is a small object with the same shape so a new one is one entry here:
//   id, label, blurb, regions (null = everywhere), currencies (null = any), available (false = listed placeholder),
//   fields [{ key, label, secret, hint }], docs,
//   validate(cfg) -> cleaned cfg (throws bad())            check the pasted details and that the keys match the chosen mode
//   test(cfg)     -> { account }                           one real, read-only request proving the keys work
//   createCheckout(cfg, ctx) -> { externalId, url }        ctx: { token, minor, major, currency, description, successUrl, cancelUrl, webhookUrl, email, name }
//   parseWebhook(req, cfg) -> { eventId, externalId, checkoutToken } | null   (null = ignore); throws on a bad signature
//   confirm(cfg, checkout) -> { paid, minor, currency, ref }   asks the PROVIDER what happened. The browser redirect and the webhook body
//                                                              are never believed: only this answer can post a payment.
// Every request goes through `http.fetch`, which tests replace so nothing here ever needs the network to be tested.
import crypto from 'node:crypto';
import { bad } from '../util.js';

export const http = { fetch: (...a) => fetch(...a) };

const ZERO = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);
/** Decimal places of a currency (ISO 4217). */
export const decimals = (cur) => (ZERO.has(cur) ? 0 : THREE.has(cur) ? 3 : 2);
/** Our stored integer (money_scale decimals) -> the provider's smallest unit. */
export const toMinor = (amount, currency, moneyScale = 0) => Math.round(Number(amount) * 10 ** (decimals(currency) - moneyScale));
export const toMajor = (minor, currency) => (Number(minor) / 10 ** decimals(currency)).toFixed(decimals(currency));

async function call(label, url, opts = {}) {
  let res;
  try { res = await http.fetch(url, { ...opts, signal: AbortSignal.timeout(20_000) }); } catch (e) { throw bad(`Could not reach ${label}: ${e.message}`); }
  let body = null; try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw bad(`${label} said: ${body?.error?.message || body?.message || body?.errors?.[0]?.description || body?.details?.[0]?.description || `HTTP ${res.status}`}`);
  return body;
}
const form = (obj, prefix = '', out = new URLSearchParams()) => {
  for (const [k, v] of Object.entries(obj)) { if (v == null) continue; const key = prefix ? `${prefix}[${k}]` : k; if (typeof v === 'object') form(v, key, out); else out.append(key, String(v)); }
  return out;
};
const need = (cfg, keys) => { for (const [k, label] of keys) if (!String(cfg[k] || '').trim()) throw bad(`${label} is required`); };
const trim = (cfg, keys) => Object.fromEntries(keys.map((k) => [k, String(cfg[k] || '').trim()]));
const modeOf = (cfg) => (cfg.mode === 'live' ? 'live' : 'test');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ------------------------------------------------------------------ Stripe (international cards)
const stripe = {
  id: 'stripe', label: 'Stripe', blurb: 'Cards and wallets worldwide, on Stripe\'s own payment page.', regions: null, currencies: null, available: true,
  docs: 'https://dashboard.stripe.com/apikeys',
  fields: [{ key: 'secret_key', label: 'Secret key', secret: true, hint: 'Starts with sk_test_ or sk_live_ (or a restricted rk_ key allowed to write Checkout Sessions)' }, { key: 'webhook_secret', label: 'Webhook signing secret', secret: true, hint: 'Starts with whsec_. Add the webhook address shown below in Stripe, event: checkout.session.completed' }],
  validate(c) {
    need(c, [['secret_key', 'The secret key'], ['webhook_secret', 'The webhook signing secret']]);
    const o = trim(c, ['secret_key', 'webhook_secret']);
    if (!/^(sk|rk)_(test|live)_/.test(o.secret_key)) throw bad('That does not look like a Stripe secret key (it starts with sk_test_ or sk_live_).');
    if (!o.webhook_secret.startsWith('whsec_')) throw bad('The webhook signing secret starts with whsec_.');
    if (modeOf(c) === 'live' && o.secret_key.includes('_test_')) throw bad('You chose live mode but pasted a test key.');
    if (modeOf(c) === 'test' && o.secret_key.includes('_live_')) throw bad('You chose test mode but pasted a live key. Use a test key until you are ready to go live.');
    return o;
  },
  async test(c) { const b = await call('Stripe', 'https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${c.secret_key}` } }); return { account: b.livemode ? 'live account' : 'test account' }; },
  async createCheckout(c, x) {
    const body = form({ mode: 'payment', client_reference_id: x.token, success_url: x.successUrl, cancel_url: x.cancelUrl, customer_email: x.email || undefined, metadata: { checkout: x.token },
      payment_intent_data: { metadata: { checkout: x.token } }, line_items: { 0: { quantity: 1, price_data: { currency: x.currency.toLowerCase(), unit_amount: x.minor, product_data: { name: x.description } } } } });
    const r = await call('Stripe', 'https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${c.secret_key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `agentify-${x.token}` }, body });
    return { externalId: r.id, url: r.url };
  },
  parseWebhook(req, c) {
    const raw = req.rawBody, header = req.get('Stripe-Signature');
    if (!raw || !header || !c?.webhook_secret) throw bad('Missing signature');
    const parts = String(header).split(',').map((p) => p.split('='));
    const t = Number(parts.find((p) => p[0] === 't')?.[1]);
    if (!t || Math.abs(Date.now() / 1000 - t) > 300) throw bad('Stale or missing timestamp');
    const want = crypto.createHmac('sha256', c.webhook_secret).update(`${t}.`).update(raw).digest('hex');
    if (!parts.filter((p) => p[0] === 'v1').some((p) => safeEq(p[1] || '', want))) throw bad('Invalid signature');
    const ev = JSON.parse(raw.toString('utf8'));
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type)) return null;
    return { eventId: ev.id, externalId: ev.data?.object?.id, checkoutToken: ev.data?.object?.client_reference_id };
  },
  async confirm(c, k) {
    const s = await call('Stripe', `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(k.external_id)}`, { headers: { Authorization: `Bearer ${c.secret_key}` } });
    return { paid: s.payment_status === 'paid' && s.client_reference_id === k.token, minor: s.amount_total, currency: String(s.currency || '').toUpperCase(), ref: s.payment_intent || s.id };
  },
};

// ------------------------------------------------------------------ PayPal (international)
const paypalBase = (c) => (modeOf(c) === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
async function paypalToken(c) {
  const r = await call('PayPal', `${paypalBase(c)}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  return r.access_token;
}
const paypal = {
  id: 'paypal', label: 'PayPal', blurb: 'PayPal balance, cards and local methods on PayPal\'s page.', regions: null, currencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'AED', 'CHF', 'JPY', 'SGD', 'HKD', 'SEK', 'NOK', 'DKK', 'NZD', 'PLN', 'CZK', 'HUF', 'ILS', 'MXN', 'BRL', 'THB', 'PHP', 'MYR', 'TWD'], available: true,
  docs: 'https://developer.paypal.com/dashboard/applications',
  fields: [{ key: 'client_id', label: 'Client ID', secret: false }, { key: 'client_secret', label: 'Client secret', secret: true }, { key: 'webhook_id', label: 'Webhook ID (optional)', secret: false, hint: 'Lets PayPal notify us when a customer closes the tab after paying' }],
  validate(c) { need(c, [['client_id', 'The client ID'], ['client_secret', 'The client secret']]); return { ...trim(c, ['client_id', 'client_secret', 'webhook_id']) }; },
  async test(c) { await paypalToken(c); return { account: `${modeOf(c)} app` }; },
  async createCheckout(c, x) {
    const token = await paypalToken(c);
    const r = await call('PayPal', `${paypalBase(c)}/v2/checkout/orders`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `agentify-${x.token}` },
      body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: x.token, custom_id: x.token, description: x.description.slice(0, 120), amount: { currency_code: x.currency, value: x.major } }],
        payment_source: { paypal: { experience_context: { user_action: 'PAY_NOW', return_url: x.successUrl, cancel_url: x.cancelUrl } } } }) });
    const link = (r.links || []).find((l) => ['payer-action', 'approve'].includes(l.rel));
    if (!link) throw bad('PayPal did not return a payment link');
    return { externalId: r.id, url: link.href };
  },
  async parseWebhook(req, c) {
    const ev = req.body || {};
    if (!c?.webhook_id) return null; // without a webhook id we cannot verify the sender; the return page still confirms
    const token = await paypalToken(c);
    const v = await call('PayPal', `${paypalBase(c)}/v1/notifications/verify-webhook-signature`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_algo: req.get('paypal-auth-algo'), cert_url: req.get('paypal-cert-url'), transmission_id: req.get('paypal-transmission-id'), transmission_sig: req.get('paypal-transmission-sig'), transmission_time: req.get('paypal-transmission-time'), webhook_id: c.webhook_id, webhook_event: ev }) });
    if (v.verification_status !== 'SUCCESS') throw bad('Invalid signature');
    if (!['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED'].includes(ev.type)) return null;
    const r = ev.resource || {};
    return { eventId: ev.id, externalId: ev.type === 'CHECKOUT.ORDER.APPROVED' ? r.id : r.supplementary_data?.related_ids?.order_id, checkoutToken: null };
  },
  async confirm(c, k) {
    const token = await paypalToken(c);
    const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    let o = await call('PayPal', `${paypalBase(c)}/v2/checkout/orders/${encodeURIComponent(k.external_id)}`, { headers: h });
    if (o.status === 'APPROVED') o = await call('PayPal', `${paypalBase(c)}/v2/checkout/orders/${encodeURIComponent(k.external_id)}/capture`, { method: 'POST', headers: { ...h, 'PayPal-Request-Id': `agentify-capture-${k.token}` }, body: '{}' });
    const pu = o.purchase_units?.[0]; const cap = pu?.payments?.captures?.[0];
    const ok = o.status === 'COMPLETED' && cap?.status === 'COMPLETED' && (pu.custom_id === k.token || pu.reference_id === k.token);
    return { paid: !!ok, minor: ok ? Math.round(Number(cap.amount.value) * 10 ** decimals(cap.amount.currency_code)) : null, currency: cap?.amount?.currency_code, ref: cap?.id || o.id };
  },
};

// ------------------------------------------------------------------ Tap Payments (GCC and wider MENA)
const tap = {
  id: 'tap', label: 'Tap Payments', blurb: 'Cards, mada, KNET, Benefit, Apple Pay across the Gulf.', regions: null, currencies: ['KWD', 'SAR', 'AED', 'BHD', 'QAR', 'OMR', 'EGP', 'JOD', 'USD', 'EUR', 'GBP'], available: true,
  docs: 'https://register.tap.company/',
  fields: [{ key: 'secret_key', label: 'Secret API key', secret: true, hint: 'Starts with sk_test_ or sk_live_' }],
  validate(c) {
    need(c, [['secret_key', 'The secret key']]); const o = trim(c, ['secret_key']);
    if (!/^sk_(test|live)_/.test(o.secret_key)) throw bad('Tap secret keys start with sk_test_ or sk_live_.');
    if (modeOf(c) === 'live' && o.secret_key.startsWith('sk_test_')) throw bad('You chose live mode but pasted a test key.');
    if (modeOf(c) === 'test' && o.secret_key.startsWith('sk_live_')) throw bad('You chose test mode but pasted a live key.');
    return o;
  },
  async test(c) { await call('Tap', 'https://api.tap.company/v2/charges/list', { method: 'POST', headers: { Authorization: `Bearer ${c.secret_key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ period: { date: { from: Date.now() - 864e5, to: Date.now() } }, limit: 1 }) }); return { account: 'key accepted' }; },
  async createCheckout(c, x) {
    const r = await call('Tap', 'https://api.tap.company/v2/charges', { method: 'POST', headers: { Authorization: `Bearer ${c.secret_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Number(x.major), currency: x.currency, customer_initiated: true, threeDSecure: true, save_card: false, description: x.description.slice(0, 120), reference: { transaction: x.token, order: x.token },
        customer: { first_name: (x.name || 'Customer').split(' ')[0], email: x.email || undefined }, source: { id: 'src_all' }, post: { url: x.webhookUrl }, redirect: { url: x.successUrl } }) });
    if (!r.transaction?.url) throw bad('Tap did not return a payment link');
    return { externalId: r.id, url: r.transaction.url };
  },
  parseWebhook(req) { const id = req.body?.id; return /^chg_/.test(String(id || '')) ? { eventId: `${id}:${req.body.status || ''}`, externalId: id, checkoutToken: null } : null; }, // unsigned: only a pointer, confirm() asks Tap
  async confirm(c, k) {
    const r = await call('Tap', `https://api.tap.company/v2/charges/${encodeURIComponent(k.external_id)}`, { headers: { Authorization: `Bearer ${c.secret_key}` } });
    return { paid: r.status === 'CAPTURED' && (r.reference?.transaction === k.token), minor: Math.round(Number(r.amount) * 10 ** decimals(r.currency)), currency: r.currency, ref: r.id };
  },
};

// ------------------------------------------------------------------ placeholders (need the merchant's account and the provider's API documents)
const placeholder = (id, label, blurb, regions) => ({ id, label, blurb, regions, currencies: null, available: false, docs: null, fields: [],
  note: 'Not built yet. It needs your merchant account and the provider\'s API documents; until then customers use the bank-transfer flow (Settings > Payment methods).' });

export const PROVIDERS = {
  stripe, paypal, tap,
  paypro: placeholder('paypro', 'PayPro (Easypaisa, JazzCash, NayaPay, SadaPay)', 'Pakistani wallets and bank transfer through one aggregator.', ['PK']),
  payoneer: placeholder('payoneer', 'Payoneer', 'Payoneer Checkout for international customers.', null),
};
export const providerIds = () => Object.keys(PROVIDERS);
