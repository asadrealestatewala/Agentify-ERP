// Meetings: scheduling and invitations for staff (signed in), and the public room API that guests and staff use to join.
import express, { Router } from 'express';
import fs from 'node:fs';
import rateLimit from 'express-rate-limit';
import { all, get, run, getSetting, setSetting } from '../db.js';
import { audit, notify } from '../audit.js';
import { asyncH, bad, notFound, forbidden, now, HttpError } from '../util.js';
import { can, hasPerm, authenticate } from '../rbac.js';
import { currentTenant } from '../context.js';
import { BASE_DOMAIN } from '../platform.js';
import { sendMail, layout } from '../services/mailer.js';
import { integrationConfig, integrationRow } from '../integrations/store.js';
import { sendSms } from '../integrations/twilio.js';
import { listScripts, renderScript, ensureStarterScript } from '../integrations/calls.js';
import { canTranscribe } from '../integrations/ai.js';
import * as M from '../integrations/meetings.js';

const r = Router();
export const roomRouter = Router();

// ------------------------------------------------------------------ helpers
const origin = (req) => `${req.protocol}://${req.get('host')}`;
/** The public address of this workspace when no request is at hand (reminder jobs). */
const workspaceOrigin = () => {
  const t = currentTenant();
  const host = t?.custom_domain || (t && BASE_DOMAIN ? `${t.slug}.${BASE_DOMAIN}` : 'localhost:4000');
  return `${process.env.ERP_PUBLIC_SCHEME || (/localhost|\.test$/.test(host) ? 'http' : 'https')}://${host}${/localhost$/.test(host) && !host.includes(':') && process.env.PORT ? `:${process.env.PORT}` : ''}`;
};
const digits = (p) => String(p || '').replace(/\D/g, '');
const waLink = (phone, text) => (digits(phone) ? `https://wa.me/${digits(phone)}?text=${encodeURIComponent(text)}` : null);
function invitationText(m, host, link) { return `${host} invited you to a video meeting: ${m.title}\nWhen: ${M.whenText(m)}\nJoin: ${link}`; }
function loadInvites(m, org) {
  return all('SELECT * FROM meeting_invites WHERE meeting_id=? ORDER BY id', m.id).map((i) => {
    const link = M.joinUrl(org, m.code, i.token);
    const host = get('SELECT name FROM users WHERE id=?', m.host_user_id)?.name || 'Your agent';
    return { id: i.id, kind: i.kind, user_id: i.user_id, contact_id: i.contact_id, name: i.name, email: i.email, phone: i.phone, link, whatsapp: i.kind === 'user' ? null : waLink(i.phone, invitationText(m, host, link)), sent_via: i.sent_via, sent_at: i.sent_at, joined_at: i.joined_at };
  });
}
const hostOrAdmin = (req, m) => { if (m.host_user_id !== req.user.id && !req.user.isSuper && !hasPerm(req.user, 'settings', 'edit')) throw forbidden('Only the host or an administrator can change this meeting.'); };
const visible = (req, m) => !req.user.own_scope || m.host_user_id === req.user.id || !!get('SELECT 1 FROM meeting_invites WHERE meeting_id=? AND user_id=?', m.id, req.user.id);

