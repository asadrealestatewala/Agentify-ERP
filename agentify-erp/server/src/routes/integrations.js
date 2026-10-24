// Workspace integrations hub and the CRM dialer. Everything here is scoped to the signed-in workspace.
//   GET  /api/integrations                  what can be connected in this country and the state of each
//   PUT/DELETE /api/integrations/twilio     connect (and really test) or remove Twilio
//   PUT/DELETE /api/integrations/voice_http connect or remove a local voice provider (Pakistan)
//   GET  /api/integrations/dialer/queue     "Call next": leads ranked by who most needs a call
//   POST /api/integrations/calls            start a call;  POST /calls/:id/outcome records how it went
//   POST /api/integrations/sms              send a text message
import { recordingFilter } from '../services/recordingFilters.js';
import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run } from '../db.js';
import { audit, activity } from '../audit.js';
import { asyncH, bad, notFound, forbidden, now, today, addDays } from '../util.js';
import { can, hasPerm } from '../rbac.js';
import { currentRegion } from '../regions/runtime.js';
import { toE164 } from '../services/phone.js';
import { catalogFor } from '../integrations/catalog.js';
import { saveIntegration, integrationConfig, integrationRow, allIntegrations, markTested, removeIntegration, logIntegration, mask } from '../integrations/store.js';
import { validateTwilioConfig, testTwilio, startBridgeCall, sendSms } from '../integrations/twilio.js';
import { validateVoiceHttp, testVoiceHttp, startVoiceCall } from '../integrations/voiceHttp.js';
import { hubExtras } from '../integrations/hub.js';
import { currentTenant } from '../context.js';
import { callSettings, saveCallSettings, listScripts, ensureStarterScript, renderScript, callStats, recordingFile, transcribeRecording } from '../integrations/calls.js';
import { AI_PROVIDERS, connectAi, aiStatus, aiConfig, activeProvider, canTranscribe } from '../integrations/ai.js';
import { getSetting, setSetting, uploadDir } from '../db.js';
import { runWithTools, completeJson } from '../integrations/ai.js';
import { toolsFor, systemPrompt } from '../integrations/aiTools.js';
import { records as domainRecords, requestDomain, verifyDomain, removeDomain } from '../integrations/domains.js';
import { getTenant } from '../platform.js';
import { PROVIDERS, appCreds, authorizeUrl, redirectUri, signState } from '../services/oauthApps.js';
import { portalsFor, PORTALS, feedToken, rotateFeedToken, listingFor, readiness, setPublication, publicationsFor } from '../integrations/portals.js';
import { assertPublicHttps } from '../services/integrations.js';
import { listAccounts, removeAccount, createPost, runDuePosts, refreshMetrics, socialReport } from '../integrations/social.js';

const r = Router();
const parseJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const region = () => currentRegion().config;

export { toE164 };
const webBase = (req) => `${req.protocol}://${req.get('host')}`;

// ---- the hub
r.get('/', can('crm', 'view'), asyncH((req, res) => {
  const rows = Object.fromEntries(allIntegrations().map((x) => [x.provider, x]));
  const reg = region();
  res.json({
    region: reg.region, base: webBase(req),
    items: catalogFor(reg.region).map((c) => {
      const row = c.id === 'ai' ? (rows.ai_anthropic || rows.ai_openai || rows.ai_gemini || rows.ai_custom) : rows[c.id];
      const info = parseJson(row?.public_info) || {};
      return { ...c, status: row?.status || 'not_connected', connected_at: row?.connected_at || null, last_test_at: row?.last_test_at || null, error: row?.last_error || null, info };
    }),
    extras: hubExtras(req),
  });
}));

// ---- Twilio
r.put('/twilio', can('settings', 'edit'), asyncH(async (req, res) => {
  const prev = integrationConfig('twilio');
  const body = { ...req.body };
  if (prev && (!body.auth_token || /^•/.test(body.auth_token))) body.auth_token = prev.auth_token; // keep the stored token when the form leaves it masked
  const cfg = validateTwilioConfig(body);
  let info;
  try { info = await testTwilio(cfg); } catch (e) { logIntegration('twilio', 'test', 'error', e.message, req.user.id); throw bad(`Twilio did not accept these details: ${e.message}`); }
  saveIntegration('twilio', cfg, { publicInfo: { account: mask(cfg.account_sid), number: cfg.phone_number, name: info.friendly_name, voice: info.voice, sms: info.sms }, status: 'connected', userId: req.user.id });
  markTested('twilio', true);
  logIntegration('twilio', 'connect', 'success', cfg.phone_number, req.user.id);
  audit(req, 'Connected Twilio', 'integration', 'twilio', cfg.phone_number);
  res.json({ ok: true, status: 'connected', info: { number: cfg.phone_number, name: info.friendly_name } });
}));
r.delete('/twilio', can('settings', 'edit'), asyncH((req, res) => { removeIntegration('twilio'); audit(req, 'Disconnected Twilio', 'integration', 'twilio'); res.json({ ok: true }); }));
r.post('/twilio/test', can('settings', 'edit'), asyncH(async (req, res) => {
  const cfg = integrationConfig('twilio');
  if (!cfg) throw bad('Twilio is not connected yet');
  try { await testTwilio(cfg); markTested('twilio', true); res.json({ ok: true }); } catch (e) { markTested('twilio', false, e.message); throw bad(e.message); }
}));

