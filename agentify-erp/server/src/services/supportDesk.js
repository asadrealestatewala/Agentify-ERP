// In-app support desk. Tickets live in the platform database (not in a workspace database) so the Super Admin console
// can work them across all workspaces, while each workspace sees only its own. People see their own tickets; a
// workspace's Super Admin role sees all of that workspace's tickets. Replies, attachments (small images/PDF kept in the
// database), service-level targets and e-mail notices in the person's own language.
import { platformDb } from '../platform.js';
import { currentTenant } from '../context.js';
import { bad, HttpError } from '../util.js';
import { sendMail, layout, platformBrand } from './mailer.js';
import { getSetting, setSetting } from './platformConfig.js';
import { STATUSES, PRIORITIES, CATEGORIES, LANGS, DEFAULT_SLA, ATTACH_LIMITS, st, ticketNo, supportLangs, langDir } from '../../../shared/supportDesk.js';

const pdb = () => platformDb();
export const SUPPORT_SCHEMA = `
CREATE TABLE IF NOT EXISTS support_tickets(
  id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0, tenant_slug TEXT, tenant_name TEXT, region TEXT, user_id INTEGER NOT NULL, user_name TEXT, user_email TEXT,
  lang TEXT NOT NULL DEFAULT 'en', subject TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'question', priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','pending','solved','closed')), assignee TEXT,
  first_response_at TEXT, solved_at TEXT, unread_staff INTEGER NOT NULL DEFAULT 1, unread_customer INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_support_t_tenant ON support_tickets(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_support_t_status ON support_tickets(status, updated_at);
CREATE TABLE IF NOT EXISTS support_messages(
  id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, author_type TEXT NOT NULL CHECK(author_type IN ('customer','staff')), author_name TEXT,
  body TEXT NOT NULL, internal INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_support_m_ticket ON support_messages(ticket_id, id);
CREATE TABLE IF NOT EXISTS support_files(
  id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, message_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS idx_support_f_msg ON support_files(message_id);
`;
let ready = false;
const ensure = () => { if (!ready) { pdb().exec(SUPPORT_SCHEMA); ready = true; } };
export const resetSupportForTests = () => { ready = false; };

const str = (v, max, label) => { const s = String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim(); if (s.length > max) throw bad(`${label} is too long (max ${max} characters)`); return s; };
const tenantKey = () => currentTenant()?.id ?? 0;
const iso = (sqlite) => (sqlite ? `${String(sqlite).replace(' ', 'T')}Z` : null);

// ---- service-level targets (minutes: first reply, solved), editable in the console
export function getSla() {
  ensure();
  let saved = {};
  try { saved = JSON.parse(getSetting('support_sla') || '{}'); } catch { saved = {}; }
  return Object.fromEntries(PRIORITIES.map((p) => [p, Array.isArray(saved[p]) && saved[p].length === 2 ? saved[p] : DEFAULT_SLA[p]]));
}
export function saveSla(input, by) {
  const out = {};
  for (const p of PRIORITIES) {
    const a = input?.[p];
    const first = Number(a?.[0]), solve = Number(a?.[1]);
    if (!Number.isFinite(first) || !Number.isFinite(solve) || first < 5 || first > 20160 || solve < first || solve > 43200) throw bad(`Check the ${p} targets: first reply 5 minutes or more, solved no sooner than the first reply, at most 30 days`);
    out[p] = [Math.round(first), Math.round(solve)];
  }
  setSetting('support_sla', JSON.stringify(out), { by });
  return out;
}
export const notifyAddress = () => (getSetting('support_notify_email') || platformBrand().email || '').trim();
export function saveNotifyAddress(v, by) {
  const s = String(v || '').trim();
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('Enter a valid e-mail address');
  setSetting('support_notify_email', s, { by });
  return s;
}

