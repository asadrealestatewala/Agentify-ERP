// WhatsApp inbox for one workspace (runs inside the tenant context).
//
// Rules this file enforces, because a WhatsApp number is easy to lose and hard to get back:
//  * staff reply one-to-one; there is no bulk send, no campaign and no automated outbound message anywhere in this module;
//  * a reply is allowed only within 24 hours of the customer's last message (WhatsApp's customer-service window), because a
//    business-started message needs an approved template, which staff send one-to-one from the saved template list;
//  * a number that wrote STOP (or similar) is blocked until it writes START or staff lift the block with a reason;
//  * sends are throttled per person and per day / month by the workspace's entitlement.
// The keys are stored encrypted per workspace and are never returned.
import crypto from 'node:crypto';
import { all, get, run, tx } from '../db.js';
import { activity, notify } from '../audit.js';
import { bad, forbidden, notFound, HttpError } from '../util.js';
import { saveIntegration, integrationConfig, integrationRow, markTested, removeIntegration, logIntegration, mask } from '../integrations/store.js';
import { whatsappProvider, cleanNumber, verifySignature, classifyError } from '../integrations/botlinkd.js';
import { currentTenant } from '../context.js';
import { whatsappAccess, REASON_TEXT } from './whatsappAccess.js';
import { currentAssignment, logHumanResponse } from './leadFlow.js';
import { submitLead } from './leads.js';
import { mode as waMode, qrConfig, qrSend, qrView, QR } from './whatsappQr.js';

