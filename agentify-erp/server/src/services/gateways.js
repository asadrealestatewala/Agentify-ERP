import crypto from 'node:crypto';
import { all, get, run, tx } from '../db.js';
import { bad, int, jparse, notFound, now, today, moneyText } from '../util.js';
import { audit, notify, notifyPerm } from '../audit.js';
import { PROVIDERS, toMinor, toMajor } from '../gateways/providers.js';
import { integrationConfig, integrationRow, logIntegration, mask, removeIntegration, saveIntegration } from '../integrations/store.js';
import { currentRegion } from '../regions/runtime.js';
import { receivePayment } from './payments.js';
import { depositAccount, systemActor, claimStateByInstallment } from './claims.js';

/**
 * Online payment gateways for a workspace: the owner connects their own merchant account(s); customers then pay installments
 * from the portal. Money safety rules (each one is covered by tests):
 *  - the amount is computed here from the selected installments, never taken from the browser;
 *  - a payment is posted only after we ask the PROVIDER for the result (confirm()) and amount + currency match what we asked for;
 *    the browser redirect and the webhook body are only prompts to look;
 *  - settling is idempotent (atomic status claim + provider event table + unique transaction id on the receipt);
 *  - test mode never posts receipts; keys are encrypted (tenant_integrations) and never returned.
 */
const KEY = (id) => `pay_${id}`;
const provider = (id) => { const p = PROVIDERS[id]; if (!p) throw notFound('Unknown payment provider'); return p; };
const regionOk = (p) => !p.regions || p.regions.includes(currentRegion().config.region);
const currencyOk = (p) => !p.currencies || p.currencies.includes(currentRegion().config.currency);
const info = (id) => jparse(integrationRow(KEY(id))?.public_info, {});

/** Settings screen: every provider, what it needs, and its state. Secrets are shown masked, never returned. */
export function gatewayList(origin) {
  const cur = currentRegion().config;
  return Object.values(PROVIDERS).map((p) => {
    const row = integrationRow(KEY(p.id)), cfg = row ? integrationConfig(KEY(p.id)) : null, pi = info(p.id);
    return {
      id: p.id, label: p.label, blurb: p.blurb, available: p.available, note: p.note || null, docs: p.docs, region_ok: regionOk(p), currency_ok: currencyOk(p), currency: cur.currency,
      status: row?.status || 'not_connected', enabled: !!pi.enabled, mode: pi.mode || 'test', account: pi.account || null, last_error: row?.last_error || null, connected_at: row?.connected_at || null,
      fields: p.fields.map((f) => ({ key: f.key, label: f.label, secret: !!f.secret, hint: f.hint || null, value: cfg?.[f.key] ? (f.secret ? mask(cfg[f.key]) : cfg[f.key]) : '' })),
      webhook_url: p.available ? `${origin}/api/hooks/pay/${p.id}` : null,
    };
  });
}

export async function saveGateway(id, body, req) {
  const p = provider(id);
  if (!p.available) throw bad(`${p.label} is not available yet`);
  if (!regionOk(p)) throw bad(`${p.label} is not offered in this workspace's country`);
  const prev = integrationConfig(KEY(id)) || {};
  const input = { mode: body.mode === 'live' ? 'live' : 'test' };
  for (const f of p.fields) { const v = body[f.key]; input[f.key] = (v == null || v === '' || /^•/.test(String(v))) ? (prev[f.key] || '') : v; } // masked/blank = keep the stored secret
  const cfg = { ...p.validate(input), mode: input.mode };
  let t;
  try { t = await p.test(cfg); } catch (e) { logIntegration(KEY(id), 'test', 'error', e.message, req.user.id); throw bad(`${p.label} did not accept these details: ${e.message}`); }
  saveIntegration(KEY(id), cfg, { publicInfo: { mode: cfg.mode, enabled: body.enabled === false ? false : true, account: t.account }, status: 'connected', userId: req.user.id });
  logIntegration(KEY(id), 'connect', 'success', cfg.mode, req.user.id);
  audit(req, `Connected payment gateway ${p.label}`, 'integration', KEY(id), `${cfg.mode} mode`);
}
export function setGatewayEnabled(id, enabled, req) {
  provider(id);
  const row = integrationRow(KEY(id)); if (!row) throw bad('Connect this provider first');
  run('UPDATE tenant_integrations SET public_info=? WHERE provider=?', JSON.stringify({ ...info(id), enabled: !!enabled }), KEY(id));
  audit(req, `${enabled ? 'Showed' : 'Hid'} payment gateway to customers`, 'integration', KEY(id), provider(id).label);
}
export function removeGateway(id, req) { provider(id); removeIntegration(KEY(id)); audit(req, 'Disconnected payment gateway', 'integration', KEY(id), provider(id).label); }

