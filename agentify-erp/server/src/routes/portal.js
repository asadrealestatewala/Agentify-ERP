import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, getSetting, uploadDir } from '../db.js';
import { requirePortal } from '../rbac.js';
import { audit } from '../audit.js';
import { asyncH, notFound, jparse, moneyText } from '../util.js';
import { saleSummary } from '../services/sales.js';
import { customerLedger, ledgerTable } from '../services/payments.js';
import { sendPdf } from '../services/pdf.js';
import { sendTable } from './helpers.js';
import { scheduleFor, progressSql } from '../services/schedule.js';
import { portalPromos } from './promos.js';
import { receiptPdf } from '../services/voucherPdf.js';
import { receiptQr } from '../services/receiptQr.js';
import { receiptCopiesPdf } from '../services/receiptSheet.js';
import { receiptRecord } from '../services/customers.js';
import { claimStateByInstallment, dues, ownClaims, proofSent, submitClaim } from '../services/claims.js';
import { uploader } from './helpers.js';
import { createCheckout, ownCheckout, portalGateways } from '../services/gateways.js';

/**
 * Customer portal. Every query is keyed on req.user.contact_id — the id never comes from the client,
 * and only customer-safe columns are selected (no internal notes, expenses, vendors or commissions).
 */
const r = Router();
r.use(requirePortal);

const mine = (req) => req.user.contact_id;
const ownSale = (req, id) => {
  const s = get("SELECT id FROM sales WHERE id=? AND contact_id=? AND status='confirmed'", id, mine(req));
  if (!s) throw notFound('Property not found');
  return s.id;
};
const RECEIPT_SUBJECT = `COALESCE(p.title, (SELECT GROUP_CONCAT(COALESCE(s2.title, p2.title), ' + ') FROM receipt_sales rs2 JOIN sales s2 ON s2.id=rs2.sale_id LEFT JOIN properties p2 ON p2.id=s2.property_id WHERE rs2.receipt_id=r.id))`;

/** Only what a customer should see of a schedule. */
function clientSchedule(s) {
  return {
    summary: s.summary,
    warnings: s.warnings.map(({ type, days, message }) => ({ type, days, message })),
    tasks: s.tasks.map((t) => ({
      id: t.id, parent_id: t.parent_id, name: t.name, is_group: t.is_group, planned_start: t.planned_start, planned_end: t.planned_end, actual_start: t.actual_start, actual_end: t.actual_end,
      progress: t.progress, planned_pct: t.planned_pct, status: t.status, delay_days: t.delay_days || 0, forecast_end: t.forecast_end, forecast_delay_days: t.forecast_delay_days, notes: t.notes,
    })),
  };
}

const BRAND_KEYS = ['company_name', 'company_address', 'company_phone', 'company_email', 'print_logo', 'print_header', 'print_footer', 'print_email', 'print_phone', 'print_address', 'print_website', 'print_social', 'print_show_logo', 'receipt_title', 'receipt_header', 'receipt_footer', 'receipt_terms'];
r.get('/branding', (req, res) => res.json(Object.fromEntries(BRAND_KEYS.map((k) => [k, getSetting(k, '')]))));

