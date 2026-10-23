// The platform mailbox: a thin server-side client for Resend's Inboxes, Emails and Webhooks APIs (the browser never talks to Resend and
// never sees the key), plus the sanitiser every inbound message passes through. Endpoint shapes follow Resend's published API reference
// for Inboxes (https://resend.com/docs/api-reference/inboxes/*), Emails and Webhooks; Inboxes are a beta feature, so a changed answer from
// Resend becomes a readable error here, not a crash.
import crypto from 'node:crypto';
import { getSetting } from './platformConfig.js';
import { HttpError, bad } from '../util.js';

const API = 'https://api.resend.com';
const apiKey = () => getSetting('resend_api_key') || process.env.RESEND_API_KEY || null;
export const resendConfigured = () => !!apiKey();

/** One request to Resend with the stored key. Errors keep Resend's own message (never the key) so the console can say what to do. */
async function rs(method, path, { query, body, idem } = {}) {
  const key = apiKey();
  if (!key) throw new HttpError(409, 'Resend is not connected yet. Save the API key in Integrations, Transactional email (Resend).');
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  let res;
  try {
    res = await fetch(`${API}${path}${qs.toString() ? `?${qs}` : ''}`, {
      method, signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'agentify-erp-console/1.0', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new HttpError(502, e.name === 'TimeoutError' ? 'Resend took too long to answer. Try again.' : 'Could not reach Resend. Check the server connection and try again.'); }
  let data = null; try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const msg = String(data?.message || data?.error?.message || data?.error || `Resend answered ${res.status}`).slice(0, 300);
    const status = res.status === 404 ? 404 : res.status === 401 || res.status === 403 ? 502 : res.status === 429 ? 429 : res.status >= 500 ? 502 : 400;
    throw new HttpError(status, res.status === 401 || res.status === 403 ? 'Resend refused the saved API key. Check it in Integrations, Transactional email (Resend).' : res.status === 429 ? 'Resend is rate limiting requests. Wait a few seconds and try again.' : msg);
  }
  return data;
}

// ---------------------------------------------------------------- identifiers (they go into URLs, so they are checked first)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDR = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/;
export const isId = (s) => UUID.test(String(s || ''));
export const inboxRef = (s) => { const v = String(s || '').trim(); if (!UUID.test(v) && !ADDR.test(v)) throw bad('Unknown inbox'); return encodeURIComponent(v); };
export const idRef = (s, what = 'item') => { const v = String(s || '').trim(); if (!UUID.test(v)) throw bad(`Unknown ${what}`); return v; };
export const parseAddress = (s) => { const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(String(s || '')); return m ? { name: (m[1] || '').trim(), address: m[2].trim() } : { name: '', address: String(s || '').trim() }; };
/** A recipient list from a form: addresses split on comma, semicolon or whitespace; each must look like an address. */
export function addresses(v, label) {
  const list = (Array.isArray(v) ? v : String(v || '').split(/[,;\n]+/)).map((x) => String(x).trim()).filter(Boolean);
  for (const a of list) { const bare = parseAddress(a).address; if (!ADDR.test(bare) || a.length > 320) throw bad(`${label}: "${a.slice(0, 60)}" is not a valid email address`); }
  return list;
}
const FORBIDDEN_FROM = /^(noreply|no-reply)@/i;

// ---------------------------------------------------------------- inboxes (the switcher is loaded from Resend, never hard-coded)
let inboxCache = { at: 0, data: [] };
export async function listInboxes({ fresh = false } = {}) {
  if (!fresh && Date.now() - inboxCache.at < 20_000) return inboxCache.data;
  const data = [];
  let after;
  for (let i = 0; i < 5; i += 1) {
    const page = await rs('GET', '/inboxes', { query: { limit: 100, after } });
    data.push(...(page.data || []));
    if (!page.has_more || !page.data?.length) break;
    after = page.data[page.data.length - 1].id;
  }
  inboxCache = { at: Date.now(), data };
  return data;
}
/** The inbox a message may be sent from: one of this account's inboxes, and never the no-reply sender. */
export async function sendingInbox(ref) {
  const want = String(ref || '').trim().toLowerCase();
  const found = (await listInboxes()).find((i) => i.id.toLowerCase() === want || String(i.email_address).toLowerCase() === want);
  if (!found) throw bad('Choose one of the company inboxes to send from');
  if (FORBIDDEN_FROM.test(found.email_address)) throw bad('Mail cannot be sent from the no-reply address');
  return found;
}
export async function updateInbox(ref, { from_name }) {
  const inbox = await sendingInbox(ref);
  const name = String(from_name ?? '').trim();
  if (name.length > 78 || /[:<>\r\n]/.test(name)) throw bad('The From name must be plain text, up to 78 characters, without : < > or line breaks');
  await rs('PATCH', `/inboxes/${encodeURIComponent(inbox.id)}`, { body: { from_name: name } });
  inboxCache.at = 0;
  return { id: inbox.id, from_name: name };
}
export const listLabels = async (inbox) => (await rs('GET', `/inboxes/${inboxRef(inbox)}/labels`)).data || [];
export async function createLabel(inbox, name, color) {
  const n = String(name || '').trim();
  if (!n || n.length > 64) throw bad('A label name is 1 to 64 characters');
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw bad('A label colour looks like #1D4ED8');
  return rs('POST', `/inboxes/${inboxRef(inbox)}/labels`, { body: { name: n, ...(color ? { color } : {}) } });
}

// ---------------------------------------------------------------- threads
const FOLDERS = ['inbox', 'sent', 'archive', 'spam', 'trash'];
const bool = (v) => (v === true || v === 'true' || v === '1' ? true : v === false || v === 'false' || v === '0' ? false : undefined);
const cursorOut = (m) => (Object.keys(m).length ? Buffer.from(JSON.stringify(m)).toString('base64url') : null);
const cursorIn = (c) => { try { const m = JSON.parse(Buffer.from(String(c || ''), 'base64url').toString()); return m && typeof m === 'object' ? m : {}; } catch { return {}; } };
const threadView = (t, inbox) => ({ id: t.id, inbox_id: inbox.id, inbox: inbox.email_address, subject: t.subject, from: t.from, to: t.to || [], cc: t.cc || [], labels: t.labels || [], email_count: t.email_count, has_attachment: !!t.has_attachment, has_draft: !!t.has_draft, read: !!t.read, received_at: t.received_at, folder: t.folder, matched_email_id: t.matched_email_id || null });

/** Thread list for one inbox or for all of them ("all": one page from each, merged newest first; the cursor remembers each inbox's place). */
export async function listThreads({ inbox = 'all', folder = 'inbox', q, read, label, attachment, after, before, limit = 25 }) {
  const inboxes = await listInboxes();
  const targets = inbox === 'all' ? inboxes : [inboxes.find((i) => i.id === inbox || String(i.email_address).toLowerCase() === String(inbox).toLowerCase())].filter(Boolean);
  if (inbox !== 'all' && !targets.length) throw bad('Unknown inbox');
  const lim = Math.min(100, Math.max(1, Number(limit) || 25));
  const f = FOLDERS.includes(folder) ? folder : 'inbox';
  const cur = inbox === 'all' ? cursorIn(after) : { [targets[0]?.id]: after };
  const search = !!(String(q || '').trim() || bool(attachment));
  const pages = await Promise.all(targets.map(async (ib) => {
    const query = { folders: f, labels: label || undefined, read: bool(read), limit: lim, after: cur[ib.id] || undefined, before: inbox === 'all' ? undefined : before || undefined };
    if (search) Object.assign(query, { query: String(q || '').trim().slice(0, 256) || undefined, has_attachment: bool(attachment) ? true : undefined });
    const res = await rs('GET', `/inboxes/${encodeURIComponent(ib.id)}/threads${search ? '/search' : ''}`, { query });
    return { ib, rows: (res.data || []).map((t) => threadView(t, ib)), more: !!res.has_more };
  }));
  const merged = pages.flatMap((p) => p.rows).sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
  const shown = inbox === 'all' ? merged.slice(0, lim) : merged;
  const next = {};
  let more = false;
  for (const p of pages) {
    const last = [...shown].reverse().find((t) => t.inbox_id === p.ib.id);
    if (last) next[p.ib.id] = last.id; else if (cur[p.ib.id]) next[p.ib.id] = cur[p.ib.id];
    if (p.more || p.rows.some((t) => !shown.includes(t))) more = true;
  }
  return { threads: shown, has_more: more, next: inbox === 'all' ? cursorOut(next) : shown.length ? shown[shown.length - 1].id : null };
}

export async function getThread(inbox, thread, { images = false, markRead = true } = {}) {
  const ib = inboxRef(inbox), th = idRef(thread, 'thread');
  const meta = await rs('GET', `/inboxes/${ib}/threads/${th}`);
  const emails = [];
  let after;
  for (let i = 0; i < 5; i += 1) {
    const page = await rs('GET', `/inboxes/${ib}/threads/${th}/emails`, { query: { limit: 100, after } });
    emails.push(...(page.data || []));
    if (!page.has_more || !page.data?.length) break;
    after = page.data[page.data.length - 1].id;
  }
  if (markRead && !meta.read) { try { await rs('PATCH', `/inboxes/${ib}/threads/${th}`, { body: { read: true } }); meta.read = true; } catch { /* reading still works */ } }
  return {
    thread: { id: meta.id, subject: meta.subject, folder: meta.folder, labels: meta.labels || [], read: !!meta.read },
    emails: emails.map((e) => ({
      id: e.id, direction: e.direction, from: e.from, from_parsed: parseAddress(e.from), to: e.to || [], cc: e.cc || [], bcc: e.bcc || [], reply_to: e.reply_to || [], subject: e.subject, message_id: e.message_id,
      html: e.html ? sanitizeEmailHtml(e.html, { images }) : null, has_remote_images: !!(e.html && /<img\b[^>]*\ssrc\s*=\s*["']?https?:/i.test(e.html)), text: e.text ? String(e.text).slice(0, 200_000) : null,
      attachments: (e.attachments || []).map((a) => ({ id: a.id, filename: a.filename || 'attachment', size: a.size ?? null })), read: !!e.read, received_at: e.received_at,
    })),
  };
}
export async function updateThread(inbox, thread, { read, folder }) {
  const body = {};
  if (read !== undefined) body.read = !!read;
  if (folder !== undefined) { if (!['inbox', 'archive', 'spam', 'trash'].includes(folder)) throw bad('A thread can be moved to Inbox, Archive, Spam or Trash'); body.folder = folder; }
  if (!Object.keys(body).length) throw bad('Nothing to change');
  return rs('PATCH', `/inboxes/${inboxRef(inbox)}/threads/${idRef(thread, 'thread')}`, { body });
}
export const addThreadLabel = (inbox, thread, labelId) => rs('POST', `/inboxes/${inboxRef(inbox)}/threads/${idRef(thread, 'thread')}/labels`, { body: { labels: [idRef(labelId, 'label')] } });
export const removeThreadLabel = (inbox, thread, labelId) => rs('DELETE', `/inboxes/${inboxRef(inbox)}/threads/${idRef(thread, 'thread')}/labels/${idRef(labelId, 'label')}`);

// ---------------------------------------------------------------- composing
export const MAX_ATTACH_BYTES = 20 * 1024 * 1024;
const plain = (html) => String(html || '').replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
/** Body text from the compose form: rich HTML is sanitised before it leaves, and a plain-text part is made from it. */
export function bodyParts(html, text) {
  const clean = sanitizeEmailHtml(String(html || ''), { images: true });
  const t = String(text || '').trim() || plain(clean);
  if (!t && !clean) throw bad('Write a message first');
  return { html: clean || undefined, text: t || undefined };
}
/** multer files (memory) to Resend attachments, capped at 20 MB in total. */
export function attachmentsFrom(files = []) {
  let total = 0;
  const out = files.map((f) => {
    total += f.size;
    const filename = String(f.originalname || 'attachment').replace(/[\\/\r\n"<>:*?|]/g, '_').slice(0, 120) || 'attachment';
    return { filename, content: f.buffer.toString('base64'), content_type: f.mimetype && /^[\w.+-]+\/[\w.+-]+$/.test(f.mimetype) ? f.mimetype : 'application/octet-stream' };
  });
  if (total > MAX_ATTACH_BYTES) throw bad('Attachments are over 20 MB in total. Remove some or send a download link instead.');
  return out;
}
const idem = () => crypto.randomUUID();

export async function saveDraft({ inbox, draftId, to, cc, bcc, subject, html, text, threadId, replyToEmailId }) {
  const ib = await sendingInbox(inbox);
  const body = {};
  const set = (k, v) => { if (v !== undefined) body[k] = v; };
  set('to', to !== undefined ? addresses(to, 'To') : undefined); set('cc', cc !== undefined ? addresses(cc, 'Cc') : undefined); set('bcc', bcc !== undefined ? addresses(bcc, 'Bcc') : undefined);
  if (subject !== undefined) set('subject', String(subject).replace(/[\r\n]+/g, ' ').slice(0, 2000) || null);
  if (html !== undefined || text !== undefined) { const p = html ? bodyParts(html, text) : { text: String(text || '') || undefined }; set('html', p.html ?? null); set('text', p.text ?? null); }
  if (draftId) {
    if (!Object.keys(body).length) throw bad('Nothing to save');
    const r = await rs('PATCH', `/inboxes/${encodeURIComponent(ib.id)}/drafts/${idRef(draftId, 'draft')}`, { body });
    return { id: r.id, inbox_id: ib.id };
  }
  if (threadId && replyToEmailId) { body.thread_id = idRef(threadId, 'thread'); body.reply_to_email_id = idRef(replyToEmailId, 'email'); }
  if (!Object.keys(body).length) body.subject = '';
  const r = await rs('POST', `/inboxes/${encodeURIComponent(ib.id)}/drafts`, { body: Object.fromEntries(Object.entries(body).filter(([, v]) => v !== '' && v !== null)) });
  return { id: r.id, inbox_id: ib.id };
}
export async function listDrafts(inbox) {
  const ib = await sendingInbox(inbox);
  const r = await rs('GET', `/inboxes/${encodeURIComponent(ib.id)}/drafts`, { query: { limit: 50 } });
  return (r.data || []).map((d) => ({ id: d.id, inbox_id: ib.id, inbox: ib.email_address, type: d.type, to: d.to || [], cc: d.cc || [], subject: d.subject, snippet: d.snippet, thread_id: d.thread_id, updated_at: d.updated_at }));
}
export async function getDraft(inbox, draftId) {
  const ib = await sendingInbox(inbox);
  const d = await rs('GET', `/inboxes/${encodeURIComponent(ib.id)}/drafts/${idRef(draftId, 'draft')}`);
  return { id: d.id, inbox_id: ib.id, to: d.to || [], cc: d.cc || [], bcc: d.bcc || [], subject: d.subject || '', html: d.html ? sanitizeEmailHtml(d.html, { images: true }) : '', text: d.text || '', thread_id: d.thread_id || null, reply_to_email_id: d.reply_to_email_id || null };
}
export async function deleteDraft(inbox, draftId) { const ib = await sendingInbox(inbox); await rs('DELETE', `/inboxes/${encodeURIComponent(ib.id)}/drafts/${idRef(draftId, 'draft')}`); }

/** Send a new message: save it as a draft (or take the saved one), add attachments, then send it. */
export async function sendNew({ inbox, draftId, to, cc, bcc, subject, html, text, files }) {
  const ib = await sendingInbox(inbox);
  const toList = addresses(to, 'To');
  if (!toList.length) throw bad('Add at least one recipient');
  const subj = String(subject || '').replace(/[\r\n]+/g, ' ').trim();
  if (!subj) throw bad('Add a subject');
  const parts = bodyParts(html, text);
  const attachments = attachmentsFrom(files);
  const draft = await saveDraft({ inbox: ib.id, draftId, to: toList, cc: addresses(cc, 'Cc'), bcc: addresses(bcc, 'Bcc'), subject: subj, html: parts.html, text: parts.text });
  if (attachments.length) await rs('PATCH', `/inboxes/${encodeURIComponent(ib.id)}/drafts/${draft.id}`, { body: { attachments } });
  const sent = await rs('POST', `/inboxes/${encodeURIComponent(ib.id)}/drafts/${draft.id}/send`, { body: {}, idem: idem() });
  return { id: sent.id, from: ib.email_address, to: toList, subject: subj };
}
export async function replyTo({ inbox, thread, email, html, text, cc, bcc, subject, all, files }) {
  const ib = await sendingInbox(inbox);
  const parts = bodyParts(html, text);
  const th = idRef(thread, 'thread'), em = idRef(email, 'email');
  let ccList = addresses(cc, 'Cc');
  if (all) {
    const orig = await rs('GET', `/inboxes/${encodeURIComponent(ib.id)}/threads/${th}/emails/${em}`);
    const me = String(ib.email_address).toLowerCase(), sender = parseAddress(orig.from).address.toLowerCase();
    const others = [...(orig.to || []), ...(orig.cc || [])].filter((a) => { const x = parseAddress(a).address.toLowerCase(); return x && x !== me && x !== sender; });
    ccList = [...new Set([...ccList, ...others])];
  }
  const attachments = attachmentsFrom(files);
  const body = { ...parts, ...(ccList.length ? { cc: ccList } : {}), ...(bcc ? { bcc: addresses(bcc, 'Bcc') } : {}), ...(subject ? { subject: String(subject).replace(/[\r\n]+/g, ' ').slice(0, 2000) } : {}), ...(attachments.length ? { attachments } : {}) };
  const r = await rs('POST', `/inboxes/${encodeURIComponent(ib.id)}/threads/${th}/emails/${em}/reply`, { body, idem: idem() });
  return { id: r.id, from: ib.email_address };
}
export async function forward({ inbox, thread, email, to, cc, bcc, html, text, subject, files }) {
  const ib = await sendingInbox(inbox);
  const toList = addresses(to, 'To');
  if (!toList.length) throw bad('Add at least one recipient to forward to');
  const attachments = attachmentsFrom(files);
  const note = html || text ? bodyParts(html, text) : {};
  const body = { to: toList, ...(cc ? { cc: addresses(cc, 'Cc') } : {}), ...(bcc ? { bcc: addresses(bcc, 'Bcc') } : {}), ...note, ...(subject ? { subject: String(subject).replace(/[\r\n]+/g, ' ').slice(0, 2000) } : {}), ...(attachments.length ? { attachments } : {}) };
  const r = await rs('POST', `/inboxes/${encodeURIComponent(ib.id)}/threads/${idRef(thread, 'thread')}/emails/${idRef(email, 'email')}/forward`, { body, idem: idem() });
  return { id: r.id, from: ib.email_address, to: toList };
}

// ---------------------------------------------------------------- attachments (downloaded by the server and handed on; the browser never gets Resend's link)
export async function fetchAttachment(emailId, attachmentId) {
  const meta = await rs('GET', `/emails/receiving/${idRef(emailId, 'email')}/attachments/${idRef(attachmentId, 'attachment')}`);
  let url;
  try { url = new URL(meta.download_url); } catch { throw new HttpError(502, 'Resend did not give a download address for this attachment.'); }
  if (url.protocol !== 'https:' || !/(^|\.)resend\.com$/i.test(url.hostname)) throw new HttpError(502, 'The attachment is not hosted by Resend, so it was not downloaded.');
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' }).catch(() => null);
  if (!res || !res.ok) throw new HttpError(502, 'The attachment could not be downloaded. Try again; the link expires after a short time.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 40 * 1024 * 1024) throw new HttpError(413, 'This attachment is too large to download here.');
  return { buffer: buf, filename: String(meta.filename || 'attachment').replace(/[\\/\r\n"]/g, '_').slice(0, 150), contentType: 'application/octet-stream' };
}

// ---------------------------------------------------------------- sent mail (Resend's own list; the local log adds workspace and type)
export const listSentFromResend = async (limit = 100) => (await rs('GET', '/emails', { query: { limit: Math.min(100, limit) } })).data || [];
export async function getSentEmail(resendId) {
  const e = await rs('GET', `/emails/${idRef(resendId, 'email')}`);
  return { id: e.id, to: e.to || [], from: e.from, cc: e.cc || [], bcc: e.bcc || [], reply_to: e.reply_to || [], subject: e.subject, html: e.html || null, text: e.text || null, last_event: e.last_event, created_at: e.created_at, tags: e.tags || [] };
}

// ---------------------------------------------------------------- inbound HTML sanitiser
const TAGS = new Set(['p', 'div', 'br', 'hr', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'center', 'small', 'sub', 'sup']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'form', 'textarea', 'select', 'button', 'head', 'title', 'video', 'audio', 'canvas', 'applet', 'frameset']);
const VOID = new Set(['br', 'hr', 'img']);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const SAFE_HREF = /^(https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:[+\d\s()-]+)$/i;
const COLOR = /^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|[a-z]{3,20})$/i;
function cleanStyle(raw) {
  const out = [];
  for (const decl of String(raw || '').split(';')) {
    const i = decl.indexOf(':'); if (i < 0) continue;
    const k = decl.slice(0, i).trim().toLowerCase(), v = decl.slice(i + 1).trim();
    if ((k === 'color' || k === 'background-color') && COLOR.test(v) && !/^(url|expression)/i.test(v)) out.push(`${k}: ${v}`);
    else if (k === 'font-size' && /^\d{1,2}(\.\d)?px$/.test(v) && parseFloat(v) >= 8 && parseFloat(v) <= 48) out.push(`font-size: ${v}`);
    else if (k === 'font-weight' && /^(normal|bold|[1-9]00)$/.test(v)) out.push(`font-weight: ${v}`);
    else if (k === 'font-style' && /^(normal|italic)$/.test(v)) out.push(`font-style: ${v}`);
    else if (k === 'text-align' && /^(left|center|right|justify)$/.test(v)) out.push(`text-align: ${v}`);
    else if (k === 'text-decoration' && /^(none|underline|line-through)$/.test(v)) out.push(`text-decoration: ${v}`);
    else if ((k === 'width' || k === 'max-width') && /^\d{1,4}(px|%)$/.test(v)) out.push(`${k}: ${v}`);
  }
  return out.join('; ');
}
function attrsOf(str) {
  const attrs = {}; const re = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g; let m;
  while ((m = re.exec(str))) attrs[m[1].toLowerCase()] = unesc(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}
/**
 * Allow-list HTML sanitiser for e-mail. Everything is re-emitted from a short list of tags and attributes: no scripts, forms, frames, event
 * handlers, CSS beyond a few harmless properties, or javascript:/data: links. Remote images are replaced by a marker until `images` is true,
 * so opening a message never tells the sender that it was read.
 */
export function sanitizeEmailHtml(input, { images = false } = {}) {
  const parts = String(input ?? '').slice(0, 600_000).split(/(<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>)/g);
  const out = [], stack = []; let skip = null;
  for (const part of parts) {
    if (!part || part.startsWith('<!--')) continue;
    const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/.exec(part);
    if (!tag) { if (!skip) out.push(esc(unesc(part))); continue; }
    const closing = tag[1] === '/', name = tag[2].toLowerCase();
    if (skip) { if (closing && name === skip) skip = null; continue; }
    if (DROP_WITH_CONTENT.has(name)) { if (!closing && !/\/\s*$/.test(tag[3])) skip = name; continue; }
    if (!TAGS.has(name)) continue;
    if (closing) {
      if (VOID.has(name)) continue;
      const at = stack.lastIndexOf(name); if (at < 0) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    const a = attrsOf(tag[3]); const attrs = [];
    const style = cleanStyle(a.style); if (style && name !== 'br' && name !== 'hr') attrs.push(`style="${style.replace(/"/g, "'")}"`);
    if (name === 'a') { const href = String(a.href || '').trim(); if (SAFE_HREF.test(href)) { attrs.push(`href="${esc(href)}"`); if (/^https?:/i.test(href)) attrs.push('target="_blank"', 'rel="noopener noreferrer nofollow"'); } }
    if (name === 'img') {
      const src = String(a.src || '').trim(), alt = esc(String(a.alt || '').slice(0, 200));
      if (!/^https:\/\/[^\s"'<>]+$/i.test(src)) { out.push(alt ? `<span class="mb-noimg">[image: ${alt}]</span>` : ''); continue; }
      if (!images) { out.push(`<span class="mb-noimg">[remote image blocked${alt ? `: ${alt}` : ''}]</span>`); continue; }
      attrs.push(`src="${esc(src)}"`, `alt="${alt}"`, 'referrerpolicy="no-referrer"');
      const w = parseInt(a.width, 10), h = parseInt(a.height, 10);
      if (w > 0 && w <= 2000) attrs.push(`width="${w}"`); if (h > 0 && h <= 2000) attrs.push(`height="${h}"`);
    }
    if ((name === 'td' || name === 'th')) { for (const k of ['colspan', 'rowspan']) { const n = parseInt(a[k], 10); if (n > 1 && n <= 50) attrs.push(`${k}="${n}"`); } if (/^(left|right|center)$/i.test(a.align || '')) attrs.push(`align="${a.align.toLowerCase()}"`); }
    out.push(`<${name}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`);
    if (!VOID.has(name)) stack.push(name);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('');
}

// ---------------------------------------------------------------- webhook signature (Svix scheme, which Resend uses)
export function verifyWebhook(rawBody, headers, secret, { toleranceSec = 300, now = Date.now() } = {}) {
  const id = headers['svix-id'], ts = headers['svix-timestamp'], sig = headers['svix-signature'];
  if (!secret || !id || !ts || !sig || !Buffer.isBuffer(rawBody)) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const keyBytes = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', keyBytes).update(`${id}.${ts}.`).update(rawBody).digest();
  for (const part of String(sig).split(' ')) {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) continue;
    const got = Buffer.from(value, 'base64');
    if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return true;
  }
  return false;
}
