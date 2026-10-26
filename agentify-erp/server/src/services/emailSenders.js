// Tenant sender domains and From identities. A workspace submits a domain it owns, adds the DNS records the provider lists,
// and verifies. Only an active From identity on a VERIFIED domain of that workspace can ever send. The provider key stays
// server-side; the browser only sees the records to add and the state.
import { platformDb, BASE_DOMAIN, sitesDomain } from '../platform.js';
import { emailProvider } from './emailProvider.js';
import { bad, HttpError } from '../util.js';
import { isAddress, lc } from './emailConsent.js';

export const SENDER_SCHEMA = `
CREATE TABLE IF NOT EXISTS email_sender_domains(
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, domain TEXT NOT NULL UNIQUE COLLATE NOCASE, provider_domain_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', records TEXT NOT NULL DEFAULT '[]', last_error TEXT, checked_at TEXT, verified_at TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_esd_tenant ON email_sender_domains(tenant_id);
CREATE TABLE IF NOT EXISTS email_senders(
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, domain_id INTEGER NOT NULL REFERENCES email_sender_domains(id) ON DELETE CASCADE,
  local_part TEXT NOT NULL, display_name TEXT, reply_to TEXT, active INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0, authorized_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(domain_id, local_part));
CREATE INDEX IF NOT EXISTS idx_es_tenant ON email_senders(tenant_id, active);
`;
let ready = null;
const pdb = () => { const d = platformDb(); if (ready !== d) { d.exec(SENDER_SCHEMA); ready = d; } return d; };

// a workspace cannot send as a mailbox provider's domain it does not control
const PUBLIC_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'msn.com', 'yandex.com', 'zoho.com', 'mail.com', 'gmx.com']);
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
export function normalizeSendingDomain(input) {
  const d = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^.*@/, '').replace(/\/.*$/, '').replace(/\.$/, '');
  const labels = d.split('.');
  if (!d || labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !/^[a-z]{2,}$/.test(labels.at(-1))) throw bad('Enter a domain you own, such as yourcompany.com (not an email address or web address).');
  if (PUBLIC_MAIL.has(d)) throw bad('Free mailbox domains such as gmail.com cannot be used: you do not control their DNS. Use your own company domain.');
  if (BASE_DOMAIN && (d === BASE_DOMAIN || d.endsWith(`.${BASE_DOMAIN}`))) throw bad(`Domains ending in ${BASE_DOMAIN} belong to the platform.`);
  const sd = sitesDomain(); if (sd && (d === sd || d.endsWith(`.${sd}`))) throw bad(`Domains ending in ${sd} belong to the platform.`);
  return d;
}

const view = (r) => ({ id: r.id, domain: r.domain, status: r.status, verified: r.status === 'verified', records: JSON.parse(r.records || '[]'), error: r.last_error, checked_at: r.checked_at, verified_at: r.verified_at, created_at: r.created_at });
const STATUS = { verified: 'verified', failed: 'failed', temporary_failure: 'pending', pending: 'pending', not_started: 'pending', verifying: 'pending' };
const mapRecords = (recs) => (Array.isArray(recs) ? recs : []).map((x) => ({ purpose: x.record || x.purpose || null, type: x.type, name: x.name, value: x.value, priority: x.priority ?? null, ttl: x.ttl ?? null, status: x.status || 'not_started' })).filter((x) => x.type && x.name);
const explain = (domain, recs) => {
  const bad1 = recs.filter((r) => r.status && r.status !== 'verified');
  return bad1.length ? `DNS is not ready for ${domain}: ${bad1.map((r) => `${r.type} ${r.name} (${String(r.status).replace('_', ' ')})`).join('; ')}. Add or correct these records at your DNS provider, wait a few minutes (it can take up to an hour), then check again.` : null;
};

