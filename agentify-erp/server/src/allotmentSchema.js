// Allotment letters for plot sales (housing projects): see services/allotment.js. Additive table in each workspace database.
export const ALLOTMENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS allotment_letters(
  id INTEGER PRIMARY KEY, letter_no TEXT UNIQUE NOT NULL, token TEXT UNIQUE NOT NULL,
  sale_id INTEGER NOT NULL REFERENCES sales(id), contact_id INTEGER NOT NULL REFERENCES contacts(id), property_id INTEGER REFERENCES properties(id),
  issue_date TEXT NOT NULL, customer_name TEXT NOT NULL, relation TEXT, customer_address TEXT NOT NULL,
  plot_no TEXT NOT NULL, block TEXT, project_name TEXT, plot_location TEXT NOT NULL, property_type TEXT,
  area_size REAL, area_unit TEXT, dimensions TEXT, note TEXT,
  status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','cancelled')), cancel_reason TEXT, cancelled_at TEXT, cancelled_by INTEGER,
  issued_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_allot_sale ON allotment_letters(sale_id);`;
