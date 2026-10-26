// Google Calendar for appointments. Each agent connects their own Google account (OAuth, calendar.events scope only);
// appointments created in the CRM are added to that agent's primary calendar and changes follow. A calendar problem never
// blocks saving an appointment: the error is stored on the appointment and shown beside it.
import { get, run } from '../db.js';
import { integrationConfig, saveIntegration, integrationRow } from './store.js';
import { refreshAccessToken } from '../services/oauthApps.js';
import { currentRegion } from '../regions/runtime.js';

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const key = (userId) => `google_calendar:${userId}`;
export const calendarConnected = (userId) => integrationRow(key(userId))?.status === 'connected';

async function accessToken(userId) {
  const cfg = integrationConfig(key(userId));
  if (!cfg) throw new Error('Google Calendar is not connected');
  if (cfg.access_token && cfg.expires_at > Date.now() + 60_000) return cfg.access_token;
  if (!cfg.refresh_token) throw new Error('Google Calendar needs to be connected again');
  const t = await refreshAccessToken('google', cfg.refresh_token);
  saveIntegration(key(userId), { ...cfg, access_token: t.access_token, expires_at: Date.now() + (t.expires_in || 3600) * 1000 }, { publicInfo: JSON.parse(integrationRow(key(userId)).public_info || '{}'), status: 'connected', userId });
  return t.access_token;
}

/** "2026-10-21 15:00:00" in the appointment's own time zone (else the workspace's), as Google wants it. */
const eventTime = (local, tz) => ({ dateTime: String(local).replace(' ', 'T').slice(0, 19), timeZone: tz || currentRegion().config.timezone });
const body = (a) => ({ summary: a.title, location: a.location || undefined, description: a.notes || undefined, start: eventTime(a.starts_at, a.timezone), end: eventTime(a.ends_at, a.timezone) });

async function call(userId, method, id, payload) {
  const token = await accessToken(userId);
  const res = await fetch(id ? `${API}/${encodeURIComponent(id)}` : API, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(15_000) });
  if (method === 'DELETE' && (res.status === 204 || res.status === 410 || res.status === 404)) return {};
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error?.message || `Google answered ${res.status}`);
  return d;
}

/** Brings Google in line with the appointment. Never throws. */
export async function syncAppointment(id) {
  const a = get('SELECT * FROM appointments WHERE id=?', id);
  if (!a || !calendarConnected(a.user_id)) return;
  try {
    if (a.status === 'canceled') { if (a.google_event_id) await call(a.user_id, 'DELETE', a.google_event_id); run('UPDATE appointments SET google_event_id=NULL, sync_error=NULL WHERE id=?', id); return; }
    const ev = a.google_event_id ? await call(a.user_id, 'PATCH', a.google_event_id, body(a)) : await call(a.user_id, 'POST', null, body(a));
    run('UPDATE appointments SET google_event_id=?, sync_error=NULL WHERE id=?', ev.id, id);
  } catch (e) { run('UPDATE appointments SET sync_error=? WHERE id=?', String(e.message).slice(0, 250), id); }
}
