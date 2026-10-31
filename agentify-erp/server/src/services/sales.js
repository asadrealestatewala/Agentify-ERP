import bcrypt from 'bcryptjs';
import { ensureCustomerCode } from './customers.js';
import crypto from 'node:crypto';
import { get, all, run, tx, nextNo } from '../db.js';
import { now, today, bad, int, addMonths, notFound, curCode } from '../util.js';
import { postJournal } from './accounting.js';
import { generateCommission, cancelCommission } from './commissions.js';
import { receivePayment } from './payments.js';
import { audit, activity, notify, notifyPerm } from '../audit.js';
import { fireWebhook } from './website.js';
import { developerSaleFields, logFileEvent } from './developers.js';

export function planSchedule(inp) {
  const net = int(inp.sale_price) - int(inp.discount);
  const booking = int(inp.booking_amount), advance = int(inp.advance_amount);
  const remaining = net - booking - advance;
  if (net <= 0) throw bad('Net sale price must be positive');
  if (remaining < 0) throw bad('Booking + advance exceed the net sale price');
  const n = int(inp.num_installments);
  const bc = int(inp.balloon_count), ba = int(inp.balloon_amount);
  const interval = int(inp.balloon_interval, 6) || 6;
  const balloonTotal = bc * ba;
  if (balloonTotal > remaining) throw bad('Balloon payments exceed the remaining balance');
  const regular = remaining - balloonTotal;
  if (regular > 0 && n <= 0) throw bad('Remaining balance is not covered: add installments, balloon payments or raise the booking amount');
  if ((n > 0 || bc > 0) && !inp.first_due) throw bad('First due date is required');
  const rows = [];
  const saleDate = inp.sale_date || today();
  if (booking > 0) rows.push({ kind: 'booking', due_date: saleDate, amount: booking });
  if (advance > 0) rows.push({ kind: 'advance', due_date: saleDate, amount: advance });
  if (n > 0) {
    let ia = int(inp.installment_amount) || Math.round(regular / n);
    if (ia * n > regular) ia = Math.floor(regular / n);
    let accumulated = 0;
    for (let i = 0; i < n; i++) {
      const amt = i === n - 1 ? regular - accumulated : ia; // last installment absorbs rounding
      accumulated += amt;
      rows.push({ kind: 'installment', due_date: addMonths(inp.first_due, i), amount: amt });
    }
  }
  const dates = Array.isArray(inp.balloon_dates) ? inp.balloon_dates : [];
  for (let j = 0; j < bc; j++) {
    rows.push({ kind: 'balloon', due_date: dates[j] || addMonths(inp.first_due, (j + 1) * interval - 1), amount: ba });
  }
  rows.sort((a, b) => a.due_date.localeCompare(b.due_date) || (a.kind === 'balloon') - (b.kind === 'balloon'));
  rows.forEach((r, i) => { r.seq = i + 1; });
  const dueDates = rows.map((r) => r.due_date);
  return { net, rows, first_due: dueDates[0] ?? null, final_due: dueDates[dueDates.length - 1] ?? null, installment_amount: n > 0 ? rows.find((r) => r.kind === 'installment').amount : 0 };
}

export function ensurePortalUser(contactId) {
  const c = get('SELECT * FROM contacts WHERE id=?', contactId);
  const existing = get('SELECT id FROM users WHERE contact_id=?', contactId);
  if (existing) return null;
  if (!c.email && !c.phone) return null;
  if (c.email && get('SELECT id FROM users WHERE email=?', c.email)) return null;
  const role = get("SELECT id FROM roles WHERE name='Customer'");
  const pwd = crypto.randomBytes(5).toString('hex');
  run('INSERT INTO users(name,email,phone,password_hash,role_id,contact_id,created_at) VALUES(?,?,?,?,?,?,?)',
    c.full_name, c.email || null, c.phone || null, bcrypt.hashSync(pwd, 10), role.id, contactId, now());
  return { login: c.email || c.phone, password: pwd };
}

export const incomeAccount = (kind) => (kind === 'construction' ? '4150' : '4100');
const KIND_LABEL = { property: 'Property sale', construction: 'Construction contract' };

/** Join a new sale to the same bundle as `otherId` (creating the bundle if needed) — one combined plan, no re-entry. */
function joinBundle(newId, otherId, contactId) {
  const other = get('SELECT * FROM sales WHERE id=?', otherId);
  if (!other || other.contact_id !== contactId) throw bad('The linked sale must belong to the same customer');
  if (other.status !== 'confirmed') throw bad('The linked sale is not active');
  let bid = other.bundle_id;
  if (!bid) {
    bid = Number(run('INSERT INTO sale_bundles(contact_id,name,created_at) VALUES(?,?,?)', contactId, 'Combined plan', now()).lastInsertRowid);
    run('UPDATE sales SET bundle_id=? WHERE id=?', bid, otherId);
  }
  run('UPDATE sales SET bundle_id=?, linked_sale_id=? WHERE id=?', bid, otherId, newId);
  return bid;
}

