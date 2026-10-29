// Video meetings (like Google Meet). Scheduling, invitations, the live room's signalling server, recordings and transcripts.
//
// How it works. The video and audio travel directly between participants' browsers (WebRTC, one connection between each
// pair, which is good for small meetings of up to about eight people). This server only introduces the browsers to each
// other (signalling over server-sent events and small POST requests), keeps the room's rules (when it may open, how long it
// may run, who is host) and stores what is saved (recordings, caption transcript). Screen sharing, mute, camera, live
// captions, a pen and pointer over the shared screen, and a script panel are all in the browser.
// A browser cannot hand control of your computer to another person; "taking control" is replaced by the pen and pointer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, getSetting, uploadDir } from '../db.js';
import { getSetting as platformSetting } from '../services/platformConfig.js';
import { currentTenant } from '../context.js';
import { currentRegion } from '../regions/runtime.js';
import os from 'node:os';
import { storageEnabled, putFile, getBuffer, isStoredRef, sessionTenantId } from '../services/storage.js';
import { aiConfig, canTranscribe, transcribe } from './ai.js';
import { now, bad, HttpError } from '../util.js';

// ---- limits set by the platform owner (the backend), inside which each workspace chooses its own
export function caps() {
  const n = (k, d) => { const v = Number(platformSetting(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  return { enabled: platformSetting('meet_enabled') !== '0', max_minutes: n('meet_max_minutes_cap', 120), max_participants: n('meet_max_participants', 8), early_join_minutes: n('meet_early_join_minutes', 10), recording: platformSetting('meet_recording') !== '0', max_advance_days: n('meet_max_advance_days', 365) };
}
export const workspaceDefaults = () => ({ default_minutes: Math.min(Number(getSetting('meet_default_minutes', '45')) || 45, caps().max_minutes), record_default: getSetting('meet_record_default', '0') === '1' });

// ---- local time helpers (the workspace's own time zone)
function tzOffsetMs(tz, atUtcMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(atUtcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - atUtcMs;
}
export function localToMs(local, tz = currentRegion().config.timezone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(local));
  if (!m) return NaN;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return wall - tzOffsetMs(tz, wall);
}
export function msToLocal(ms, tz = currentRegion().config.timezone) { return new Date(ms + tzOffsetMs(tz, ms)).toISOString().slice(0, 19).replace('T', ' '); }

// ---- scheduling
const newCode = () => crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').slice(0, 12).toLowerCase();
const newToken = () => crypto.randomBytes(14).toString('base64url');
export function createMeeting(user, b) {
  const c = caps();
  if (!c.enabled) throw bad('Meetings are switched off on this platform.');
  const title = String(b.title || '').trim();
  if (!title) throw bad('Give the meeting a title.');
  const startMs = localToMs(b.starts_at);
  if (Number.isNaN(startMs)) throw bad('Choose the date and time of the meeting.');
  if (startMs < Date.now() - 15 * 60_000) throw bad('That start time has already passed.');
  if (startMs > Date.now() + c.max_advance_days * 864e5) throw bad(`Meetings can be scheduled up to ${c.max_advance_days} days ahead.`);
  const minutes = Math.round(Number(b.max_minutes) || workspaceDefaults().default_minutes);
  if (minutes < 5) throw bad('A meeting must be at least 5 minutes long.');
  if (minutes > c.max_minutes) throw bad(`Meetings on this platform can last at most ${c.max_minutes} minutes.`);
  const record = b.record && c.recording ? 1 : 0;
  const id = Number(run(`INSERT INTO meetings(code, title, description, host_user_id, contact_id, starts_at, ends_at, max_minutes, record, transcribe, script_id, allow_guests, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newCode(), title.slice(0, 160), String(b.description || '').slice(0, 1000) || null, user.id, b.contact_id ? Number(b.contact_id) : null, msToLocal(startMs), msToLocal(startMs + minutes * 60_000), minutes, record, b.transcribe === false ? 0 : 1, b.script_id ? Number(b.script_id) : null, b.allow_guests === false ? 0 : 1, now()).lastInsertRowid);
  addInvite(id, { kind: 'user', user_id: user.id, name: user.name });
  for (const inv of Array.isArray(b.invitees) ? b.invitees.slice(0, 50) : []) addInvite(id, inv);
  return id;
}
export function addInvite(meetingId, inv) {
  const kind = ['user', 'contact', 'email', 'phone'].includes(inv.kind) ? inv.kind : null;
  if (!kind) return null;
  let name = String(inv.name || '').trim(), email = String(inv.email || '').trim().toLowerCase(), phone = String(inv.phone || '').trim();
  if (kind === 'user') { const u = get('SELECT id, name, email, phone FROM users WHERE id=? AND active=1', Number(inv.user_id)); if (!u) return null; name = u.name; email = u.email || ''; phone = u.phone || ''; inv = { ...inv, user_id: u.id }; }
  if (kind === 'contact') { const c = get('SELECT id, full_name, email, phone FROM contacts WHERE id=?', Number(inv.contact_id)); if (!c) return null; name = c.full_name; email = c.email || ''; phone = c.phone || ''; inv = { ...inv, contact_id: c.id }; }
  if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Enter a valid email address for the invitee.');
  if (kind === 'phone' && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) throw bad('Enter a valid phone number for the invitee.');
  const dup = get('SELECT id FROM meeting_invites WHERE meeting_id=? AND ((user_id IS NOT NULL AND user_id=?) OR (contact_id IS NOT NULL AND contact_id=?) OR (email<>\'\' AND email=?) OR (phone<>\'\' AND phone=?))', meetingId, inv.user_id ?? -1, inv.contact_id ?? -1, email, phone);
  if (dup) return dup.id;
  return Number(run('INSERT INTO meeting_invites(meeting_id, kind, user_id, contact_id, name, email, phone, token) VALUES(?,?,?,?,?,?,?,?)', meetingId, kind, inv.user_id ?? null, inv.contact_id ?? null, name || null, email, phone, newToken()).lastInsertRowid);
}
export const joinUrl = (origin, code, token) => `${origin}/meet/${code}${token ? `?i=${token}` : ''}`;
export const whenText = (m) => `${m.starts_at.slice(0, 16)} (${currentRegion().config.timezone}), up to ${m.max_minutes} minutes`;

// ---- the live room (in memory; a restart ends running meetings, which clients show as "reconnecting")
const rooms = new Map();
const roomKey = (code) => `${currentTenant()?.id ?? 0}:${code}`;
export const iceServers = () => { try { const v = JSON.parse(process.env.ERP_ICE_SERVERS || 'null'); if (Array.isArray(v)) return v; } catch { /* default below */ } return [{ urls: 'stun:stun.l.google.com:19302' }]; };

export function meetingByCode(code) { return get('SELECT * FROM meetings WHERE code=?', String(code || '').toLowerCase()); }
export function joinWindow(m) {
  const startMs = localToMs(m.starts_at), early = caps().early_join_minutes * 60_000;
  const hardStop = m.started_at ? localToMs(m.started_at) + m.max_minutes * 60_000 : localToMs(m.ends_at) + 15 * 60_000;
  const t = Date.now();
  if (m.status === 'canceled') return { open: false, reason: 'This meeting was canceled.' };
  if (m.status === 'ended' || t > hardStop) return { open: false, reason: 'This meeting has ended.' };
  if (t < startMs - early) return { open: false, reason: `This meeting opens ${caps().early_join_minutes} minutes before it starts, at ${m.starts_at.slice(0, 16)}.`, opens_at_ms: startMs - early };
  return { open: true, hard_stop_ms: hardStop };
}

export function joinRoom(m, { name, role, userId, inviteId }) {
  const w = joinWindow(m);
  if (!w.open) throw new HttpError(403, w.reason);
  const key = roomKey(m.code);
  let room = rooms.get(key);
  if (!room) { room = { code: m.code, meetingId: m.id, peers: new Map(), timers: [], captionsAt: Date.now() }; rooms.set(key, room); }
  if (room.peers.size >= caps().max_participants) throw new HttpError(403, `This meeting is full (${caps().max_participants} people).`);
  if (!m.started_at) {
    if (role !== 'host') throw new HttpError(403, 'The host has not started this meeting yet. Try again in a moment.');
    run("UPDATE meetings SET status='live', started_at=? WHERE id=?", now(), m.id);
    m = get('SELECT * FROM meetings WHERE id=?', m.id);
  }
  const hardStopMs = localToMs(m.started_at) + m.max_minutes * 60_000;
  const pid = crypto.randomBytes(6).toString('hex'), token = crypto.randomBytes(16).toString('base64url');
  const peer = { pid, token, name: String(name || 'Guest').slice(0, 60), role, userId: userId || null, res: null, joinedAt: Date.now(), queue: [] };
  room.peers.set(pid, peer);
  if (inviteId) run('UPDATE meeting_invites SET joined_at=COALESCE(joined_at, ?) WHERE id=?', now(), inviteId);
  armTimers(room, m, hardStopMs);
  broadcast(room, { type: 'peer-joined', peer: { pid, name: peer.name, role } }, pid);
  return { pid, token, role, name: peer.name, hard_stop_ms: hardStopMs, ice_servers: iceServers(), peers: [...room.peers.values()].filter((p) => p.pid !== pid).map((p) => ({ pid: p.pid, name: p.name, role: p.role })), meeting: { id: m.id, title: m.title, record: !!m.record, transcribe: !!m.transcribe, script_id: m.script_id, started_at: m.started_at, max_minutes: m.max_minutes } };
}
function armTimers(room, m, hardStopMs) {
  if (room.armed) return;
  room.armed = true;
  const left = hardStopMs - Date.now();
  if (left > 5 * 60_000) room.timers.push(setTimeout(() => broadcast(room, { type: 'warning', minutes: 5 }), left - 5 * 60_000));
  if (left > 60_000) room.timers.push(setTimeout(() => broadcast(room, { type: 'warning', minutes: 1 }), left - 60_000));
  room.timers.push(setTimeout(() => endRoom(m.code, m.id, 'time'), Math.max(0, left)));
  for (const t of room.timers) t.unref?.();
}
function broadcast(room, event, exceptPid) { for (const p of room.peers.values()) if (p.pid !== exceptPid) deliver(p, event); }
function deliver(peer, event) {
  if (peer.res) { try { peer.res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* closed */ } } else if (peer.queue.length < 200) peer.queue.push(event);
}
export function peerOf(code, pid, token) {
  const room = rooms.get(roomKey(code));
  const p = room?.peers.get(pid);
  if (!p || !token || p.token !== token) return null;
  return { room, peer: p };
}
export function attachStream(room, peer, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  peer.res = res;
  for (const e of peer.queue.splice(0)) res.write(`data: ${JSON.stringify(e)}\n\n`);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 20_000);
  clearTimeout(peer.dropTimer);
  const key = roomKey(room.code);
  // a closed tab that never said goodbye: drop the person unless they reconnect shortly (a network blip reconnects within seconds)
  res.on('close', () => {
    clearInterval(ping);
    if (peer.res !== res) return;
    peer.res = null;
    peer.dropTimer = setTimeout(() => {
      if (peer.res || room.peers.get(peer.pid) !== peer) return;
      room.peers.delete(peer.pid);
      broadcast(room, { type: 'peer-left', pid: peer.pid });
      if (!room.peers.size) { for (const t of room.timers) clearTimeout(t); rooms.delete(key); }
    }, 25_000);
  });
}
export function relay(room, from, to, event) {
  const target = room.peers.get(to);
  if (!target) return false;
  deliver(target, { ...event, from: from.pid, from_name: from.name });
  return true;
}
export function announce(room, from, event) { broadcast(room, { ...event, from: from.pid, from_name: from.name }, from.pid); }
export function leaveRoom(code, pid) {
  const room = rooms.get(roomKey(code));
  const p = room?.peers.get(pid);
  if (!p) return;
  room.peers.delete(pid);
  clearTimeout(p.dropTimer);
  try { p.res?.end(); } catch { /* closed */ }
  broadcast(room, { type: 'peer-left', pid });
  if (!room.peers.size) { for (const t of room.timers) clearTimeout(t); rooms.delete(roomKey(code)); }
}
export function endRoom(code, meetingId, why) {
  const room = rooms.get(roomKey(code));
  run("UPDATE meetings SET status='ended', ended_at=COALESCE(ended_at, ?) WHERE id=? AND status<>'canceled'", now(), meetingId);
  if (!room) return;
  broadcast(room, { type: 'ended', reason: why });
  for (const p of room.peers.values()) { try { p.res?.end(); } catch { /* closed */ } }
  for (const t of room.timers) clearTimeout(t);
  rooms.delete(roomKey(code));
}
export const roomPeers = (code) => [...(rooms.get(roomKey(code))?.peers.values() || [])].map((p) => ({ name: p.name, role: p.role }));

// ---- captions (spoken words turned into text by each person's own browser), recordings and transcripts
export function addCaption(m, speaker, text, atMs) {
  const t = String(text || '').trim().slice(0, 600);
  if (!t) return;
  run('INSERT INTO meeting_transcript(meeting_id, speaker, text, at_ms, created_at) VALUES(?,?,?,?,?)', m.id, String(speaker).slice(0, 60), t, atMs ?? null, now());
}
export const transcriptText = (meetingId) => all('SELECT speaker, text FROM meeting_transcript WHERE meeting_id=? ORDER BY id', meetingId).map((l) => `${l.speaker}: ${l.text}`).join('\n');
// live chunks are a working file: in the system temp folder when object storage is on, in the upload folder otherwise
const recDir = () => (storageEnabled() ? path.join(os.tmpdir(), 'agentify-erp-uploads', 'rec', String(sessionTenantId())) : path.join(uploadDir(), 'recordings', 'meetings'));
export function appendChunk(meetingId, seq, buf) {
  fs.mkdirSync(recDir(), { recursive: true });
  const file = path.join(recDir(), `${meetingId}-live.part`);
  if (seq === 0) fs.writeFileSync(file, buf); else fs.appendFileSync(file, buf);
  return fs.statSync(file).size;
}
export async function finishRecording(m, { mime, duration, uploadedBy }) {
  const part = path.join(recDir(), `${m.id}-live.part`);
  if (!fs.existsSync(part)) throw bad('No recording data was received.');
  const ext = String(mime || '').includes('mp4') ? 'mp4' : 'webm';
  const id = Number(run('INSERT INTO meeting_recordings(meeting_id, kind, path, size, duration, mime, uploaded_by, created_at) VALUES(?,?,?,?,?,?,?,?)', m.id, 'video', 'pending', fs.statSync(part).size, duration ? Math.round(duration) : null, mime || 'video/webm', uploadedBy, now()).lastInsertRowid);
  let rel;
  if (storageEnabled()) {
    try { rel = (await putFile(part, { module: 'recordings', filename: `meeting-${m.id}-${id}.${ext}`, mime: mime || 'video/webm' })).ref; }
    catch (e) { run('DELETE FROM meeting_recordings WHERE id=?', id); throw e; }
    fs.rmSync(part, { force: true });
  } else {
    fs.mkdirSync(path.join(uploadDir(), 'recordings', 'meetings'), { recursive: true });
    rel = path.join('recordings', 'meetings', `${m.id}-${id}.${ext}`).split(path.sep).join('/');
    fs.renameSync(part, path.join(uploadDir(), rel));
  }
  run('UPDATE meeting_recordings SET path=? WHERE id=?', rel, id);
  if (m.transcribe && canTranscribe()) transcribeMeetingRecording(id).catch(() => {});
  return id;
}
export async function transcribeMeetingRecording(recId) {
  const rec = get('SELECT * FROM meeting_recordings WHERE id=?', recId);
  if (!rec) throw bad('Recording not found');
  if (rec.size > 24 * 1024 * 1024) { run("UPDATE meeting_recordings SET transcript_status='failed', error=? WHERE id=?", 'This recording is larger than the 25 MB the speech-to-text service accepts. The live captions are kept instead.', rec.id); throw bad('This recording is too large to transcribe (25 MB limit). The live caption transcript is kept.'); }
  run("UPDATE meeting_recordings SET transcript_status='working' WHERE id=?", rec.id);
  try {
    const text = await transcribe(isStoredRef(rec.path) ? await getBuffer(rec.path) : fs.readFileSync(path.join(uploadDir(), rec.path)), path.basename(rec.path));
    run("UPDATE meeting_recordings SET transcript=?, transcript_status='done', error=NULL WHERE id=?", text, rec.id);
  } catch (e) { run("UPDATE meeting_recordings SET transcript_status='failed', error=? WHERE id=?", String(e.message).slice(0, 250), rec.id); throw e; }
}
export const recordingPath = (rel) => path.join(uploadDir(), rel);
