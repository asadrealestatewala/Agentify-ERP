import bcrypt from 'bcryptjs';
import { passwordProblem } from '../validation.js';
import { assertUserEmailFree } from './uniqueEmail.js';
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

/** The rebate rules a file is booked under: the plot's own rebate when it has one, else the agreement's per-stage rates. */
export function rebateTermsOf(prop, ag) {
  if (prop?.rebate_type) return { mode: 'plot', type: prop.rebate_type, value: Number(prop.rebate_value) || 0 };
  return { mode: 'agreement', down: Number(ag?.rebate_down_pct) || 0, installment: Number(ag?.rebate_installment_pct) || 0, balloon: Number(ag?.rebate_balloon_pct) || 0 };
}

/** Columns that mark a new sale as a developer file (snapshotting the agreement so later edits never rewrite history). */
export function developerSaleFields(prop, saleDate) {
  if (!prop || prop.inventory_source !== 'developer') return null;
  const ag = get('SELECT * FROM developer_agreements WHERE id=?', prop.agreement_id);
  if (!ag) throw bad('The agreement for this plot is missing');
  return {
    developer_id: prop.developer_id, agreement_id: ag.id, booking_id: nextNo('BK', 'BK'), file_state: 'active', holder: 'customer',
    cancel_window_until: ag.cancel_window_days > 0 ? addDays(saleDate, ag.cancel_window_days) : null, cancel_tiers: ag.cancel_tiers || '[]',
    rebate_terms: JSON.stringify(rebateTermsOf(prop, ag)),
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
  if (password) { const pp = passwordProblem(password, { email, name: d.name }); if (pp) throw bad(pp); }
  const pw = password ? String(password) : `${crypto.randomBytes(4).toString('hex')}-${crypto.randomInt(1000, 9999)}`;
  const hash = bcrypt.hashSync(pw, 10);
  const existing = get('SELECT id FROM users WHERE developer_id=?', developerId);
  assertUserEmailFree(email, existing?.id || 0);
  if (existing) {
    run('UPDATE users SET password_hash=?, token_version=token_version+1, active=1, email=? WHERE id=?', hash, email, existing.id);
    return { created: false, login: email, password: pw };
  }
  let role = val("SELECT id FROM roles WHERE name='Developer'");
  if (!role) role = Number(run("INSERT INTO roles(name,description,own_scope,portal,is_system) VALUES('Developer','Developer partner portal only',0,1,1)").lastInsertRowid);
  run('INSERT INTO users(name,email,phone,password_hash,role_id,active,developer_id,created_at) VALUES(?,?,?,?,?,1,?,?)', d.name, email, d.phone || null, hash, role, developerId, now());
  return { created: true, login: email, password: pw };
}

/** Per-plot rebate: what the developer owes the company on this plot, as a percent of the plot price or a fixed amount.
 *  Both empty means the plot follows its agreement's per-stage rates. */
export function cleanRebate(d, price) {
  const type = d.rebate_type === '' || d.rebate_type === undefined ? null : d.rebate_type;
  if (type === null || type === 'none') return { rebate_type: null, rebate_value: null };
  if (!['percent', 'fixed'].includes(type)) throw bad('Rebate type must be percent or fixed');
  const v = num(d.rebate_value);
  if (!(v >= 0)) throw bad('Enter the rebate as a positive number');
  if (type === 'percent' && v > 100) throw bad('A rebate percentage must be between 0 and 100');
  if (type === 'fixed' && price && v > Number(price)) throw bad('A fixed rebate cannot exceed the plot price');
  return { rebate_type: type, rebate_value: v };
}

/** Rebate amount for one plot at its current price (0 when the plot uses the agreement rates). */
export function plotRebateAmount(p) {
  if (!p?.rebate_type) return 0;
  return p.rebate_type === 'percent' ? Math.round((Number(p.net_price) || 0) * Number(p.rebate_value || 0) / 100) : Math.round(Number(p.rebate_value) || 0);
}

const unsold = (p) => p.status !== 'sold' && !get("SELECT 1 FROM sales WHERE property_id=? AND status='confirmed'", p.id);
const plotsByIds = (ids) => {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((x) => int(x)).filter(Boolean))];
  if (!list.length) throw bad('Choose at least one plot');
  if (list.length > 500) throw bad('Link at most 500 plots at a time');
  return list.map((id) => get('SELECT * FROM properties WHERE id=?', id) || (() => { throw bad(`Plot ${id} not found`); })());
};

/** Link already-added properties to a developer + agreement (bulk). Sold or booked plots are skipped and reported. */
export function linkPlots(developerId, agreementId, ids, rebate) {
  const fields = propertyDeveloperFields({ inventory_source: 'developer', developer_id: developerId, agreement_id: agreementId });
  const reb = rebate && rebate.rebate_type ? rebate : null;
  const linked = [], skipped = [];
  for (const p of plotsByIds(ids)) {
    if (!unsold(p)) { skipped.push({ id: p.id, title: p.title, reason: 'Already sold or booked' }); continue; }
    if (p.inventory_source === 'developer' && p.developer_id !== Number(developerId)) { skipped.push({ id: p.id, title: p.title, reason: 'Belongs to another developer' }); continue; }
    const r = reb ? cleanRebate(reb, p.net_price) : null;
    run('UPDATE properties SET inventory_source=?, developer_id=?, agreement_id=?, rebate_type=COALESCE(?,rebate_type), rebate_value=CASE WHEN ? IS NULL THEN rebate_value ELSE ? END, updated_at=? WHERE id=?',
      fields.inventory_source, fields.developer_id, fields.agreement_id, r?.rebate_type ?? null, r?.rebate_type ?? null, r?.rebate_value ?? null, now(), p.id);
    linked.push(p.id);
  }
  return { linked, skipped };
}