export const PROVIDER = 'botlinkd';
export const WINDOW_HOURS = 24;
export const MAX_TEXT = 1000;
export const PER_USER_PER_MINUTE = 20;
const STOP_WORDS = /^\s*(stop|stop all|unsubscribe|cancel|end|quit|opt ?out|do not (contact|message)|don'?t message me)\s*[.!]*\s*$/i;
const START_WORDS = /^\s*(start|subscribe|unstop|yes)\s*[.!]*\s*$/i;
// times in the WhatsApp tables are UTC ISO strings, so the 24-hour window and the limits never depend on a workspace's time zone
const ms = (iso) => Date.parse(iso);
const utcNow = () => new Date().toISOString();
const digits = (v) => String(v || '').replace(/\D/g, '');

// ---------------------------------------------------------------- connection
export function connectionView(baseUrl) {
  const cfg = integrationConfig(PROVIDER), row = integrationRow(PROVIDER);
  const t = currentTenant();
  const acc = whatsappAccess(t);
  const info = (() => { try { return JSON.parse(row?.public_info || '{}'); } catch { return {}; } })();
  const lastIn = get("SELECT MAX(created_at) at FROM wa_messages WHERE direction='in'")?.at || null;
  const qr = qrView(), viaQr = qr.active;
  return {
    mode: viaQr ? 'qr' : 'cloud', qr,
    access: { enabled: acc.enabled, reason: acc.reason, message: acc.reason ? REASON_TEXT[acc.reason] || 'WhatsApp is not available.' : null, monthly: acc.monthly, daily: acc.daily },
    configured: viaQr ? true : !!cfg, state: viaQr ? qr.state : !cfg ? 'not_configured' : row?.status || 'configured',
    keys: cfg ? { appkey: mask(cfg.appkey), authkey: mask(cfg.authkey) } : null,
    number: info.number || null, templates: info.templates || [], signing_secret_saved: !!cfg?.signing_secret, connected_at: row?.connected_at || null, last_test_at: row?.last_test_at || null, last_error: row?.last_error || null,
    webhook_url: cfg && baseUrl ? `${baseUrl}/api/hooks/whatsapp/${cfg.webhook_token}` : null,
    last_inbound_at: lastIn, usage: usage(),
    safeguards: { window_hours: WINDOW_HOURS, per_user_per_minute: PER_USER_PER_MINUTE, max_text: MAX_TEXT, bulk_sending: false, templates: true },
  };
}
const pubInfo = () => { try { return JSON.parse(integrationRow(PROVIDER)?.public_info || '{}'); } catch { return {}; } };
const keyOk = (v, label) => { const s = String(v ?? '').trim(); if (!/^[A-Za-z0-9._\-|:]{8,200}$/.test(s)) throw bad(`${label} looks wrong. Copy it again from your Botlinkd account without spaces.`); return s; };

export function saveConnection(user, b) {
  const prev = integrationConfig(PROVIDER) || {};
  const appkey = b.appkey ? keyOk(b.appkey, 'The App key') : prev.appkey;
  const authkey = b.authkey ? keyOk(b.authkey, 'The Auth key') : prev.authkey;
  if (!appkey || !authkey) throw bad('Enter both the App key and the Auth key from your Botlinkd account.');
  let number = null;
  if (b.number !== undefined && b.number !== '') { number = cleanNumber(b.number); if (!number) throw bad('Enter the WhatsApp number in international form, digits only, for example 447700900123.'); }
  else number = (() => { try { return JSON.parse(integrationRow(PROVIDER)?.public_info || '{}').number || null; } catch { return null; } })();
  let signing = prev.signing_secret || null;
  if (b.signing_secret !== undefined && b.signing_secret !== '') { const s = String(b.signing_secret).trim(); if (s.length < 8 || s.length > 200 || /\s/.test(s)) throw bad('The signing secret looks wrong. Copy it again from Botlinkd (Auto Reply Settings).'); signing = s; }
  const cfg = { appkey, authkey, webhook_token: prev.webhook_token || crypto.randomBytes(24).toString('hex'), signing_secret: signing };
  const keysChanged = appkey !== prev.appkey || authkey !== prev.authkey;
  saveIntegration(PROVIDER, cfg, { publicInfo: { number, templates: pubInfo().templates || [] }, status: keysChanged || !prev.appkey ? 'configured' : integrationRow(PROVIDER)?.status || 'configured', userId: user.id });
  logIntegration(PROVIDER, 'configure', 'success', number ? `number ${number}` : 'keys saved', user.id);
  return cfg;
}
export function removeConnection(user) { removeIntegration(PROVIDER); logIntegration(PROVIDER, 'disconnect', 'success', null, user.id); }
export function rotateWebhookToken(user) {
  const cfg = integrationConfig(PROVIDER); if (!cfg) throw bad('Save your Botlinkd keys first.');
  cfg.webhook_token = crypto.randomBytes(24).toString('hex');
  const row = integrationRow(PROVIDER);
  saveIntegration(PROVIDER, cfg, { publicInfo: (() => { try { return JSON.parse(row?.public_info || '{}'); } catch { return {}; } })(), status: row?.status || 'configured', userId: user.id });
  logIntegration(PROVIDER, 'rotate-webhook', 'success', null, user.id);
}

// ---------------------------------------------------------------- limits
const startOfMonth = () => `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;
const startOfDay = () => `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
export function usage() {
  const acc = whatsappAccess(currentTenant());
  const month = get("SELECT COUNT(*) n FROM wa_messages WHERE direction='out' AND status='sent' AND created_at>=?", startOfMonth()).n;
  const day = get("SELECT COUNT(*) n FROM wa_messages WHERE direction='out' AND status='sent' AND created_at>=?", startOfDay()).n;
  return { month, day, monthly: acc.monthly ?? null, daily: acc.daily ?? null };
}

// ---------------------------------------------------------------- threads
const optedOut = (waId) => !!get('SELECT 1 FROM wa_optouts WHERE wa_id=? AND removed_at IS NULL', waId);
export function findContactByNumber(waId) {
  const key = digits(waId).slice(-10);
  if (key.length < 7) return null;
  const rows = all("SELECT id,agent_id,full_name,phone,whatsapp,alt_phone FROM contacts WHERE replace(replace(replace(replace(replace(COALESCE(phone,'')||' '||COALESCE(whatsapp,'')||' '||COALESCE(alt_phone,''),' ',''),'-',''),'(',''),')',''),'+','') LIKE ? LIMIT 50", `%${key.slice(-7)}%`);
  return rows.find((r) => [r.phone, r.whatsapp, r.alt_phone].some((p) => digits(p).length >= 7 && digits(p).slice(-10) === key)) || null;
}
const managers = () => all("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0 AND r.name IN ('Sales Manager','Admin','Owner','Super Admin')").map((x) => x.id);

export function threadRow(id) {
  return get(`SELECT t.*, c.full_name contact_name, c.agent_id contact_agent, u.name assigned_name,
    EXISTS(SELECT 1 FROM wa_optouts o WHERE o.wa_id=t.wa_id AND o.removed_at IS NULL) opted_out
    FROM wa_threads t LEFT JOIN contacts c ON c.id=t.contact_id LEFT JOIN users u ON u.id=t.assigned_to WHERE t.id=?`, id) || null;
}
export const withWindow = (t) => {
  const open = t.last_inbound_at && Date.now() - ms(t.last_inbound_at) < WINDOW_HOURS * 3600_000;
  return { ...t, opted_out: !!t.opted_out, can_reply: !!open && !t.opted_out, window_closes_at: t.last_inbound_at ? new Date(ms(t.last_inbound_at) + WINDOW_HOURS * 3600_000).toISOString() : null };
};
/** `mineOnly` = a role limited to its own records: assigned to them, or linked to a contact they own. */
export function listThreads({ mineOnly = null, status = 'open', filter = '', q = '' } = {}) {
  const where = [], p = [];
  if (mineOnly) { where.push('(t.assigned_to=? OR c.agent_id=?)'); p.push(mineOnly, mineOnly); }
  if (status === 'open' || status === 'closed') { where.push('t.status=?'); p.push(status); }
  if (filter === 'unread') where.push('t.unread>0');
  if (filter === 'unassigned') where.push('t.assigned_to IS NULL');
  if (q) { where.push('(t.wa_id LIKE ? OR t.display_name LIKE ? OR c.full_name LIKE ?)'); const l = `%${String(q).slice(0, 40)}%`; p.push(l, l, l); }
  return all(`SELECT t.id FROM wa_threads t LEFT JOIN contacts c ON c.id=t.contact_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY COALESCE(t.last_message_at, t.created_at) DESC, t.id DESC LIMIT 200`, ...p).map((r) => withWindow(threadRow(r.id)));
}
export function visibleThread(id, mineOnly) {
  const t = threadRow(id);
  if (!t) throw notFound('Conversation not found');
  if (mineOnly && t.assigned_to !== mineOnly && t.contact_agent !== mineOnly) throw forbidden('This conversation belongs to someone else');
  return t;
}
export const messagesOf = (threadId, limit = 200) => all(`SELECT m.id,m.direction,m.type,m.body,m.status,m.error,m.created_at,m.user_id,u.name user_name FROM wa_messages m LEFT JOIN users u ON u.id=m.user_id WHERE m.thread_id=? ORDER BY m.id DESC LIMIT ?`, threadId, limit).reverse();
export function markRead(id) { run('UPDATE wa_threads SET unread=0 WHERE id=?', id); }

function ensureThread(waId, name) {
  let t = get('SELECT * FROM wa_threads WHERE wa_id=?', waId);
  if (t) { if (name && !t.display_name) run('UPDATE wa_threads SET display_name=? WHERE id=?', name, t.id); return t; }
  const c = findContactByNumber(waId);
  const id = Number(run('INSERT INTO wa_threads(wa_id,contact_id,display_name,assigned_to,created_at) VALUES(?,?,?,?,?)', waId, c?.id ?? null, name || null, c?.agent_id ?? null, utcNow()).lastInsertRowid);
  return get('SELECT * FROM wa_threads WHERE id=?', id);
}

// ---------------------------------------------------------------- inbound
/**
 * Verify and store one webhook delivery. Returns { status, body } for the route to send. A request is accepted only with the
 * workspace's secret path token, and, when a signing secret is saved, a valid HMAC over the exact bytes.
 */
export function receiveWebhook(token, rawBody, headers, payload) {
  const same = (c) => { if (!c?.webhook_token || !token) return false; const a = Buffer.from(String(token)), b = Buffer.from(c.webhook_token); return a.length === b.length && crypto.timingSafeEqual(a, b); };
  // the address's secret token picks the connection: the official Botlinkd one or the optional QR one
  const prov = same(integrationConfig(PROVIDER)) ? PROVIDER : same(qrConfig()) ? QR : null;
  if (!prov) return { status: 404, body: { ok: false } };
  const cfg = integrationConfig(prov);
  if (cfg.signing_secret && !verifySignature(cfg.signing_secret, rawBody, headers)) { logIntegration(prov, 'webhook', 'rejected', 'signature did not match'); return { status: 401, body: { ok: false } }; }
  if (!whatsappAccess(currentTenant()).enabled) return { status: 200, body: { ok: true } }; // not entitled: acknowledge, store nothing
  if (payload?.event !== 'message.received') return { status: 200, body: { ok: true } };
  const waId = cleanNumber(payload?.data?.sender?.wa_id);
  if (!waId) return { status: 400, body: { ok: false, error: 'sender missing' } };
  const m = payload.data?.message || {};
  const type = String(m.type || 'text').slice(0, 20);
  const body = type === 'text' ? String(m.text ?? '').slice(0, 4000) : `[${type} received. Open it in WhatsApp on the business phone.]`;
  const eventId = payload.event_id ? String(payload.event_id).slice(0, 120) : null;
  const name = String(payload.data?.sender?.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || null;
  const stored = tx(() => {
    if (eventId && get('SELECT 1 FROM wa_messages WHERE event_id=?', eventId)) return null; // a repeated delivery
    const t = ensureThread(waId, name);
    const at = utcNow();
    run('INSERT INTO wa_messages(thread_id,direction,type,body,status,event_id,created_at) VALUES(?,?,?,?,?,?,?)', t.id, 'in', type, body, 'received', eventId, at);
    const wasUnread = t.unread > 0;
    run("UPDATE wa_threads SET unread=unread+1, last_message_at=?, last_inbound_at=?, last_preview=?, status='open' WHERE id=?", at, at, body.slice(0, 120), t.id);
    // opt-out words are handled here, in the same transaction as the message that carried them
    if (type === 'text' && STOP_WORDS.test(body)) { run("INSERT INTO wa_optouts(wa_id,reason,source,created_at) VALUES(?,?,?,?) ON CONFLICT(wa_id) DO UPDATE SET reason=excluded.reason, source=excluded.source, created_at=excluded.created_at, removed_at=NULL", waId, 'asked to stop', 'customer_message', at); if (t.contact_id) activity(t.contact_id, null, 'WhatsApp opt-out', { detail: 'The customer asked us to stop messaging them on WhatsApp.' }); }
    else if (type === 'text' && START_WORDS.test(body) && optedOut(waId)) { run("UPDATE wa_optouts SET removed_at=? WHERE wa_id=? AND removed_at IS NULL", at, waId); if (t.contact_id) activity(t.contact_id, null, 'WhatsApp opt-in', { detail: 'The customer asked to receive WhatsApp messages again.' }); }
    return { thread: t, wasUnread };
  });
  if (stored && !stored.wasUnread) {
    const to = stored.thread.assigned_to ? [stored.thread.assigned_to] : managers();
    notify(to, 'whatsapp', 'New WhatsApp message', `${name || stored.thread.display_name || `+${waId}`}: ${body.slice(0, 80)}`, `/whatsapp?thread=${stored.thread.id}`);
  }
  if (stored) { markTested(prov, true); }
  return { status: 200, body: { ok: true } }; // no "reply" field: Botlinkd sends nothing back to the customer
}

// ---------------------------------------------------------------- outbound
/** Everything a send must pass, whatever it carries: connection, entitlement, opt-out, per-person throttle, daily and monthly caps. */
function sendGuards(user, waId) {
  const viaQr = waMode() === 'qr' && !!qrConfig(), prov = viaQr ? QR : PROVIDER;
  const cfg = integrationConfig(PROVIDER);
  if (!viaQr && !cfg) throw bad('WhatsApp is not connected. Add your Botlinkd keys in Settings > WhatsApp.');
  if (viaQr && integrationRow(QR)?.status !== 'connected') throw bad('The QR connection is not linked right now. Open Settings > WhatsApp and scan the QR code again.');
  const acc = whatsappAccess(currentTenant());
  if (!acc.enabled) throw bad(REASON_TEXT[acc.reason] || 'WhatsApp is not available.');
  if (optedOut(waId)) throw new HttpError(409, 'This customer asked not to be messaged on WhatsApp.');
  const minute = new Date(Date.now() - 60_000).toISOString();
  if (get("SELECT COUNT(*) n FROM wa_messages WHERE direction='out' AND user_id=? AND created_at>=?", user.id, minute).n >= PER_USER_PER_MINUTE) throw new HttpError(429, 'You are sending too fast. Wait a minute and try again.');
  const u = usage();
  if (acc.daily != null && u.day >= acc.daily) throw new HttpError(429, 'The daily WhatsApp limit for this workspace is used up. It resets at midnight UTC.');
  if (acc.monthly != null && u.month >= acc.monthly) throw new HttpError(429, 'The monthly WhatsApp limit for this workspace is used up.');
  return { viaQr, prov, cfg, acc };
}

export async function sendReply(user, threadId, text) {
  const t = threadRow(threadId);
  if (!t) throw notFound('Conversation not found');
  const body = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!body) throw bad('Type a message first.');
  if (body.length > MAX_TEXT) throw bad(`Keep a WhatsApp message under ${MAX_TEXT} characters.`);
  const { viaQr, prov, cfg, acc } = sendGuards(user, t.wa_id);
  if (!t.last_inbound_at || Date.now() - ms(t.last_inbound_at) >= WINDOW_HOURS * 3600_000) throw new HttpError(409, `The ${WINDOW_HOURS}-hour reply window is closed. Send an approved template to start the conversation again, or wait until the customer writes to you; WhatsApp does not allow free messages after that.`);
  let ref = null, err = null;
  try { ref = (viaQr ? await qrSend(t.wa_id, body) : await whatsappProvider().sendText({ appkey: cfg.appkey, authkey: cfg.authkey, to: t.wa_id, message: body })).ref; }
  catch (e) { err = e.kind ? e : classifyError(e.message, e.status); }
  return recordOutbound(user, t, { prov, type: 'text', body, ref, err });
}
/** Stores one outbound attempt, updates the conversation and the contact's history, and throws a plain error when it failed. */
function recordOutbound(user, t, { prov, type, body, ref, err }) {
  const at = utcNow();
  const id = Number(run('INSERT INTO wa_messages(thread_id,direction,type,body,status,provider_ref,user_id,error,created_at) VALUES(?,?,?,?,?,?,?,?,?)', t.id, 'out', type, body, err ? 'failed' : 'sent', ref, user.id, err ? err.message : null, at).lastInsertRowid);
  if (err) { markTested(prov, false, err.message); logIntegration(prov, 'send', 'error', `${err.kind}: ${err.message}`, user.id); }
  else {
    run('UPDATE wa_threads SET last_message_at=?, last_preview=?, unread=0, assigned_to=COALESCE(assigned_to,?) WHERE id=?', at, `You: ${body}`.slice(0, 120), user.id, t.id);
    if (t.contact_id) {
      activity(t.contact_id, user, type === 'template' ? 'WhatsApp template sent' : 'WhatsApp message sent', { detail: body.slice(0, 160) });
      try { if (currentAssignment(t.contact_id)) logHumanResponse(t.contact_id, user, { channel: 'whatsapp', evidence: 'whatsapp_message', note: body.slice(0, 80) }); } catch { /* the send itself must not fail on bookkeeping */ }
    }
  }
  const row = get('SELECT id,direction,type,body,status,error,created_at,user_id FROM wa_messages WHERE id=?', id);
  if (err) { throw new HttpError(502, HELP[err.kind] || err.message, { message: row }); }
  return row;
}
const HELP = {
  auth: 'Botlinkd did not accept the keys. Check the App key and Auth key in Settings > WhatsApp.',
  limit: 'Your Botlinkd plan has no message allowance left. Check your Botlinkd account.',
  recipient: 'WhatsApp did not accept this number.',
  template: 'WhatsApp or Botlinkd did not accept this template. Check that its name, language and number of values match the approved template in your Botlinkd account.',
  window: 'WhatsApp will not deliver a free-text message now because the customer has not written in the last 24 hours. Send an approved template instead.',
  platform: 'The WhatsApp platform in Botlinkd is not connected or active. Check your Botlinkd dashboard.',
  temporary: 'Botlinkd could not send the message right now. It was not retried so the customer is not messaged twice; try again in a moment.',
};

/** The one real send outside the inbox: a test to a number the admin types, on an explicit click. Counts against the limits. */
export async function sendTest(user, to) {
  const cfg = integrationConfig(PROVIDER);
  if (!cfg) throw bad('Save your Botlinkd keys first.');
  const acc = whatsappAccess(currentTenant());
  if (!acc.enabled) throw bad(REASON_TEXT[acc.reason] || 'WhatsApp is not available.');
  const num = cleanNumber(to);
  if (!num) throw bad('Enter the number to test in international form, digits only.');
  const u = usage();
  if ((acc.daily != null && u.day >= acc.daily) || (acc.monthly != null && u.month >= acc.monthly)) throw new HttpError(429, 'The WhatsApp limit for this workspace is used up.');
  try { await whatsappProvider().sendText({ appkey: cfg.appkey, authkey: cfg.authkey, to: num, message: 'This is a test message from your Agentify ERP workspace. No reply is needed.' }); }
  catch (e) { const err = e.kind ? e : classifyError(e.message, e.status); markTested(PROVIDER, false, err.message); logIntegration(PROVIDER, 'test', 'error', err.kind, user.id); throw bad(HELP[err.kind] || err.message); }
  markTested(PROVIDER, true); logIntegration(PROVIDER, 'test', 'success', `to ${num.slice(0, 3)}…${num.slice(-2)}`, user.id);
  return { ok: true };
}

// ---------------------------------------------------------------- approved templates (the only way to start or restart a chat)
// Botlinkd has no call that lists templates or their approval state, so the workspace records each template it created and had
// approved in its Botlinkd account, and ticks "approved". A template that is not ticked cannot be sent from here.
export const MAX_TEMPLATES = 20;
export function saveTemplates(user, list) {
  if (!integrationConfig(PROVIDER)) throw bad('Save your Botlinkd keys first.');
  if (!Array.isArray(list) || list.length > MAX_TEMPLATES) throw bad(`Save up to ${MAX_TEMPLATES} templates.`);
  const seen = new Set();
  const out = list.map((x) => {
    const name = String(x?.name || '').trim(), language = String(x?.language || 'en').trim();
    if (!/^[a-z0-9_]{1,512}$/.test(name)) throw bad('A template name uses lower-case letters, digits and underscores only, exactly as in Botlinkd (for example appointment_reminder).');
    if (!/^[a-z]{2,3}(_[A-Za-z]{2,4})?$/.test(language)) throw bad(`The language of "${name}" looks like en, en_US or ar.`);
    if (seen.has(`${name}/${language}`)) throw bad(`"${name}" (${language}) is listed twice.`);
    seen.add(`${name}/${language}`);
    const params = (Array.isArray(x?.params) ? x.params : []).map((l) => String(l || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean);
    if (params.length > 10) throw bad(`"${name}" can have up to 10 values.`);
    return { name, language, params, preview: String(x?.preview || '').replace(/\r\n/g, '\n').trim().slice(0, 1000), approved: x?.approved === true };
  });
  const row = integrationRow(PROVIDER);
  saveIntegration(PROVIDER, integrationConfig(PROVIDER), { publicInfo: { ...pubInfo(), templates: out }, status: row?.status || 'configured', userId: user.id });
  logIntegration(PROVIDER, 'templates', 'success', `${out.length} template(s)`, user.id);
  return out;
}
const visibleThreadSafe = (id, mineOnly) => { try { visibleThread(id, mineOnly); return true; } catch { return false; } };
const renderTemplate = (tpl, values) => (tpl.preview ? tpl.preview.replace(/\{\{(\d+)\}\}/g, (m, n) => values[Number(n) - 1] ?? m) : `${tpl.name}: ${values.join(', ')}`).slice(0, 1000);

/**
 * Sends one approved template to one person, one at a time, by a named staff member. `thread` may be null for a number we have
 * never written to; it is then created, and removed again when the very first send fails. Needs the same entitlement, throttle,
 * caps and opt-out checks as a reply. A number that never wrote to us also needs the staff member to confirm the person agreed.
 */
export async function sendTemplateMessage(user, { thread = null, number = null, name = null, template, language = null, values = [], consent = false, mineOnly = null }) {
  if (waMode() === 'qr' && qrConfig()) throw bad('Templates belong to the official Botlinkd connection. Switch QR mode off to send one.');
  const waId = thread ? thread.wa_id : cleanNumber(number);
  if (!waId) throw bad('Enter the WhatsApp number in international form, digits only, for example 447700900123.');
  const tpl = (pubInfo().templates || []).find((x) => x.name === template && (!language || x.language === language));
  if (!tpl) throw bad('Choose one of the saved templates. An admin adds them in Settings > WhatsApp.');
  if (!tpl.approved) throw bad(`"${tpl.name}" is not marked as approved. Approve it in your Botlinkd account first, then tick Approved in Settings > WhatsApp.`);
  const vals = (Array.isArray(values) ? values : []).map((v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim());
  if (vals.length !== tpl.params.length || vals.some((v) => !v)) throw bad(tpl.params.length ? `Fill in all ${tpl.params.length} value(s): ${tpl.params.join(', ')}.` : 'This template takes no values.');
  if (vals.some((v) => v.length > 200)) throw bad('Keep each value under 200 characters.');
  const { cfg } = sendGuards(user, waId);
  const existing = thread || get('SELECT * FROM wa_threads WHERE wa_id=?', waId);
  if (!thread && mineOnly) {
    const c = findContactByNumber(waId);
    if ((c && c.agent_id !== mineOnly) || (existing && visibleThreadSafe(existing.id, mineOnly) === false)) throw forbidden('This number belongs to a contact or conversation of someone else.');
  }
  if (!existing?.last_inbound_at && consent !== true) throw bad('Tick the box to confirm this person agreed to receive WhatsApp messages from you. WhatsApp can block a number that messages people who did not.');
  const fresh = !existing;
  const t = existing || ensureThread(waId, String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || null);
  let ref = null, err = null;
  try { ref = (await whatsappProvider().sendTemplate({ appkey: cfg.appkey, authkey: cfg.authkey, to: waId, template: tpl.name, language: tpl.language, params: vals })).ref; }
  catch (e) { err = e.kind ? e : classifyError(e.message, e.status); }
  if (err && fresh) { run('DELETE FROM wa_threads WHERE id=?', t.id); logIntegration(PROVIDER, 'template', 'error', `${err.kind}: ${err.message}`, user.id); throw new HttpError(502, HELP[err.kind] || err.message); }
  try { return { ...recordOutbound(user, t, { prov: PROVIDER, type: 'template', body: renderTemplate(tpl, vals), ref, err }), thread_id: t.id }; }
  catch (e) { e.thread_id = t.id; throw e; }
}

// ---------------------------------------------------------------- staff actions on a conversation
export function updateThread(user, t, b, mineOnly) {
  if (b.status !== undefined) { if (!['open', 'closed'].includes(b.status)) throw bad('Status is open or closed'); run('UPDATE wa_threads SET status=? WHERE id=?', b.status, t.id); }
  if (b.assigned_to !== undefined) {
    const uid = b.assigned_to === null || b.assigned_to === '' ? null : Number(b.assigned_to);
    if (uid !== null) {
      if (!get('SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.active=1 AND r.portal=0', uid)) throw bad('Choose a staff member');
      if (mineOnly && uid !== mineOnly) throw forbidden('You can only assign conversations to yourself');
    } else if (mineOnly) throw forbidden('You can only assign conversations to yourself');
    run('UPDATE wa_threads SET assigned_to=? WHERE id=?', uid, t.id);
    if (uid && uid !== user.id) notify([uid], 'whatsapp', 'WhatsApp conversation assigned to you', t.contact_name || t.display_name || `+${t.wa_id}`, `/whatsapp?thread=${t.id}`);
  }
  if (b.contact_id !== undefined) {
    const cid = b.contact_id === null || b.contact_id === '' ? null : Number(b.contact_id);
    if (cid !== null) {
      const c = get('SELECT id,agent_id FROM contacts WHERE id=?', cid);
      if (!c) throw bad('Contact not found');
      if (mineOnly && c.agent_id !== mineOnly) throw forbidden('You can only link contacts that are yours');
      run('UPDATE wa_threads SET contact_id=?, assigned_to=COALESCE(assigned_to,?) WHERE id=?', cid, c.agent_id, t.id);
      activity(cid, user, 'WhatsApp conversation linked', { detail: `+${t.wa_id}` });
    } else run('UPDATE wa_threads SET contact_id=NULL WHERE id=?', t.id);
  }
}
export function setOptOut(user, t, optOut, reason) {
  const r = String(reason || '').trim().slice(0, 200);
  if (optOut) run("INSERT INTO wa_optouts(wa_id,reason,source,created_at) VALUES(?,?,?,?) ON CONFLICT(wa_id) DO UPDATE SET reason=excluded.reason, source=excluded.source, created_at=excluded.created_at, removed_at=NULL", t.wa_id, r || 'marked by staff', `staff:${user.id}`, utcNow());
  else { if (!r) throw bad('Say why messaging this number is allowed again (for example: the customer asked us to message them).'); run('UPDATE wa_optouts SET removed_at=? WHERE wa_id=? AND removed_at IS NULL', utcNow(), t.wa_id); }
  if (t.contact_id) activity(t.contact_id, user, optOut ? 'WhatsApp opt-out recorded' : 'WhatsApp messaging allowed again', { detail: r });
}
export function createLeadFromThread(user, t, name) {
  if (t.contact_id) throw bad('This conversation is already linked to a contact.');
  const first = get("SELECT body FROM wa_messages WHERE thread_id=? AND direction='in' ORDER BY id LIMIT 1", t.id)?.body || '';
  const r = submitLead({ name, phone: `+${t.wa_id}`, message: first.slice(0, 500) });
  if (r.result === 'created') run("UPDATE contacts SET lead_source='WhatsApp', whatsapp=? WHERE id=?", `+${t.wa_id}`, r.id);
  const c = get('SELECT agent_id FROM contacts WHERE id=?', r.id);
  run('UPDATE wa_threads SET contact_id=?, assigned_to=COALESCE(assigned_to,?) WHERE id=?', r.id, c?.agent_id ?? user.id, t.id);
  activity(r.id, user, 'Lead created from WhatsApp', { detail: `+${t.wa_id}` });
  return { contact_id: r.id, result: r.result };
}