// ---- local voice provider
r.put('/voice_http', can('settings', 'edit'), asyncH(async (req, res) => {
  const prev = integrationConfig('voice_http');
  const body = { ...req.body };
  if (prev && (!body.api_key || /^•/.test(body.api_key))) body.api_key = prev.api_key;
  const cfg = validateVoiceHttp(body);
  let info;
  try { info = await testVoiceHttp(cfg); } catch (e) { logIntegration('voice_http', 'test', 'error', e.message, req.user.id); throw bad(`The provider did not accept the test request: ${e.message}`); }
  saveIntegration('voice_http', cfg, { publicInfo: { endpoint: info.endpoint_host, from: cfg.from_number }, status: 'connected', userId: req.user.id });
  markTested('voice_http', true);
  audit(req, 'Connected voice provider', 'integration', 'voice_http', info.endpoint_host);
  res.json({ ok: true, status: 'connected' });
}));
r.delete('/voice_http', can('settings', 'edit'), asyncH((req, res) => { removeIntegration('voice_http'); audit(req, 'Disconnected voice provider', 'integration', 'voice_http'); res.json({ ok: true }); }));

const activeVoice = () => (integrationRow('twilio')?.status === 'connected' ? 'twilio' : integrationRow('voice_http')?.status === 'connected' ? 'voice_http' : null);

// ---- "Call next": who to call now, and why
export function callQueue(user, limit = 15) {
  const own = user.own_scope ? ' AND c.agent_id=?' : '';
  const rows = all(`SELECT c.id, c.full_name, c.phone, c.alt_phone, c.whatsapp, c.followup_date, c.priority, c.created_at, c.last_activity_at, c.is_customer, c.budget,
      (SELECT MAX(started_at) FROM calls k WHERE k.contact_id=c.id) AS last_call, (SELECT COUNT(*) FROM calls k WHERE k.contact_id=c.id) AS call_count,
      (SELECT 1 FROM calls k WHERE k.contact_id=c.id AND k.outcome='do_not_call' LIMIT 1) AS dnc
    FROM contacts c WHERE (c.phone IS NOT NULL AND c.phone<>'')${own} LIMIT 500`, ...(user.own_scope ? [user.id] : []));
  const t = today();
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const fourHoursAgo = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const out = [];
  for (const c of rows) {
    if (c.dnc) continue;
    if (c.last_call && c.last_call > fourHoursAgo.replace('T', ' ') && c.last_call.slice(0, 10) === t) continue; // just called
    let score = 0; const why = [];
    if (c.followup_date) {
      const d = daysBetween(c.followup_date, t);
      if (d > 0) { score += 100 + Math.min(d, 30); why.push(`Follow-up was due ${d} day${d === 1 ? '' : 's'} ago`); }
      else if (d === 0) { score += 80; why.push('Follow-up is due today'); }
    }
    const age = daysBetween(c.created_at.slice(0, 10), t);
    if (!c.call_count && age <= 3) { score += 60; why.push('New lead, not called yet'); }
    else if (!c.call_count) { score += 25; why.push('Never called'); }
    if (c.priority === 'High') { score += 20; why.push('High priority'); }
    const quiet = c.last_activity_at ? daysBetween(c.last_activity_at.slice(0, 10), t) : age;
    if (quiet >= 7 && !c.is_customer) { score += 10 + Math.min(quiet, 30) / 3; why.push(`No contact for ${quiet} days`); }
    if (c.is_customer) score -= 15;
    if (score > 0) out.push({ id: c.id, name: c.full_name, phone: c.phone, score: Math.round(score), reason: why.slice(0, 2).join(' · '), priority: c.priority, followup_date: c.followup_date, last_call: c.last_call });
  }
  return out.sort((a, b) => b.score - a.score || a.id - b.id).slice(0, limit);
}
r.get('/dialer/queue', can('crm', 'view'), asyncH((req, res) => {
  res.json({ voice: activeVoice(), queue: callQueue(req.user, Math.min(50, Number(req.query.limit) || 15)) });
}));