r.get('/dashboard', asyncH((req, res) => {
  const c = get('SELECT id,customer_code,full_name,phone,email,cnic,address,city FROM contacts WHERE id=?', mine(req));
  const sales = all("SELECT id FROM sales WHERE contact_id=? AND status='confirmed' ORDER BY id", mine(req)).map((s) => saleSummary(s.id));
  const next = sales.map((s) => s.next_due && { ...s.next_due, property: s.property_title }).filter(Boolean).sort((a, b) => a.due_date.localeCompare(b.due_date))[0] || null;
  const progress = all(`SELECT pr.id, pr.name, pr.dev_status, ${progressSql('pr.id')} progress FROM projects pr
    WHERE pr.id IN (SELECT project_id FROM sales WHERE contact_id=? AND status='confirmed' AND kind='property')`, mine(req));
  const bundles = [...new Set(sales.filter((s) => s.bundle).map((s) => s.bundle_id))].map((id) => sales.find((s) => s.bundle_id === id).bundle);
  res.json({
    customer: c,
    properties: sales.map((s) => {
      const sch = s.kind === 'construction' && s.project_id ? scheduleFor(s.project_id, { scope: s.id, clientOnly: true }) : null;
      return {
        sale_id: s.id, kind: s.kind, title: s.property_title, plot_no: s.plot_no, block: s.block, project: s.project_name, net_price: s.net_price, paid: s.paid_amount, outstanding: s.outstanding,
        bundle_id: s.bundle_id, cover: s.property_id ? get(`SELECT path FROM media WHERE entity_type='property' AND entity_id=? AND kind IN ('cover','gallery') ORDER BY kind='cover' DESC, sort_order LIMIT 1`, s.property_id)?.path ?? null : null,
        schedule: sch?.summary.tasks ? { actual_pct: sch.summary.actual_pct, planned_pct: sch.summary.planned_pct, health: sch.summary.health, projected_delay_days: sch.summary.projected_delay_days } : null,
      };
    }),
    bundles: bundles.map((b) => ({ id: b.id, sales: b.sales.map((x) => ({ id: x.id, kind: x.kind, title: x.title })), net_price: b.net_price, paid_amount: b.paid_amount, outstanding: b.outstanding, monthly_total: b.monthly_total })),
    totals: { purchase_value: sales.reduce((a, s) => a + s.net_price, 0), paid: sales.reduce((a, s) => a + s.paid_amount, 0), outstanding: sales.reduce((a, s) => a + s.outstanding, 0),
      overdue: sales.reduce((a, s) => a + s.overdue_amount, 0) },
    next_installment: next, development: progress,
    recent_payments: all(`SELECT receipt_no,date,amount,payment_type,method FROM receipts WHERE contact_id=? AND status='valid' ORDER BY date DESC, id DESC LIMIT 5`, mine(req)),
    notifications: all('SELECT id,title,body,created_at,read FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 10', req.user.id),
  });
}));

/**
 * The customer's own ledger, optionally for one sale (or its combined plan) and a date range.
 * format=pdf|xlsx|csv downloads it; the contact comes from the session, never from the request.
 */
