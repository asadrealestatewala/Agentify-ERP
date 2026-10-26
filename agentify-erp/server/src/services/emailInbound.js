// Reply detection through the provider's inbound e-mail (webhook `email.received`). Opens and clicks are never used.
//
// Outgoing sequence mail gets a Reply-To of reply+<token>@<inbound domain>, where the token is signed and names one queued
// message. When mail arrives at such an address we find OUR row, take the workspace from it (never from the request),
// check the sender really is the person we mailed, ignore automatic replies and bounces, and de-duplicate by message id.
// If no inbound domain is configured, nothing here runs and the CRM says so; staff can pause or log a reply by hand.
import crypto from 'node:crypto';
import { getTenant, withTenant } from '../platform.js';
import { getSetting } from './platformConfig.js';
import { secretsKey } from './platformConfig.js';
import { emailProvider } from './emailProvider.js';
import { pdb } from './tenantEmail.js';
import { lc } from './emailConsent.js';

const sig = (id) => crypto.createHmac('sha256', secretsKey()).update(`reply:${id}`).digest('base64url').slice(0, 12);
export const inboundDomain = () => (getSetting('inbound_reply_domain') || process.env.INBOUND_REPLY_DOMAIN || '').trim().toLowerCase() || null;
export const replyAddressFor = (queueId) => { const d = inboundDomain(); return d ? `reply+${queueId}.${sig(queueId)}@${d}` : null; };
/** Queue id from a reply address, only when the signature is right. */
export function parseReplyAddress(addr) {
  const m = /^reply\+(\d+)\.([A-Za-z0-9_-]{12})@(.+)$/i.exec(String(addr || '').trim().replace(/^.*<|>$/g, ''));
  if (!m) return null;
  const want = sig(m[1]);
  return m[2].length === want.length && crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(want)) && (!inboundDomain() || m[3].toLowerCase() === inboundDomain()) ? Number(m[1]) : null;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS email_inbound(email_id TEXT PRIMARY KEY, tenant_id INTEGER, queue_id INTEGER, kind TEXT NOT NULL, from_addr TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));`;
let ready = false;
const tbl = () => { const d = pdb(); if (!ready) { d.exec(SCHEMA); ready = true; } return d; };

const listeners = [];
/** Called (inside the workspace) for each genuine human reply: ({ tenant, row, from, subject, emailId }). */
export const onReply = (fn) => { listeners.push(fn); };

const norm = (h) => {
  const out = {};
  if (Array.isArray(h)) for (const x of h) if (x?.name) out[String(x.name).toLowerCase()] = String(x.value ?? '');
  else if (h && typeof h === 'object') for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v ?? '');
  return out;
};
const bareAddress = (s) => lc(String(s || '').replace(/^.*<|>.*$/g, '').trim());

/** automatic reply / bounce notice / list noise, from headers and the usual subject lines */
export function classifyInbound({ from, subject, headers }) {
  const h = norm(headers), f = bareAddress(from);
  if (/^(mailer-daemon|postmaster)@/.test(f) || /multipart\/report/i.test(h['content-type'] || '') || /delivery status|undeliverable|returned mail|delivery failure/i.test(subject || '')) return 'bounce';
  if ((h['auto-submitted'] && !/^no$/i.test(h['auto-submitted'].trim())) || h['x-autoreply'] || h['x-autorespond'] || /auto_reply|auto-reply|bulk|junk|list/i.test(h.precedence || '') || h['x-auto-response-suppress']
    || /^(automatic reply|auto(matic)?[- ]?reply|out of office|autoreply)/i.test(String(subject || '').trim())) return 'auto';
  return 'reply';
}

export async function handleInbound(emailId, data = {}) {
  const d = tbl();
  const tos = [].concat(data.to || []).map(String);
  const hit = tos.map(parseReplyAddress).find(Boolean);
  if (!hit) return { handled: false };
  if (d.prepare('SELECT 1 FROM email_inbound WHERE email_id=?').get(emailId)) return { handled: true, duplicate: true };
  const row = d.prepare('SELECT * FROM email_queue WHERE id=?').get(hit);
  if (!row) return { handled: false };
  let full = data;
  if (!data.headers || !data.from) { try { full = { ...data, ...(await emailProvider().getReceived(emailId)) }; } catch { /* classify with what we have */ } }
  const from = bareAddress(full.from);
  const kind = classifyInbound({ from, subject: full.subject, headers: full.headers });
  // the sender must be the person this message went to (a forward or a stranger is not a reply from the contact)
  const verdict = kind !== 'reply' ? kind : from === lc(row.to_addr) ? 'reply' : 'unmatched_sender';
  if (!d.prepare('INSERT OR IGNORE INTO email_inbound(email_id,tenant_id,queue_id,kind,from_addr) VALUES(?,?,?,?,?)').run(emailId, row.tenant_id, row.id, verdict, from || null).changes) return { handled: true, duplicate: true };
  if (verdict === 'reply') {
    const tenant = getTenant(row.tenant_id);
    if (tenant) withTenant(tenant, () => { for (const fn of listeners) { try { fn({ tenant, row, from, subject: full.subject || '', emailId }); } catch (e) { console.error('[reply hook]', e.message); } } });
  }
  return { handled: true, kind: verdict };
}