// ---- call settings, scripts, statistics, recordings
r.get('/calls-settings', can('crm', 'view'), (_req, res) => res.json({ ...callSettings(), ai_transcripts: canTranscribe() }));
r.put('/calls-settings', can('settings', 'edit'), asyncH((req, res) => {
  const b = req.body || {};
  // a blank notice falls back to the default wording: recording never starts without one
  const out = saveCallSettings(b); audit(req, out.record ? 'Turned call recording on' : 'Turned call recording off', 'integration', 'calls'); res.json(out);
}));
r.get('/scripts', can('crm', 'view'), (req, res) => { ensureStarterScript(req.user.id); res.json(listScripts()); });
r.post('/scripts', can('settings', 'edit'), asyncH((req, res) => {
  const name = String(req.body?.name || '').trim(), body = String(req.body?.body || '').trim();
  if (!name || !body) throw bad('Give the script a name and some text.');
  const id = Number(run('INSERT INTO call_scripts(name, body, kind, created_by, created_at) VALUES(?,?,?,?,?)', name.slice(0, 120), body.slice(0, 6000), req.body?.kind === 'meeting' ? 'meeting' : 'call', req.user.id, now()).lastInsertRowid);
  res.status(201).json(get('SELECT * FROM call_scripts WHERE id=?', id));
}));
r.put('/scripts/:id', can('settings', 'edit'), asyncH((req, res) => {
  const s0 = get('SELECT * FROM call_scripts WHERE id=?', Number(req.params.id));
  if (!s0) throw notFound('Script not found');
  run('UPDATE call_scripts SET name=?, body=?, updated_at=? WHERE id=?', String(req.body?.name ?? s0.name).trim().slice(0, 120), String(req.body?.body ?? s0.body).slice(0, 6000), now(), s0.id);
  res.json(get('SELECT * FROM call_scripts WHERE id=?', s0.id));
}));
r.delete('/scripts/:id', can('settings', 'edit'), asyncH((req, res) => { run('UPDATE call_scripts SET active=0 WHERE id=?', Number(req.params.id)); res.json({ ok: true }); }));
r.get('/scripts/:id/render', can('crm', 'view'), asyncH((req, res) => {
  const c = req.query.contact_id ? get('SELECT full_name FROM contacts WHERE id=?', Number(req.query.contact_id)) : null;
  const out = renderScript(Number(req.params.id), { contact: c, agent: req.user, company: getSetting('company_name', '') });
  if (!out) throw notFound('Script not found');
  res.json(out);
}));
r.get('/dialer/stats', can('crm', 'view'), (req, res) => res.json(callStats(req.user, String(req.query.range || '7d'))));
r.get('/recordings/calls', can('crm', 'view'), (req, res) => {
  const own = req.user.own_scope ? ' AND k.user_id=?' : '';
  const f = recordingFilter(req.query, {
    text: ['r.transcript', 'k.notes', 'k.outcome', 'c.full_name', 'k.to_number'],
    customer: ['c.full_name', 'c.phone', 'c.email', 'k.to_number', 'k.from_number'],
    host: ['u.name'], when: 'r.created_at', transcript: 'r.transcript_status', seconds: 'r.duration',
  });
  res.json(all(`SELECT r.id, r.call_id, r.duration, r.size, r.transcript_status, r.error, r.created_at, (r.path IS NOT NULL) AS has_audio, substr(r.transcript,1,300) AS excerpt, k.to_number, c.full_name AS contact_name, u.name AS agent_name
    FROM call_recordings r JOIN calls k ON k.id=r.call_id LEFT JOIN contacts c ON c.id=k.contact_id LEFT JOIN users u ON u.id=k.user_id WHERE 1=1${own}${f.sql} ORDER BY r.id DESC LIMIT 200`, ...(req.user.own_scope ? [req.user.id] : []), ...f.params));
});
const recFor = (req) => {
  const rec = get('SELECT r.*, k.user_id FROM call_recordings r JOIN calls k ON k.id=r.call_id WHERE r.id=?', Number(req.params.id));
  if (!rec) throw notFound('Recording not found');
  if (req.user.own_scope && rec.user_id !== req.user.id) throw forbidden('This is not your call');
  return rec;
};
r.get('/recordings/calls/:id', can('crm', 'view'), asyncH((req, res) => { const rec = recFor(req); res.json({ ...rec, path: undefined, remote_url: undefined, has_audio: !!rec.path }); }));
r.get('/recordings/calls/:id/audio', can('crm', 'view'), asyncH((req, res) => { const rec = recFor(req); if (!rec.path) throw notFound('The audio is not available yet'); audit(req, 'Played call recording', 'call', rec.call_id); res.type('audio/mpeg').sendFile(recordingFile(rec.path)); }));
r.post('/recordings/calls/:id/transcribe', can('crm', 'edit'), asyncH(async (req, res) => { const rec = recFor(req); try { await transcribeRecording(rec.id); } catch (e) { throw bad(e.message); } res.json(get('SELECT transcript, transcript_status FROM call_recordings WHERE id=?', rec.id)); }));