/** What the customer can pick on the ledger page: their projects, and each property / contract they bought (with combined plans). */
r.get('/ledger-options', asyncH((req, res) => {
  const sales = all(`SELECT s.id, s.sale_no, s.kind, s.bundle_id, s.project_id, COALESCE(s.title, p.title) title, pr.name project_name
    FROM sales s LEFT JOIN properties p ON p.id=s.property_id LEFT JOIN projects pr ON pr.id=s.project_id WHERE s.contact_id=? AND s.status='confirmed' ORDER BY s.id`, mine(req));
  const projects = [...new Map(sales.filter((s) => s.project_id).map((s) => [s.project_id, { id: s.project_id, name: s.project_name }])).values()];
  const bundles = [...new Set(sales.filter((s) => s.bundle_id).map((s) => s.bundle_id))].map((b) => { const m = sales.filter((s) => s.bundle_id === b); return { sale_id: m[0].id, title: m.map((x) => x.title).join(' + '), n: m.length }; }).filter((b) => b.n > 1);
  res.json({ projects, sales: sales.map(({ id, sale_no, kind, title, project_name }) => ({ id, sale_no, kind, title, project_name })), bundles });
}));
r.get('/ledger', asyncH(async (req, res) => {
  const { sale_id, from, to, format, combined, project_id } = req.query;
  const ok = (d) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!ok(from) || !ok(to)) throw notFound('Invalid date');
  let ids = null; let label = 'All properties & contracts';
  if (project_id) {
    const pr = get('SELECT p.id, p.name FROM projects p WHERE p.id=? AND p.id IN (SELECT project_id FROM sales WHERE contact_id=? AND status=\'confirmed\')', Number(project_id), mine(req));
    if (!pr) throw notFound('You have no purchases in this project');
    ids = all("SELECT id FROM sales WHERE contact_id=? AND status='confirmed' AND project_id=? ORDER BY id", mine(req), pr.id).map((x) => x.id);
    label = `Project: ${pr.name}`;
  }
  if (sale_id) {
    ids = [ownSale(req, Number(sale_id))];
    const s = saleSummary(ids[0], false);
    label = s.property_title;
    if (combined === '1' && s.bundle_id) ids = all("SELECT id FROM sales WHERE bundle_id=? AND contact_id=? AND status='confirmed'", s.bundle_id, mine(req)).map((x) => x.id);
  }
  const ledger = customerLedger(mine(req), ids, { from, to });
  if (!['pdf', 'xlsx', 'csv'].includes(format)) return res.json(ledger);
  const c = get('SELECT full_name,phone,cnic FROM contacts WHERE id=?', mine(req));
  const t = ledgerTable(ledger);
  audit(req, 'Portal ledger download', 'contact', mine(req), `${format} ${from || ''}..${to || ''}`);
  if (format === 'pdf') {
    return sendPdf(res, 'account-ledger', { title: 'ACCOUNT LEDGER', subtitle: `${c.full_name} · ${label}\n${from || 'Beginning'} to ${to || 'today'}`, summary: [['Opening balance', `${moneyText((ledger.opening || 0))}`], ['Total debits', `${moneyText((ledger.total_debit ?? t.totals.debit))}`], ['Total payments', `${moneyText((ledger.total_credit ?? t.totals.credit))}`], ['Closing balance (you owe)', `${moneyText(ledger.balance)}`]], columns: t.columns, rows: t.rows, totals: t.totals });
  }
  return sendTable(res, format, 'account-ledger', t.columns, t.rows.concat([{ description: 'Closing balance', balance: ledger.balance }]));
}));

r.get('/properties/:saleId(\\d+)', asyncH((req, res) => {
  const id = ownSale(req, req.params.saleId);
  const s = saleSummary(id);
  let prop = s.property_id ? get('SELECT id,title,property_type,block,plot_no,area_size,unit,city,location,address,lat,lng FROM properties WHERE id=?', s.property_id) : { title: s.property_title };
  if (s.kind === 'construction') prop = { ...prop, title: s.property_title };
  const safe = (({ id: i, sale_no, kind, sale_date, sale_price, discount, net_price, booking_amount, advance_amount, num_installments, installment_amount, balloon_count, balloon_amount, first_due, final_due, paid_amount, outstanding, installments_paid, installments_remaining, overdue_amount, next_due, bundle_id }) =>
    ({ id: i, sale_no, kind, sale_date, sale_price, discount, net_price, booking_amount, advance_amount, num_installments, installment_amount, balloon_count, balloon_amount, first_due, final_due, paid_amount, outstanding, installments_paid, installments_remaining, overdue_amount, next_due, bundle_id }))(s);
  const out = {
    sale: safe, property: prop, project: s.project_id ? get('SELECT id,name,code,location,dev_status FROM projects WHERE id=?', s.project_id) : null,
    images: s.property_id ? all("SELECT id,kind,path,caption FROM media WHERE entity_type='property' AND entity_id=? AND kind IN ('cover','gallery','siteplan','map') ORDER BY sort_order", s.property_id) : [],
    installments: (() => { const st = claimStateByInstallment(mine(req)); return s.installments.map(({ id, seq, kind, due_date, amount, paid, status, paid_date }) => ({ id, seq, kind, due_date, amount, paid, status, paid_date, claim_state: st.get(id) ? (st.get(id).status === 'verifying' ? 'verifying' : 'in_process') : undefined })); })(),
    receipts: all(`SELECT r.id,r.receipt_no,r.date,rs.amount,r.payment_type,r.method,(SELECT COUNT(*) FROM receipt_sales x WHERE x.receipt_id=r.id) parts FROM receipt_sales rs JOIN receipts r ON r.id=rs.receipt_id
      WHERE rs.sale_id=? AND r.contact_id=? AND r.status='valid' AND rs.amount<>0 ORDER BY r.date,r.id`, id, mine(req)),
    ledger: customerLedger(mine(req), id),
    documents: all('SELECT id,name,category,created_at FROM documents WHERE entity_type=? AND entity_id=? AND portal_visible=1', 'sale', id),
  };
  if (s.bundle) {
    out.bundle = s.bundle;
    out.bundle_ledger = customerLedger(mine(req), s.bundle.sales.map((x) => x.id));
  }
  if (s.kind === 'construction' && s.project_id) out.schedule = clientSchedule(scheduleFor(s.project_id, { scope: s.id, clientOnly: true }));
  res.json(out);
}));

