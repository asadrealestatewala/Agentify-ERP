// Website integrations: one connection per website or plugin, each with its own key and its own list of things it may do.
// A key looks like agf_<connection id>_<secret>. Only a hash of the secret is stored, so the key is shown once when it is
// made (or rotated). Rotating keeps the old key working for a day so a website can be updated without downtime.
import crypto from 'node:crypto';
import { all, get, run } from '../db.js';
import { HttpError, bad, jparse, now } from '../util.js';

export const SCOPES = {
  'leads:write': 'Send enquiries and leads into the CRM',
  'listings:read': 'Read published listings',
  'projects:read': 'Read projects that are shown on the website',
  'agents:read': 'Read agent cards (only when the website shows agents)',
  'webhooks:manage': 'Subscribe to events (new listings, new leads)',
};
export const PLATFORMS = ['wordpress', 'custom', 'webflow', 'wix', 'squarespace', 'zapier', 'other'];
const ROTATE_OVERLAP_MS = 24 * 3600 * 1000;
const EVENT_DAYS = 90;

const utc = () => new Date().toISOString(); // expiry times are real instants; now() is a wall-clock string in the workspace's time zone
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const secret = () => crypto.randomBytes(32).toString('base64url');

/** Mapping and routing a connection applies to the leads it sends (set in the wizard). Unknown keys are dropped. */
export function cleanConfig(c = {}) {
  const out = {};
  const label = String(c.lead_source ?? '').trim().slice(0, 60);
  out.lead_source = label || 'Website';
  if (c.stage_id) { const id = Number(c.stage_id); if (!get("SELECT 1 FROM lookups WHERE id=? AND type='lead_stage' AND active=1", id)) throw bad('That pipeline stage does not exist'); out.stage_id = id; }
  if (c.agent_id) { const id = Number(c.agent_id); if (!get('SELECT 1 FROM users WHERE id=? AND active=1', id)) throw bad('That agent does not exist'); out.agent_id = id; }
  out.listings = ['all', 'featured', 'projects'].includes(c.listings) ? c.listings : 'all';
  if (out.listings === 'projects') {
    out.project_ids = [...new Set((Array.isArray(c.project_ids) ? c.project_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
    if (!out.project_ids.length) throw bad('Choose at least one project, or show all listings');
  }
  if (c.require_privacy_consent) out.require_privacy_consent = true;
  return out;
}
function cleanScopes(list) {
  const s = [...new Set((Array.isArray(list) ? list : []).map(String))];
  if (!s.length) throw bad('Choose at least one thing this connection may do');
  const unknown = s.find((x) => !SCOPES[x]);
  if (unknown) throw bad(`Unknown permission: ${unknown}`);
  return s;
}

const view = (r) => r && ({
  id: r.id, name: r.name, platform: r.platform, scopes: jparse(r.scopes, []), config: jparse(r.config, {}), status: r.status,
  key_hint: r.key_hint, created_at: r.created_at, last_used_at: r.last_used_at, last_success_at: r.last_success_at,
  last_error: r.last_error, last_error_at: r.last_error_at, revoked_at: r.revoked_at,
  rotating_until: r.prev_key_hash && r.prev_key_until > utc() ? r.prev_key_until : null,
});

export const listConnections = () => all('SELECT * FROM integration_connections ORDER BY id DESC').map(view);
export const getConnection = (id) => view(get('SELECT * FROM integration_connections WHERE id=?', id));

function requireRow(id) {
  const r = get('SELECT * FROM integration_connections WHERE id=?', id);
  if (!r) throw new HttpError(404, 'Connection not found');
  return r;
}

/** Make a connection. Returns the connection and its key; the key cannot be read again. */
export function createConnection({ name, platform, scopes, config }, userId) {
  const n = String(name || '').trim().slice(0, 80);
  if (!n) throw bad('Give the connection a name, for example "Main website"');
  const p = PLATFORMS.includes(platform) ? platform : 'custom';
  const sec = secret();
  const id = Number(run('INSERT INTO integration_connections(name,platform,scopes,config,key_hash,key_hint,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
    n, p, JSON.stringify(cleanScopes(scopes)), JSON.stringify(cleanConfig(config)), sha(sec), sec.slice(-4), userId ?? null, now()).lastInsertRowid);
  record(id, 'created', 'success', `${p} connection created`);
  return { connection: getConnection(id), key: `agf_${id}_${sec}` };
}

export function updateConnection(id, b) {
  const r = requireRow(id);
  if (r.status === 'revoked') throw bad('This connection was disconnected. Create a new one.');
  run('UPDATE integration_connections SET name=?, scopes=?, config=? WHERE id=?',
    b.name === undefined ? r.name : String(b.name).trim().slice(0, 80) || r.name,
    b.scopes === undefined ? r.scopes : JSON.stringify(cleanScopes(b.scopes)),
    b.config === undefined ? r.config : JSON.stringify(cleanConfig(b.config)), id);
  return getConnection(id);
}

/** A new key; the old one keeps working for 24 hours so the website can be updated first. */
export function rotateKey(id) {
  const r = requireRow(id);
  if (r.status === 'revoked') throw bad('This connection was disconnected. Create a new one.');
  const sec = secret();
  run('UPDATE integration_connections SET key_hash=?, key_hint=?, prev_key_hash=?, prev_key_until=? WHERE id=?', sha(sec), sec.slice(-4), r.key_hash, new Date(Date.now() + ROTATE_OVERLAP_MS).toISOString(), id);
  record(id, 'key_rotated', 'success', 'New key issued; the old key works for 24 hours');
  return { connection: getConnection(id), key: `agf_${id}_${sec}` };
}

/** Disconnect: the key stops working at once. Leads it already sent stay in the CRM. */
export function revokeConnection(id) {
  const r = requireRow(id);
  run("UPDATE integration_connections SET status='revoked', revoked_at=?, key_hash=?, prev_key_hash=NULL, prev_key_until=NULL WHERE id=?", now(), `revoked:${crypto.randomBytes(8).toString('hex')}`, id);
  record(id, 'revoked', 'success', `${r.name} disconnected`);
  return getConnection(id);
}

/** Resolve "Bearer agf_<id>_<secret>" to an active connection, or throw 401. Never reads the key from the address. */
export function authenticate(header) {
  const m = /^Bearer\s+agf_(\d{1,9})_([A-Za-z0-9_-]{43})\s*$/.exec(String(header || ''));
  if (!m) throw new HttpError(401, 'Send your key as: Authorization: Bearer agf_...', { code: 'invalid_key' });
  const r = get('SELECT * FROM integration_connections WHERE id=?', Number(m[1]));
  const h = sha(m[2]);
  const current = r && same(r.key_hash, h);
  const previous = r && !current && r.prev_key_hash && r.prev_key_until > utc() && same(r.prev_key_hash, h);
  if (!current && !previous) throw new HttpError(401, 'This key is not valid. It may have been rotated or disconnected.', { code: 'invalid_key' });
  if (r.status !== 'active') throw new HttpError(401, 'This connection is disconnected.', { code: 'invalid_key' });
  return { ...view(r), via_previous_key: !!previous };
}

const minute = (ts) => (ts || '').slice(0, 16);
/** Called after each authenticated request: last-used time (at most once a minute) and the outcome of the last call. */
export function touch(conn, ok, error) {
  const t = now();
  if (ok && minute(conn.last_success_at) !== minute(t)) run('UPDATE integration_connections SET last_used_at=?, last_success_at=? WHERE id=?', t, t, conn.id);
  else if (!ok && error) run('UPDATE integration_connections SET last_used_at=?, last_error=?, last_error_at=? WHERE id=?', t, String(error).slice(0, 200), t, conn.id);
}

/** Metadata only (no message text, no phone numbers or e-mail addresses). Kept 90 days. */
export function record(connectionId, event, outcome, detail = null) {
  run('INSERT INTO connection_events(connection_id,event,outcome,detail,created_at) VALUES(?,?,?,?,?)', connectionId, event, outcome, detail ? String(detail).slice(0, 300) : null, now());
  if (Math.random() < 0.02) run("DELETE FROM connection_events WHERE created_at < ?", new Date(Date.now() - EVENT_DAYS * 864e5).toISOString().slice(0, 10));
}
export const events = (id, limit = 30) => all('SELECT event,outcome,detail,created_at FROM connection_events WHERE connection_id=? ORDER BY id DESC LIMIT ?', id, limit);