// ---- AI providers (the workspace's own ChatGPT / Claude key)
r.get('/ai', can('crm', 'view'), (_req, res) => res.json({ providers: Object.entries(AI_PROVIDERS).map(([id, p]) => ({ id, label: p.label, key_url: p.key_url, key_hint: p.key_hint, default_model: p.default_model, custom: !!p.custom, status: aiStatus(id) })), default: getSetting('ai_default', null), share_names: getSetting('ai_share_names', '0') === '1', active: activeProvider(getSetting('ai_default', null)) }));
r.put('/ai/:provider', can('settings', 'edit'), asyncH(async (req, res) => { await connectAi(req.params.provider, req.body || {}, req.user.id); audit(req, 'Connected AI provider', 'integration', req.params.provider); res.json({ ok: true }); }));
r.delete('/ai/:provider', can('settings', 'edit'), asyncH((req, res) => { removeIntegration(`ai_${req.params.provider}`); audit(req, 'Disconnected AI provider', 'integration', req.params.provider); res.json({ ok: true }); }));
r.put('/ai-settings', can('settings', 'edit'), asyncH((req, res) => { if (req.body?.default !== undefined) setSetting('ai_default', Object.keys(AI_PROVIDERS).includes(req.body.default) ? req.body.default : null); if (req.body?.share_names !== undefined) setSetting('ai_share_names', req.body.share_names ? '1' : '0'); res.json({ ok: true }); }));