/**
 * Combine two or more of one developer's unsold plots into one plot of any size (e.g. two 3-marla plots sold as 6, or as 4 or 5 marla).
 * The sources leave stock (status cancelled, merged_into points at the new plot); when the new size is smaller than their total,
 * the rest becomes a separate plot so no land disappears. The new plot is available but not published on the website.
 */
export function combinePlots(developerId, ids, inp, user) {
  const plots = plotsByIds(ids);
  if (plots.length < 2) throw bad('Choose at least two plots to combine');
  const first = plots[0];
  for (const p of plots) {
    if (p.developer_id !== Number(developerId)) throw bad(`${p.title} is not this developer’s plot`);
    if (!unsold(p)) throw bad(`${p.title} is already sold or booked`);
    if (['cancelled', 'reserved'].includes(p.status)) throw bad(`${p.title} is ${p.status} and cannot be combined`);
    if (p.project_id !== first.project_id || p.agreement_id !== first.agreement_id) throw bad('Plots must be in the same project and under the same agreement');
    if (String(p.unit || '').toLowerCase() !== String(first.unit || '').toLowerCase()) throw bad('Plots must use the same size unit');
  }
  const total = Math.round(plots.reduce((t, p) => t + (Number(p.area_size) || 0), 0) * 100) / 100;
  const area = Math.round((Number(inp.area_size) || total) * 100) / 100;
  if (area <= 0 || area > total) throw bad(`The combined size must be more than 0 and at most ${total} ${first.unit || ''}`.trim());
  const sumPrice = plots.reduce((t, p) => t + (Number(p.net_price) || 0), 0);
  const price = inp.total_price === undefined || inp.total_price === '' || inp.total_price === null ? Math.round(sumPrice * area / total) : int(inp.total_price);
  if (price < 0) throw bad('Price cannot be negative');
  const uniq = (a) => [...new Set(a.map((x) => String(x ?? '').trim()).filter(Boolean))];
  const plotNo = String(inp.plot_no || '').trim() || uniq(plots.map((p) => p.plot_no)).join('/');
  const block = String(inp.block || '').trim() || uniq(plots.map((p) => p.block)).join(', ');
  if (!plotNo) throw bad('Enter the plot number of the combined plot');
  const clash = (no, b) => get("SELECT id FROM properties WHERE project_id IS ? AND IFNULL(block,'')=? AND plot_no=? AND status<>'cancelled'", first.project_id ?? null, b, no);
  if (clash(plotNo, block)) throw bad(`Plot ${plotNo} already exists in this project`);
  const make = (no, blk, size, amount, from) => {
    const code = nextNo('PR', 'PR');
    const r = run(`INSERT INTO properties(code,title,purpose,property_type,project_id,block,sector,plot_no,city,area_name,location,lat,lng,area_size,unit,total_price,price_per_unit,discount,net_price,
      installment_available,ready_possession,inventory_source,developer_id,agreement_id,rebate_type,rebate_value,registration_no,file_status,status,review_state,published,combined_from,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,'developer',?,?,?,?,?,?,'available','draft',0,?,?,?,?)`,
    code, `${size} ${first.unit || ''} Plot ${no}`.replace(/\s+/g, ' ').trim(), first.purpose, first.property_type, first.project_id, blk, first.sector, no, first.city, first.area_name, first.location, first.lat, first.lng, size, first.unit,
    amount, size > 0 ? Math.round(amount / size) : null, amount, first.installment_available, first.ready_possession, first.developer_id, first.agreement_id, first.rebate_type, first.rebate_value,
    nextNo('REG', 'REG', 4), first.file_status, JSON.stringify(from), user?.id ?? null, now(), now());
    return Number(r.lastInsertRowid);
  };
  const from = plots.map((p) => p.id);
  const combinedId = make(plotNo, block, area, price, from);
  let leftoverId = null;
  const rest = Math.round((total - area) * 100) / 100;
  if (rest > 0) {
    const no = String(inp.remainder_plot_no || '').trim() || `${plotNo}-rest`;
    if (clash(no, block)) throw bad(`Plot ${no} already exists in this project`);
    leftoverId = make(no, block, rest, Math.round(sumPrice * rest / total), from);
  }
  for (const p of plots) {
    run("UPDATE properties SET status='cancelled', published=0, merged_into=?, file_notes=?, updated_at=? WHERE id=?", combinedId, `Combined into plot ${plotNo}`, now(), p.id);
  }
  return { id: combinedId, leftover_id: leftoverId, combined: from, area_size: area, leftover_area: rest > 0 ? rest : 0 };
}

