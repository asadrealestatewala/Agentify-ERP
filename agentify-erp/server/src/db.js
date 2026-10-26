import './env.js';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCHEMA, SALES_DDL } from './schema.js';
import { CONSTRUCTION_SCHEMA } from './constructionSchema.js';
import { IDENTITY_SCHEMA } from './regions/identitySchema.js';
import { MORTGAGE_SCHEMA } from './regions/mortgageSchema.js';
import { DOCUMENTS_SCHEMA } from './regions/documentsSchema.js';
import { syncRegionLookups } from './regions/lookups.js';
import { INTEGRATIONS_SCHEMA } from './integrations/schema.js';
import { FIELD_SCHEMA } from './fieldSchema.js';
import { ONBOARDING_SCHEMA } from './onboardingSchema.js';
import { GATEWAYS_SCHEMA } from './gateways/schema.js';
import { EMAIL_SCHEMA } from './emailSchema.js';
import { LEAD_SCHEMA } from './leadSchema.js';
import { WHATSAPP_SCHEMA } from './whatsappSchema.js';
import { now } from './util.js';
import { als, currentContext, currentTenant } from './context.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.ERP_DATA_DIR || path.join(here, '..', 'data');
/** Upload root of the original single-company install; other tenants get their own folder (see uploadDir). */
export const UPLOAD_DIR = process.env.ERP_UPLOAD_DIR || path.join(here, '..', 'uploads');
export const DEFAULT_DB_FILE = process.env.ERP_DB || path.join(DATA_DIR, 'erp.db');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** One open connection per database file, shared by every request of that tenant. */
const handles = new Map();

/** Open (once) a tenant database file and bring its schema up to date. */
export function openDb(file, tenant = null) {
  const abs = path.resolve(file);
  let h = handles.get(abs);
  if (h) return h;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  h = new DatabaseSync(abs);
  h.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  handles.set(abs, h);
  try {
    als.run({ tenant, db: h }, () => { db.exec(SCHEMA); db.exec(CONSTRUCTION_SCHEMA); db.exec(IDENTITY_SCHEMA); db.exec(MORTGAGE_SCHEMA); db.exec(DOCUMENTS_SCHEMA); db.exec(INTEGRATIONS_SCHEMA); db.exec(ONBOARDING_SCHEMA); db.exec(FIELD_SCHEMA); db.exec(GATEWAYS_SCHEMA); db.exec(EMAIL_SCHEMA); db.exec(LEAD_SCHEMA); db.exec(WHATSAPP_SCHEMA); migrate(); backfillIds(); try { syncRegionLookups(); } catch { /* lists are a convenience; never block opening the workspace */ } });
  } catch (e) { handles.delete(abs); h.close(); throw e; }
  return h;
}

/** Close one database file (before a workspace's data is deleted). */
export function closeDb(file) {
  const abs = path.resolve(file);
  const h = handles.get(abs);
  if (h) { try { h.close(); } catch { /* already closed */ } handles.delete(abs); }
}

export function closeDbs() {
  for (const h of handles.values()) { try { h.close(); } catch { /* already closed */ } }
  handles.clear();
}

/** The current tenant's connection; outside a tenant context, the original single-company database. */
const current = () => currentContext()?.db || openDb(DEFAULT_DB_FILE);
/** The raw connection behind `db`, for per-tenant caches (e.g. a WeakMap keyed by connection). */
export const currentDb = current;

/** `db` always means the current tenant's database, so existing code keeps calling db.prepare / db.exec unchanged. */
export const db = new Proxy({}, {
  get(_t, key) {
    const h = current();
    const v = h[key];
    return typeof v === 'function' ? v.bind(h) : v;
  },
});

/** The current tenant's upload folder (the original install keeps the legacy root). */
export const uploadDir = () => currentTenant()?.upload_dir || UPLOAD_DIR;

