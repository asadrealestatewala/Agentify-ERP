// Events sent to a website or automation tool that subscribed through the Integration API.
// Every delivery is signed (Agentify-Signature: t=<unix>,v1=<HMAC-SHA256 of "t.body"> with the subscription's secret), carries a
// stable Agentify-Event-Id so the receiver can ignore repeats, goes only to public https addresses (checked again at every attempt,
// redirects are not followed) and is retried about 1 min, 5 min, 30 min, 2 h and 12 h later before it is marked failed.
import crypto from 'node:crypto';
import { all, get, run } from '../db.js';
import { HttpError, bad, jparse, now } from '../util.js';
import { encrypt, decrypt } from './platformConfig.js';
import { assertPublicHttps } from './integrations.js';
import { signWebhook, publicProperty } from './website.js';
import { record } from './connections.js';
import { on } from './events.js';

export const EVENTS = {
  'listing.published': 'A listing appears on the website',
  'listing.updated': 'A listing on the website changes (price, status, featured, details)',
  'listing.unpublished': 'A listing is taken off the website',
  'project.updated': 'A project shown on the website changes',
  'lead.created': 'A new lead arrives (no personal details are sent; the lead reference is)',
};
const RETRY_MINUTES = [1, 5, 30, 120, 720]; // after the 1st..5th failed attempt; the 6th failure is final
const KEEP_DAYS = 30;
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();

export function createSubscription(connectionId, { url, events }) {
  const list = [...new Set((Array.isArray(events) && events.length ? events : Object.keys(EVENTS)).map(String))];
  const unknown = list.find((e) => !EVENTS[e]);
  if (unknown) throw bad(`Unknown event: ${unknown}`);
  if (all('SELECT id FROM webhook_subscriptions WHERE connection_id=? AND active=1', connectionId).length >= 10) throw bad('A connection can have at most 10 subscriptions');
  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const id = Number(run('INSERT INTO webhook_subscriptions(connection_id,url,events,secret_enc,created_at) VALUES(?,?,?,?,?)', connectionId, String(url || '').trim().slice(0, 500), JSON.stringify(list), encrypt(secret), now()).lastInsertRowid);
  return { id, secret };
}
/** Checks the address is a real public https URL before it is saved (and again at every delivery). */
export async function checkUrl(url) { return assertPublicHttps(String(url || '').trim()); }

const sub = (r) => r && ({ id: r.id, url: r.url, events: jparse(r.events, []), active: !!r.active, created_at: r.created_at, last_success_at: r.last_success_at, last_error: r.last_error, last_error_at: r.last_error_at });
export const listSubscriptions = (connectionId) => all('SELECT * FROM webhook_subscriptions WHERE connection_id=? AND active=1 ORDER BY id', connectionId).map(sub);
export function removeSubscription(connectionId, id) {
  const r = run('UPDATE webhook_subscriptions SET active=0 WHERE id=? AND connection_id=? AND active=1', id, connectionId);
  if (!r.changes) throw new HttpError(404, 'Subscription not found');
  run("UPDATE webhook_deliveries SET status='cancelled' WHERE subscription_id=? AND status='pending'", id);
}

/** Queue an event for every active subscription of an active connection that asked for it, and try right away. */
export function emit(event, data) {
  const subs = all("SELECT s.* FROM webhook_subscriptions s JOIN integration_connections c ON c.id=s.connection_id WHERE s.active=1 AND c.status='active'")
    .filter((s) => jparse(s.events, []).includes(event));
  for (const s of subs) {
    const eventId = crypto.randomUUID();
    const payload = JSON.stringify({ id: eventId, type: event, created_at: iso(), data });
    const id = Number(run('INSERT INTO webhook_deliveries(subscription_id,event,event_id,payload,next_attempt_at,created_at) VALUES(?,?,?,?,?,?)', s.id, event, eventId, payload, iso(), now()).lastInsertRowid);
    deliver(id).catch(() => { /* recorded on the delivery; the retry job picks it up */ });
  }
  return subs.length;
}