export async function submitDomain(tenant, input, by) {
  const domain = normalizeSendingDomain(input);
  const d = pdb();
  const taken = d.prepare('SELECT tenant_id FROM email_sender_domains WHERE domain=?').get(domain);
  if (taken) throw bad(taken.tenant_id === tenant.id ? 'This domain is already added to your workspace.' : 'That domain is already connected to another workspace.');
  if (d.prepare('SELECT COUNT(*) n FROM email_sender_domains WHERE tenant_id=?').get(tenant.id).n >= 5) throw bad('A workspace can have up to 5 sending domains.');
  let out;
  try { out = await emailProvider().createDomain(domain); } catch (e) { throw new HttpError(e.kind === 'config' ? 503 : 502, e.kind === 'config' ? 'E-mail sending is not connected on this server yet. Ask Agentify support.' : `The e-mail provider could not add the domain: ${e.message}`); }
  const recs = mapRecords(out?.records);
  const r = d.prepare('INSERT INTO email_sender_domains(tenant_id,domain,provider_domain_id,status,records,created_by) VALUES(?,?,?,?,?,?)').run(tenant.id, domain, out?.id || null, STATUS[out?.status] || 'pending', JSON.stringify(recs), by || null);
  return view(d.prepare('SELECT * FROM email_sender_domains WHERE id=?').get(Number(r.lastInsertRowid)));
}

export async function checkDomain(tenant, id) {
  const d = pdb();
  const row = d.prepare('SELECT * FROM email_sender_domains WHERE id=? AND tenant_id=?').get(Number(id), tenant.id);
  if (!row) throw new HttpError(404, 'Domain not found');
  try {
    if (row.status !== 'verified' && row.provider_domain_id) await emailProvider().verifyDomain(row.provider_domain_id);
    const out = await emailProvider().getDomain(row.provider_domain_id);
    const recs = mapRecords(out?.records), status = STATUS[out?.status] || 'pending';
    d.prepare("UPDATE email_sender_domains SET status=?, records=?, last_error=?, checked_at=datetime('now'), verified_at=CASE WHEN ?='verified' AND verified_at IS NULL THEN datetime('now') ELSE verified_at END WHERE id=?")
      .run(status, JSON.stringify(recs.length ? recs : JSON.parse(row.records)), status === 'verified' ? null : explain(row.domain, recs) || (status === 'failed' ? 'The provider could not verify this domain. Check the DNS records below.' : 'Verification is still in progress.'), status, row.id);
  } catch (e) {
    d.prepare("UPDATE email_sender_domains SET last_error=?, checked_at=datetime('now') WHERE id=?").run(`Could not check with the provider: ${e.message}`, row.id);
    throw new HttpError(502, `Could not check with the provider: ${e.message}`);
  }
  return view(d.prepare('SELECT * FROM email_sender_domains WHERE id=?').get(row.id));
}

export async function removeDomain(tenant, id) {
  const d = pdb();
  const row = d.prepare('SELECT * FROM email_sender_domains WHERE id=? AND tenant_id=?').get(Number(id), tenant.id);
  if (!row) throw new HttpError(404, 'Domain not found');
  if (d.prepare("SELECT 1 FROM email_queue WHERE tenant_id=? AND from_addr LIKE ? AND status IN ('queued','ambiguous','sending')").get(tenant.id, `%@${row.domain}>`)) throw bad('Messages are still waiting to be sent from this domain. Wait for them or cancel them first.');
  try { if (row.provider_domain_id) await emailProvider().removeDomain(row.provider_domain_id); } catch { /* already gone at the provider */ }
  d.prepare('DELETE FROM email_sender_domains WHERE id=?').run(row.id);
}

export const listDomains = (tenantId) => pdb().prepare('SELECT * FROM email_sender_domains WHERE tenant_id=? ORDER BY id').all(tenantId).map(view);

