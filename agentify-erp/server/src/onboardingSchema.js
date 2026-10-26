// Tenant-database tables for employee onboarding checklists (see services/onboarding.js). Additive only: new tables plus
// one nullable link column on work_tasks (added in db.js migrate()).
// Event times (*_at) on these tables are UTC ISO strings ('2026-10-25T09:00:00.000Z'); due dates are calendar dates in
// the workspace's own timezone.
export const ONBOARDING_SCHEMA = `
CREATE TABLE IF NOT EXISTS onboarding_templates(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS onboarding_template_items(
  id INTEGER PRIMARY KEY, template_id INTEGER NOT NULL REFERENCES onboarding_templates(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'other', title TEXT NOT NULL, description TEXT,
  required INTEGER NOT NULL DEFAULT 1, assignee_type TEXT NOT NULL DEFAULT 'hr', assignee_user_id INTEGER,
  due_offset_days INTEGER NOT NULL DEFAULT 0, criteria TEXT NOT NULL DEFAULT 'manual', criteria_ref TEXT);
CREATE INDEX IF NOT EXISTS idx_onb_titems ON onboarding_template_items(template_id, sort_order);
CREATE TABLE IF NOT EXISTS onboardings(
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), template_id INTEGER, template_name TEXT,
  joining_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', idem_key TEXT, started_by INTEGER,
  created_at TEXT NOT NULL, completed_at TEXT, cancelled_at TEXT, cancelled_by INTEGER, cancel_reason TEXT, last_overdue_notice TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onb_idem ON onboardings(idem_key) WHERE idem_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_onb_open ON onboardings(employee_id) WHERE status IN ('pending','in_progress');
CREATE TABLE IF NOT EXISTS onboarding_items(
  id INTEGER PRIMARY KEY, onboarding_id INTEGER NOT NULL REFERENCES onboardings(id) ON DELETE CASCADE, template_item_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'other', title TEXT NOT NULL, description TEXT,
  required INTEGER NOT NULL DEFAULT 1, assignee_type TEXT NOT NULL DEFAULT 'hr', assignee_user_id INTEGER,
  due_offset_days INTEGER NOT NULL DEFAULT 0, due_date TEXT, criteria TEXT NOT NULL DEFAULT 'manual', criteria_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending', evidence_type TEXT, evidence_ref TEXT, evidence_note TEXT,
  started_at TEXT, completed_by INTEGER, completed_at TEXT, waived_by INTEGER, waived_at TEXT, waive_reason TEXT,
  reopened_by INTEGER, reopened_at TEXT, reopen_reason TEXT, work_task_id INTEGER, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_onb_items ON onboarding_items(onboarding_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_onb_items_assignee ON onboarding_items(assignee_user_id, status);
CREATE TABLE IF NOT EXISTS onboarding_item_events(
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES onboarding_items(id) ON DELETE CASCADE, onboarding_id INTEGER NOT NULL,
  user_id INTEGER, action TEXT NOT NULL, from_status TEXT, to_status TEXT, reason TEXT, evidence TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_onb_events ON onboarding_item_events(onboarding_id, id);
`;