// ---- ask the AI about your own data; write promotional video scripts; keep the rendered videos
r.post('/ai/ask', can('crm', 'view'), asyncH(async (req, res) => {
  const provider = activeProvider(getSetting('ai_default', null));
  if (!provider) throw bad('Connect ChatGPT or Claude in Settings > Integrations first.');
  const question = String(req.body?.question || '').trim().slice(0, 600);
  if (!question) throw bad('Ask a question about your sales, leads, calls or listings.');
  const history = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-6).filter((m) => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  try {
    const out = await runWithTools(provider, { system: systemPrompt(getSetting('company_name', '')), question, history, tools: toolsFor(req.user, { shareNames: getSetting('ai_share_names', '0') === '1' }) });
    audit(req, 'Asked the AI assistant', 'assistant', null, question.slice(0, 120));
    res.json({ ...out, provider });
  } catch (e) { throw bad(`The AI could not answer: ${e.message}`); }
}));
r.post('/ai/promo-script', can('content', 'edit'), asyncH(async (req, res) => {
  const provider = activeProvider(getSetting('ai_default', null));
  if (!provider) throw bad('Connect ChatGPT or Claude in Settings > Integrations first.');
  const p = get('SELECT * FROM properties WHERE id=?', Number(req.body?.property_id));
  if (!p) throw notFound('Property not found');
  const feats = (() => { try { return JSON.parse(p.features || '{}'); } catch { return {}; } })();
  const photos = all("SELECT id FROM media WHERE entity_type='property' AND entity_id=? AND kind IN ('cover','gallery')", p.id).length;
  const reg = currentRegion().config;
  const facts = { title: p.title, type: p.property_type, purpose: p.purpose, city: p.city, area_name: p.area_name, price: `${reg.currency} ${(p.net_price / 10 ** reg.money_scale).toLocaleString('en')}`, area: p.area_size ? `${p.area_size} ${p.unit}` : null, bedrooms: feats.bedrooms, bathrooms: feats.bathrooms, description: String(p.description || p.short_desc || '').slice(0, 600) };
  const style = ['friendly', 'luxury', 'urgent', 'family'].includes(req.body?.style) ? req.body.style : 'friendly';
  const lang = ['en', 'fr', 'ar', 'ur'].includes(req.body?.language) ? req.body.language : 'en';
  try {
    const plan = await completeJson(provider, { system: 'You write short promotional videos for real estate listings. Use only the facts given; never invent features, prices, distances or claims. Reply with JSON only.',
      prompt: `Facts: ${JSON.stringify(facts)}\nPhotos available: ${photos}\nTone: ${style}. Language: ${lang}.\nReturn JSON: {"title": string, "scenes": [{"caption": string (max 70 chars), "seconds": number 2-5, "photo": index starting at 0}], "voiceover": string (what a presenter could say, 60-90 words), "call_to_action": string, "hashtags": [string]}. Use 4 to 7 scenes.` });
    const scenes = (plan.scenes || []).slice(0, 8).map((x, i) => ({ caption: String(x.caption || '').slice(0, 90), seconds: Math.min(6, Math.max(2, Number(x.seconds) || 3)), photo: photos ? Math.min(photos - 1, Math.max(0, Number(x.photo) || i % photos)) : 0 }));
    res.json({ title: String(plan.title || p.title).slice(0, 120), scenes, voiceover: String(plan.voiceover || ''), call_to_action: String(plan.call_to_action || ''), hashtags: (plan.hashtags || []).slice(0, 8).map(String), photos, provider });
  } catch (e) { throw bad(`The AI could not write the script: ${e.message}`); }
}));
r.post('/ai/promo-videos', can('content', 'edit'), express.raw({ type: ['video/webm', 'video/mp4', 'application/octet-stream'], limit: '150mb' }), asyncH((req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 1000) throw bad('No video was received.');
  const ext = String(req.get('content-type') || '').includes('mp4') ? 'mp4' : 'webm';
  const pid = req.query.property_id ? Number(req.query.property_id) : null;
  const title = String(req.query.title || 'Promotional video').slice(0, 120);
  const id = Number(run('INSERT INTO promo_videos(property_id, title, script, path, size, duration, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)', pid, title, String(req.query.script || '').slice(0, 2000) || null, 'pending', buf.length, Number(req.query.duration) || null, req.user.id, now()).lastInsertRowid);
  const rel = path.join('media', 'promo', `promo-${id}.${ext}`);
  fs.mkdirSync(path.join(uploadDir(), 'media', 'promo'), { recursive: true });
  fs.writeFileSync(path.join(uploadDir(), rel), buf);
  run('UPDATE promo_videos SET path=? WHERE id=?', rel.split(path.sep).join('/'), id);
  audit(req, 'Saved promotional video', 'promo_video', id, title);
  res.status(201).json({ id, url: `/uploads/${rel.split(path.sep).join('/')}` });
}));
r.get('/ai/promo-videos', can('crm', 'view'), (_req, res) => res.json(all('SELECT id, property_id, title, path, size, duration, created_at FROM promo_videos ORDER BY id DESC LIMIT 100').map((v) => ({ ...v, url: `/uploads/${v.path}` }))));
r.delete('/ai/promo-videos/:id', can('content', 'edit'), asyncH((req, res) => { const v = get('SELECT * FROM promo_videos WHERE id=?', Number(req.params.id)); if (v) { try { fs.rmSync(path.join(uploadDir(), v.path), { force: true }); } catch { /* gone */ } run('DELETE FROM promo_videos WHERE id=?', v.id); } res.json({ ok: true }); }));