export async function deliver(deliveryId) {
  const d = get("SELECT d.*, s.url, s.secret_enc, s.connection_id, s.active FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id=d.subscription_id WHERE d.id=? AND d.status IN ('pending','failed')", deliveryId);
  if (!d) return null;
  if (!d.active) { run("UPDATE webhook_deliveries SET status='cancelled' WHERE id=?", deliveryId); return null; }
  const attempt = d.attempts + 1;
  let status = null, error = null, gone = false;
  try {
    const safe = await assertPublicHttps(d.url);
    const headers = { 'Content-Type': 'application/json', 'X-Agentify-Event': d.event, 'Agentify-Delivery-Attempt': String(attempt), ...signWebhook(d.payload, decrypt(d.secret_enc)), 'Agentify-Event-Id': d.event_id };
    const res = await fetch(safe, { method: 'POST', headers, body: d.payload, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    status = res.status;
    if (!(res.status >= 200 && res.status < 300)) { error = `HTTP ${res.status}`; gone = res.status === 410; }
  } catch (e) { error = String(e.message || e).slice(0, 200); }
  if (!error) {
    run("UPDATE webhook_deliveries SET status='delivered', attempts=?, last_status=?, last_error=NULL, delivered_at=?, next_attempt_at=NULL WHERE id=?", attempt, status, now(), deliveryId);
    run('UPDATE webhook_subscriptions SET last_success_at=?, last_error=NULL WHERE id=?', now(), d.subscription_id);
    return true;
  }
  const wait = RETRY_MINUTES[attempt - 1];
  const final = gone || wait === undefined;
  run('UPDATE webhook_deliveries SET status=?, attempts=?, last_status=?, last_error=?, next_attempt_at=? WHERE id=?', final ? 'failed' : 'pending', attempt, status, error, final ? null : iso(wait * 60_000), deliveryId);
  run('UPDATE webhook_subscriptions SET last_error=?, last_error_at=? WHERE id=?', error, now(), d.subscription_id);
  if (gone) { run('UPDATE webhook_subscriptions SET active=0 WHERE id=?', d.subscription_id); record(d.connection_id, 'webhook', 'error', `Subscription ${d.subscription_id} ended: the receiver answered 410 Gone`); }
  else if (final) record(d.connection_id, 'webhook', 'error', `${d.event} could not be delivered after ${attempt} attempts (${error})`);
  return false;
}

/** The retry job (every minute, every workspace). */
export async function runDueDeliveries() {
  const due = all("SELECT id FROM webhook_deliveries WHERE status='pending' AND next_attempt_at <= ? ORDER BY id LIMIT 50", iso());
  for (const d of due) { try { await deliver(d.id); } catch (e) { console.error('[webhooks]', e.message); } }
  if (Math.random() < 0.05) run("DELETE FROM webhook_deliveries WHERE created_at < ?", new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10));
}

/** A failed delivery sent again by hand ("Retry" in the health dashboard). */
export async function retryDelivery(connectionId, id) {
  const d = get("SELECT d.id FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id=d.subscription_id WHERE d.id=? AND s.connection_id=? AND d.status='failed'", id, connectionId);
  if (!d) throw new HttpError(404, 'No failed delivery with that number');
  run("UPDATE webhook_deliveries SET status='pending', attempts=0 WHERE id=?", id);
  return deliver(id);
}
export const deliveries = (connectionId, limit = 50) => all(`SELECT d.id, d.event, d.event_id, d.status, d.attempts, d.last_status, d.last_error, d.created_at, d.delivered_at, d.next_attempt_at, s.url
  FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id=d.subscription_id WHERE s.connection_id=? ORDER BY d.id DESC LIMIT ?`, connectionId, limit);

// ---- what the ERP emits (called from the places that already fire the old website webhook, and from lead intake)
const LISTING_EVENT = { 'property.published': 'listing.published', 'property.available': 'listing.published', 'property.hidden': 'listing.unpublished' };
export function emitListing(propertyId, legacyEvent) {
  const event = LISTING_EVENT[legacyEvent] || 'listing.updated';
  const p = get('SELECT * FROM properties WHERE id=?', propertyId);
  if (!p) return;
  if (event === 'listing.unpublished') return emit(event, { listing: { id: p.id } });
  if (!(p.published && ['available', 'featured', 'reserved', 'sold'].includes(p.status))) return; // nothing public changed
  emit(event, { listing: publicProperty(p, { full: false }) });
}
export function emitProject(projectId) {
  const p = get('SELECT id,name,site_visible FROM projects WHERE id=?', projectId);
  if (p) emit('project.updated', { project: p.site_visible ? { id: p.id, name: p.name, visible: true } : { id: p.id, visible: false } });
}
export const emitLead = (leadRef, enquiryType, test) => emit('lead.created', { lead_ref: leadRef, enquiry_type: enquiryType, test: !!test });

on('listing', emitListing);
on('project', emitProject);
on('lead', emitLead);
