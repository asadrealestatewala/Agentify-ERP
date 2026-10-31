import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { get, all, run, nextNo, val } from '../db.js';
import { now, bad, int, num, jparse, addDays, region } from '../util.js';

/** Plot sizes in sqft. The marla size comes from the region pack (never hard-coded); a kanal is 20 marla. */
export function toSqft(area, unit) {
  const a = Number(area) || 0;
  const u = String(unit || '').toLowerCase();
  const marla = Number(region().config.marla_sqft) || 0;
  if (u === 'marla') return Math.round(a * marla * 100) / 100;
  if (u === 'kanal') return Math.round(a * 20 * marla * 100) / 100;
  if (u === 'sqft' || u === 'sq ft' || u === 'square feet') return a;
  return null;
}

/** Tiers: [{ to_day, pct }, ..., { pct }]  (the last tier has no to_day and applies after every earlier one). */
export function cleanTiers(raw) {
  const tiers = (Array.isArray(raw) ? raw : jparse(raw, [])).map((t) => ({ to_day: t.to_day === undefined || t.to_day === null || t.to_day === '' ? null : int(t.to_day), pct: num(t.pct) }));
  let prev = 0;
  tiers.forEach((t, i) => {
    if (!(t.pct >= 0 && t.pct <= 100)) throw bad('A deduction percentage must be between 0 and 100');
    if (t.to_day === null && i !== tiers.length - 1) throw bad('Only the last deduction tier can be open-ended');
    if (t.to_day !== null) { if (t.to_day <= prev) throw bad('Deduction tiers must go up in days'); prev = t.to_day; }
  });
  return tiers;
}

/** Deduction % that applies when a file is cancelled `days` after booking. Null when the tiers are empty. */
export function deductionPct(tiers, days) {
  const list = Array.isArray(tiers) ? tiers : jparse(tiers, []);
  for (const t of list) if (t.to_day === null || t.to_day === undefined || days <= t.to_day) return Number(t.pct);
  return list.length ? Number(list[list.length - 1].pct) : null;
}

const AGREEMENT_COLS = ['project_id', 'title', 'pricing_basis', 'developer_rate', 'company_rate', 'rebate_basis', 'rebate_down_pct', 'rebate_installment_pct', 'rebate_balloon_pct',
  'cancel_window_days', 'effective_from', 'effective_to', 'status', 'notes'];

export function checkAgreement(d, existing) {
  const out = { ...d };
  if (out.title !== undefined && !String(out.title).trim()) throw bad('Give the agreement a title');
  if (!existing && !String(out.title || '').trim()) throw bad('Give the agreement a title');
  for (const k of ['rebate_down_pct', 'rebate_installment_pct', 'rebate_balloon_pct']) {
    if (out[k] !== undefined) { out[k] = num(out[k]); if (!(out[k] >= 0 && out[k] <= 100)) throw bad('Rebate percentages must be between 0 and 100'); }
  }
  for (const k of ['developer_rate', 'company_rate']) if (out[k] !== undefined) { out[k] = out[k] === '' || out[k] === null ? null : num(out[k]); if (out[k] !== null && out[k] < 0) throw bad('Rates cannot be negative'); }
  if (out.cancel_window_days !== undefined) { out.cancel_window_days = int(out.cancel_window_days); if (out.cancel_window_days < 0) throw bad('The cancellation window cannot be negative'); }
  if (out.project_id === '') out.project_id = null;
  if (out.project_id && !get('SELECT 1 FROM projects WHERE id=?', out.project_id)) throw bad('Project not found');
  if (out.cancel_tiers !== undefined) out.cancel_tiers = JSON.stringify(cleanTiers(out.cancel_tiers));
  return out;
}
export const AGREEMENT_FIELDS = [...AGREEMENT_COLS, 'cancel_tiers'];