// ---- calls
const ownsContact = (req, c) => { if (req.user.own_scope && c.agent_id !== req.user.id) throw forbidden('This contact is not assigned to you'); };
r.post('/calls', can('crm', 'edit'), asyncH(async (req, res) => {
  const provider = activeVoice();
  if (!provider) throw bad('Connect Twilio (or your voice provider) in Settings > Integrations before calling.');
  const c = get('SELECT * FROM contacts WHERE id=?', Number(req.body?.contact_id));
  if (!c) throw notFound('Contact not found');
  ownsContact(req, c);
  if (get("SELECT 1 FROM calls WHERE contact_id=? AND outcome='do_not_call'", c.id)) throw bad('This person asked not to be called. Remove the do-not-call mark first if that has changed.');
  const to = toE164(req.body?.to || c.phone);
  if (!to) throw bad('The contact\'s phone number is not valid for this country. Fix it on the contact page.');
  const agentNumber = toE164(req.body?.agent_number || get('SELECT phone FROM users WHERE id=?', req.user.id)?.phone);
  if (!agentNumber) throw bad('Enter the phone number to ring you on (your own mobile). It can be saved on your profile.');
  const cfg = integrationConfig(provider);
  const id = Number(run('INSERT INTO calls(contact_id, user_id, direction, to_number, from_number, agent_number, provider, status, started_at) VALUES(?,?,?,?,?,?,?,?,?)', c.id, req.user.id, 'outbound', to, cfg.phone_number || cfg.from_number || null, agentNumber, provider, 'queued', now()).lastInsertRowid);
  try {
    const out = provider === 'twilio'
      ? await startBridgeCall(cfg, { agentNumber, bridgeUrl: `${webBase(req)}/api/hooks/twilio/bridge?call=${id}`, statusUrl: `${webBase(req)}/api/hooks/twilio/status?call=${id}` })
      : await startVoiceCall(cfg, { to, agentNumber });
    run('UPDATE calls SET provider_sid=?, status=? WHERE id=?', out.sid, out.status, id);
  } catch (e) {
    run("UPDATE calls SET status='failed', notes=? WHERE id=?", String(e.message).slice(0, 300), id);
    logIntegration(provider, 'call', 'error', e.message, req.user.id);
    throw bad(`The call could not be started: ${e.message}`);
  }
  activity(c.id, req.user, 'Call started', { detail: `To ${to}`, entityType: 'call', entityId: id });
  res.status(201).json({ id, status: 'queued', message: `Ringing ${agentNumber} first. Answer it and we connect ${c.full_name}.` });
}));
r.get('/calls', can('crm', 'view'), (req, res) => {
  const own = req.user.own_scope ? ' AND k.user_id=?' : '';
  const cid = Number(req.query.contact_id) || 0;
  res.json(all(`SELECT k.*, c.full_name FROM calls k LEFT JOIN contacts c ON c.id=k.contact_id WHERE 1=1${cid ? ' AND k.contact_id=?' : ''}${own} ORDER BY k.id DESC LIMIT 100`, ...(cid ? [cid] : []), ...(req.user.own_scope ? [req.user.id] : [])));
});
const OUTCOMES = ['connected', 'no_answer', 'voicemail', 'wrong_number', 'callback', 'interested', 'not_interested', 'do_not_call'];
r.post('/calls/:id/outcome', can('crm', 'edit'), asyncH((req, res) => {
  const k = get('SELECT * FROM calls WHERE id=?', Number(req.params.id));
  if (!k) throw notFound('Call not found');
  if (req.user.own_scope && k.user_id !== req.user.id) throw forbidden('This is not your call');
  const outcome = String(req.body?.outcome || '');
  if (!OUTCOMES.includes(outcome)) throw bad('Choose how the call went');
  const notes = String(req.body?.notes || '').slice(0, 1000) || null;
  run('UPDATE calls SET outcome=?, notes=COALESCE(?, notes) WHERE id=?', outcome, notes, k.id);
  let follow = null;
  if (['callback', 'no_answer', 'voicemail'].includes(outcome) && k.contact_id) {
    follow = req.body?.followup_date || addDays(today(), outcome === 'callback' ? 1 : 2);
    if (/^\d{4}-\d{2}-\d{2}$/.test(follow)) run('UPDATE contacts SET followup_date=? WHERE id=?', follow, k.contact_id); else follow = null;
  }
  if (outcome === 'do_not_call') audit(req, 'Marked do not call', 'contact', k.contact_id);
  if (k.contact_id) activity(k.contact_id, req.user, `Call: ${outcome.replace(/_/g, ' ')}`, { detail: notes || undefined, entityType: 'call', entityId: k.id });
  res.json({ ok: true, followup_date: follow });
}));

// ---- SMS
r.post('/sms', can('crm', 'edit'), asyncH(async (req, res) => {
  const cfg = integrationConfig('twilio');
  if (!cfg || integrationRow('twilio')?.status !== 'connected') throw bad('Connect Twilio in Settings > Integrations to send text messages.');
  const c = get('SELECT * FROM contacts WHERE id=?', Number(req.body?.contact_id));
  if (!c) throw notFound('Contact not found');
  ownsContact(req, c);
  const body = String(req.body?.body || '').trim();
  if (!body || body.length > 600) throw bad('Write a message of up to 600 characters.');
  if (get("SELECT 1 FROM calls WHERE contact_id=? AND outcome='do_not_call'", c.id)) throw bad('This person asked not to be contacted.');
  const to = toE164(c.phone);
  if (!to) throw bad('The contact\'s phone number is not valid for this country.');
  try {
    const out = await sendSms(cfg, { to, body });
    run('INSERT INTO sms_log(contact_id, user_id, to_number, body, provider, provider_sid, status, created_at) VALUES(?,?,?,?,?,?,?,?)', c.id, req.user.id, to, body, 'twilio', out.sid, out.status, now());
    activity(c.id, req.user, 'Text message sent', { detail: body.slice(0, 120), entityType: 'sms' });
    res.status(201).json({ ok: true });
  } catch (e) {
    run('INSERT INTO sms_log(contact_id, user_id, to_number, body, provider, status, error, created_at) VALUES(?,?,?,?,?,?,?,?)', c.id, req.user.id, to, body, 'twilio', 'failed', String(e.message).slice(0, 300), now());
    throw bad(`The message could not be sent: ${e.message}`);
  }
}));