/** Sends the invitation to the chosen people by email and/or text message. WhatsApp is a link the agent opens (the app has no WhatsApp Business connection). */
async function sendInvites(req, m, inviteIds, via) {
  const org = origin(req), hostName = req.user.name;
  const twilio = integrationRow('twilio')?.status === 'connected' ? integrationConfig('twilio') : null;
  const out = [];
  for (const i of all('SELECT * FROM meeting_invites WHERE meeting_id=?', m.id).filter((x) => !inviteIds || inviteIds.includes(x.id))) {
    if (i.kind === 'user' && i.user_id === m.host_user_id) continue;
    const link = M.joinUrl(org, m.code, i.token);
    const sent = [];
    if (via.includes('email') && i.email) {
      const mail = layout({ heading: m.title, lines: [`${hostName} invited you to a video meeting.`, `When: ${M.whenText(m)}`, m.description || ''].filter(Boolean), button: { label: 'Join the meeting', url: link }, footer: 'You can join from a computer or a phone. No account is needed.' });
      if (await sendMail({ type: 'meeting', to: i.email, subject: `Meeting: ${m.title}`, ...mail })) sent.push('email');
    }
    if (via.includes('sms') && i.phone && twilio) { try { const to = i.phone.startsWith('+') ? i.phone.replace(/[^\d+]/g, '') : null; if (to) { await sendSms(twilio, { to, body: invitationText(m, hostName, link).slice(0, 600) }); sent.push('sms'); } } catch { /* shown as not sent */ } }
    if (via.includes('whatsapp')) sent.push('whatsapp');
    if (i.kind === 'user' && i.user_id) notify(i.user_id, 'meeting', `Meeting: ${m.title}`, `${M.whenText(m)}`, `/meet/${m.code}`, { dedupe: `meet-invite-${m.id}-${i.user_id}` });
    if (sent.length) run('UPDATE meeting_invites SET sent_via=?, sent_at=? WHERE id=?', sent.join(','), now(), i.id);
    out.push({ id: i.id, name: i.name, sent });
  }
  return out;
}
const shape = (m, req, extra = {}) => ({ id: m.id, code: m.code, title: m.title, description: m.description, starts_at: m.starts_at, ends_at: m.ends_at, max_minutes: m.max_minutes, status: m.status, record: !!m.record, transcribe: !!m.transcribe, script_id: m.script_id, contact_id: m.contact_id, host_user_id: m.host_user_id, started_at: m.started_at, ended_at: m.ended_at, join_url: M.joinUrl(origin(req), m.code), ...extra });

// ------------------------------------------------------------------ staff API
r.get('/settings', can('crm', 'view'), (_req, res) => { ensureStarterScript(null); res.json({ caps: M.caps(), defaults: M.workspaceDefaults(), openai: canTranscribe(), scripts: listScripts().filter((s) => s.kind === 'meeting' || s.kind === 'call') }); });
r.put('/settings', can('settings', 'edit'), asyncH((req, res) => {
  const c = M.caps(); const mins = Math.round(Number(req.body?.default_minutes));
  if (req.body?.default_minutes !== undefined) { if (!(mins >= 5)) throw bad('Enter at least 5 minutes.'); if (mins > c.max_minutes) throw bad(`The platform allows at most ${c.max_minutes} minutes per meeting.`); setSetting('meet_default_minutes', String(mins)); }
  if (req.body?.record_default !== undefined) setSetting('meet_record_default', req.body.record_default && c.recording ? '1' : '0');
  res.json(M.workspaceDefaults());
}));