/** Check a plot's developer link and return the columns to store. */
export function propertyDeveloperFields(d, existing) {
  const source = d.inventory_source ?? existing?.inventory_source ?? 'own';
  if (!['own', 'developer'].includes(source)) throw bad('Inventory source must be own or developer');
  if (source === 'own') return { inventory_source: 'own', developer_id: null, agreement_id: null };
  const developerId = int(d.developer_id ?? existing?.developer_id);
  const agreementId = int(d.agreement_id ?? existing?.agreement_id);
  const dev = developerId ? get('SELECT * FROM developers WHERE id=?', developerId) : null;
  if (!dev) throw bad('Choose the developer who owns this plot');
  if (dev.status !== 'active') throw bad('This developer is inactive');
  const ag = agreementId ? get('SELECT * FROM developer_agreements WHERE id=? AND developer_id=?', agreementId, dev.id) : null;
  if (!ag) throw bad('Choose one of this developer’s agreements');
  if (ag.status !== 'active') throw bad('This agreement has ended');
  return { inventory_source: 'developer', developer_id: dev.id, agreement_id: ag.id };
}

/** Columns that mark a new sale as a developer file (snapshotting the agreement so later edits never rewrite history). */
export function developerSaleFields(prop, saleDate) {
  if (!prop || prop.inventory_source !== 'developer') return null;
  const ag = get('SELECT * FROM developer_agreements WHERE id=?', prop.agreement_id);
  if (!ag) throw bad('The agreement for this plot is missing');
  return {
    developer_id: prop.developer_id, agreement_id: ag.id, booking_id: nextNo('BK', 'BK'), file_state: 'active', holder: 'customer',
    cancel_window_until: ag.cancel_window_days > 0 ? addDays(saleDate, ag.cancel_window_days) : null, cancel_tiers: ag.cancel_tiers || '[]',
  };
}

export function logFileEvent(saleId, event, { from, to, user, amount, note } = {}) {
  run('INSERT INTO file_events(sale_id,event,from_state,to_state,actor_user,actor_role,amount,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    saleId, event, from ?? null, to ?? null, user?.id ?? null, user?.role ?? null, amount ?? null, note ?? null, now());
}

/** Create (or reset) a developer's portal login. The password is returned once. */
export function createDeveloperPortalUser(developerId, password) {
  const d = get('SELECT * FROM developers WHERE id=?', developerId);
  if (!d) throw bad('Developer not found');
  const email = String(d.email || '').trim().toLowerCase();
  if (!email) throw bad('Add the developer’s e-mail address first: it becomes their login');
  if (password && String(password).length < 8) throw bad('Password must be at least 8 characters');
  const pw = password ? String(password) : `${crypto.randomBytes(4).toString('hex')}-${crypto.randomInt(1000, 9999)}`;
  const hash = bcrypt.hashSync(pw, 10);
  const existing = get('SELECT id FROM users WHERE developer_id=?', developerId);
  if (existing) {
    run('UPDATE users SET password_hash=?, token_version=token_version+1, active=1, email=? WHERE id=?', hash, email, existing.id);
    return { created: false, login: email, password: pw };
  }
  if (get('SELECT 1 FROM users WHERE lower(email)=?', email)) throw bad('Another account already uses this e-mail');
  let role = val("SELECT id FROM roles WHERE name='Developer'");
  if (!role) role = Number(run("INSERT INTO roles(name,description,own_scope,portal,is_system) VALUES('Developer','Developer partner portal only',0,1,1)").lastInsertRowid);
  run('INSERT INTO users(name,email,phone,password_hash,role_id,active,developer_id,created_at) VALUES(?,?,?,?,?,1,?,?)', d.name, email, d.phone || null, hash, role, developerId, now());
  return { created: true, login: email, password: pw };
}

export function developerSummary(id) {
  const files = get(`SELECT COUNT(*) n, COALESCE(SUM(net_price),0) value, COALESCE(SUM(paid_amount),0) paid FROM sales WHERE developer_id=? AND status='confirmed'`, id);
  return {
    plots: get("SELECT COUNT(*) n FROM properties WHERE developer_id=?", id).n,
    available: get("SELECT COUNT(*) n FROM properties WHERE developer_id=? AND status IN ('available','featured')", id).n,
    files: files.n, contract_value: files.value, collected: files.paid, outstanding: files.value - files.paid,
  };
}
export const listDevelopers = () => all('SELECT * FROM developers ORDER BY status, name').map((d) => ({ ...d, ...developerSummary(d.id) }));
