// Platform-level settings edited from the admin console (Stripe keys, ...). Secret values are encrypted at rest with
// AES-256-GCM and are never sent back to the browser: the console only learns that a secret is set and its last 4 characters.
//
// The encryption key is ERP_SECRETS_KEY (any long random string). If it is not set, a key file is created next to the
// databases (server/data/.secrets-key); back that file up together with platform.db, or the stored keys cannot be read.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../db.js';
import { platformDb } from '../platform.js';
import { auditCtx } from './platformAccess.js';
import { PLANS } from './plans.js';
import { LADDER_IDS, LADDER_HOME_CURRENCY } from './planLadder.js';

let key;
export function secretsKey() {
  if (key) return key;
  let material = process.env.ERP_SECRETS_KEY;
  if (!material) {
    const f = path.join(DATA_DIR, '.secrets-key');
    if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
    material = fs.readFileSync(f, 'utf8');
  }
  key = crypto.createHash('sha256').update(String(material)).digest();
  return key;
}
export const resetSecretsKeyCache = () => { key = undefined; };

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretsKey(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}
export function decrypt(blob) {
  const [v, iv, tag, ct] = String(blob).split(':');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', secretsKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

/** Stored value (decrypted), or null. A secret that cannot be decrypted (wrong key) reads as unset. */
export function getSetting(k) {
  const r = platformDb().prepare('SELECT value, secret FROM platform_settings WHERE key=?').get(k);
  if (!r || r.value == null) return null;
  if (!r.secret) return r.value;
  try { return decrypt(r.value); } catch { return null; }
}
export function setSetting(k, value, { secret = false, by = null } = {}) {
  if (value == null || value === '') { platformDb().prepare('DELETE FROM platform_settings WHERE key=?').run(k); return; }
  platformDb().prepare(`INSERT INTO platform_settings(key,value,secret,updated_by,updated_at) VALUES(?,?,?,?,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, secret=excluded.secret, updated_by=excluded.updated_by, updated_at=excluded.updated_at`).run(k, secret ? encrypt(value) : String(value), secret ? 1 : 0, by);
}
/** What the console may show about a secret: whether it is set and its last 4 characters. */
export const mask = (v) => ({ set: !!v, hint: v ? `…${String(v).slice(-4)}` : null });

/**
 * Append one row to the platform audit trail. The request context (set by auditContext in platformAccess.js) adds the
 * actor's role, IP, browser and request id; target and reason are taken from the detail. Never pass secret values here.
 */
export function audit(admin, action, detail, { outcome = 'success' } = {}) {
  const ctx = auditCtx.getStore();
  const op = ctx?.req?.operator;
  const d = detail || {};
  const target = d.slug ? `workspace:${d.slug}` : d.tenant ? `workspace#${d.tenant}` : d.plan ? `plan:${d.plan}` : d.email ? `admin:${d.email}` : d.id != null ? `#${d.id}` : null;
  platformDb().prepare('INSERT INTO platform_audit(admin,action,detail,actor_role,target,reason,outcome,ip,user_agent,request_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(admin || null, action, detail ? JSON.stringify(detail) : null, op ? (op.via === 'token' ? 'api-token' : op.role || null) : null, target,
      d.reason ? String(d.reason).slice(0, 500) : null, outcome, ctx?.ip || null, ctx?.ua || null, ctx?.rid || null);
}

// ---- Stripe settings ------------------------------------------------------------------------------------------
export const STRIPE_MODES = ['test', 'live'];
/** One Stripe price per plan and interval; follows the plans defined in the console. */
// a plan with a setup fee also gets a one-time Stripe price slot (<plan>_setup) charged with the first checkout
// A Stripe price has one fixed currency, so the ladder plans (priced in several currencies) get one slot per extra currency: <plan>_<interval>_<currency>, e.g. lad_agency_growth_month_usd.
// The plain <plan>_<interval> slot stays the home-currency price for the ladder; older plans keep their single slot as before.
export const ladderCurrencySlots = (plan) => (LADDER_IDS.includes(plan) ? Object.keys(PLANS[plan]?.price || {}).filter((c) => c !== LADDER_HOME_CURRENCY).flatMap((c) => ['month', 'year'].filter((i) => PLANS[plan].price[c][i] != null).map((i) => `${plan}_${i}_${c.toLowerCase()}`)) : []);
export const priceSlots = () => Object.keys(PLANS).flatMap((p) => [...['month', 'year'].map((i) => `${p}_${i}`), ...ladderCurrencySlots(p), ...(Object.keys(PLANS[p].setup_fee || {}).length ? [`${p}_setup`] : [])]);
const KEY_RULES = {
  secret_key: { re: /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/, label: 'Secret key (starts with sk_ or rk_)' },
  publishable_key: { re: /^pk_(test|live)_[A-Za-z0-9]+$/, label: 'Publishable key (starts with pk_)' },
  webhook_secret: { re: /^whsec_[A-Za-z0-9+/=_-]+$/, label: 'Webhook signing secret (starts with whsec_)' },
};
const isSecret = (field) => field !== 'publishable_key';

/** Effective Stripe configuration: console settings first, environment variables as the fallback. */
export function stripeConfig() {
  const envKey = process.env.STRIPE_SECRET_KEY || '';
  const mode = getSetting('stripe_mode') || (envKey.includes('_live_') ? 'live' : 'test');
  const pick = (m, field, envName) => getSetting(`stripe_${m}_${field}`) || (m === mode && envName ? process.env[envName] : null) || null;
  const out = { mode, modes: {} };
  for (const m of STRIPE_MODES) {
    out.modes[m] = { secret_key: pick(m, 'secret_key', 'STRIPE_SECRET_KEY'), publishable_key: pick(m, 'publishable_key', 'STRIPE_PUBLISHABLE_KEY'), webhook_secret: pick(m, 'webhook_secret', 'STRIPE_WEBHOOK_SECRET'),
      prices: Object.fromEntries(priceSlots().map((s) => [s, getSetting(`stripe_${m}_price_${s}`) || (m === mode ? process.env[`STRIPE_PRICE_${s.toUpperCase()}`] : null) || null])) };
  }
  Object.assign(out, out.modes[mode]);
  return out;
}

/** Shape the console receives: secrets masked, publishable key and price ids in clear. */
export function stripeView() {
  const c = stripeConfig();
  return {
    mode: c.mode,
    modes: Object.fromEntries(STRIPE_MODES.map((m) => [m, { secret_key: mask(c.modes[m].secret_key), publishable_key: c.modes[m].publishable_key, webhook_secret: mask(c.modes[m].webhook_secret), prices: c.modes[m].prices }])),
    events: ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'],
    ready: !!c.secret_key && Object.values(c.prices).some(Boolean),
  };
}

/**
 * Apply an edit from the console. Per field: omitted or "" keeps the stored value, a string replaces it, null clears it.
 * Keys are checked for the right prefix and for being in the right mode slot (a live key cannot be saved as a test key).
 */
export function saveStripe(body, by) {
  const errs = [];
  const changes = [];
  if (body.mode !== undefined) {
    if (!STRIPE_MODES.includes(body.mode)) errs.push('Mode must be test or live');
    else changes.push(['stripe_mode', body.mode, false]);
  }
  for (const m of STRIPE_MODES) {
    const sec = body[m] || {};
    for (const field of Object.keys(KEY_RULES)) {
      const v = sec[field];
      if (v === undefined || v === '') continue;
      if (v === null) { changes.push([`stripe_${m}_${field}`, null, isSecret(field)]); continue; }
      const s = String(v).trim();
      if (!KEY_RULES[field].re.test(s)) { errs.push(`${m}: ${KEY_RULES[field].label} looks wrong`); continue; }
      if (field !== 'webhook_secret' && !s.includes(`_${m}_`)) { errs.push(`${m}: this is a ${s.includes('_live_') ? 'live' : 'test'} key, not a ${m} key`); continue; }
      changes.push([`stripe_${m}_${field}`, s, isSecret(field)]);
    }
    for (const [slot, v] of Object.entries(body.prices?.[m] || {})) {
      if (!priceSlots().includes(slot)) { errs.push(`Unknown price slot ${slot}`); continue; }
      if (v === undefined) continue;
      if (v === null || v === '') { changes.push([`stripe_${m}_price_${slot}`, null, false]); continue; }
      if (!/^price_[A-Za-z0-9]+$/.test(String(v).trim())) { errs.push(`${m}: ${slot.replace('_', ' / ')} price id must look like price_...`); continue; }
      changes.push([`stripe_${m}_price_${slot}`, String(v).trim(), false]);
    }
  }
  if (errs.length) return { errors: errs };
  platformDb().exec('BEGIN');
  try { for (const [k, v, secret] of changes) setSetting(k, v, { secret, by }); platformDb().exec('COMMIT'); } catch (e) { platformDb().exec('ROLLBACK'); throw e; }
  audit(by, 'stripe-settings', { fields: changes.map(([k, v]) => `${k}${v == null ? ':cleared' : ''}`) }); // names only, never values
  return { errors: [] };
}