function createSaleTx(inp, req) {
  const user = req.user;
  const kind = inp.kind === 'construction' ? 'construction' : 'property';
  const contact = get('SELECT * FROM contacts WHERE id=?', inp.contact_id);
  if (!contact) throw bad('Customer not found');
  const prop = inp.property_id ? get('SELECT * FROM properties WHERE id=?', inp.property_id) : null;
  let projectId = null, title = null;
  if (kind === 'property') {
    if (!prop) throw bad('Property not found');
    if (prop.status === 'sold') throw bad('This property is already sold and cannot be sold again');
    if (['draft', 'cancelled'].includes(prop.status)) throw bad(`A ${prop.status} property cannot be sold — publish or make it available first`);
    if (prop.status === 'reserved' && prop.reserved_contact_id && prop.reserved_contact_id !== contact.id) throw bad('This property is reserved for another customer');
    projectId = prop.project_id;
  } else {
    const project = inp.project_id ? get('SELECT * FROM projects WHERE id=?', inp.project_id) : null;
    if (!project) throw bad('Select the construction project for this contract');
    if (!String(inp.title || '').trim()) throw bad('Enter a contract title, e.g. "House construction — Plot 7C"');
    projectId = project.id; title = String(inp.title).trim();
    if (inp.property_id && !prop) throw bad('Linked plot not found');
  }
  const agentId = inp.agent_id || contact.agent_id || (user.own_scope ? user.id : null);
  if (user.own_scope && agentId !== user.id) throw bad('Agents can only record sales under their own name');
  const body = {
    ...inp,
    sale_price: int(inp.sale_price, kind === 'property' ? prop.total_price : 0),
    discount: inp.discount === undefined || inp.discount === '' ? (kind === 'property' ? prop.discount : 0) : int(inp.discount),
    sale_date: inp.sale_date || today(),
  };
  const plan = planSchedule(body);
  const saleNo = nextNo('SL', 'SL');
  const r = run(`INSERT INTO sales(sale_no,kind,title,contact_id,property_id,project_id,sale_date,sale_price,discount,net_price,booking_amount,advance_amount,
    num_installments,installment_amount,balloon_count,balloon_amount,balloon_interval,first_due,final_due,agent_id,manager_id,status,notes,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  saleNo, kind, title, contact.id, prop?.id ?? null, projectId, body.sale_date, body.sale_price, body.discount, plan.net,
  int(body.booking_amount), int(body.advance_amount), int(body.num_installments), plan.installment_amount,
  int(body.balloon_count), int(body.balloon_amount), int(body.balloon_interval, 6), plan.first_due, plan.final_due,
  agentId, contact.manager_id, 'confirmed', body.notes ?? null, user.id, now());
  const id = Number(r.lastInsertRowid);
  // a plot owned by a developer: the money is the developer's, so the sale is a pass-through contract, not company revenue
  const dev = kind === 'property' ? developerSaleFields(prop, body.sale_date) : null;
  if (dev) {
    run(`UPDATE sales SET developer_id=?, agreement_id=?, booking_id=?, file_state=?, holder=?, cancel_window_until=?, cancel_tiers=? WHERE id=?`,
      dev.developer_id, dev.agreement_id, dev.booking_id, dev.file_state, dev.holder, dev.cancel_window_until, dev.cancel_tiers, id);
    logFileEvent(id, 'booked', { to: 'active', user, amount: plan.net, note: dev.booking_id });
  }
  for (const row of plan.rows) run('INSERT INTO installments(sale_id,seq,kind,due_date,amount) VALUES(?,?,?,?,?)', id, row.seq, row.kind, row.due_date, row.amount);
  const label = prop?.title && kind === 'property' ? prop.title : title;

  if (kind === 'property') run("UPDATE properties SET status='sold', reserved_contact_id=NULL, updated_at=? WHERE id=?", now(), prop.id);
  const won = get(`SELECT id,value FROM lookups WHERE type='lead_stage' AND meta LIKE '%"kind":"won"%' LIMIT 1`);
  const prevStage = get('SELECT value FROM lookups WHERE id=?', contact.stage_id)?.value;
  run(`UPDATE contacts SET is_customer=1, customer_since=COALESCE(customer_since,?), stage_id=COALESCE(?,stage_id),
    agent_id=COALESCE(agent_id,?), followup_date=NULL, updated_at=? WHERE id=?`, today(), won?.id ?? null, agentId, now(), contact.id);
  ensureCustomerCode(contact.id);
  if (!contact.is_customer) activity(contact.id, user, 'Customer converted', { detail: saleNo });
  if (won && prevStage !== won.value) activity(contact.id, user, 'Lead stage changed', { field: 'Lead stage', prev: prevStage, next: won.value });
  activity(contact.id, user, kind === 'property' ? 'Property sold' : 'Construction contract signed', { detail: `${label} — ${saleNo}`, entityType: 'sale', entityId: id });

  const jid = postJournal({
    date: body.sale_date, memo: `${KIND_LABEL[kind]} ${saleNo} — ${label}`, refType: 'sale', refId: id, projectId, userId: user.id,
    lines: [{ account: '1300', debit: plan.net, contactId: contact.id, saleId: id }, { account: dev ? '2610' : incomeAccount(kind), credit: plan.net, contactId: contact.id, saleId: id }],
  });
  run('UPDATE sales SET journal_id=? WHERE id=?', jid, id);
  if (inp.linked_sale_id) joinBundle(id, Number(inp.linked_sale_id), contact.id);
  generateCommission(id, user);
  if (inp.collect_booking && int(body.booking_amount) > 0) {
    receivePayment({ contact_id: contact.id, sale_id: id, amount: int(body.booking_amount), payment_type: 'Booking Payment', date: body.sale_date, ...inp.collect_booking }, req);
  }
  audit(req, kind === 'property' ? 'Created sale' : 'Created construction contract', 'sale', id, `${saleNo} ${label} for ${contact.full_name}, net ${curCode()} ${plan.net}`);
  notify([agentId, contact.manager_id], 'sale', kind === 'property' ? 'Property sold' : 'Construction contract signed', `${label} — ${contact.full_name}`, `/sales/${id}`);
  notifyPerm('accounting', 'view', 'sale', kind === 'property' ? 'Property sold' : 'Construction contract signed', `${saleNo}: ${label}`, `/sales/${id}`);
  return { id, contact, agentId, prop };
}

/**
 * Creates a sale. A property sale may carry a nested `construction` contract: it inherits the customer, plot,
 * agent, dates and installment cadence unless overridden, and both join one combined payment plan.
 */
export function createSale(inp, req) {
  let portalCreds = null;
  const ids = tx(() => {
    const main = createSaleTx(inp, req);
    const made = [main.id];
    if (inp.construction && inp.kind !== 'construction') {
      const c = inp.construction;
      const child = createSaleTx({
        kind: 'construction', contact_id: inp.contact_id, property_id: inp.property_id, agent_id: main.agentId, sale_date: inp.sale_date, first_due: inp.first_due,
        num_installments: inp.num_installments, title: `House construction — ${main.prop?.title || ''}`,
        ...c, linked_sale_id: main.id,
      }, req);
      made.push(child.id);
    }
    portalCreds = ensurePortalUser(main.contact.id);
    return made;
  });
  if (inp.kind !== 'construction') fireWebhook(inp.property_id, 'property.sold');
  return { id: ids[0], ids, portal: portalCreds };
}

export function cancelSale(id, reason, req) {
  tx(() => {
    const s = get('SELECT * FROM sales WHERE id=?', id);
    if (!s) throw notFound('Sale not found');
    if (s.status === 'cancelled') throw bad('Sale already cancelled');
    if (get("SELECT 1 FROM receipt_sales rs JOIN receipts r ON r.id=rs.receipt_id WHERE rs.sale_id=? AND r.status='valid'", id)) {
      throw bad('This sale has valid receipts. Void or refund them before cancelling the sale.');
    }
    const comm = get("SELECT id FROM commissions WHERE sale_id=? AND status<>'cancelled'", id);
    if (comm) cancelCommission(comm.id, req);
    if (s.journal_id) {
      postJournal({
        memo: `Sale ${s.sale_no} cancelled`, refType: 'sale', refId: id, projectId: s.project_id, userId: req.user.id, reversalOf: s.journal_id,
        lines: [{ account: s.developer_id ? '2610' : incomeAccount(s.kind), debit: s.net_price, contactId: s.contact_id, saleId: id }, { account: '1300', credit: s.net_price, contactId: s.contact_id, saleId: id }],
      });
    }
    if (s.developer_id) logFileEvent(id, 'cancelled', { from: s.file_state, to: 'cancelled', user: req.user, note: reason });
    run("UPDATE sales SET status='cancelled', notes=COALESCE(notes,'')||? WHERE id=?", `\nCancelled: ${reason || ''}`, id);
    if (s.kind === 'property' && s.property_id) run("UPDATE properties SET status='available', updated_at=? WHERE id=?", now(), s.property_id);
    if (!get("SELECT 1 FROM sales WHERE contact_id=? AND status='confirmed'", s.contact_id)) run('UPDATE contacts SET is_customer=0 WHERE id=?', s.contact_id);
    activity(s.contact_id, req.user, 'Sale cancelled', { detail: `${s.sale_no} ${reason || ''}` });
    audit(req, 'Cancelled sale', 'sale', id, `${s.sale_no} ${reason || ''}`);
  });
  const s = get('SELECT property_id, kind FROM sales WHERE id=?', id);
  if (s.kind === 'property' && s.property_id) fireWebhook(s.property_id, 'property.available');
}

/** Ledger summary for a sale — always derived from installments + receipts. */
export function saleSummary(id, withBundle = true) {
  const s = get(`SELECT s.*, COALESCE(s.title, p.title) property_title, p.plot_no, p.block, p.property_type, pr.name project_name, pr.code project_code,
      c.full_name customer_name, c.phone customer_phone, u.name agent_name
    FROM sales s LEFT JOIN properties p ON p.id=s.property_id LEFT JOIN projects pr ON pr.id=s.project_id
    JOIN contacts c ON c.id=s.contact_id LEFT JOIN users u ON u.id=s.agent_id WHERE s.id=?`, id);
  if (!s) return null;
  const inst = all('SELECT * FROM installments WHERE sale_id=? ORDER BY due_date, seq', id);
  const t = today();
  const paidRows = inst.filter((i) => i.status === 'paid');
  const overdue = inst.filter((i) => i.status !== 'paid' && i.due_date < t);
  const upcoming = inst.find((i) => i.status !== 'paid' && i.due_date >= t) || null;
  const out = {
    ...s, installments: inst, outstanding: s.net_price - s.paid_amount,
    installments_paid: paidRows.filter((i) => i.kind === 'installment').length,
    installments_remaining: inst.filter((i) => i.kind === 'installment' && i.status !== 'paid').length,
    balloons_paid: paidRows.filter((i) => i.kind === 'balloon').length,
    overdue_amount: overdue.reduce((a, i) => a + (i.amount - i.paid), 0), overdue_count: overdue.length,
    next_due: upcoming ? { id: upcoming.id, due_date: upcoming.due_date, amount: upcoming.amount - upcoming.paid, kind: upcoming.kind } : null,
    late_payments: all(`SELECT i.* FROM installments i WHERE i.sale_id=? AND i.status='paid' AND i.paid_date>i.due_date`, id).length,
  };
  if (withBundle && s.bundle_id) out.bundle = bundleSummary(s.bundle_id);
  return out;
}

/** One customer, several sales paid together: combined totals and a merged month-by-month schedule. */
export function bundleSummary(bundleId) {
  const ids = all("SELECT id FROM sales WHERE bundle_id=? AND status='confirmed' ORDER BY id", bundleId).map((r) => r.id);
  if (ids.length < 2) return null;
  const sales = ids.map((i) => saleSummary(i, false));
  const months = new Map();
  for (const s of sales) {
    for (const i of s.installments) {
      const row = months.get(i.due_date) || { due_date: i.due_date, amount: 0, paid: 0, parts: [] };
      row.amount += i.amount; row.paid += i.paid;
      row.parts.push({ sale_id: s.id, label: s.kind === 'construction' ? 'Construction' : 'Plot', kind: i.kind, amount: i.amount, paid: i.paid });
      months.set(i.due_date, row);
    }
  }
  const t = today();
  return {
    id: bundleId,
    sales: sales.map((s) => ({ id: s.id, sale_no: s.sale_no, kind: s.kind, title: s.property_title, net_price: s.net_price, paid_amount: s.paid_amount, outstanding: s.outstanding,
      installment_amount: s.installment_amount, overdue_amount: s.overdue_amount, project_name: s.project_name, next_due: s.next_due })),
    net_price: sales.reduce((a, s) => a + s.net_price, 0), paid_amount: sales.reduce((a, s) => a + s.paid_amount, 0),
    outstanding: sales.reduce((a, s) => a + s.outstanding, 0), overdue_amount: sales.reduce((a, s) => a + s.overdue_amount, 0),
    monthly_total: sales.reduce((a, s) => a + s.installment_amount, 0),
    schedule: [...months.values()].sort((a, b) => a.due_date.localeCompare(b.due_date))
      .map((m) => ({ ...m, status: m.paid >= m.amount ? 'paid' : m.due_date < t ? 'overdue' : m.paid > 0 ? 'partial' : 'pending' })),
  };
}
