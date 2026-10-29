// Call scripts, call statistics, call recordings and their transcripts.
// Recording is off until a workspace turns it on, and then every call opens with a spoken notice (laws on recording calls
// differ by country and state; the notice is the minimum, and the owner is responsible for local consent rules).
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, getSetting, setSetting, uploadDir } from '../db.js';
import { integrationConfig } from './store.js';
import { aiConfig, canTranscribe, transcribe } from './ai.js';
import { render } from '../../../shared/region/templates.js';
import { currentRegion } from '../regions/runtime.js';
import { now, today, addDays } from '../util.js';
import { storageEnabled, putFile, getBuffer, isStoredRef } from '../services/storage.js';

export const DEFAULT_ANNOUNCEMENT = 'This call may be recorded for quality and training.';
export const callSettings = () => ({ record: getSetting('calls_record', '0') === '1', transcribe: getSetting('calls_transcribe', '1') === '1', announcement: getSetting('calls_announce', '') || DEFAULT_ANNOUNCEMENT });
export function saveCallSettings(b) {
  setSetting('calls_record', b.record ? '1' : '0');
  setSetting('calls_transcribe', b.transcribe === false ? '0' : '1');
  if (b.announcement !== undefined) setSetting('calls_announce', String(b.announcement || '').trim().slice(0, 240));
  return callSettings();
}

// ---- scripts
export const STARTER_SCRIPT = `OPENING
Hello {{contact.name}}, this is {{agent.name}} from {{company.name}}. Is now a good time for a quick call?

FIND OUT WHAT THEY NEED
- What are you looking for (buy, rent, invest)?
- Which areas are you considering, and what is your budget?
- When would you like to move?

NEXT STEP
Offer a viewing or a meeting, and book it in the CRM while you are on the call.

CLOSE
Thank them, repeat the next step, and tell them how they will hear from you.`;
export function ensureStarterScript(userId) {
  if (!get('SELECT 1 FROM call_scripts LIMIT 1')) run('INSERT INTO call_scripts(name, body, kind, created_by, created_at) VALUES(?,?,?,?,?)', 'First call to a new lead', STARTER_SCRIPT, 'call', userId || null, now());
}
export const listScripts = () => all('SELECT * FROM call_scripts WHERE active=1 ORDER BY id');
export function renderScript(scriptId, { contact, agent, company }) {
  const s = get('SELECT * FROM call_scripts WHERE id=?', scriptId);
  if (!s) return null;
  const out = render(s.body, { contact: { name: contact?.name || contact?.full_name || 'there' }, agent: { name: agent?.name || 'your agent' }, company: { name: company || '' } }, { html: false });
  return { id: s.id, name: s.name, text: out.text };
}

// ---- statistics
export function callStats(user, range = '7d') {
  const days = { today: 0, '7d': 6, '30d': 29 }[range] ?? 6;
  const from = `${addDays(today(), -days)} 00:00:00`;
  const own = user.own_scope ? ' AND k.user_id=?' : '';
  const params = [from, ...(user.own_scope ? [user.id] : [])];
  const base = `FROM calls k WHERE k.started_at>=?${own}`;
  const tot = get(`SELECT COUNT(*) calls, SUM(CASE WHEN k.status='completed' AND COALESCE(k.duration,0)>0 THEN 1 ELSE 0 END) connected, AVG(CASE WHEN k.duration>0 THEN k.duration END) avg_duration, SUM(COALESCE(k.duration,0)) talk_seconds ${base}`, ...params);
  const byUser = all(`SELECT u.name, COUNT(*) calls, SUM(CASE WHEN k.duration>0 THEN 1 ELSE 0 END) connected, AVG(CASE WHEN k.duration>0 THEN k.duration END) avg_duration ${base.replace('FROM calls k', 'FROM calls k LEFT JOIN users u ON u.id=k.user_id')} GROUP BY k.user_id ORDER BY calls DESC LIMIT 20`, ...params);
  const outcomes = all(`SELECT COALESCE(k.outcome,'not_recorded') outcome, COUNT(*) n ${base} GROUP BY outcome ORDER BY n DESC`, ...params);
  const byDay = all(`SELECT substr(k.started_at,1,10) day, COUNT(*) calls, SUM(CASE WHEN k.duration>0 THEN 1 ELSE 0 END) connected ${base} GROUP BY day ORDER BY day`, ...params);
  const recs = get(`SELECT COUNT(*) n FROM call_recordings r JOIN calls k ON k.id=r.call_id WHERE k.started_at>=?${own}`, ...params).n;
  return { range, calls: tot.calls || 0, connected: tot.connected || 0, connect_rate: tot.calls ? Math.round(((tot.connected || 0) / tot.calls) * 100) : 0, avg_duration: Math.round(tot.avg_duration || 0), talk_seconds: tot.talk_seconds || 0, recordings: recs, by_user: byUser.map((u) => ({ ...u, avg_duration: Math.round(u.avg_duration || 0) })), outcomes, by_day: byDay };
}

