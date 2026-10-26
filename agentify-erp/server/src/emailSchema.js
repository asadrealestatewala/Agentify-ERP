// Tenant-database tables for e-mail consent and suppression. They live in the workspace's own database so one workspace's
// preferences can never change another's. (Queue, usage ledger and sender domains are control-plane tables: services/tenantEmail.js.)
export const EMAIL_SCHEMA = `
-- who must not be mailed. scope 'marketing' = promotional mail only (unsubscribed, complained); 'all' = any tenant mail (hard bounce)
CREATE TABLE IF NOT EXISTS email_suppressions(
  id INTEGER PRIMARY KEY, email_lc TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('marketing','all')), reason TEXT NOT NULL, source TEXT, detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), removed_at TEXT, removed_by INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_supp_live ON email_suppressions(email_lc, scope) WHERE removed_at IS NULL;
-- consent evidence, append-only: the latest row per address and purpose decides
CREATE TABLE IF NOT EXISTS email_consents(
  id INTEGER PRIMARY KEY, email_lc TEXT NOT NULL, contact_id INTEGER, purpose TEXT NOT NULL DEFAULT 'marketing', channel TEXT NOT NULL DEFAULT 'email',
  status TEXT NOT NULL CHECK(status IN ('granted','withdrawn')), source TEXT NOT NULL, policy_version TEXT, text TEXT, sender_id INTEGER, actor_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_email_consent ON email_consents(email_lc, purpose, id);
-- activation checklist: a step is recorded the first time real data shows it done, and stays done
CREATE TABLE IF NOT EXISTS activation_progress(step TEXT PRIMARY KEY, completed_at TEXT NOT NULL DEFAULT (datetime('now')), source TEXT);
`;