r.get('/development', asyncH((req, res) => {
  const projects = all("SELECT DISTINCT project_id id FROM sales WHERE contact_id=? AND status='confirmed' AND project_id IS NOT NULL", mine(req));
  res.json(projects.map(({ id }) => {
    const p = get('SELECT id,name,code,location,dev_status,expected_completion,kind FROM projects WHERE id=?', id);
    const shared = scheduleFor(id, { scope: 'project', clientOnly: true });
    const contracts = all("SELECT id,title,sale_no FROM sales WHERE contact_id=? AND project_id=? AND kind='construction' AND status='confirmed'", mine(req), id)
      .map((c) => ({ sale_id: c.id, title: c.title, sale_no: c.sale_no, schedule: clientSchedule(scheduleFor(id, { scope: c.id, clientOnly: true })) }));
    return {
      ...p, progress: get(`SELECT ${progressSql(String(Number(id)))} v`).v ?? 0,
      schedule: shared.tasks.length ? clientSchedule(shared) : null, contracts,
      items: all('SELECT name,progress FROM dev_items WHERE project_id=? ORDER BY sort_order,id', id),
      updates: all('SELECT id,update_date,title,kind,progress,description,videos FROM dev_updates WHERE project_id=? AND published=1 ORDER BY update_date DESC, id DESC LIMIT 30', id)
        .map((u) => ({ ...u, videos: jparse(u.videos, []), media: all("SELECT id,kind,path,caption FROM media WHERE entity_type='dev_update' AND entity_id=? ORDER BY sort_order", u.id) })),
    };
  }));
}));

/**
 * Construction progress for the client's own projects (projects of their construction contracts): % complete from
 * measured BOQ progress, milestones, change orders and site reports that staff marked as visible to the client.
 * Costs, budgets, suppliers and internal notes are never included.
 */
