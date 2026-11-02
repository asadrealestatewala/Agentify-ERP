// Creative Studio tables (workspace database; see services/creativeStudio.js). Kept import-free so db.js can load it without a cycle.
export const CREATIVE_SCHEMA = `
CREATE TABLE IF NOT EXISTS creative_brand(
  id INTEGER PRIMARY KEY CHECK(id=1), brand_name TEXT, logo TEXT, primary_color TEXT, secondary_color TEXT, tone TEXT, business_type TEXT, about TEXT,
  language TEXT NOT NULL DEFAULT 'English', updated_by INTEGER, updated_at TEXT);
CREATE TABLE IF NOT EXISTS creative_items(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT, prompt TEXT, size TEXT, language TEXT, body TEXT, file_ref TEXT, mime TEXT, size_bytes INTEGER,
  credits INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_creative_items_kind ON creative_items(kind, id);
`;
