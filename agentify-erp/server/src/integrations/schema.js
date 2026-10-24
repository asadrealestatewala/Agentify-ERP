// Workspace-database tables for integrations, calls and text messages (see store.js). No imports: db.js loads this.
export const INTEGRATIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS tenant_integrations(
  provider TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'configured', config_enc TEXT, public_info TEXT, connected_by INTEGER, connected_at TEXT, last_test_at TEXT, last_error TEXT);
CREATE TABLE IF NOT EXISTS integration_log(
  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT, user_id INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS calls(
  id INTEGER PRIMARY KEY, contact_id INTEGER, user_id INTEGER, direction TEXT NOT NULL DEFAULT 'outbound', to_number TEXT, from_number TEXT, agent_number TEXT,
  provider TEXT NOT NULL, provider_sid TEXT, status TEXT NOT NULL DEFAULT 'queued', duration INTEGER, outcome TEXT, notes TEXT, started_at TEXT NOT NULL, ended_at TEXT);
CREATE INDEX IF NOT EXISTS idx_calls_contact ON calls(contact_id);
CREATE TABLE IF NOT EXISTS sms_log(
  id INTEGER PRIMARY KEY, contact_id INTEGER, user_id INTEGER, to_number TEXT, body TEXT, provider TEXT NOT NULL, provider_sid TEXT, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS appointments(
  id INTEGER PRIMARY KEY, contact_id INTEGER, property_id INTEGER, user_id INTEGER NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'viewing', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  location TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'scheduled', google_event_id TEXT, sync_error TEXT, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id, starts_at);
CREATE TABLE IF NOT EXISTS social_connections(
  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, external_id TEXT NOT NULL, name TEXT, token_enc TEXT NOT NULL, meta TEXT, connected_by INTEGER, connected_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'connected', UNIQUE(provider, external_id));
CREATE TABLE IF NOT EXISTS social_posts(
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, message TEXT NOT NULL, media_url TEXT, link TEXT, property_id INTEGER, scheduled_at TEXT, status TEXT NOT NULL DEFAULT 'scheduled', external_post_id TEXT, error TEXT, published_at TEXT, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_social_posts_due ON social_posts(status, scheduled_at);
CREATE TABLE IF NOT EXISTS social_metrics(
  post_id INTEGER PRIMARY KEY, fetched_at TEXT NOT NULL, impressions INTEGER, reach INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, clicks INTEGER);
CREATE TABLE IF NOT EXISTS portal_publications(
  id INTEGER PRIMARY KEY, property_id INTEGER NOT NULL, portal TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', external_id TEXT, error TEXT, published_at TEXT, updated_at TEXT NOT NULL, UNIQUE(property_id, portal));

CREATE TABLE IF NOT EXISTS call_scripts(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'call', active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS call_recordings(
  id INTEGER PRIMARY KEY, call_id INTEGER NOT NULL, provider_sid TEXT, remote_url TEXT, duration INTEGER, path TEXT, size INTEGER, transcript TEXT, transcript_status TEXT NOT NULL DEFAULT 'none', error TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_call_recordings_call ON call_recordings(call_id);
CREATE TABLE IF NOT EXISTS meetings(
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT, host_user_id INTEGER NOT NULL, contact_id INTEGER, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, max_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', record INTEGER NOT NULL DEFAULT 0, transcribe INTEGER NOT NULL DEFAULT 1, script_id INTEGER, allow_guests INTEGER NOT NULL DEFAULT 1, started_at TEXT, ended_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_meetings_start ON meetings(starts_at);
CREATE TABLE IF NOT EXISTS meeting_invites(
  id INTEGER PRIMARY KEY, meeting_id INTEGER NOT NULL, kind TEXT NOT NULL, user_id INTEGER, contact_id INTEGER, name TEXT, email TEXT, phone TEXT, token TEXT NOT NULL UNIQUE, sent_via TEXT, sent_at TEXT, remind_24h_at TEXT, remind_15m_at TEXT, joined_at TEXT);
CREATE INDEX IF NOT EXISTS idx_meeting_invites ON meeting_invites(meeting_id);
CREATE TABLE IF NOT EXISTS meeting_recordings(
  id INTEGER PRIMARY KEY, meeting_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'video', path TEXT NOT NULL, size INTEGER, duration INTEGER, mime TEXT, uploaded_by TEXT, transcript TEXT, transcript_status TEXT NOT NULL DEFAULT 'none', error TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meeting_transcript(
  id INTEGER PRIMARY KEY, meeting_id INTEGER NOT NULL, speaker TEXT, text TEXT NOT NULL, at_ms INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_meeting_transcript ON meeting_transcript(meeting_id, id);
CREATE TABLE IF NOT EXISTS promo_videos(
  id INTEGER PRIMARY KEY, property_id INTEGER, title TEXT NOT NULL, script TEXT, path TEXT NOT NULL, size INTEGER, duration INTEGER, created_by INTEGER, created_at TEXT NOT NULL);

-- Website integrations (API v1): one connection per website or plugin, with its own scoped key
CREATE TABLE IF NOT EXISTS integration_connections(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL DEFAULT 'custom', scopes TEXT NOT NULL DEFAULT '[]', config TEXT NOT NULL DEFAULT '{}',
  key_hash TEXT NOT NULL, key_hint TEXT, prev_key_hash TEXT, prev_key_until TEXT, status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER, created_at TEXT NOT NULL, last_used_at TEXT, last_success_at TEXT, last_error TEXT, last_error_at TEXT, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS connection_events(
  id INTEGER PRIMARY KEY, connection_id INTEGER NOT NULL, event TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_connection_events ON connection_events(connection_id, id);
CREATE TABLE IF NOT EXISTS api_idempotency(
  connection_id INTEGER NOT NULL, idem_key TEXT NOT NULL, request_hash TEXT NOT NULL, status INTEGER NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(connection_id, idem_key));
CREATE TABLE IF NOT EXISTS lead_attribution(
  id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL, connection_id INTEGER, external_id TEXT, form TEXT, enquiry_type TEXT, page_url TEXT, referrer TEXT, utm TEXT,
  consent TEXT, result TEXT NOT NULL, test INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_lead_attr_contact ON lead_attribution(contact_id);
CREATE INDEX IF NOT EXISTS idx_lead_attr_conn ON lead_attribution(connection_id, id);

CREATE TABLE IF NOT EXISTS webhook_subscriptions(
  id INTEGER PRIMARY KEY, connection_id INTEGER NOT NULL, url TEXT NOT NULL, events TEXT NOT NULL, secret_enc TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, last_success_at TEXT, last_error TEXT, last_error_at TEXT);
CREATE TABLE IF NOT EXISTS webhook_deliveries(
  id INTEGER PRIMARY KEY, subscription_id INTEGER NOT NULL, event TEXT NOT NULL, event_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, last_status INTEGER, last_error TEXT, created_at TEXT NOT NULL, delivered_at TEXT);
CREATE INDEX IF NOT EXISTS idx_webhook_due ON webhook_deliveries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_webhook_sub ON webhook_deliveries(subscription_id, id);
CREATE TABLE IF NOT EXISTS form_keys(
  id INTEGER PRIMARY KEY, connection_id INTEGER NOT NULL, form_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, origins TEXT NOT NULL DEFAULT '[]', title TEXT, consent_text TEXT, button TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_used_at TEXT);
`;