r.get('/construction', asyncH((req, res) => {
  const projects = all("SELECT DISTINCT p.id, p.name, p.location, p.start_date, p.expected_completion FROM sales s JOIN projects p ON p.id=s.project_id WHERE s.contact_id=? AND s.kind='construction' AND s.status='confirmed'", mine(req));
  res.json(projects.map((p) => {
    const boq = get('SELECT COALESCE(SUM(qty*rate),0) v, COALESCE(SUM(MIN(completed_qty,qty)*rate),0) e FROM con_boq_items WHERE project_id=?', p.id);
    return {
      ...p, percent_complete: boq.v ? Math.round((boq.e / boq.v) * 1000) / 10 : null,
      milestones: all('SELECT id, name, due_date, achieved_at FROM con_milestones WHERE project_id=? AND client_visible=1 ORDER BY due_date IS NULL, due_date', p.id),
      change_orders: all("SELECT co_no, title, description, amount, days_impact, status, decided_at FROM con_change_orders WHERE project_id=? AND client_visible=1 AND status IN ('submitted','approved') ORDER BY id DESC", p.id),
      reports: all('SELECT id, date, weather, work_done FROM con_daily_reports WHERE project_id=? AND client_visible=1 ORDER BY date DESC, id DESC LIMIT 30', p.id),
    };
  }));
}));
r.get('/payments', asyncH((req, res) => {
  res.json(all(`SELECT r.id,r.receipt_no,r.date,r.amount,r.payment_type,r.method,${RECEIPT_SUBJECT} property FROM receipts r LEFT JOIN properties p ON p.id=r.property_id
    WHERE r.contact_id=? AND r.status='valid' ORDER BY r.date DESC, r.id DESC`, mine(req)));
}));
r.get('/receipts/:id(\\d+)', asyncH((req, res) => {
  const rc = get(`SELECT r.receipt_no,r.date,r.amount,r.payment_type,r.method,r.reference_no,r.txn_id,${RECEIPT_SUBJECT} property,pr.name project,c.full_name customer, r.id
    FROM receipts r JOIN contacts c ON c.id=r.contact_id LEFT JOIN properties p ON p.id=r.property_id LEFT JOIN projects pr ON pr.id=r.project_id
    WHERE r.id=? AND r.contact_id=? AND r.status='valid'`, req.params.id, mine(req));
  if (!rc) throw notFound();
  rc.parts = all(`SELECT s.sale_no, s.kind, COALESCE(s.title, p.title) title, rs.amount FROM receipt_sales rs JOIN sales s ON s.id=rs.sale_id LEFT JOIN properties p ON p.id=s.property_id WHERE rs.receipt_id=?`, rc.id);
  rc.record = receiptRecord(mine(req), get("SELECT rs.sale_id id FROM receipt_sales rs JOIN sales s ON s.id=rs.sale_id WHERE rs.receipt_id=? ORDER BY (s.kind='property') DESC, s.id LIMIT 1", rc.id)?.id);
  res.json(rc);
}));

/** Documents a customer may open: their own, their sales' (contracts…) and shared drawings of the projects they bought into. */
const DOC_SCOPE = `d.portal_visible=1 AND (
    (d.entity_type='contact' AND d.entity_id=?) OR (d.entity_type='sale' AND d.entity_id IN (SELECT id FROM sales WHERE contact_id=? AND status='confirmed'))
    OR (d.entity_type='project' AND d.entity_id IN (SELECT project_id FROM sales WHERE contact_id=? AND status='confirmed' AND project_id IS NOT NULL))
    OR (d.entity_type='property' AND d.entity_id IN (SELECT property_id FROM sales WHERE contact_id=? AND status='confirmed' AND property_id IS NOT NULL)))`;
