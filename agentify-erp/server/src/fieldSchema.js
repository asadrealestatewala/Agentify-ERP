// Field-agent location tables (see services/fieldLocation.js). Kept import-free so db.js can load it without a cycle.
export const FIELD_SCHEMA = `
CREATE TABLE IF NOT EXISTS field_agents(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  service_area TEXT, availability TEXT NOT NULL DEFAULT 'unknown', availability_at TEXT,
  sharing TEXT NOT NULL DEFAULT 'off', sharing_session TEXT, sharing_started_at TEXT,
  lat REAL, lng REAL, accuracy_m REAL, captured_at TEXT, received_at TEXT, source TEXT,
  last_error TEXT, last_error_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS field_consents(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notice_version INTEGER NOT NULL, accepted_at TEXT NOT NULL, withdrawn_at TEXT);
`;
