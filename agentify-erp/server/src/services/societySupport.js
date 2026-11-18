// Housing society support center: complaints and requests (website, customer portal, staff) and launch notices (pop-ups).
import { all, get, nextNo, run } from '../db.js';
import { bad, notFound, now, today } from '../util.js';
import { notify } from '../audit.js';
import { isEmail, isPersonName } from '../validation.js';

export const CATEGORIES = ['Transactions', 'Receipts', 'Ledger', 'Development', 'Complaint', 'Facilities', 'Possession', 'Other'];
export const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
export const PRIORITIES = ['low', 'normal', 'high'];
export const NOTICE_KINDS = ['Possession', 'Allotment', 'Construction', 'New launch', 'Notice'];

const digits = (v) => String(v || '').replace(/\D/g, '');
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

/** Staff who should hear about a new request: Super Admins and anyone who can edit customers. */
const staffIds = () => all(`SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN role_permissions p ON p.role_id=r.id
  WHERE u.active=1 AND r.portal=0 AND (r.name='Super Admin' OR (p.module='customers' AND p.action='edit'))`).map((x) => x.id);

/** The customer record this person already has, matched on an exact e-mail or phone number (never a guess). */
function matchContact({ email, phone, whatsapp }) {
  const e = String(email || '').trim().toLowerCase();
  if (e) { const c = get('SELECT id FROM contacts WHERE lower(email)=? LIMIT 1', e); if (c) return c.id; }
  for (const d of [digits(phone), digits(whatsapp)].filter((x) => x.length >= 7)) {
    const c = get("SELECT id FROM contacts WHERE replace(replace(replace(replace(COALESCE(phone,''),' ',''),'-',''),'+',''),'(','') LIKE ? OR replace(replace(replace(replace(COALESCE(whatsapp,''),' ',''),'-',''),'+',''),'(','') LIKE ? LIMIT 1", `%${d.slice(-9)}`, `%${d.slice(-9)}`);
    if (c) return c.id;
  }
  return null;
}

/** Check and clean what a person typed. Name letters only, a real e-mail, and a phone or WhatsApp number to call back on. */
export function cleanComplaint(b = {}) {
  const name = clip(b.name, 100), email = clip(b.email, 254), phone = clip(b.phone, 30), whatsapp = clip(b.whatsapp, 30);
  if (!isPersonName(name)) throw bad('Please enter your name using letters only');
  if (!isEmail(email)) throw bad('Please enter a valid email address, like name@example.com');
  if (digits(phone).length < 7 && digits(whatsapp).length < 7) throw bad('Please enter a phone or WhatsApp number we can reach you on');
  const category = CATEGORIES.includes(b.category) ? b.category : 'Other';
  const message = clip(b.message, 4000), subject = clip(b.subject, 140) || `${category} request`;
  if (message.length < 5) throw bad('Please describe your request or complaint');
  return { name, email, phone: phone || null, whatsapp: whatsapp || null, plot_no: clip(b.plot_no, 60) || null, category, subject, message };
}