r.get('/', can('crm', 'view'), (req, res) => {
  const scope = req.query.scope === 'past' ? 'past' : 'upcoming';
  const cutoff = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = all(scope === 'past' ? "SELECT * FROM meetings WHERE status IN ('ended','canceled') OR ends_at < ? ORDER BY starts_at DESC LIMIT 100" : "SELECT * FROM meetings WHERE status IN ('scheduled','live') AND ends_at >= ? ORDER BY starts_at LIMIT 100", M.msToLocal(Date.parse(cutoff + 'Z')));
  res.json(rows.filter((m) => visible(req, m)).map((m) => shape(m, req, { host_name: get('SELECT name FROM users WHERE id=?', m.host_user_id)?.name, invitees: get('SELECT COUNT(*) n FROM meeting_invites WHERE meeting_id=?', m.id).n, recordings: get('SELECT COUNT(*) n FROM meeting_recordings WHERE meeting_id=?', m.id).n, joined_now: M.roomPeers(m.code).length })));
});
r.post('/', can('crm', 'edit'), asyncH(async (req, res) => {
  const b = req.body || {};
  if (b.contact_id && req.user.own_scope && get('SELECT agent_id FROM contacts WHERE id=?', Number(b.contact_id))?.agent_id !== req.user.id) throw forbidden('This contact is not assigned to you');
  const id = M.createMeeting(req.user, { ...b, record: b.record ?? M.workspaceDefaults().record_default });
  const m = get('SELECT * FROM meetings WHERE id=?', id);
  audit(req, 'Scheduled meeting', 'meeting', id, m.title);
  const sent = Array.isArray(b.send) && b.send.length ? await sendInvites(req, m, null, b.send) : [];
  res.status(201).json({ ...shape(m, req), invites: loadInvites(m, origin(req)), sent });
}));
r.get('/recordings/all', can('crm', 'view'), (req, res) => {
  const own = req.user.own_scope ? ' AND (m.host_user_id=?)' : '';
  res.json(all(`SELECT rr.id, rr.meeting_id, m.title, m.starts_at, rr.kind, rr.size, rr.duration, rr.transcript_status, rr.created_at, substr(rr.transcript,1,300) AS excerpt, (SELECT COUNT(*) FROM meeting_transcript t WHERE t.meeting_id=m.id) AS caption_lines
    FROM meeting_recordings rr JOIN meetings m ON m.id=rr.meeting_id WHERE 1=1${own} ORDER BY rr.id DESC LIMIT 200`, ...(req.user.own_scope ? [req.user.id] : [])));
});
const recOf = (req) => { const rec = get('SELECT rr.*, m.host_user_id, m.title FROM meeting_recordings rr JOIN meetings m ON m.id=rr.meeting_id WHERE rr.id=?', Number(req.params.id)); if (!rec) throw notFound('Recording not found'); if (req.user.own_scope && rec.host_user_id !== req.user.id) throw forbidden('This is not your meeting'); return rec; };
r.get('/recordings/:id', can('crm', 'view'), asyncH((req, res) => { const rec = recOf(req); res.json({ ...rec, path: undefined, captions: all('SELECT speaker, text, at_ms FROM meeting_transcript WHERE meeting_id=? ORDER BY id', rec.meeting_id) }); }));
r.get('/recordings/:id/video', can('crm', 'view'), asyncH((req, res) => { const rec = recOf(req); audit(req, 'Played meeting recording', 'meeting', rec.meeting_id); res.type(rec.mime || 'video/webm').sendFile(M.recordingPath(rec.path)); }));
r.post('/recordings/:id/transcribe', can('crm', 'edit'), asyncH(async (req, res) => { const rec = recOf(req); try { await M.transcribeMeetingRecording(rec.id); } catch (e) { throw bad(e.message); } res.json(get('SELECT transcript, transcript_status FROM meeting_recordings WHERE id=?', rec.id)); }));
r.delete('/recordings/:id', can('settings', 'edit'), asyncH((req, res) => { const rec = recOf(req); try { fs.rmSync(M.recordingPath(rec.path), { force: true }); } catch { /* gone */ } run('DELETE FROM meeting_recordings WHERE id=?', rec.id); audit(req, 'Deleted meeting recording', 'meeting', rec.meeting_id); res.json({ ok: true }); }));

