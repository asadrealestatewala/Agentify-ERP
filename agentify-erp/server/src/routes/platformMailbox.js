// Super Admin console: Mailbox (Inbox, Sent log, Settings). Mounted at /api/platform/admin/mailbox behind requireOperator + mailbox.manage,
// so every handler here is Platform Owner / Super Admin only. Resend is called from the server; the browser never sees the key.
import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { asyncH, bad, HttpError } from '../util.js';
import * as mb from '../services/mailbox.js';
import { listLog, getLog, importFromResend, webhookStatus, STATUSES } from '../services/emailLog.js';
import { audit, getSetting, setSetting } from '../services/platformConfig.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: mb.MAX_ATTACH_BYTES, files: 10, fields: 30, fieldSize: 2 * 1024 * 1024 } });
// multer errors become readable 400s instead of a generic failure
const files = (req, res, next) => upload.array('files', 10)(req, res, (e) => {
  if (!e) return next();
  next(bad(e.code === 'LIMIT_FILE_SIZE' ? 'An attachment is over 20 MB. Remove it or send a download link instead.' : e.code === 'LIMIT_FILE_COUNT' ? 'At most 10 attachments per message' : 'The attachments could not be read'));
});
const sendLimiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.MAILBOX_SEND_LIMIT) || 20, standardHeaders: true, legacyHeaders: false, message: { error: 'You are sending too fast. Wait a minute and try again.' } });
const readLimiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Try again in a moment.' } });
r.use(readLimiter);

const who = (req) => req.operator.email;
const short = (s, n = 120) => String(s || '').slice(0, n);

// ---------------------------------------------------------------- inboxes
r.get('/inboxes', asyncH(async (req, res) => {
  const inboxes = await mb.listInboxes({ fresh: req.query.fresh === '1' });
  const counts = await Promise.all(inboxes.map(async (i) => {
    try { const t = await mb.listThreads({ inbox: i.id, folder: 'inbox', read: 'false', limit: 100 }); return t.threads.length; } catch { return null; }
  }));
  res.json({ configured: mb.resendConfigured(), inboxes: inboxes.map((i, n) => ({ id: i.id, email: i.email_address, from_name: i.from_name || '', can_send: !/^(noreply|no-reply)@/i.test(i.email_address), unread: counts[n], unread_capped: counts[n] === 100 })) });
}));
r.get('/inboxes/:inbox/labels', asyncH(async (req, res) => res.json({ labels: await mb.listLabels(req.params.inbox) })));
r.post('/inboxes/:inbox/labels', asyncH(async (req, res) => {
  const out = await mb.createLabel(req.params.inbox, req.body?.name, req.body?.color);
  audit(who(req), 'mailbox-label-created', { inbox: short(req.params.inbox, 40), name: short(req.body?.name, 64) });
  res.status(201).json(out);
}));

// ---------------------------------------------------------------- threads
r.get('/threads', asyncH(async (req, res) => {
  const q = req.query;
  res.json(await mb.listThreads({ inbox: q.inbox || 'all', folder: q.folder, q: q.q, read: q.read, label: q.label, attachment: q.attachment, after: q.after, before: q.before, limit: q.limit }));
}));
r.get('/threads/:inbox/:thread', asyncH(async (req, res) => res.json(await mb.getThread(req.params.inbox, req.params.thread, { images: req.query.images === '1', markRead: req.query.mark !== '0' }))));
r.patch('/threads/:inbox/:thread', asyncH(async (req, res) => {
  const { read, folder } = req.body || {};
  await mb.updateThread(req.params.inbox, req.params.thread, { read, folder });
  if (folder) audit(who(req), `mailbox-thread-${folder}`, { inbox: short(req.params.inbox, 40), thread: req.params.thread });
  res.json({ ok: true });
}));
r.post('/threads/:inbox/:thread/labels', asyncH(async (req, res) => { await mb.addThreadLabel(req.params.inbox, req.params.thread, req.body?.label_id); res.json({ ok: true }); }));
r.delete('/threads/:inbox/:thread/labels/:label', asyncH(async (req, res) => { await mb.removeThreadLabel(req.params.inbox, req.params.thread, req.params.label); res.json({ ok: true }); }));