export function createComplaint(d, { source = 'website', contactId = null, saleId = null, createdBy = null } = {}) {
  const ref = nextNo('complaint', 'CMP', 4), ts = now();
  const cid = contactId || matchContact(d);
  const id = Number(run('INSERT INTO complaints(ref,contact_id,sale_id,name,email,phone,whatsapp,plot_no,category,subject,message,status,priority,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ref, cid, saleId, d.name, d.email, d.phone, d.whatsapp, d.plot_no, d.category, d.subject, d.message, 'open', 'normal', source, ts, ts).lastInsertRowid);
  run('INSERT INTO complaint_messages(complaint_id,author_type,author_name,body,internal,created_at) VALUES(?,?,?,?,0,?)', id, createdBy ? 'staff' : 'customer', d.name, d.message, ts);
  notify(staffIds(), 'support', `New ${d.category.toLowerCase()} request ${ref}`, `${d.name}${d.plot_no ? ` (${d.plot_no})` : ''}: ${d.subject}`, '/customers/support');
  return { id, ref };
}

/** Only the customer-visible thread; internal staff notes never leave the ERP. */
export const publicThread = (id) => all("SELECT author_type,author_name,body,created_at FROM complaint_messages WHERE complaint_id=? AND internal=0 ORDER BY id", id);

const shape = (c) => ({ ref: c.ref, status: c.status, category: c.category, subject: c.subject, plot_no: c.plot_no, created_at: c.created_at, updated_at: c.updated_at, resolved_at: c.resolved_at });

/** A visitor checks a request with its reference plus the phone, WhatsApp or e-mail they gave. */
export function trackComplaint(ref, proof) {
  const c = get('SELECT * FROM complaints WHERE ref=?', String(ref || '').trim().toUpperCase());
  const p = String(proof || '').trim().toLowerCase(), d = digits(p);
  const ok = c && p && ((c.email && c.email.toLowerCase() === p) || (d.length >= 7 && [digits(c.phone), digits(c.whatsapp)].some((x) => x && x.slice(-9) === d.slice(-9))));
  if (!ok) throw notFound('No request found with that reference and contact detail');
  return { ...shape(c), messages: publicThread(c.id) };
}

// ---- customer portal (always keyed on the signed-in customer's contact id)
export const ownComplaints = (contactId) => all('SELECT ref,id,status,category,subject,plot_no,created_at,updated_at FROM complaints WHERE contact_id=? ORDER BY id DESC', contactId);
export function ownComplaint(contactId, id) {
  const c = get('SELECT * FROM complaints WHERE id=? AND contact_id=?', id, contactId);
  if (!c) throw notFound('Request not found');
  return { ...shape(c), id: c.id, messages: publicThread(c.id) };
}
export function customerReply(contactId, id, text, name) {
  const c = get('SELECT * FROM complaints WHERE id=? AND contact_id=?', id, contactId);
  if (!c) throw notFound('Request not found');
  const body = clip(text, 4000);
  if (body.length < 2) throw bad('Write your message first');
  const ts = now();
  run('INSERT INTO complaint_messages(complaint_id,author_type,author_name,body,internal,created_at) VALUES(?,?,?,?,0,?)', c.id, 'customer', name, body, ts);
  run("UPDATE complaints SET updated_at=?, status=CASE WHEN status IN ('resolved','closed') THEN 'open' ELSE status END, resolved_at=CASE WHEN status IN ('resolved','closed') THEN NULL ELSE resolved_at END WHERE id=?", ts, c.id);
  notify(c.assigned_to ? [c.assigned_to] : staffIds(), 'support', `Reply on ${c.ref}`, `${name}: ${body.slice(0, 120)}`, '/customers/support');
}

// ---- staff
export function listComplaints({ status, category, q, mine, userId } = {}) {
  const where = ['1=1'], prm = [];
  if (STATUSES.includes(status)) { where.push('c.status=?'); prm.push(status); }
  if (CATEGORIES.includes(category)) { where.push('c.category=?'); prm.push(category); }
  if (mine) { where.push('c.assigned_to=?'); prm.push(userId); }
  if (q) { where.push('(c.ref LIKE ? OR c.name LIKE ? OR c.plot_no LIKE ? OR c.subject LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)'); prm.push(...Array(6).fill(`%${String(q).slice(0, 60)}%`)); }
  const rows = all(`SELECT c.*, u.name assignee FROM complaints c LEFT JOIN users u ON u.id=c.assigned_to WHERE ${where.join(' AND ')} ORDER BY (c.status IN ('open','in_progress')) DESC, c.id DESC LIMIT 300`, ...prm);
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) n FROM complaints GROUP BY status').map((x) => [x.status, x.n]));
  return { rows, counts };
}
export function complaintDetail(id) {
  const c = get('SELECT c.*, u.name assignee, s.id sale_ref FROM complaints c LEFT JOIN users u ON u.id=c.assigned_to LEFT JOIN sales s ON s.id=c.sale_id WHERE c.id=?', id);
  if (!c) throw notFound('Request not found');
  return { ...c, messages: all('SELECT * FROM complaint_messages WHERE complaint_id=? ORDER BY id', id), contact: c.contact_id ? get('SELECT id,full_name FROM contacts WHERE id=?', c.contact_id) : null };
}
export function updateComplaint(id, b) {
  const c = get('SELECT * FROM complaints WHERE id=?', id);
  if (!c) throw notFound('Request not found');
  const d = {};
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw bad('Unknown status'); d.status = b.status; d.resolved_at = ['resolved', 'closed'].includes(b.status) ? (c.resolved_at || now()) : null; }
  if (b.priority !== undefined) { if (!PRIORITIES.includes(b.priority)) throw bad('Unknown priority'); d.priority = b.priority; }
  if (b.assigned_to !== undefined) {
    d.assigned_to = b.assigned_to ? Number(b.assigned_to) : null;
    if (d.assigned_to && !get('SELECT 1 FROM users WHERE id=? AND active=1', d.assigned_to)) throw bad('Choose an active team member');
  }
  d.updated_at = now();
  const keys = Object.keys(d);
  run(`UPDATE complaints SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => d[k]), id);
  if (d.assigned_to && d.assigned_to !== c.assigned_to) notify(d.assigned_to, 'support', `Request ${c.ref} assigned to you`, c.subject, '/customers/support');
  if (d.status && d.status !== c.status) {
    const tell = portalUsers(c.contact_id);
    if (tell.length) notify(tell, 'support', `Your request ${c.ref} is now ${d.status.replace('_', ' ')}`, c.subject, '/portal/support');
  }
}
const portalUsers = (contactId) => (contactId ? all('SELECT id FROM users WHERE contact_id=? AND active=1', contactId).map((u) => u.id) : []);
export function staffReply(id, user, b) {
  const c = get('SELECT * FROM complaints WHERE id=?', id);
  if (!c) throw notFound('Request not found');
  const body = clip(b.body, 4000);
  if (body.length < 2) throw bad('Write a reply first');
  const internal = b.internal === true || b.internal === 1 || b.internal === '1' || b.internal === 'true' ? 1 : 0, ts = now();
  run('INSERT INTO complaint_messages(complaint_id,author_type,author_name,body,internal,created_at) VALUES(?,?,?,?,?,?)', c.id, 'staff', user.name, body, internal, ts);
  run("UPDATE complaints SET updated_at=?, status=CASE WHEN status='open' AND ?=0 THEN 'in_progress' ELSE status END WHERE id=?", ts, internal, c.id);
  if (!internal) { const tell = portalUsers(c.contact_id); if (tell.length) notify(tell, 'support', `New reply on ${c.ref}`, body.slice(0, 140), '/portal/support'); }
}

// ---- launch notices
const noticeCols = 'id,title,body,kind,image,link_label,link_href,project_id,show_popup,starts_on,ends_on,active,created_at';
/** Notices a visitor may see today: active and inside their date range. */
export const liveNotices = ({ popupOnly = false } = {}) => all(`SELECT ${noticeCols} FROM launch_notices WHERE active=1 AND (starts_on IS NULL OR starts_on<=?) AND (ends_on IS NULL OR ends_on>=?) ${popupOnly ? 'AND show_popup=1' : ''} ORDER BY id DESC LIMIT 12`, today(), today());
export const allNotices = () => all(`SELECT ${noticeCols}, (SELECT name FROM projects WHERE id=project_id) project_name FROM launch_notices ORDER BY active DESC, id DESC`);

const safeLink = (v) => { const s = String(v || '').trim(); return !s || /^(https?:\/\/|\/)/i.test(s) ? s.slice(0, 300) : ''; };
export function noticeFields(b, forCreate) {
  const d = {};
  if (b.title !== undefined || forCreate) { d.title = clip(b.title, 140); if (!d.title) throw bad('Give the notice a title'); }
  if (b.body !== undefined) d.body = clip(b.body, 2000) || null;
  if (b.kind !== undefined) d.kind = NOTICE_KINDS.includes(b.kind) ? b.kind : 'Notice';
  if (b.link_label !== undefined) d.link_label = clip(b.link_label, 60) || null;
  if (b.link_href !== undefined) d.link_href = safeLink(b.link_href) || null;
  for (const k of ['starts_on', 'ends_on']) if (b[k] !== undefined) { const v = String(b[k] || '').trim(); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('Use a valid date'); d[k] = v || null; }
  if (b.project_id !== undefined) d.project_id = b.project_id ? Number(b.project_id) : null;
  for (const k of ['show_popup', 'active']) if (b[k] !== undefined) d[k] = [true, 1, '1', 'true'].includes(b[k]) ? 1 : 0;
  return d;
}