/** What the portal may offer: connected, switched on, valid for this country and currency. */
export function portalGateways() {
  return Object.values(PROVIDERS).filter((p) => p.available && regionOk(p) && currencyOk(p) && integrationRow(KEY(p.id))?.status === 'connected' && info(p.id).enabled)
    .map((p) => ({ id: p.id, label: p.label, test_mode: info(p.id).mode !== 'live' }));
}

const lock = (k) => run("UPDATE pay_checkouts SET status='posting', updated_at=? WHERE id=? AND status IN ('created','pending','mismatch','failed')", now(), k.id).changes === 1;

export async function createCheckout(req, { provider: pid, installment_ids }) {
  const p = provider(pid);
  if (!portalGateways().some((g) => g.id === pid)) throw bad('This payment option is not available');
  const contactId = req.user.contact_id;
  const ids = [...new Set((Array.isArray(installment_ids) ? installment_ids : String(installment_ids || '').split(',')).map((x) => int(x)).filter(Boolean))];
  if (!ids.length) throw bad('Choose what you are paying');
  const rows = all(`SELECT i.id, i.sale_id, i.seq, i.kind, i.amount - i.paid remaining, COALESCE(s.title, pr.title) title FROM installments i JOIN sales s ON s.id=i.sale_id LEFT JOIN properties pr ON pr.id=s.property_id
    WHERE i.id IN (${ids.map(() => '?').join(',')}) AND s.contact_id=? AND s.status='confirmed' AND i.status<>'paid' AND i.amount - i.paid > 0`, ...ids, contactId);
  if (rows.length !== ids.length) throw notFound('One of the selected payments was not found or is already paid');
  if (new Set(rows.map((r) => r.sale_id)).size > 1) throw bad('Pay one plan at a time');
  const open = claimStateByInstallment(contactId);
  if (ids.some((i) => open.has(i))) throw bad('A payment for one of these is already being checked');
  const amount = rows.reduce((a, r) => a + r.remaining, 0);
  const cfg = integrationConfig(KEY(pid)); if (!cfg) throw bad('This payment option is not available');
  const { currency, money_scale } = currentRegion().config;
  const minor = toMinor(amount, currency, money_scale);
  const token = crypto.randomBytes(18).toString('hex');
  const id = Number(run(`INSERT INTO pay_checkouts(token,provider,contact_id,sale_id,installment_ids,amount,currency,minor_amount,sandbox,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    token, pid, contactId, rows[0].sale_id, JSON.stringify(ids), amount, currency, minor, cfg.mode === 'live' ? 0 : 1, 'created', req.user.id, now()).lastInsertRowid);
  const contact = get('SELECT full_name, email FROM contacts WHERE id=?', contactId);
  const origin = `${req.protocol}://${req.get('host')}`;
  try {
    const r = await p.createCheckout(cfg, { token, minor, major: toMajor(minor, currency), currency, description: `${rows[0].title} — ${rows.map((x) => `${x.kind} #${x.seq}`).join(', ')}`.slice(0, 200),
      successUrl: `${origin}/api/hooks/pay/return/${pid}/${token}`, cancelUrl: `${origin}/portal/payments?gw=${token}&cancelled=1`, webhookUrl: `${origin}/api/hooks/pay/${pid}`, email: contact?.email || undefined, name: contact?.full_name });
    run("UPDATE pay_checkouts SET status='pending', external_id=?, checkout_url=?, updated_at=? WHERE id=?", r.externalId, r.url, now(), id);
    audit(req, 'Started online payment', 'pay_checkout', id, `${p.label} ${currency} ${amount}${cfg.mode === 'live' ? '' : ' (test)'}`);
    return { token, url: r.url, test_mode: cfg.mode !== 'live' };
  } catch (e) {
    run("UPDATE pay_checkouts SET status='failed', error=?, updated_at=? WHERE id=?", String(e.message).slice(0, 300), now(), id);
    logIntegration(KEY(pid), 'checkout', 'error', e.message);
    throw bad('We could not start this payment. Please try another way or contact us.');
  }
}

function postReceipt(k) {
  const actor = systemActor(), acc = depositAccount('Online Transfer');
  const label = PROVIDERS[k.provider].label;
  if (!actor || !acc) {
    run("UPDATE pay_checkouts SET status='needs_review', error='No deposit account or finance user to post to', updated_at=? WHERE id=?", now(), k.id);
    notifyPerm('payments', 'create', 'payment', 'Online payment received — needs posting', `${label} ${moneyText(k.amount)} (checkout ${k.id}): add an online/bank account, then retry in Settings > Payment gateways.`, '/settings/payment-gateways');
    return null;
  }
  return tx(() => {
    const rid = receivePayment({ contact_id: k.contact_id, sale_id: k.sale_id, amount: k.amount, method: 'Online Transfer', txn_id: `${k.provider}:${k.payment_ref}`, bank: label, date: today(), account_id: acc, payment_type: 'Installment', overpayment: true,
      notes: `Paid online through ${label} from the customer portal (checkout ${k.id}); confirmed with ${label} by the server.` }, actor);
    run("UPDATE pay_checkouts SET status='paid', receipt_id=?, error=NULL, updated_at=? WHERE id=?", rid, now(), k.id);
    audit(actor, 'Online payment posted', 'pay_checkout', k.id, `${label} ${k.currency} ${k.amount} receipt ${rid}`);
    return rid;
  });
}

/** Ask the provider what happened to this checkout and, only if it is really paid for the right amount, post it. Idempotent. */
export async function settle(token) {
  let k = get('SELECT * FROM pay_checkouts WHERE token=?', token);
  if (!k) throw notFound('Unknown payment');
  if (['paid', 'paid_test', 'posting'].includes(k.status) || !k.external_id) return k;
  const p = PROVIDERS[k.provider], cfg = integrationConfig(KEY(k.provider));
  if (!p || !cfg) return k;
  const r = await p.confirm(cfg, k); // may throw (provider down): the caller reports it and the provider retries the webhook
  if (!r.paid) return k;
  if (r.currency !== k.currency || Number(r.minor) !== k.minor_amount) {
    run("UPDATE pay_checkouts SET status='mismatch', error=?, updated_at=? WHERE id=?", `Provider reports ${r.currency} ${r.minor}, expected ${k.currency} ${k.minor_amount}`, now(), k.id);
    notifyPerm('payments', 'create', 'payment', 'Online payment amount mismatch', `${p.label} checkout ${k.id}: the amount paid does not match what was requested. Check it in ${p.label} before crediting.`, '/settings/payment-gateways');
    audit({ user: null, ip: 'gateway' }, 'Online payment amount mismatch', 'pay_checkout', k.id, `${r.currency} ${r.minor}`);
    return get('SELECT * FROM pay_checkouts WHERE id=?', k.id);
  }
  if (!lock(k)) return get('SELECT * FROM pay_checkouts WHERE id=?', k.id);
  k = { ...k, payment_ref: String(r.ref || k.external_id) };
  run('UPDATE pay_checkouts SET payment_ref=? WHERE id=?', k.payment_ref, k.id);
  if (k.sandbox) {
    run("UPDATE pay_checkouts SET status='paid_test', updated_at=? WHERE id=?", now(), k.id);
    audit({ user: null, ip: 'gateway' }, 'Test-mode online payment (no receipt posted)', 'pay_checkout', k.id, p.label);
  } else {
    try { postReceipt(k); } catch (e) {
      run("UPDATE pay_checkouts SET status='needs_review', error=?, updated_at=? WHERE id=?", String(e.message).slice(0, 300), now(), k.id);
      notifyPerm('payments', 'create', 'payment', 'Online payment received — needs posting', `${p.label} ${moneyText(k.amount)} (checkout ${k.id}): ${e.message}`, '/settings/payment-gateways');
    }
  }
  return get('SELECT * FROM pay_checkouts WHERE id=?', k.id);
}

/** Provider call-back. Returns { status } for the HTTP reply. */
export async function handleWebhook(pid, req) {
  const p = PROVIDERS[pid], cfg = p?.available ? integrationConfig(KEY(pid)) : null;
  if (!cfg) return { status: 404 };
  let ev;
  try { ev = await p.parseWebhook(req, cfg); } catch (e) { logIntegration(KEY(pid), 'webhook', 'rejected', e.message); return { status: 400 }; }
  if (!ev) return { status: 200 };
  if (ev.eventId && get('SELECT 1 FROM pay_events WHERE provider=? AND event_id=?', pid, ev.eventId)) return { status: 200, duplicate: true };
  const k = ev.checkoutToken ? get('SELECT token FROM pay_checkouts WHERE token=? AND provider=?', ev.checkoutToken, pid) : get('SELECT token FROM pay_checkouts WHERE provider=? AND external_id=?', pid, ev.externalId);
  if (k) {
    try { await settle(k.token); } catch (e) { logIntegration(KEY(pid), 'webhook', 'error', e.message); return { status: 502 }; }
  }
  if (ev.eventId) run('INSERT OR IGNORE INTO pay_events(provider,event_id,created_at) VALUES(?,?,?)', pid, ev.eventId, now());
  return { status: 200 };
}

/** The customer's own checkout, for the "we are confirming your payment" banner. */
export function ownCheckout(contactId, token) {
  const k = get('SELECT * FROM pay_checkouts WHERE token=? AND contact_id=?', token, contactId);
  if (!k) throw notFound('Payment not found');
  return { token: k.token, provider: PROVIDERS[k.provider]?.label || k.provider, amount: k.amount, status: ['paid', 'paid_test'].includes(k.status) ? k.status : ['failed', 'mismatch'].includes(k.status) ? 'failed' : k.status === 'needs_review' ? 'paid_pending_posting' : 'pending', receipt_id: k.receipt_id, test_mode: !!k.sandbox };
}

export function staffCheckouts() {
  return all(`SELECT k.id, k.provider, k.amount, k.currency, k.status, k.sandbox, k.error, k.created_at, k.receipt_id, c.full_name customer FROM pay_checkouts k JOIN contacts c ON c.id=k.contact_id ORDER BY k.id DESC LIMIT 200`)
    .map((k) => ({ ...k, provider_label: PROVIDERS[k.provider]?.label || k.provider }));
}
export function retryPosting(id, req) {
  const k = get('SELECT * FROM pay_checkouts WHERE id=?', id);
  if (!k) throw notFound('Payment not found');
  if (k.status !== 'needs_review' || !k.payment_ref) throw bad('This payment does not need posting');
  if (!run("UPDATE pay_checkouts SET status='posting' WHERE id=? AND status='needs_review'", id).changes) throw bad('Already being posted');
  try { if (!postReceipt(k)) throw bad('Still no deposit account to post to'); } catch (e) {
    run("UPDATE pay_checkouts SET status='needs_review', error=?, updated_at=? WHERE id=?", String(e.message).slice(0, 300), now(), id);
    throw e.status ? e : bad(e.message);
  }
  audit(req, 'Retried posting online payment', 'pay_checkout', id, '');
}