const mtg = (req) => { const m = get('SELECT * FROM meetings WHERE id=?', Number(req.params.id)); if (!m) throw notFound('Meeting not found'); if (!visible(req, m)) throw forbidden('This meeting is not yours'); return m; };
r.get('/:id', can('crm', 'view'), asyncH((req, res) => { const m = mtg(req); res.json({ ...shape(m, req), invites: loadInvites(m, origin(req)), recordings: all('SELECT id, kind, size, duration, transcript_status, created_at FROM meeting_recordings WHERE meeting_id=?', m.id), caption_lines: get('SELECT COUNT(*) n FROM meeting_transcript WHERE meeting_id=?', m.id).n }); }));
r.put('/:id', can('crm', 'edit'), asyncH((req, res) => {
  const m = mtg(req); hostOrAdmin(req, m);
  if (m.status !== 'scheduled') throw bad('Only a meeting that has not started can be changed.');
  const b = req.body || {}, c = M.caps();
  const startMs = b.starts_at ? M.localToMs(b.starts_at) : M.localToMs(m.starts_at);
  if (Number.isNaN(startMs)) throw bad('Choose a valid date and time.');
  const mins = Math.round(Number(b.max_minutes ?? m.max_minutes));
  if (mins < 5 || mins > c.max_minutes) throw bad(`A meeting lasts between 5 and ${c.max_minutes} minutes.`);
  run('UPDATE meetings SET title=?, description=?, starts_at=?, ends_at=?, max_minutes=?, record=?, transcribe=?, script_id=? WHERE id=?', String(b.title ?? m.title).trim().slice(0, 160) || m.title, b.description ?? m.description, M.msToLocal(startMs), M.msToLocal(startMs + mins * 60_000), mins, (b.record ?? m.record) && c.recording ? 1 : 0, (b.transcribe ?? m.transcribe) ? 1 : 0, b.script_id !== undefined ? (b.script_id ? Number(b.script_id) : null) : m.script_id, m.id);
  run('UPDATE meeting_invites SET remind_24h_at=NULL, remind_15m_at=NULL WHERE meeting_id=?', m.id);
  audit(req, 'Changed meeting', 'meeting', m.id);
  res.json(shape(get('SELECT * FROM meetings WHERE id=?', m.id), req));
}));
r.post('/:id/cancel', can('crm', 'edit'), asyncH((req, res) => { const m = mtg(req); hostOrAdmin(req, m); M.endRoom(m.code, m.id, 'canceled'); run("UPDATE meetings SET status='canceled' WHERE id=?", m.id); audit(req, 'Canceled meeting', 'meeting', m.id, m.title); res.json({ ok: true }); }));
r.post('/:id/invites', can('crm', 'edit'), asyncH(async (req, res) => {
  const m = mtg(req); hostOrAdmin(req, m);
  for (const inv of [].concat(req.body?.invitees || []).slice(0, 50)) M.addInvite(m.id, inv);
  const sent = Array.isArray(req.body?.send) && req.body.send.length ? await sendInvites(req, m, null, req.body.send) : [];
  res.json({ invites: loadInvites(m, origin(req)), sent });
}));
r.post('/:id/send', can('crm', 'edit'), asyncH(async (req, res) => { const m = mtg(req); hostOrAdmin(req, m); const via = [].concat(req.body?.via || ['email']); res.json({ sent: await sendInvites(req, m, req.body?.invite_ids?.map(Number) || null, via), invites: loadInvites(m, origin(req)) }); }));
r.delete('/:id/invites/:inviteId', can('crm', 'edit'), asyncH((req, res) => { const m = mtg(req); hostOrAdmin(req, m); run('DELETE FROM meeting_invites WHERE id=? AND meeting_id=? AND NOT (kind=\'user\' AND user_id=?)', Number(req.params.inviteId), m.id, m.host_user_id); res.json({ ok: true }); }));
r.get('/:id/transcript', can('crm', 'view'), asyncH((req, res) => { const m = mtg(req); res.json({ lines: all('SELECT speaker, text, at_ms, created_at FROM meeting_transcript WHERE meeting_id=? ORDER BY id', m.id), text: M.transcriptText(m.id) }); }));
r.get('/:id/script', can('crm', 'view'), asyncH((req, res) => { const m = mtg(req); const s = m.script_id ? renderScript(m.script_id, { contact: m.contact_id ? get('SELECT full_name FROM contacts WHERE id=?', m.contact_id) : null, agent: req.user, company: getSetting('company_name', '') }) : null; res.json(s); }));