// ---- connecting accounts with OAuth (Google Calendar, Facebook/Instagram, LinkedIn, TikTok)
const SOCIAL = ['meta', 'linkedin', 'tiktok'];
r.get('/oauth/:provider/start', can('crm', 'view'), asyncH((req, res) => {
  const provider = req.params.provider, purpose = provider === 'google' ? 'calendar' : 'social';
  if (!PROVIDERS[provider] || (provider !== 'google' && !SOCIAL.includes(provider))) throw bad('Unknown provider');
  if (purpose === 'social' && !hasPerm(req.user, 'settings', 'edit')) throw forbidden('Only an administrator can connect social accounts');
  if (!appCreds(provider)) throw bad(`${PROVIDERS[provider].label} is not set up on this platform yet. Ask the platform administrator to add the app credentials.`);
  const origin = webBase(req);
  const state = signState({ purpose, tid: currentTenant().id, uid: req.user.id, origin });
  res.json({ url: authorizeUrl(provider, purpose, { state, redirect: redirectUri(provider, req) }) });
}));
r.delete('/google_calendar', can('crm', 'view'), asyncH((req, res) => { removeIntegration(`google_calendar:${req.user.id}`); res.json({ ok: true }); }));
r.get('/oauth-status', can('crm', 'view'), (req, res) => {
  const row = integrationRow(`google_calendar:${req.user.id}`);
  res.json({ providers: Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, !!appCreds(p)])), google_calendar: row ? { status: row.status, ...JSON.parse(row.public_info || '{}') } : null });
});

// ---- social posting, scheduling and reports
r.get('/social/accounts', can('crm', 'view'), (_req, res) => res.json(listAccounts()));
r.delete('/social/accounts/:id', can('settings', 'edit'), asyncH((req, res) => { removeAccount(Number(req.params.id)); audit(req, 'Disconnected social account', 'integration', req.params.id); res.json({ ok: true }); }));
r.post('/social/posts', can('content', 'edit'), asyncH(async (req, res) => {
  const b = req.body || {};
  if (!String(b.message || '').trim()) throw bad('Write the post.');
  if (b.scheduled_at && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}/.test(b.scheduled_at)) throw bad('Choose a valid date and time to publish.');
  let id;
  try { id = createPost({ ...b, scheduled_at: b.scheduled_at ? String(b.scheduled_at).replace('T', ' ').slice(0, 16) + ':00' : null }, req.user.id); } catch (e) { throw bad(e.message); }
  audit(req, 'Created social post', 'social_post', id);
  if (!b.scheduled_at) await runDuePosts();
  res.status(201).json(get('SELECT * FROM social_posts WHERE id=?', id));
}));
r.post('/social/posts/:id/cancel', can('content', 'edit'), asyncH((req, res) => { run("UPDATE social_posts SET status='canceled' WHERE id=? AND status IN ('scheduled','failed')", Number(req.params.id)); res.json({ ok: true }); }));
r.post('/social/posts/:id/retry', can('content', 'edit'), asyncH(async (req, res) => { run("UPDATE social_posts SET status='scheduled', error=NULL, scheduled_at=NULL WHERE id=? AND status='failed'", Number(req.params.id)); await runDuePosts(); res.json(get('SELECT * FROM social_posts WHERE id=?', Number(req.params.id))); }));
r.get('/social/report', can('crm', 'view'), asyncH(async (req, res) => { if (req.query.refresh === '1') await refreshMetrics(); res.json(socialReport()); }));

// ---- property portals and MLS
const portalInfo = (p, req) => ({ ...p, feed: { xml: `${webBase(req)}/api/hooks/feeds/${p.id}.xml?token=${feedToken()}`, csv: `${webBase(req)}/api/hooks/feeds/${p.id}.csv?token=${feedToken()}`, json: `${webBase(req)}/api/hooks/feeds/${p.id}.json?token=${feedToken()}` },
  published: get("SELECT COUNT(*) n FROM portal_publications WHERE portal=? AND status='published'", p.id).n, api_connected: p.api ? integrationRow(`portal:${p.id}`)?.status === 'connected' : undefined });