/** Due times and state for a ticket row. */
export function slaOf(t, sla = getSla()) {
  const [first, solve] = sla[t.priority] || sla.normal;
  const created = Date.parse(iso(t.created_at));
  const firstDue = created + first * 60000, solveDue = created + solve * 60000;
  const now = Date.now();
  const state = (done, due, doneAt) => (done ? ((doneAt ? Date.parse(iso(doneAt)) : now) <= due ? 'met' : 'breached') : now > due ? 'breached' : (due - now) < (due - created) * 0.25 ? 'at_risk' : 'ok');
  const closed = t.status === 'solved' || t.status === 'closed';
  return {
    first_due: new Date(firstDue).toISOString(), solve_due: new Date(solveDue).toISOString(),
    first_state: state(!!t.first_response_at, firstDue, t.first_response_at),
    solve_state: state(closed, solveDue, t.solved_at),
  };
}

// ---- attachments
const SIG = {
  'image/png': (b) => b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 4).toString('latin1') === '%PDF',
};
/** Each item is { name, data: 'data:<type>;base64,…' }. Returns buffers after checking type, size and the file's own signature. */
export function cleanFiles(list) {
  if (!list) return [];
  if (!Array.isArray(list)) throw bad('Attachments are not valid');
  if (list.length > ATTACH_LIMITS.files) throw bad(`You can attach up to ${ATTACH_LIMITS.files} files`);
  return list.map((f) => {
    const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(f?.data || ''));
    if (!m || !ATTACH_LIMITS.types.includes(m[1])) throw bad('Only images (PNG, JPG, WebP) and PDF files can be attached');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > ATTACH_LIMITS.bytes) throw bad('A file is too large (450 KB at most)');
    if (!SIG[m[1]](buf)) throw bad('A file is not a valid image or PDF');
    return { name: str(f.name || 'file', 120, 'File name').replace(/[\\/"<>:*?|]+/g, '_') || 'file', type: m[1], buf };
  });
}
const saveFiles = (ticketId, messageId, files) => {
  const ins = pdb().prepare('INSERT INTO support_files(ticket_id,message_id,name,type,size,data) VALUES(?,?,?,?,?,?)');
  for (const f of files) ins.run(ticketId, messageId, f.name, f.type, f.buf.length, f.buf);
};
export function fileOf(id, ticketId) {
  ensure();
  const f = pdb().prepare('SELECT id,ticket_id,name,type,size,data FROM support_files WHERE id=? AND ticket_id=?').get(Number(id), Number(ticketId));
  if (!f) throw new HttpError(404, 'File not found');
  return { name: f.name, type: f.type, buffer: Buffer.from(f.data) };
}

// ---- views
const ticketView = (t, sla) => ({
  id: t.id, no: ticketNo(t.id), subject: t.subject, category: t.category, priority: t.priority, status: t.status, lang: t.lang, assignee: t.assignee || null,
  requester: { name: t.user_name, email: t.user_email }, workspace: { id: t.tenant_id, slug: t.tenant_slug, name: t.tenant_name, region: t.region },
  created_at: iso(t.created_at), updated_at: iso(t.updated_at), first_response_at: iso(t.first_response_at), solved_at: iso(t.solved_at),
  unread_staff: !!t.unread_staff, unread_customer: !!t.unread_customer, sla: slaOf(t, sla),
});
function messagesOf(id, { staff }) {
  const files = pdb().prepare('SELECT id,message_id,name,type,size FROM support_files WHERE ticket_id=?').all(id);
  return pdb().prepare(`SELECT id,author_type,author_name,body,internal,created_at FROM support_messages WHERE ticket_id=? ${staff ? '' : 'AND internal=0'} ORDER BY id`).all(id)
    .map((m) => ({ id: m.id, author_type: m.author_type, author_name: m.author_name, body: m.body, internal: !!m.internal, created_at: iso(m.created_at), files: files.filter((f) => f.message_id === m.id).map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size })) }));
}

