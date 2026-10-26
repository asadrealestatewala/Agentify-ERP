// Workspace-database tables for online payment gateways (see services/gateways.js). No imports: db.js loads this.
export const GATEWAYS_SCHEMA = `
CREATE TABLE IF NOT EXISTS pay_checkouts(
  id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, contact_id INTEGER NOT NULL, sale_id INTEGER NOT NULL, installment_ids TEXT NOT NULL,
  amount INTEGER NOT NULL, currency TEXT NOT NULL, minor_amount INTEGER NOT NULL, sandbox INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'created', external_id TEXT, checkout_url TEXT, payment_ref TEXT, receipt_id INTEGER, error TEXT,
  created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_pay_checkouts_contact ON pay_checkouts(contact_id, id);
CREATE INDEX IF NOT EXISTS idx_pay_checkouts_ext ON pay_checkouts(provider, external_id);
CREATE TABLE IF NOT EXISTS pay_events(
  provider TEXT NOT NULL, event_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(provider, event_id));
`;
