// Developer partner portal (joint-venture inventory): tables in each workspace's own database, additive only.
// Design: docs/DEVELOPER_PARTNER_PORTAL.md. A "developer file" is an ordinary sale (installments, ledger, receipts) whose
// plot belongs to a developer; the columns that mark it live on properties, sales and users (see migrate() in db.js).
export const DEVELOPER_SCHEMA = `
CREATE TABLE IF NOT EXISTS developers(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT, ntn TEXT, address TEXT, bank_details TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), created_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS developer_agreements(
  id INTEGER PRIMARY KEY, developer_id INTEGER NOT NULL REFERENCES developers(id) ON DELETE CASCADE, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL, pricing_basis TEXT NOT NULL DEFAULT 'per_sqft' CHECK(pricing_basis IN ('per_sqft','per_plot')),
  developer_rate REAL, company_rate REAL,
  rebate_basis TEXT NOT NULL DEFAULT 'percent_of_payment' CHECK(rebate_basis IN ('percent_of_payment','spread')),
  rebate_down_pct REAL NOT NULL DEFAULT 0, rebate_installment_pct REAL NOT NULL DEFAULT 0, rebate_balloon_pct REAL NOT NULL DEFAULT 0,
  cancel_window_days INTEGER NOT NULL DEFAULT 0, cancel_tiers TEXT NOT NULL DEFAULT '[]',
  effective_from TEXT, effective_to TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')), notes TEXT, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_devagr_dev ON developer_agreements(developer_id);
CREATE TABLE IF NOT EXISTS file_events(
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE, event TEXT NOT NULL, from_state TEXT, to_state TEXT,
  actor_user INTEGER, actor_role TEXT, amount INTEGER, note TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_fileev_sale ON file_events(sale_id);
`;