/** Bring databases created by earlier versions up to date (idempotent). */
function migrate() {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all();
  const addCol = (t, name, def) => { if (cols(t).length && !cols(t).some((c) => c.name === name)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${name} ${def}`); };
  const hasSales = cols('sales').length > 0;
  if (hasSales) {
    // property_id used to be NOT NULL; construction contracts may have no plot. Rebuild the table once.
    if (cols('sales').find((c) => c.name === 'property_id')?.notnull) {
      const old = cols('sales').map((c) => c.name);
      db.exec('PRAGMA foreign_keys=OFF');
      db.exec('BEGIN');
      try {
        db.exec(SALES_DDL('sales_new'));
        const shared = old.join(',');
        db.exec(`INSERT INTO sales_new(${shared}) SELECT ${shared} FROM sales`);
        db.exec('DROP TABLE sales');
        db.exec('ALTER TABLE sales_new RENAME TO sales');
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      db.exec('PRAGMA foreign_keys=ON');
    }
    addCol('sales', 'kind', "TEXT NOT NULL DEFAULT 'property'"); addCol('sales', 'title', 'TEXT');
    addCol('sales', 'bundle_id', 'INTEGER'); addCol('sales', 'linked_sale_id', 'INTEGER');
  }
  addCol('projects', 'kind', "TEXT NOT NULL DEFAULT 'development'");
  addCol('expense_vouchers', 'sale_id', 'INTEGER');
  addCol('commission_rules', 'sale_kind', 'TEXT');
  addCol('projects', 'budget', 'INTEGER');
  addCol('projects', 'site_visible', 'INTEGER NOT NULL DEFAULT 1');
  addCol('notifications', 'dedupe', 'TEXT');
  addCol('employees', 'photo', 'TEXT'); addCol('employees', 'father_name', 'TEXT');
  addCol('leaves', 'decision_note', 'TEXT'); addCol('leaves', 'decided_at', 'TEXT');
  addCol('properties', 'file_no', 'TEXT'); addCol('properties', 'registration_no', 'TEXT');
  addCol('properties', 'file_status', 'TEXT'); addCol('properties', 'file_notes', 'TEXT');
  addCol('contacts', 'customer_code', 'TEXT');
  addCol('expense_vouchers', 'show_paid_from', 'INTEGER NOT NULL DEFAULT 0'); addCol('expense_vouchers', 'is_asset', 'INTEGER NOT NULL DEFAULT 0'); addCol('expense_vouchers', 'asset_info', 'TEXT');
  addCol('properties', 'review_note', 'TEXT'); addCol('properties', 'review_by', 'INTEGER'); addCol('properties', 'reviewed_at', 'TEXT');
  addCol('projects', 'site_state', "TEXT NOT NULL DEFAULT 'none'"); addCol('projects', 'site_requested_by', 'INTEGER'); addCol('projects', 'site_requested_at', 'TEXT'); addCol('projects', 'site_featured', 'INTEGER NOT NULL DEFAULT 0'); addCol('projects', 'site_note', 'TEXT');
  for (const [c, t] of [['installment_ids', 'TEXT'], ['proof_sent_at', 'TEXT'], ['verifying_at', 'TEXT'], ['verified_channel', 'TEXT'], ['verified_ref', 'TEXT'], ['verified_note', 'TEXT'], ['verified_by', 'INTEGER'], ['verified_at', 'TEXT'],
    ['received_amount', 'INTEGER'], ['feed_id', 'INTEGER'], ['auto_matched', 'INTEGER NOT NULL DEFAULT 0'], ['auto_synced', 'INTEGER NOT NULL DEFAULT 0']]) addCol('payment_claims', c, t);
  addCol('receipts', 'qr_payload', 'TEXT'); addCol('receipts', 'qr_at', 'TEXT');
  addCol('site_posts', 'seo_title', 'TEXT'); addCol('site_posts', 'seo_desc', 'TEXT'); addCol('site_posts', 'focus_keyword', 'TEXT');
  addCol('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 1'); addCol('users', 'totp_secret', 'TEXT'); addCol('users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0'); addCol('users', 'recovery_codes', 'TEXT'); addCol('users', 'totp_last_step', 'INTEGER NOT NULL DEFAULT 0');
  addCol('users', 'vendor_id', 'INTEGER'); addCol('vendors', 'vendor_code', 'TEXT');
  addCol('assets', 'vendor_id', 'INTEGER'); addCol('assets', 'project_id', 'INTEGER'); addCol('assets', 'warranty_until', 'TEXT'); addCol('assets', 'source', 'TEXT');
  // property visits on appointments (all nullable, so older apps and rows keep working)
  for (const [c, t] of [['timezone', 'TEXT'], ['starts_utc', 'TEXT'], ['ends_utc', 'TEXT'], ['client_key', 'TEXT'], ['checked_in_at', 'TEXT'], ['checked_out_at', 'TEXT'],
    ['outcome', 'TEXT'], ['outcome_notes', 'TEXT'], ['followup_task_id', 'INTEGER'], ['status_note', 'TEXT'], ['status_by', 'INTEGER'], ['status_at', 'TEXT']]) addCol('appointments', c, t);
  if (cols('appointments').length) {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_key ON appointments(created_by, client_key) WHERE client_key IS NOT NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_property ON appointments(property_id); CREATE INDEX IF NOT EXISTS idx_appointments_contact ON appointments(contact_id)');
  }
  addCol('work_tasks', 'onboarding_item_id', 'INTEGER'); // the onboarding checklist item a task was created for
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_dedupe ON notifications(user_id, dedupe) WHERE dedupe IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sales_contact ON sales(contact_id); CREATE INDEX IF NOT EXISTS idx_sales_agent ON sales(agent_id); CREATE INDEX IF NOT EXISTS idx_sales_bundle ON sales(bundle_id);');
  // every receipt belongs to one or more sales through receipt_sales
  db.exec(`INSERT INTO receipt_sales(receipt_id,sale_id,amount,advance) SELECT r.id,r.sale_id,CASE WHEN r.payment_type='Refund' THEN -r.amount ELSE r.amount-r.advance_amount END,r.advance_amount FROM receipts r
    WHERE r.sale_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM receipt_sales x WHERE x.receipt_id=r.id)`);
  // construction income account for existing charts
  if (db.prepare("SELECT 1 FROM accounts WHERE code='4000'").get() && !db.prepare("SELECT 1 FROM accounts WHERE code='4150'").get()) {
    db.exec("INSERT INTO accounts(code,name,type,subtype,parent_id,is_system) VALUES('4150','Construction Contract Income','income',NULL,(SELECT id FROM accounts WHERE code='4000'),1)");
  }
}
/**
 * Every customer gets a customer ID (CUS-0001…) and every property a registration number (REG-0001…) so each can be
 * searched by it. Idempotent: only fills what is missing, then enforces uniqueness.
 */
export function backfillIds() {
  const next = (key) => { db.prepare('INSERT INTO counters(key,value) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET value=value+1').run(key); return db.prepare('SELECT value FROM counters WHERE key=?').get(key).value; };
  const pad = (p, n, w) => `${p}-${String(n).padStart(w, '0')}`;
  for (const c of db.prepare("SELECT id FROM contacts WHERE is_customer=1 AND (customer_code IS NULL OR customer_code='') ORDER BY COALESCE(customer_since,''), id").all()) {
    db.prepare('UPDATE contacts SET customer_code=? WHERE id=?').run(pad('CUS', next('CUS'), 4), c.id);
  }
  for (const p of db.prepare("SELECT id FROM properties WHERE registration_no IS NULL OR registration_no='' ORDER BY id").all()) {
    db.prepare('UPDATE properties SET registration_no=? WHERE id=?').run(pad('REG', next('REG'), 4), p.id);
  }
  for (const v of db.prepare("SELECT id FROM vendors WHERE vendor_code IS NULL OR vendor_code='' ORDER BY COALESCE(created_at,''), id").all()) {
    db.prepare('UPDATE vendors SET vendor_code=? WHERE id=?').run(pad('VND', next('VND'), 4), v.id);
  }
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_code ON vendors(vendor_code) WHERE vendor_code IS NOT NULL'); } catch { /* manual duplicates */ }
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_code ON contacts(customer_code) WHERE customer_code IS NOT NULL"); } catch { /* duplicates from manual edits: leave to validation */ }
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_prop_reg ON properties(registration_no) WHERE registration_no IS NOT NULL AND registration_no<>''"); } catch { /* same */ }
}

const clean = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0)
  : v !== null && typeof v === 'object' ? JSON.stringify(v) : v));

export const all = (sql, ...p) => db.prepare(sql).all(...clean(p));
export const get = (sql, ...p) => db.prepare(sql).get(...clean(p));
export const run = (sql, ...p) => db.prepare(sql).run(...clean(p));
export const val = (sql, ...p) => { const r = get(sql, ...p); return r ? Object.values(r)[0] : null; };

/** Transaction nesting depth per connection (each tenant database has its own). */
const depths = new WeakMap();
export function tx(fn) {
  const h = current();
  const depth = (depths.get(h) || 0) + 1;
  depths.set(h, depth);
  const name = `sp${depth - 1}`;
  h.exec(depth === 1 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
  try {
    const r = fn();
    h.exec(depth === 1 ? 'COMMIT' : `RELEASE ${name}`);
    return r;
  } catch (e) {
    h.exec(depth === 1 ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
    throw e;
  } finally { depths.set(h, depth - 1); }
}

/** Insert only whitelisted columns. */
export function insert(table, data, cols) {
  const keys = cols.filter((c) => data[c] !== undefined);
  const r = run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => data[k]));
  return Number(r.lastInsertRowid);
}
export function update(table, id, data, cols) {
  const keys = cols.filter((c) => data[c] !== undefined);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => data[k]), id);
}

export function nextNo(key, prefix, width = 5) {
  run('INSERT INTO counters(key,value) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET value=value+1', key);
  return `${prefix}-${String(val('SELECT value FROM counters WHERE key=?', key)).padStart(width, '0')}`;
}

export function getSetting(key, def = null) {
  const r = get('SELECT value FROM settings WHERE key=?', key);
  return r ? r.value : def;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
}
export const touch = () => now();