const LOCAL = /^[a-z0-9][a-z0-9._+-]{0,63}$/;
export function addSender(tenant, { domain_id, local_part, display_name, reply_to }, by) {
  const d = pdb();
  const dom = d.prepare('SELECT * FROM email_sender_domains WHERE id=? AND tenant_id=?').get(Number(domain_id), tenant.id);
  if (!dom) throw bad('Choose one of your sending domains');
  const lp = String(local_part || '').trim().toLowerCase();
  if (!LOCAL.test(lp)) throw bad('The part before @ can use letters, numbers and . _ + - (up to 64 characters)');
  const name = String(display_name ?? '').trim();
  if (name.length > 78 || /[<>"\r\n:]/.test(name)) throw bad('The sender name must be plain text, up to 78 characters, without < > " : or line breaks');
  const reply = lc(reply_to);
  if (reply && !isAddress(reply)) throw bad('Reply-To must be a valid email address');
  if (d.prepare('SELECT 1 FROM email_senders WHERE domain_id=? AND local_part=?').get(dom.id, lp)) throw bad('That sender address already exists');
  const first = !d.prepare('SELECT 1 FROM email_senders WHERE tenant_id=? AND active=1').get(tenant.id);
  const r = d.prepare('INSERT INTO email_senders(tenant_id,domain_id,local_part,display_name,reply_to,is_default,authorized_by) VALUES(?,?,?,?,?,?,?)').run(tenant.id, dom.id, lp, name || null, reply || null, first ? 1 : 0, by || null);
  return Number(r.lastInsertRowid);
}
export function updateSender(tenant, id, { display_name, reply_to, active, is_default }) {
  const d = pdb();
  const s = d.prepare('SELECT * FROM email_senders WHERE id=? AND tenant_id=?').get(Number(id), tenant.id);
  if (!s) throw new HttpError(404, 'Sender not found');
  const f = {};
  if (display_name !== undefined) { const n = String(display_name || '').trim(); if (n.length > 78 || /[<>"\r\n:]/.test(n)) throw bad('The sender name must be plain text without < > " : or line breaks'); f.display_name = n || null; }
  if (reply_to !== undefined) { const r = lc(reply_to); if (r && !isAddress(r)) throw bad('Reply-To must be a valid email address'); f.reply_to = r || null; }
  if (active !== undefined) f.active = active ? 1 : 0;
  const keys = Object.keys(f);
  if (keys.length) d.prepare(`UPDATE email_senders SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => f[k]), s.id);
  if (is_default) { d.prepare('UPDATE email_senders SET is_default=0 WHERE tenant_id=?').run(tenant.id); d.prepare('UPDATE email_senders SET is_default=1 WHERE id=?').run(s.id); }
}
export function removeSender(tenant, id) {
  const r = pdb().prepare('DELETE FROM email_senders WHERE id=? AND tenant_id=?').run(Number(id), tenant.id);
  if (!r.changes) throw new HttpError(404, 'Sender not found');
}
export const listSenders = (tenantId) => pdb().prepare(`SELECT s.id,s.local_part,s.display_name,s.reply_to,s.active,s.is_default,s.domain_id,d.domain,d.status domain_status,s.authorized_by
  FROM email_senders s JOIN email_sender_domains d ON d.id=s.domain_id WHERE s.tenant_id=? ORDER BY s.id`).all(tenantId)
  .map((s) => ({ ...s, address: `${s.local_part}@${s.domain}`, active: !!s.active, is_default: !!s.is_default, can_send: !!s.active && s.domain_status === 'verified' }));

/** The sender a message may use: the one asked for, or the workspace default. Null unless active, owned by the workspace and on a verified domain. */
export function activeSenderFor(tenantId, senderId) {
  const d = pdb();
  const q = `SELECT s.id,s.local_part,s.display_name,s.reply_to,dm.domain FROM email_senders s JOIN email_sender_domains dm ON dm.id=s.domain_id
    WHERE s.tenant_id=? AND s.active=1 AND dm.tenant_id=s.tenant_id AND dm.status='verified'`;
  if (senderId) return d.prepare(`${q} AND s.id=?`).get(tenantId, Number(senderId)) || null;
  return d.prepare(`${q} ORDER BY s.is_default DESC, s.id LIMIT 1`).get(tenantId) || null;
}