// ---- recordings
const dirFor = (kind) => path.join(uploadDir(), 'recordings', kind);
export function recordingFile(rel) { return path.join(uploadDir(), rel); }
/** The audio bytes, from the bucket or (legacy) the workspace's upload folder. */
const readRecording = (rel) => (isStoredRef(rel) ? getBuffer(rel) : fs.readFileSync(recordingFile(rel)));

/** Called by the Twilio recording web hook. Stores the row, then downloads the audio and (optionally) transcribes it. */
export function addRecording(callId, { sid, url, duration }) {
  const id = Number(run('INSERT INTO call_recordings(call_id, provider_sid, remote_url, duration, created_at) VALUES(?,?,?,?,?)', callId, sid, url, duration ? Number(duration) : null, now()).lastInsertRowid);
  return id;
}
export async function fetchRecording(recId) {
  const rec = get('SELECT * FROM call_recordings WHERE id=?', recId);
  const cfg = integrationConfig('twilio');
  if (!rec || !cfg || !rec.remote_url) return;
  try {
    const res = await fetch(`${rec.remote_url}.mp3`, { headers: { Authorization: `Basic ${Buffer.from(`${cfg.account_sid}:${cfg.auth_token}`).toString('base64')}` }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Twilio answered ${res.status} for the recording`);
    const buf = Buffer.from(await res.arrayBuffer());
    let rel;
    if (storageEnabled()) rel = (await putFile(buf, { module: 'recordings', filename: `call-${rec.call_id}-${rec.id}.mp3`, mime: 'audio/mpeg' })).ref;
    else {
      fs.mkdirSync(dirFor('calls'), { recursive: true });
      rel = path.join('recordings', 'calls', `${rec.call_id}-${rec.id}.mp3`);
      fs.writeFileSync(path.join(uploadDir(), rel), buf);
    }
    run('UPDATE call_recordings SET path=?, size=?, error=NULL WHERE id=?', rel, buf.length, rec.id);
    if (callSettings().transcribe && canTranscribe()) await transcribeRecording(rec.id);
  } catch (e) { run('UPDATE call_recordings SET error=? WHERE id=?', String(e.message).slice(0, 250), rec.id); }
}
export async function transcribeRecording(recId) {
  const rec = get('SELECT * FROM call_recordings WHERE id=?', recId);
  if (!rec?.path) throw new Error('The audio has not been downloaded yet');
  run("UPDATE call_recordings SET transcript_status='working' WHERE id=?", rec.id);
  try {
    const lang = { fr: 'fr', ar: 'ar' }[currentRegion().config.language] || undefined;
    const text = await transcribe(await readRecording(rec.path), path.basename(rec.path), lang);
    run("UPDATE call_recordings SET transcript=?, transcript_status='done', error=NULL WHERE id=?", text, rec.id);
  } catch (e) { run("UPDATE call_recordings SET transcript_status='failed', error=? WHERE id=?", String(e.message).slice(0, 250), rec.id); throw e; }
}