// ------------------------------------------------------------------ reminders (called every minute for each workspace)
export async function runMeetingReminders() {
  const t = Date.now();
  const rows = all("SELECT * FROM meetings WHERE status='scheduled' AND ends_at >= ?", M.msToLocal(t - 3600_000));
  const org = workspaceOrigin();
  for (const m of rows) {
    const startMs = M.localToMs(m.starts_at);
    for (const [col, lead, label] of [['remind_24h_at', 24 * 3600_000, 'tomorrow'], ['remind_15m_at', 15 * 60_000, 'in 15 minutes']]) {
      if (startMs - t > lead || startMs < t - 5 * 60_000) continue;
      for (const i of all(`SELECT * FROM meeting_invites WHERE meeting_id=? AND ${col} IS NULL`, m.id)) {
        if (col === 'remind_24h_at' && startMs - t < 3600_000) { run(`UPDATE meeting_invites SET ${col}=? WHERE id=?`, now(), i.id); continue; } // too close for a "tomorrow" message
        const link = M.joinUrl(org, m.code, i.token);
        if (i.kind === 'user' && i.user_id) notify(i.user_id, 'meeting', `Meeting ${label}: ${m.title}`, M.whenText(m), `/meet/${m.code}`, { dedupe: `meet-${col}-${m.id}-${i.user_id}` });
        else if (i.email) await sendMail({ type: 'meeting', to: i.email, subject: `Reminder: ${m.title} ${label}`, ...layout({ heading: `${m.title} starts ${label}`, lines: [M.whenText(m)], button: { label: 'Join the meeting', url: link } }) });
        run(`UPDATE meeting_invites SET ${col}=? WHERE id=?`, now(), i.id);
      }
    }
  }
  // meetings nobody closed: end them once their time limit has passed
  for (const m of all("SELECT * FROM meetings WHERE status='live' AND started_at IS NOT NULL")) if (Date.now() > M.localToMs(m.started_at) + m.max_minutes * 60_000 + 60_000) M.endRoom(m.code, m.id, 'time');
}

export default r;

// ------------------------------------------------------------------ the room (guests and staff)
const roomLimit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
roomRouter.use(roomLimit, authenticate);
const mCode = (req) => { const m = M.meetingByCode(req.params.code); if (!m) throw notFound('This meeting link is not valid.'); return m; };
const inviteOf = (m, token) => (token ? get('SELECT * FROM meeting_invites WHERE meeting_id=? AND token=?', m.id, String(token)) : null);

