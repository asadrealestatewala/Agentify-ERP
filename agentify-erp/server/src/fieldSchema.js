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
-- route history: only written while the workspace setting route_history is on (off by default); see services/fieldLocation.js
CREATE TABLE IF NOT EXISTS field_points(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat REAL NOT NULL, lng REAL NOT NULL, accuracy_m REAL, captured_at TEXT NOT NULL, source TEXT);
CREATE INDEX IF NOT EXISTS idx_field_points_user_time ON field_points(user_id, captured_at);
`;