r.get('/receipts/:id(\\d+)/pdf', asyncH(async (req, res) => {
  const rc = get(`SELECT r.id,r.receipt_no,r.date,r.amount,r.advance_amount,r.payment_type,r.method,r.reference_no,r.txn_id,r.cheque_no,r.bank,r.sender,r.notes,r.status,${RECEIPT_SUBJECT} property_title,pr.name project_name,c.full_name customer_name, c.customer_code
    FROM receipts r JOIN contacts c ON c.id=r.contact_id LEFT JOIN properties p ON p.id=r.property_id LEFT JOIN projects pr ON pr.id=r.project_id WHERE r.id=? AND r.contact_id=? AND r.status='valid'`, req.params.id, mine(req));
  if (!rc) throw notFound();
  rc.parts = all(`SELECT s.sale_no, s.kind, COALESCE(s.title, p.title) title, rs.amount FROM receipt_sales rs JOIN sales s ON s.id=rs.sale_id LEFT JOIN properties p ON p.id=s.property_id WHERE rs.receipt_id=?`, rc.id);
  rc.record = receiptRecord(mine(req), get("SELECT rs.sale_id id FROM receipt_sales rs JOIN sales s ON s.id=rs.sale_id WHERE rs.receipt_id=? ORDER BY (s.kind='property') DESC, s.id LIMIT 1", rc.id)?.id);
  audit(req, 'Portal receipt PDF download', 'receipt', rc.id, rc.receipt_no);
  const full = get('SELECT r.id, r.receipt_no, r.date, r.amount, r.payment_type, r.sale_id, c.full_name customer_name, c.customer_code FROM receipts r JOIN contacts c ON c.id=r.contact_id WHERE r.id=?', rc.id);
  Object.assign(rc, { customer_name: full.customer_name, customer_code: full.customer_code });
  receiptCopiesPdf(res, rc, { qr: getSetting('receipt_qr', '1') !== '0' ? await receiptQr(full, req) : null, layout: 'client' }); // customers get their own A4 page
}));
r.get('/documents', asyncH((req, res) => {
  const c = mine(req);
  res.json(all(`SELECT d.id,d.name,d.category,d.created_at,d.mime,d.entity_type,
    CASE d.entity_type WHEN 'sale' THEN (SELECT COALESCE(s.title,p.title) FROM sales s LEFT JOIN properties p ON p.id=s.property_id WHERE s.id=d.entity_id)
      WHEN 'project' THEN (SELECT name FROM projects WHERE id=d.entity_id) WHEN 'property' THEN (SELECT title FROM properties WHERE id=d.entity_id) ELSE NULL END related
    FROM documents d WHERE ${DOC_SCOPE} ORDER BY d.id DESC`, c, c, c, c));
}));
r.get('/promos', asyncH((_req, res) => res.json(portalPromos())));
/** Bank / wallet details the customer can pay into (from Settings → Payment methods). */
/** "I have paid": the customer reports a payment (with a slip) for finance to verify and turn into a receipt. */
const slipUp = uploader('claims', 'documents', 8);
r.post('/payment-claims', slipUp.single('slip'), asyncH((req, res) => {
  res.status(201).json(submitClaim(req, req.body || {}, req.file ? `claims/${req.file.filename}` : null));
}));
r.get('/payment-claims', asyncH((req, res) => res.json(ownClaims(mine(req)))));
r.get('/pay-online', asyncH((_req, res) => res.json(portalGateways())));
r.post('/pay-online', asyncH(async (req, res) => res.status(201).json(await createCheckout(req, req.body || {}))));
r.get('/pay-online/:token', asyncH((req, res) => res.json(ownCheckout(mine(req), String(req.params.token)))));
r.get('/dues', asyncH((req, res) => res.json(dues(mine(req)))));
r.post('/payment-claims/:id(\\d+)/proof-sent', asyncH((req, res) => { proofSent(req, Number(req.params.id)); res.json({ ok: true }); }));
r.get('/pay-to', asyncH((_req, res) => {
  res.json(all("SELECT value name, meta FROM lookups WHERE type='payment_method' AND active=1 ORDER BY sort_order").map((m) => ({ name: m.name, ...jparse(m.meta, {}) }))
    .filter((m) => m.account_number || m.iban || m.wallet_number || m.instructions).map(({ name, kind, bank_name, account_title, account_number, iban, branch, wallet_number, instructions }) => ({ name, kind, bank_name, account_title, account_number, iban, branch, wallet_number, instructions })));
}));
r.get('/documents/:id(\\d+)/file', asyncH((req, res) => {
  const c = mine(req);
  const d = get(`SELECT d.* FROM documents d WHERE d.id=? AND ${DOC_SCOPE}`, req.params.id, c, c, c, c);
  if (!d) throw notFound();
  const file = path.join(uploadDir(), d.path);
  if (!file.startsWith(uploadDir()) || !fs.existsSync(file)) throw notFound('File missing');
  audit(req, 'Portal document download', 'document', d.id, d.name);
  res.setHeader('Content-Type', d.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.name)}`);
  res.sendFile(file);
}));

export default r;