/** Return plots to the company's own stock. Booked or sold plots stay put. */
export function unlinkPlots(developerId, ids) {
  const unlinked = [], skipped = [];
  for (const p of plotsByIds(ids)) {
    if (p.developer_id !== Number(developerId)) { skipped.push({ id: p.id, title: p.title, reason: 'Not this developer’s plot' }); continue; }
    if (!unsold(p)) { skipped.push({ id: p.id, title: p.title, reason: 'Already sold or booked' }); continue; }
    run("UPDATE properties SET inventory_source='own', developer_id=NULL, agreement_id=NULL, rebate_type=NULL, rebate_value=NULL, updated_at=? WHERE id=?", now(), p.id);
    unlinked.push(p.id);
  }
  return { unlinked, skipped };
}

/** Set (or clear) the same rebate on many of a developer's plots. ids omitted = every plot of that developer. */
export function setPlotRebates(developerId, ids, rebate) {
  const rows = ids ? plotsByIds(ids) : all('SELECT * FROM properties WHERE developer_id=?', developerId);
  const updated = [], skipped = [];
  for (const p of rows) {
    if (p.developer_id !== Number(developerId)) { skipped.push({ id: p.id, title: p.title, reason: 'Not this developer’s plot' }); continue; }
    const r = cleanRebate(rebate || {}, p.net_price);
    run('UPDATE properties SET rebate_type=?, rebate_value=?, updated_at=? WHERE id=?', r.rebate_type, r.rebate_value, now(), p.id);
    updated.push(p.id);
  }
  return { updated, skipped };
}

export function developerSummary(id) {
  const rebate = all("SELECT net_price, rebate_type, rebate_value, status FROM properties WHERE developer_id=?", id);
  const rebate_expected = rebate.reduce((t, p) => t + plotRebateAmount(p), 0);
  const rebate_on_sold = rebate.filter((p) => p.status === 'sold').reduce((t, p) => t + plotRebateAmount(p), 0);
  const files = get(`SELECT COUNT(*) n, COALESCE(SUM(net_price),0) value, COALESCE(SUM(paid_amount),0) paid FROM sales WHERE developer_id=? AND status='confirmed'`, id);
  return {
    plots: get("SELECT COUNT(*) n FROM properties WHERE developer_id=?", id).n,
    available: get("SELECT COUNT(*) n FROM properties WHERE developer_id=? AND status IN ('available','featured')", id).n,
    rebate_expected, rebate_on_sold,
    files: files.n, contract_value: files.value, collected: files.paid, outstanding: files.value - files.paid,
  };
}
export const listDevelopers = () => all('SELECT * FROM developers ORDER BY status, name').map((d) => ({ ...d, ...developerSummary(d.id) }));

// ---------------------------------------------------------------- developer portal view
/**
 * The ONLY shape in which a developer file leaves the company. Allow-list, built field by field: it never spreads a sale,
 * property or contact row, so CNIC, phone, e-mail, address, agent, notes and margins cannot reach the developer by accident.
 */
export function toDeveloperFile(sale, { detail = false } = {}) {
  const company = get("SELECT value FROM settings WHERE key='company_name'")?.value || 'The company';
  const prop = get('SELECT * FROM properties WHERE id=?', sale.property_id);
  const out = {
    id: sale.id, booking_id: sale.booking_id, booking_date: sale.sale_date, registration_no: prop?.registration_no || null,
    plot: { title: prop?.title || null, plot_no: prop?.plot_no || null, block: prop?.block || null, type: prop?.property_type || null,
      area_size: prop?.area_size ?? null, unit: prop?.unit || null, area_sqft: prop ? toSqft(prop.area_size, prop.unit) : null,
      photos: prop ? all("SELECT path, caption FROM media WHERE entity_type='property' AND entity_id=? AND kind IN ('cover','gallery') ORDER BY sort_order, id", prop.id) : [] },
    customer_name: sale.holder === 'company' ? company : get('SELECT full_name FROM contacts WHERE id=?', sale.contact_id)?.full_name || null,
    held_by_company: sale.holder === 'company',
    file_state: sale.file_state, contract_value: sale.net_price, paid: sale.paid_amount, outstanding: sale.net_price - sale.paid_amount,
    status: sale.status,
  };
  if (detail) {
    out.schedule = all('SELECT seq, kind, due_date, amount, paid, status, paid_date FROM installments WHERE sale_id=? ORDER BY due_date, seq', sale.id);
    out.payments = all(`SELECT r.date, r.payment_type, r.method, rs.amount FROM receipt_sales rs JOIN receipts r ON r.id=rs.receipt_id
      WHERE rs.sale_id=? AND r.status='valid' ORDER BY r.date, r.id`, sale.id);
    out.history = all('SELECT event, from_state, to_state, created_at FROM file_events WHERE sale_id=? ORDER BY id', sale.id);
  }
  return out;
}

export const developerFiles = (developerId) => all("SELECT * FROM sales WHERE developer_id=? AND status IN ('confirmed','cancelled') ORDER BY id DESC", developerId);
