// Public web hooks that providers call (no sign-in): Twilio asks what to do when the agent picks up, and reports call
// progress. Every request is checked against Twilio's signature using the workspace's own Auth Token, so a stranger who
// guesses the address cannot start calls or change records.
import express, { Router } from 'express';
import { get, run } from '../db.js';
import { now } from '../util.js';
import { integrationConfig } from './store.js';
import { bridgeTwiml, verifyTwilioSignature } from './twilio.js';
import { PORTALS, feedToken, publishedListings, feedXml, feedCsv } from './portals.js';
import crypto from 'node:crypto';
import { callSettings, addRecording, fetchRecording } from './calls.js';
import { handleWebhook, settle } from '../services/gateways.js';

function asyncSafe(fn) { return (req, res) => fn(req, res).catch(() => res.sendStatus(500)); }
const r = Router();
/** Online payments: the provider calls this when a customer pays; we then ask the provider (not the caller) what happened. */
r.post('/pay/:provider', asyncSafe(async (req, res) => { const out = await handleWebhook(req.params.provider, req); res.sendStatus(out.status); }));
/** Where the provider sends the customer's browser back to. It only prompts a check with the provider; it never marks anything paid by itself. */
r.get('/pay/return/:provider/:token', asyncSafe(async (req, res) => {
  const token = String(req.params.token).replace(/[^a-f0-9]/g, '');
  try { await settle(token); } catch { /* the portal keeps showing "confirming" and the webhook will retry */ }
  res.redirect(`/portal/payments?gw=${token}`);
}));
r.use(express.urlencoded({ extended: false, limit: '100kb' }));

function verified(req) {
  const cfg = integrationConfig('twilio');
  if (!cfg) return null;
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  return verifyTwilioSignature(cfg.auth_token, url, req.body || {}, req.get('X-Twilio-Signature')) ? cfg : null;
}

r.post('/twilio/bridge', (req, res) => {
  const cfg = verified(req);
  if (!cfg) return res.status(403).type('text/plain').send('Invalid signature');
  const call = get('SELECT * FROM calls WHERE id=?', Number(req.query.call));
  if (!call || call.provider !== 'twilio') return res.status(404).type('text/plain').send('Unknown call');
  const set = callSettings();
  res.type('text/xml').send(bridgeTwiml({ leadNumber: call.to_number, callerId: cfg.phone_number, record: set.record, announcement: set.announcement, recordingCallback: `${req.protocol}://${req.get('host')}/api/hooks/twilio/recording?call=${call.id}` }));
});

const MAP = { queued: 'queued', initiated: 'queued', ringing: 'ringing', 'in-progress': 'in_progress', completed: 'completed', busy: 'busy', failed: 'failed', 'no-answer': 'no_answer', canceled: 'canceled' };
r.post('/twilio/status', (req, res) => {
  if (!verified(req)) return res.status(403).type('text/plain').send('Invalid signature');
  const id = Number(req.query.call);
  const status = MAP[String(req.body?.CallStatus || '')] || null;
  if (get('SELECT 1 FROM calls WHERE id=?', id) && status) {
    const done = ['completed', 'busy', 'failed', 'no_answer', 'canceled'].includes(status);
    run('UPDATE calls SET status=?, duration=COALESCE(?, duration), ended_at=CASE WHEN ? THEN ? ELSE ended_at END WHERE id=?', status, req.body?.CallDuration ? Number(req.body.CallDuration) : null, done ? 1 : 0, now(), id);
  }
  res.sendStatus(204);
});
/** Twilio tells us a recording is ready: store it, then download the audio and transcribe it in the background. */
r.post('/twilio/recording', (req, res) => {
  if (!verified(req)) return res.status(403).type('text/plain').send('Invalid signature');
  const id = Number(req.query.call);
  if (get('SELECT 1 FROM calls WHERE id=?', id) && req.body?.RecordingStatus === 'completed' && req.body.RecordingSid && !get('SELECT 1 FROM call_recordings WHERE provider_sid=?', req.body.RecordingSid)) {
    const rid = addRecording(id, { sid: req.body.RecordingSid, url: String(req.body.RecordingUrl || ''), duration: req.body.RecordingDuration });
    fetchRecording(rid).catch(() => {});
  }
  res.sendStatus(204);
});

/** Listing feeds for portals: /api/hooks/feeds/<portal>.<xml|csv|json>?token=... */
r.get('/feeds/:portal.:fmt', (req, res) => {
  const pt = PORTALS.find((p) => p.id === req.params.portal);
  const given = Buffer.from(String(req.query.token || '')), want = Buffer.from(feedToken());
  if (!pt || given.length !== want.length || !crypto.timingSafeEqual(given, want)) return res.status(404).type('text/plain').send('Not found');
  const base = `${req.protocol}://${req.get('host')}`;
  const list = publishedListings(pt.id, base);
  if (req.params.fmt === 'xml') return res.type('application/xml').send(feedXml(pt.id, list));
  if (req.params.fmt === 'csv') return res.type('text/csv').send(feedCsv(list));
  if (req.params.fmt === 'json') return res.json({ portal: pt.id, listings: list });
  return res.status(404).type('text/plain').send('Not found');
});
export default r;