// ---- e-mail (never blocks or fails the request; sendMail swallows provider errors)
const baseUrl = (t) => { try { return currentTenant() && t.tenant_slug ? `https://${t.tenant_slug}.${process.env.ERP_BASE_DOMAIN}` : ''; } catch { return ''; } };
const fmtWhen = (isoStr, lang) => { try { return new Date(isoStr).toLocaleString(lang === 'ur' ? 'ur-PK' : lang === 'ar' ? 'ar-AE' : lang === 'fr' ? 'fr-CA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'; } catch { return isoStr; } };
function mailTo(t, lang, kind, extra = {}) {
  const p = { no: ticketNo(t.id), subject: t.subject, when: extra.when || '' };
  const lines = kind === 'new' ? [st(lang, 'mail.new_l1', p), st(lang, 'mail.new_l2', p), st(lang, 'mail.new_l3', p)]
    : kind === 'reply' ? [st(lang, 'mail.reply_l1', p), '', extra.body || ''] : [st(lang, 'mail.solved_l1', p)];
  const url = baseUrl(t) ? `${baseUrl(t)}/support?t=${t.id}` : '';
  const out = layout({ brand: 'platform', heading: st(lang, `mail.${kind}_heading`), lines, ...(url ? { button: { label: st(lang, 'mail.open'), url } } : {}) });
  if (langDir(lang) === 'rtl') out.html = out.html.replace('<html lang="en"', `<html lang="${lang}" dir="rtl"`).replace('<body', '<body dir="rtl"');
  else if (lang !== 'en') out.html = out.html.replace('<html lang="en"', `<html lang="${lang}"`);
  return { to: t.user_email, subject: st(lang, `mail.${kind}_subject`, p), ...out, type: 'support', workspaceId: t.tenant_id || null };
}
const notifyTeam = (t, what, body) => {
  const to = notifyAddress();
  if (!to) return;
  const out = layout({ brand: 'platform', heading: what, lines: [`${ticketNo(t.id)} · ${t.priority} · ${t.tenant_name || 'workspace'} · ${t.user_name} <${t.user_email}>`, t.subject, '', String(body || '').slice(0, 1500)], footer: 'Open Support desk in the console to reply.' });
  sendMail({ to, subject: `[${ticketNo(t.id)}] ${what}: ${t.subject}`, ...out, type: 'support', workspaceId: t.tenant_id || null, replyTo: t.user_email }).catch(() => {});
};
const mail = (m) => { sendMail(m).catch(() => {}); };

// ---- workspace side
const row = (id) => pdb().prepare('SELECT * FROM support_tickets WHERE id=?').get(Number(id));
function visible(user, id) {
  ensure();
  const t = row(id);
  if (!t || t.tenant_id !== tenantKey() || (t.user_id !== user.id && !user.isSuper)) throw new HttpError(404, 'Ticket not found');
  return t;
}
const tooMany = (sql, ...args) => { if (pdb().prepare(sql).get(...args).n >= 0) return pdb().prepare(sql).get(...args).n; return 0; };

export function createTicket(user, b, region) {
  ensure();
  const subject = str(b.subject, 140, 'Subject');
  if (subject.length < 3) throw bad('Please write a short subject');
  const body = str(b.body, 6000, 'Message');
  if (body.length < 10) throw bad('Please describe the question or problem (at least 10 characters)');
  const category = CATEGORIES.includes(b.category) ? b.category : 'question';
  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';
  const offered = supportLangs(region);
  const lang = LANGS.includes(b.lang) && offered.includes(b.lang) ? b.lang : 'en';
  const files = cleanFiles(b.files);
  if (tooMany("SELECT COUNT(*) n FROM support_tickets WHERE tenant_id=? AND user_id=? AND created_at > datetime('now','-1 hour')", tenantKey(), user.id) >= 5) throw bad('You have sent several tickets in the last hour. Please wait a little, or add to an existing ticket.');
  const tn = currentTenant();
  const id = Number(pdb().prepare('INSERT INTO support_tickets(tenant_id,tenant_slug,tenant_name,region,user_id,user_name,user_email,lang,subject,category,priority) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(tenantKey(), tn?.slug || null, tn?.name || null, region || null, user.id, user.name, user.email || '', lang, subject, category, priority).lastInsertRowid);
  const mid = Number(pdb().prepare("INSERT INTO support_messages(ticket_id,author_type,author_name,body) VALUES(?,'customer',?,?)").run(id, user.name, body).lastInsertRowid);
  saveFiles(id, mid, files);
  const t = row(id);
  const sla = getSla();
  if (t.user_email) mail(mailTo(t, lang, 'new', { when: fmtWhen(slaOf(t, sla).first_due, lang) }));
  notifyTeam(t, 'New ticket', body);
  return ticketView(t, sla);
}
export function listMine(user, { status } = {}) {
  ensure();
  const sla = getSla();
  const ok = STATUSES.includes(status);
  const rows = pdb().prepare(`SELECT * FROM support_tickets WHERE tenant_id=? ${user.isSuper ? '' : 'AND user_id=?'} ${ok ? 'AND status=?' : ''} ORDER BY updated_at DESC, id DESC LIMIT 200`)
    .all(tenantKey(), ...(user.isSuper ? [] : [user.id]), ...(ok ? [status] : []));
  return rows.map((t) => ticketView(t, sla));
}
export function getMine(user, id) {
  const t = visible(user, id);
  if (t.unread_customer) pdb().prepare('UPDATE support_tickets SET unread_customer=0 WHERE id=?').run(t.id);
  return { ticket: ticketView({ ...t, unread_customer: 0 }, getSla()), messages: messagesOf(t.id, { staff: false }) };
}
export function unreadCount(user) {
  ensure();
  return pdb().prepare(`SELECT COUNT(*) n FROM support_tickets WHERE tenant_id=? AND unread_customer=1 ${user.isSuper ? '' : 'AND user_id=?'}`).get(tenantKey(), ...(user.isSuper ? [] : [user.id])).n;
}
export function customerReply(user, id, b) {
  const t = visible(user, id);
  const body = str(b.body, 6000, 'Message');
  if (body.length < 2) throw bad('Please write your reply');
  const files = cleanFiles(b.files);
  if (pdb().prepare("SELECT COUNT(*) n FROM support_messages WHERE ticket_id=? AND author_type='customer' AND created_at > datetime('now','-1 hour')").get(t.id).n >= 20) throw bad('Too many messages in the last hour. Please wait a little.');
  const mid = Number(pdb().prepare("INSERT INTO support_messages(ticket_id,author_type,author_name,body) VALUES(?,'customer',?,?)").run(t.id, user.name, body).lastInsertRowid);
  saveFiles(t.id, mid, files);
  // a reply wakes a solved/waiting ticket up again; a closed one stays closed
  const status = t.status === 'closed' ? 'closed' : 'open';
  if (t.status === 'closed') throw bad('This ticket is closed. Please start a new ticket.');
  pdb().prepare("UPDATE support_tickets SET status=?, solved_at=NULL, unread_staff=1, updated_at=datetime('now') WHERE id=?").run(status, t.id);
  notifyTeam(t, 'Customer replied', body);
  return getMine(user, t.id);
}
export function customerStatus(user, id, status) {
  const t = visible(user, id);
  if (t.status === 'closed') throw bad('This ticket is closed. Please start a new ticket.');
  if (status === 'solved') pdb().prepare("UPDATE support_tickets SET status='solved', solved_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(t.id);
  else if (status === 'open') pdb().prepare("UPDATE support_tickets SET status='open', solved_at=NULL, unread_staff=1, updated_at=datetime('now') WHERE id=?").run(t.id);
  else throw bad('Choose solved or open');
  return getMine(user, t.id);
}
export const mineFile = (user, ticketId, fileId) => { visible(user, ticketId); return fileOf(fileId, ticketId); };

// ---- console side
export function counts() {
  ensure();
  const by = Object.fromEntries(pdb().prepare('SELECT status, COUNT(*) n FROM support_tickets GROUP BY status').all().map((x) => [x.status, x.n]));
  return { open: by.open || 0, pending: by.pending || 0, solved: by.solved || 0, closed: by.closed || 0, unread: pdb().prepare('SELECT COUNT(*) n FROM support_tickets WHERE unread_staff=1 AND status IN (\'open\',\'pending\')').get().n };
}
export function listAll({ status, priority, q, assignee, breached } = {}) {
  ensure();
  const sla = getSla();
  const w = [], a = [];
  if (STATUSES.includes(status)) { w.push('status=?'); a.push(status); } else if (status === 'active') w.push("status IN ('open','pending')");
  if (PRIORITIES.includes(priority)) { w.push('priority=?'); a.push(priority); }
  if (assignee) { w.push('assignee=?'); a.push(String(assignee)); }
  if (q) { const like = `%${String(q).replace(/[%_]/g, '')}%`; w.push('(subject LIKE ? OR tenant_name LIKE ? OR user_email LIKE ? OR user_name LIKE ?)'); a.push(like, like, like, like); }
  let rows = pdb().prepare(`SELECT * FROM support_tickets ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY unread_staff DESC, updated_at DESC LIMIT 300`).all(...a).map((t) => ticketView(t, sla));
  if (breached) rows = rows.filter((t) => t.sla.first_state === 'breached' || t.sla.solve_state === 'breached');
  return { counts: counts(), rows };
}
export function getAny(id) {
  ensure();
  const t = row(id);
  if (!t) throw new HttpError(404, 'Ticket not found');
  if (t.unread_staff) pdb().prepare('UPDATE support_tickets SET unread_staff=0 WHERE id=?').run(t.id);
  return { ticket: ticketView({ ...t, unread_staff: 0 }, getSla()), messages: messagesOf(t.id, { staff: true }), sla_targets: getSla() };
}
export function staffReply(op, id, b) {
  ensure();
  const t = row(id);
  if (!t) throw new HttpError(404, 'Ticket not found');
  const body = str(b.body, 6000, 'Reply');
  if (body.length < 1) throw bad('Write a reply first');
  const internal = b.internal === true;
  const files = cleanFiles(b.files);
  const mid = Number(pdb().prepare('INSERT INTO support_messages(ticket_id,author_type,author_name,body,internal) VALUES(?,?,?,?,?)').run(t.id, 'staff', op.name || op.email, body, internal ? 1 : 0).lastInsertRowid);
  saveFiles(t.id, mid, files);
  if (!internal) {
    const status = STATUSES.includes(b.status) ? b.status : 'pending';
    pdb().prepare(`UPDATE support_tickets SET status=?, unread_customer=1, first_response_at=COALESCE(first_response_at, datetime('now')), solved_at=CASE WHEN ?='solved' THEN datetime('now') ELSE NULL END, assignee=COALESCE(assignee, ?), updated_at=datetime('now') WHERE id=?`)
      .run(status, status, op.email, t.id);
    const fresh = row(t.id);
    if (fresh.user_email) mail(mailTo(fresh, fresh.lang, 'reply', { body }));
  } else pdb().prepare("UPDATE support_tickets SET updated_at=datetime('now') WHERE id=?").run(t.id);
  return getAny(t.id);
}
export function updateTicket(op, id, b) {
  ensure();
  const t = row(id);
  if (!t) throw new HttpError(404, 'Ticket not found');
  const sets = [], a = [];
  if (b.priority !== undefined) { if (!PRIORITIES.includes(b.priority)) throw bad('Unknown priority'); sets.push('priority=?'); a.push(b.priority); }
  if (b.assignee !== undefined) { sets.push('assignee=?'); a.push(b.assignee ? str(b.assignee, 160, 'Assignee') : null); }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) throw bad('Unknown status');
    sets.push('status=?'); a.push(b.status);
    sets.push(b.status === 'solved' ? "solved_at=datetime('now')" : b.status === 'closed' ? "solved_at=COALESCE(solved_at, datetime('now'))" : 'solved_at=NULL');
    if (b.status === 'solved' && t.status !== 'solved') sets.push('unread_customer=1');
  }
  if (!sets.length) throw bad('Nothing to change');
  pdb().prepare(`UPDATE support_tickets SET ${sets.join(',')}, updated_at=datetime('now') WHERE id=?`).run(...a, t.id);
  if (b.status === 'solved' && t.status !== 'solved' && t.user_email) mail(mailTo(row(t.id), t.lang, 'solved'));
  return getAny(t.id);
}
export const anyFile = (ticketId, fileId) => { ensure(); return fileOf(fileId, ticketId); };
