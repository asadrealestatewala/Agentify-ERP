// Workspace-database tables for lead conversion: routing rules, assignments and their events (the response-time record),
// duplicate review, merge history, and follow-up sequences. All additive (CREATE IF NOT EXISTS); no existing table changes.
export const LEAD_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_routing_profiles(
  user_id INTEGER PRIMARY KEY, available INTEGER NOT NULL DEFAULT 1, team TEXT, projects TEXT, cities TEXT, max_open INTEGER, weight INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
CREATE TABLE IF NOT EXISTS lead_routing_rules(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 100, mode TEXT NOT NULL DEFAULT 'round_robin' CHECK(mode IN ('manual','round_robin','weighted')),
  match TEXT NOT NULL DEFAULT '{}', agent_ids TEXT NOT NULL DEFAULT '[]', team TEXT, fallback_agent_id INTEGER, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE TABLE IF NOT EXISTS lead_routing_state(rule_id INTEGER PRIMARY KEY, last_agent_id INTEGER, weights TEXT);
-- one row per assignment of a lead to an agent. The deadlines are computed when it is made and never rewritten.
CREATE TABLE IF NOT EXISTS lead_assignments(
  id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL, agent_id INTEGER, rule_id INTEGER, kind TEXT NOT NULL, reason TEXT, actor_id INTEGER,
  assigned_at TEXT NOT NULL, accept_due_at TEXT, response_due_at TEXT, accepted_at TEXT, first_human_response_at TEXT, ended_at TEXT, end_reason TEXT);
CREATE INDEX IF NOT EXISTS idx_la_contact ON lead_assignments(contact_id, id);
CREATE INDEX IF NOT EXISTS idx_la_agent ON lead_assignments(agent_id, ended_at);
-- what happened, one fact per row. automated=1 rows (acknowledgements, sequence emails) never count as a human response.
CREATE TABLE IF NOT EXISTS lead_events(
  id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL, assignment_id INTEGER, type TEXT NOT NULL, actor_id INTEGER, automated INTEGER NOT NULL DEFAULT 0, channel TEXT, evidence TEXT, detail TEXT, dedupe TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_le_contact ON lead_events(contact_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_le_dedupe ON lead_events(dedupe) WHERE dedupe IS NOT NULL;
-- inbound enquiries already seen (same person, same message, same form, close in time): a repeat is recorded, not counted again
CREATE TABLE IF NOT EXISTS lead_inbound_seen(fingerprint TEXT PRIMARY KEY, contact_id INTEGER, first_at TEXT NOT NULL, repeats INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS duplicate_reviews(
  id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL, candidate_id INTEGER NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dismissed','merged')),
  created_at TEXT NOT NULL, decided_by INTEGER, decided_at TEXT, UNIQUE(contact_id, candidate_id));
CREATE TABLE IF NOT EXISTS contact_merges(
  id INTEGER PRIMARY KEY, kept_id INTEGER NOT NULL, merged_id INTEGER NOT NULL, merged_snapshot TEXT, moved TEXT, actor_id INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sequences(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused')), trigger TEXT NOT NULL DEFAULT '{"type":"manual"}',
  sender_id INTEGER, current_version INTEGER NOT NULL DEFAULT 1, template TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
-- a version is immutable: steps, sending window, frequency limits and stop rules travel together
CREATE TABLE IF NOT EXISTS sequence_versions(
  id INTEGER PRIMARY KEY, sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE, version INTEGER NOT NULL, config TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(sequence_id, version));
CREATE TABLE IF NOT EXISTS sequence_enrollments(
  id INTEGER PRIMARY KEY, sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE, version INTEGER NOT NULL, contact_id INTEGER NOT NULL, ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','stopped')), stop_reason TEXT, pause_reason TEXT, step_index INTEGER NOT NULL DEFAULT 0, next_run_at TEXT,
  started_at TEXT NOT NULL, ended_at TEXT, enrolled_by INTEGER, UNIQUE(sequence_id, contact_id, ref));
CREATE INDEX IF NOT EXISTS idx_se_run ON sequence_enrollments(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_se_contact ON sequence_enrollments(contact_id, status);
CREATE TABLE IF NOT EXISTS sequence_log(
  id INTEGER PRIMARY KEY, enrollment_id INTEGER NOT NULL REFERENCES sequence_enrollments(id) ON DELETE CASCADE, step_index INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, ref TEXT, detail TEXT, created_at TEXT NOT NULL,
  UNIQUE(enrollment_id, step_index));
`;