roomRouter.get('/:code/info', asyncH((req, res) => {
  const m = mCode(req); const inv = inviteOf(m, req.query.i); const w = M.joinWindow(m);
  const host = get('SELECT name FROM users WHERE id=?', m.host_user_id)?.name;
  res.json({ title: m.title, description: m.description, host_name: host, starts_at: m.starts_at, ends_at: m.ends_at, status: m.status, max_minutes: m.max_minutes, join_open: w.open, closed_reason: w.open ? null : w.reason, opens_at_ms: w.opens_at_ms || null, record: !!m.record, allow_guests: !!m.allow_guests || !!inv, name_hint: inv?.name || req.user?.name || '', signed_in: !!req.user && !req.user.portal, is_host: !!req.user && req.user.id === m.host_user_id });
}));
roomRouter.post('/:code/join', asyncH((req, res) => {
  const m = mCode(req); const inv = inviteOf(m, req.body?.i);
  const staff = req.user && !req.user.portal ? req.user : null;
  let role = 'guest', name = String(req.body?.name || '').trim();
  if (staff && staff.id === m.host_user_id) { role = 'host'; name = name || staff.name; }
  else if (staff && (hasPerm(staff, 'crm', 'view') || get('SELECT 1 FROM meeting_invites WHERE meeting_id=? AND user_id=?', m.id, staff.id))) { role = 'member'; name = name || staff.name; }
  else if (!m.allow_guests && !inv) throw new HttpError(403, 'This meeting is by invitation only. Use the link you were sent.');
  if (!name) throw bad('Enter your name to join.');
  const out = M.joinRoom(m, { name, role, userId: staff?.id, inviteId: inv?.id });
  res.json({ ...out, recording_notice: m.record ? 'This meeting is being recorded.' : null });
}));
const peerOr401 = (req) => { const p = M.peerOf(req.params.code, String(req.query.pid || req.body?.pid || ''), String(req.query.token || req.body?.token || '')); if (!p) throw new HttpError(401, 'Your session in this meeting ended. Rejoin.'); return p; };
roomRouter.get('/:code/events', asyncH((req, res) => { const { room, peer } = peerOr401(req); M.attachStream(room, peer, res); }));
roomRouter.post('/:code/signal', express.json({ limit: '200kb' }), asyncH((req, res) => {
  const { room, peer } = peerOr401(req);
  const type = String(req.body?.type || '');
  if (!['offer', 'answer', 'candidate', 'stream-info', 'pointer', 'stroke', 'clear-strokes', 'chat', 'hand', 'present', 'mute-state'].includes(type)) throw bad('Unknown message');
  const event = { type, data: req.body?.data ?? null };
  if (req.body?.to) { if (!M.relay(room, peer, String(req.body.to), event)) throw notFound('That person left.'); } else M.announce(room, peer, event);
  res.json({ ok: true });
}));
roomRouter.post('/:code/caption', asyncH((req, res) => {
  const { room, peer } = peerOr401(req); const m = mCode(req);
  const text = String(req.body?.text || '').slice(0, 600);
  if (req.body?.final && m.transcribe) M.addCaption(m, peer.name, text, Date.now() - M.localToMs(m.started_at || m.starts_at));
  M.announce(room, peer, { type: 'caption', data: { text, final: !!req.body?.final } });
  res.json({ ok: true });
}));
roomRouter.post('/:code/leave', asyncH((req, res) => { M.leaveRoom(req.params.code, String(req.body?.pid || req.query.pid || '')); res.json({ ok: true }); }));
roomRouter.post('/:code/end', asyncH((req, res) => { const { peer } = peerOr401(req); const m = mCode(req); if (peer.role !== 'host') throw forbidden('Only the host can end the meeting.'); M.endRoom(m.code, m.id, 'host'); res.json({ ok: true }); }));
roomRouter.get('/:code/script', asyncH((req, res) => { const { peer } = peerOr401(req); const m = mCode(req); if (peer.role === 'guest') throw forbidden('The script is for your team.'); res.json(m.script_id ? renderScript(m.script_id, { contact: m.contact_id ? get('SELECT full_name FROM contacts WHERE id=?', m.contact_id) : null, agent: { name: peer.name }, company: getSetting('company_name', '') }) : null); }));
roomRouter.post('/:code/recording/chunk', express.raw({ type: '*/*', limit: '25mb' }), asyncH((req, res) => {
  const { peer } = peerOr401(req); const m = mCode(req);
  if (peer.role !== 'host' || !m.record) throw forbidden('Only the host can record, and only when recording is switched on for this meeting.');
  const size = M.appendChunk(m.id, Number(req.query.seq) || 0, req.body);
  if (size > 600 * 1024 * 1024) throw bad('The recording is too large.');
  res.json({ ok: true, size });
}));
roomRouter.post('/:code/recording/finish', asyncH(async (req, res) => {
  const { peer } = peerOr401(req); const m = mCode(req);
  if (peer.role !== 'host' || !m.record) throw forbidden('Only the host can save a recording.');
  const id = await M.finishRecording(m, { mime: req.body?.mime, duration: req.body?.duration, uploadedBy: peer.name });
  res.status(201).json({ id });
}));