// ---------------------------------------------------------------- attachments (server downloads and hands the bytes on)
r.get('/attachments/:email/:attachment', asyncH(async (req, res) => {
  const a = await mb.fetchAttachment(req.params.email, req.params.attachment);
  res.setHeader('Content-Type', a.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${a.filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.send(a.buffer);
}));

// ---------------------------------------------------------------- drafts, send, reply, forward
r.get('/drafts', asyncH(async (req, res) => {
  const inboxes = (await mb.listInboxes()).filter((i) => !/^(noreply|no-reply)@/i.test(i.email_address) && (!req.query.inbox || req.query.inbox === 'all' || i.id === req.query.inbox));
  const all = await Promise.all(inboxes.map((i) => mb.listDrafts(i.id).catch(() => [])));
  res.json({ drafts: all.flat().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))) });
}));
r.get('/drafts/:inbox/:id', asyncH(async (req, res) => res.json(await mb.getDraft(req.params.inbox, req.params.id))));
r.post('/drafts', sendLimiter, asyncH(async (req, res) => res.status(req.body?.draft_id ? 200 : 201).json(await mb.saveDraft({ inbox: req.body?.inbox, draftId: req.body?.draft_id, to: req.body?.to, cc: req.body?.cc, bcc: req.body?.bcc, subject: req.body?.subject, html: req.body?.html, text: req.body?.text, threadId: req.body?.thread_id, replyToEmailId: req.body?.reply_to_email_id }))));
r.delete('/drafts/:inbox/:id', asyncH(async (req, res) => {
  await mb.deleteDraft(req.params.inbox, req.params.id);
  audit(who(req), 'mailbox-draft-deleted', { inbox: short(req.params.inbox, 40), draft: req.params.id });
  res.json({ ok: true });
}));

r.post('/send', sendLimiter, files, asyncH(async (req, res) => {
  const b = req.body || {};
  const out = await mb.sendNew({ inbox: b.inbox, draftId: b.draft_id, to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject, html: b.html, text: b.text, files: req.files });
  audit(who(req), 'mailbox-sent', { from: out.from, to: out.to.join(', ').slice(0, 300), subject: short(out.subject, 200), attachments: (req.files || []).length });
  res.status(201).json(out);
}));
r.post('/reply', sendLimiter, files, asyncH(async (req, res) => {
  const b = req.body || {};
  const out = await mb.replyTo({ inbox: b.inbox, thread: b.thread_id, email: b.email_id, html: b.html, text: b.text, cc: b.cc, bcc: b.bcc, subject: b.subject, all: b.all === 'true' || b.all === true, files: req.files });
  audit(who(req), b.all === 'true' || b.all === true ? 'mailbox-reply-all' : 'mailbox-reply', { from: out.from, thread: b.thread_id, attachments: (req.files || []).length });
  res.status(201).json(out);
}));
r.post('/forward', sendLimiter, files, asyncH(async (req, res) => {
  const b = req.body || {};
  const out = await mb.forward({ inbox: b.inbox, thread: b.thread_id, email: b.email_id, to: b.to, cc: b.cc, bcc: b.bcc, html: b.html, text: b.text, subject: b.subject, files: req.files });
  audit(who(req), 'mailbox-forward', { from: out.from, to: out.to.join(', ').slice(0, 300), thread: b.thread_id });
  res.status(201).json(out);
}));

// ---------------------------------------------------------------- sent log (everything the platform sent through Resend)
r.get('/log', asyncH((req, res) => {
  const q = req.query;
  res.json({ ...listLog({ status: q.status, type: q.type, workspace: q.workspace, from: q.from, to: q.to, q: q.q, limit: q.limit, offset: q.offset }), statuses: STATUSES });
}));
r.get('/log/:id', asyncH((req, res) => {
  const row = getLog(req.params.id);
  if (!row) throw new HttpError(404, 'That e-mail is not in the log');
  res.json(row);
}));
/** Pull Resend's own list so mail sent before the log existed (or by hand from the inbox) shows up too. */
r.post('/log/sync', sendLimiter, asyncH(async (req, res) => {
  const added = importFromResend(await mb.listSentFromResend(100));
  audit(who(req), 'mailbox-log-sync', { added });
  res.json({ added });
}));

// ---------------------------------------------------------------- settings
r.get('/settings', asyncH(async (req, res) => {
  const configured = mb.resendConfigured();
  let inboxes = [];
  if (configured) inboxes = await mb.listInboxes({ fresh: true }).catch(() => []);
  const from = getSetting('mail_from') || process.env.MAIL_FROM || '';
  const proto = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
  res.json({
    configured,
    inboxes: inboxes.map((i) => ({ id: i.id, email: i.email_address, from_name: i.from_name || '', can_send: !/^(noreply|no-reply)@/i.test(i.email_address) })),
    sender: from,
    reply_to: getSetting('mail_reply_to') || '',
    reply_to_default: /@agentifyerp\.co>?\s*$/i.test(from) ? 'hello@agentifyerp.co' : '',
    webhook: { url: `${proto}://${req.get('host')}/api/platform/webhooks/resend`, secret_saved: !!getSetting('resend_webhook_secret'), ...webhookStatus() },
  });
}));
r.put('/settings/inboxes/:inbox', asyncH(async (req, res) => {
  const out = await mb.updateInbox(req.params.inbox, { from_name: req.body?.from_name });
  audit(who(req), 'mailbox-settings', { inbox: short(req.params.inbox, 40), from_name: out.from_name });
  res.json(out);
}));
r.put('/settings/reply-to', asyncH((req, res) => {
  const v = String(req.body?.reply_to ?? '').trim();
  if (v && !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/.test(v)) throw bad('Reply-To must be one e-mail address');
  setSetting('mail_reply_to', v || null, { by: who(req) });
  audit(who(req), 'mailbox-settings', { reply_to: v || '(default)' });
  res.json({ reply_to: v });
}));

export default r;