r.get('/portals', can('crm', 'view'), (req, res) => res.json({ portals: portalsFor(region().region).map((p) => portalInfo(p, req)) }));
r.post('/portals/rotate-token', can('settings', 'edit'), asyncH((req, res) => { rotateFeedToken(); audit(req, 'Changed portal feed address', 'integration', 'portals'); res.json({ ok: true }); }));
r.get('/portals/readiness/:propertyId', can('properties', 'view'), asyncH((req, res) => {
  const p = get('SELECT * FROM properties WHERE id=?', Number(req.params.propertyId));
  if (!p) throw notFound('Property not found');
  const l = listingFor(p, webBase(req));
  const pubs = Object.fromEntries(publicationsFor(p.id).map((x) => [x.portal, x]));
  res.json(portalsFor(region().region).map((pt) => ({ id: pt.id, name: pt.name, missing: readiness(l, pt), publication: pubs[pt.id] || null })));
}));
r.post('/portals/publish', can('properties', 'edit'), asyncH(async (req, res) => {
  const p = get('SELECT * FROM properties WHERE id=?', Number(req.body?.property_id));
  if (!p) throw notFound('Property not found');
  if (!p.published) throw bad('Publish the listing on your website first; portals only receive published listings.');
  const l = listingFor(p, webBase(req));
  const out = [];
  for (const id of [].concat(req.body?.portals || [])) {
    const pt = portalsFor(region().region).find((x) => x.id === id);
    if (!pt) { out.push({ portal: id, ok: false, error: 'Not available in this country' }); continue; }
    const missing = readiness(l, pt);
    if (missing.length) { out.push({ portal: id, ok: false, error: `Add ${missing.join(', ')} first` }); continue; }
    try {
      const cfg = pt.api ? integrationConfig(`portal:${id}`) : null;
      if (cfg) {
        await assertPublicHttps(cfg.endpoint);
        const resp = await fetch(cfg.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` }, body: JSON.stringify(l), redirect: 'error', signal: AbortSignal.timeout(20_000) });
        if (!resp.ok) throw new Error(`The portal answered ${resp.status}`);
      }
      setPublication(p.id, id, 'published');
      out.push({ portal: id, ok: true, via: cfg ? 'api' : 'feed' });
    } catch (e) { setPublication(p.id, id, 'failed', e.message); out.push({ portal: id, ok: false, error: e.message }); }
  }
  audit(req, 'Published to portals', 'property', p.id, out.filter((x) => x.ok).map((x) => x.portal).join(', '));
  res.json({ results: out });
}));
r.post('/portals/unpublish', can('properties', 'edit'), asyncH((req, res) => { for (const id of [].concat(req.body?.portals || [])) setPublication(Number(req.body.property_id), id, 'withdrawn'); res.json({ ok: true }); }));
r.put('/portals/:id/api', can('settings', 'edit'), asyncH(async (req, res) => {
  const pt = PORTALS.find((x) => x.id === req.params.id && x.api);
  if (!pt) throw notFound('This portal has no API settings');
  const endpoint = await assertPublicHttps(req.body?.endpoint);
  const prev = integrationConfig(`portal:${pt.id}`);
  const token = !req.body?.token || /^•/.test(req.body.token) ? prev?.token : String(req.body.token).trim();
  if (!token) throw bad('Enter the token your board issued.');
  saveIntegration(`portal:${pt.id}`, { endpoint, token }, { publicInfo: { endpoint_host: new URL(endpoint).host }, status: 'connected', userId: req.user.id });
  res.json({ ok: true });
}));
r.delete('/portals/:id/api', can('settings', 'edit'), asyncH((req, res) => { removeIntegration(`portal:${req.params.id}`); res.json({ ok: true }); }));

// ---- your own web address
const freshTenant = () => getTenant(currentTenant().id);
r.get('/domain', can('settings', 'view'), (req, res) => res.json({ base: process.env.ERP_BASE_DOMAIN || null, current: domainRecords(freshTenant(), req) }));
r.put('/domain', can('settings', 'edit'), asyncH((req, res) => { requestDomain(freshTenant(), req.body?.domain); audit(req, 'Added custom domain', 'integration', 'domain', req.body?.domain); res.json({ current: domainRecords(freshTenant(), req) }); }));
r.post('/domain/verify', can('settings', 'edit'), asyncH(async (req, res) => { const out = await verifyDomain(freshTenant()); audit(req, 'Verified custom domain', 'integration', 'domain', out.domain); res.json({ ok: true, current: domainRecords(freshTenant(), req) }); }));
r.delete('/domain', can('settings', 'edit'), asyncH((req, res) => { removeDomain(freshTenant()); audit(req, 'Removed custom domain', 'integration', 'domain'); res.json({ ok: true }); }));

export default r;
export { hasPerm };
