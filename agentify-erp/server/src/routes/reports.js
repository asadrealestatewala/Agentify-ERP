import { Router } from 'express';
import { all, get } from '../db.js';
import { can, hasPerm, ownerId, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { sendTable } from './helpers.js';
import { sendPdf } from '../services/pdf.js';
import { asyncH, bad, forbidden, dateRange, today } from '../util.js';
import { trialBalance, accountBalance, isDebitNature } from '../services/accounting.js';
import { projectFinancials } from '../services/projectFinance.js';

const r = Router();
r.use(requireStaff);

const C = (key, label, type) => ({ key, label, type });
const money = 'money';

/** f = {from,to,project_id,agent_id,contact_id,property_id,method,account_id} */
const REPORTS = [
  { key: 'sales-by-agent', group: 'Sales', title: 'Sales by agent', module: 'reports',
    run: (f) => ({ columns: [C('agent', 'Agent'), C('sales', 'Sales'), C('value', 'Sales value', money), C('collected', 'Collected', money), C('commission', 'Commission', money)],
      rows: all(`SELECT COALESCE(u.name,'Unassigned') agent, COUNT(*) sales, SUM(s.net_price) value, SUM(s.paid_amount) collected,
        (SELECT COALESCE(SUM(amount),0) FROM commissions c WHERE c.agent_id=s.agent_id AND c.status<>'cancelled') commission
        FROM sales s LEFT JOIN users u ON u.id=s.agent_id WHERE s.status='confirmed' AND s.sale_date BETWEEN ? AND ? ${f.project_id ? 'AND s.project_id=' + Number(f.project_id) : ''} ${f.agent_id ? 'AND s.agent_id=' + Number(f.agent_id) : ''}
        GROUP BY s.agent_id ORDER BY value DESC`, f.from, f.to) }) },
  { key: 'sales-by-project', group: 'Sales', title: 'Sales by project', module: 'reports',
    run: (f) => ({ columns: [C('project', 'Project'), C('sales', 'Units sold'), C('value', 'Sales value', money), C('collected', 'Collected', money), C('receivable', 'Receivable', money)],
      rows: all(`SELECT COALESCE(p.name,'—') project, COUNT(*) sales, SUM(s.net_price) value, SUM(s.paid_amount) collected, SUM(s.net_price-s.paid_amount) receivable
        FROM sales s LEFT JOIN projects p ON p.id=s.project_id WHERE s.status='confirmed' AND s.sale_date BETWEEN ? AND ? ${f.agent_id ? 'AND s.agent_id=' + Number(f.agent_id) : ''} GROUP BY s.project_id ORDER BY value DESC`, f.from, f.to) }) },
  { key: 'sales-by-property', group: 'Sales', title: 'Sales by property', module: 'reports',
    run: (f) => ({ columns: [C('sale_no', 'Sale'), C('sale_date', 'Date'), C('property', 'Property'), C('project', 'Project'), C('customer', 'Customer'), C('agent', 'Agent'), C('net_price', 'Net price', money), C('paid', 'Paid', money)],
      rows: all(`SELECT s.sale_no, s.sale_date, COALESCE(s.title, p.title) property, pr.name project, c.full_name customer, u.name agent, s.net_price, s.paid_amount paid FROM sales s LEFT JOIN properties p ON p.id=s.property_id
        LEFT JOIN projects pr ON pr.id=s.project_id JOIN contacts c ON c.id=s.contact_id LEFT JOIN users u ON u.id=s.agent_id WHERE s.status='confirmed' AND s.sale_date BETWEEN ? AND ?
        ${f.project_id ? 'AND s.project_id=' + Number(f.project_id) : ''} ${f.agent_id ? 'AND s.agent_id=' + Number(f.agent_id) : ''} ${f.property_id ? 'AND s.property_id=' + Number(f.property_id) : ''} ORDER BY s.sale_date DESC`, f.from, f.to) }) },
  { key: 'sales-by-month', group: 'Sales', title: 'Sales by month', module: 'reports',
    run: (f) => ({ columns: [C('month', 'Month'), C('sales', 'Sales'), C('value', 'Sales value', money), C('collected', 'Collected', money)],
      rows: all(`SELECT substr(sale_date,1,7) month, COUNT(*) sales, SUM(net_price) value, SUM(paid_amount) collected FROM sales WHERE status='confirmed' AND sale_date BETWEEN ? AND ?
        ${f.project_id ? 'AND project_id=' + Number(f.project_id) : ''} GROUP BY month ORDER BY month`, f.from, f.to) }) },
  { key: 'sales-conversion', group: 'Sales', title: 'Sales conversion', module: 'reports',
    run: (f) => ({ columns: [C('agent', 'Agent'), C('leads', 'Leads'), C('converted', 'Converted'), C('rate', 'Conversion %')],
      rows: all(`SELECT u.name agent, COUNT(c.id) leads, SUM(c.is_customer) converted, ROUND(100.0*SUM(c.is_customer)/COUNT(c.id),1) rate FROM contacts c JOIN users u ON u.id=c.agent_id
        WHERE date(c.created_at) BETWEEN ? AND ? GROUP BY c.agent_id ORDER BY rate DESC`, f.from, f.to) }) },
  { key: 'commission', group: 'Sales', title: 'Commission report', module: 'reports',
    run: (f) => ({ columns: [C('commission_no', 'Commission'), C('agent', 'Agent'), C('sale_no', 'Sale'), C('customer', 'Customer'), C('base', 'Sale value', money), C('amount', 'Commission', money), C('paid', 'Paid', money), C('balance', 'Balance', money), C('status', 'Status')],
      rows: all(`SELECT cm.commission_no, u.name agent, s.sale_no, c.full_name customer, cm.base_amount base, cm.amount, cm.paid_amount paid, cm.amount-cm.paid_amount balance, cm.status
        FROM commissions cm JOIN users u ON u.id=cm.agent_id JOIN sales s ON s.id=cm.sale_id LEFT JOIN contacts c ON c.id=cm.contact_id WHERE date(cm.created_at) BETWEEN ? AND ?
        ${f.agent_id ? 'AND cm.agent_id=' + Number(f.agent_id) : ''} ${f.project_id ? 'AND cm.project_id=' + Number(f.project_id) : ''} ORDER BY cm.id DESC`, f.from, f.to) }) },

  { key: 'crm-by-source', group: 'CRM', title: 'Leads by source', module: 'reports',
    run: (f) => ({ columns: [C('source', 'Source'), C('leads', 'Leads'), C('customers', 'Converted')],
      rows: all(`SELECT COALESCE(lead_source,'Unknown') source, COUNT(*) leads, SUM(is_customer) customers FROM contacts WHERE date(created_at) BETWEEN ? AND ? GROUP BY lead_source ORDER BY leads DESC`, f.from, f.to) }) },
  { key: 'crm-by-stage', group: 'CRM', title: 'Leads by stage', module: 'reports',
    run: (f) => ({ columns: [C('stage', 'Stage'), C('leads', 'Contacts')],
      rows: all(`SELECT st.value stage, COUNT(c.id) leads FROM lookups st LEFT JOIN contacts c ON c.stage_id=st.id AND date(c.created_at) BETWEEN ? AND ?
        ${f.agent_id ? 'AND c.agent_id=' + Number(f.agent_id) : ''} WHERE st.type='lead_stage' AND st.active=1 GROUP BY st.id ORDER BY st.sort_order`, f.from, f.to) }) },
  { key: 'crm-followups', group: 'CRM', title: 'Follow-ups due', module: 'reports',
    run: (f) => ({ columns: [C('followup_date', 'Follow-up'), C('full_name', 'Contact'), C('phone', 'Phone'), C('stage', 'Stage'), C('agent', 'Agent')],
      rows: all(`SELECT c.followup_date, c.full_name, c.phone, st.value stage, u.name agent FROM contacts c LEFT JOIN lookups st ON st.id=c.stage_id LEFT JOIN users u ON u.id=c.agent_id
        WHERE c.followup_date BETWEEN ? AND ? ${f.agent_id ? 'AND c.agent_id=' + Number(f.agent_id) : ''} ORDER BY c.followup_date`, f.from, f.to) }) },

  { key: 'property-inventory', group: 'Property', title: 'Project inventory', module: 'reports',
    run: (f) => ({ columns: [C('project', 'Project'), C('total', 'Units'), C('available', 'Available'), C('featured', 'Featured'), C('reserved', 'Reserved'), C('sold', 'Sold'), C('draft', 'Draft'), C('value_available', 'Available value', money)],
      rows: all(`SELECT COALESCE(pr.name,'No project') project, COUNT(*) total, SUM(p.status='available') available, SUM(p.status='featured') featured, SUM(p.status='reserved') reserved, SUM(p.status='sold') sold,
        SUM(p.status='draft') draft, COALESCE(SUM(CASE WHEN p.status IN ('available','featured') THEN p.net_price END),0) value_available
        FROM properties p LEFT JOIN projects pr ON pr.id=p.project_id WHERE p.status<>'cancelled' ${f.project_id ? 'AND p.project_id=' + Number(f.project_id) : ''} GROUP BY p.project_id ORDER BY project`) }) },
  { key: 'property-status', group: 'Property', title: 'Properties by status', module: 'reports',
    run: (f) => ({ columns: [C('status', 'Status'), C('count', 'Properties'), C('value', 'Value', money)],
      rows: all(`SELECT status, COUNT(*) count, SUM(net_price) value FROM properties ${f.project_id ? 'WHERE project_id=' + Number(f.project_id) : ''} GROUP BY status ORDER BY count DESC`) }) },

  { key: 'project-profitability', group: 'Financial', title: 'Project profitability', module: 'accounting',
    run: () => { const rows = all('SELECT id,name FROM projects ORDER BY name').map((p) => { const x = projectFinancials(p.id); return { project: p.name, sales: x.total_sales, collections: x.collections, receivables: x.receivables, expenses: x.expenses, profit: x.gross_profit, cash: x.cash_position }; });
      return { columns: [C('project', 'Project'), C('sales', 'Sales', money), C('collections', 'Collections', money), C('receivables', 'Receivables', money), C('expenses', 'Expenses', money), C('profit', 'Gross profit', money), C('cash', 'Cash position', money)], rows }; } },
  // Same streams as the dashboard "Total revenue" card: customer payments the company keeps + developer rebates (4500).
  { key: 'revenue-by-source', group: 'Financial', title: 'Revenue by source', module: 'accounting',
    run: (f) => {
      const pj = f.project_id ? Number(f.project_id) : 0;
      const pay = all(`SELECT r.date, r.receipt_no reference, c.full_name payer, pr.name project, r.method,
        CASE WHEN r.payment_type='Refund' THEN -r.amount ELSE r.amount END amount, r.payment_type
        FROM receipts r JOIN contacts c ON c.id=r.contact_id LEFT JOIN projects pr ON pr.id=r.project_id
        WHERE r.status='valid' AND r.date BETWEEN ? AND ? AND r.account_id NOT IN (SELECT id FROM accounts WHERE code='2610') AND r.held_for_developer=0
        ${pj ? 'AND r.project_id=' + pj : ''} ORDER BY r.date DESC, r.id DESC`, f.from, f.to)
        .map((x) => ({ ...x, source: x.payment_type === 'Refund' ? 'Customer refund' : 'Customer payment' }));
      const reb = all(`SELECT j.date, j.journal_no reference, COALESCE(d.name, '—') payer, COALESCE(pr.name, pj2.name) project,
        COALESCE(c.full_name, j.memo) detail, l.credit-l.debit amount
        FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
        LEFT JOIN sales s ON s.id=l.sale_id LEFT JOIN developers d ON d.id=s.developer_id LEFT JOIN contacts c ON c.id=s.contact_id
        LEFT JOIN projects pr ON pr.id=s.project_id LEFT JOIN projects pj2 ON pj2.id=COALESCE(l.project_id, j.project_id)
        WHERE a.code='4500' AND j.date BETWEEN ? AND ? AND l.credit-l.debit<>0 ${pj ? 'AND COALESCE(s.project_id, l.project_id, j.project_id)=' + pj : ''}
        ORDER BY j.date DESC, j.id DESC`, f.from, f.to)
        .map((x) => ({ ...x, source: 'Developer rebate', method: x.detail ? `File: ${x.detail}` : '' }));
      const tp = pay.reduce((s, x) => s + x.amount, 0), tr = reb.reduce((s, x) => s + x.amount, 0);
      const rows = [...[...pay, ...reb].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).map(({ date, source, reference, payer, project, method, amount }) => ({ date, source, reference, payer, project, method, amount }))];
      const summary = [{ label: 'Customer payments', value: tp, n: pay.length }, { label: 'Developer rebates', value: tr, n: reb.length }, { label: 'Total revenue', value: tp + tr }];
      return { summary, columns: [C('date', 'Date'), C('source', 'Source'), C('reference', 'Voucher'), C('payer', 'Received from'), C('project', 'Project'), C('method', 'Method / file'), C('amount', 'Amount', money)], rows };
    } },
  { key: 'income-statement', group: 'Financial', title: 'Income statement', module: 'accounting',
    run: (f) => { const tb = trialBalance({ from: f.from, to: f.to, projectId: f.project_id }).filter((a) => ['income', 'expense'].includes(a.type) && a.balance);
      const rows = [...tb.filter((a) => a.type === 'income').map((a) => ({ section: 'Income', account: `${a.code} ${a.name}`, amount: a.balance })),
        ...tb.filter((a) => a.type === 'expense').map((a) => ({ section: 'Expense', account: `${a.code} ${a.name}`, amount: a.balance }))];
      const ti = rows.filter((x) => x.section === 'Income').reduce((s, x) => s + x.amount, 0), te = rows.filter((x) => x.section === 'Expense').reduce((s, x) => s + x.amount, 0);
      rows.push({ section: 'Net', account: 'Net profit / (loss)', amount: ti - te });
      return { columns: [C('section', 'Section'), C('account', 'Account'), C('amount', 'Amount', money)], rows }; } },
  { key: 'expense-statement', group: 'Financial', title: 'Expense statement', module: 'accounting',
    run: (f) => ({ columns: [C('date', 'Date'), C('voucher_no', 'Voucher'), C('project', 'Project'), C('vendor', 'Vendor'), C('account', 'Expense account'), C('description', 'Description'), C('amount', 'Amount', money), C('status', 'Status')],
      rows: all(`SELECT e.date, e.voucher_no, pr.name project, v.name vendor, a.name account, e.description, e.amount, e.status FROM expense_vouchers e JOIN accounts a ON a.id=e.expense_account_id
        LEFT JOIN projects pr ON pr.id=e.project_id LEFT JOIN vendors v ON v.id=e.vendor_id WHERE e.date BETWEEN ? AND ? AND e.status IN ('approved','partial','paid') ${f.project_id ? 'AND e.project_id=' + Number(f.project_id) : ''} ORDER BY e.date DESC`, f.from, f.to) }) },
  { key: 'cash-flow', group: 'Financial', title: 'Cash flow', module: 'accounting',
    run: (f) => ({ columns: [C('month', 'Month'), C('inflow', 'Cash in', money), C('outflow', 'Cash out', money), C('net', 'Net', money)],
      rows: all(`SELECT substr(j.date,1,7) month, SUM(l.debit) inflow, SUM(l.credit) outflow, SUM(l.debit-l.credit) net FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
        WHERE a.subtype IN ('cash','bank','custody','online') AND j.date BETWEEN ? AND ? AND COALESCE(j.ref_type,'') NOT IN ('transfer','opening') GROUP BY month ORDER BY month`, f.from, f.to) }) },
  { key: 'general-ledger', group: 'Financial', title: 'General ledger', module: 'accounting',
    run: (f) => { if (!f.account_id) return { columns: [], rows: [], note: 'Choose an account to view its ledger.' };
      const a = get('SELECT * FROM accounts WHERE id=?', f.account_id); if (!a) throw bad('Account not found');
      let bal = f.from > '1900-01-01' ? accountBalance(a.id, { to: new Date(Date.parse(f.from) - 86400000).toISOString().slice(0, 10) }) : 0;
      const rows = all(`SELECT j.date, j.journal_no, j.memo, l.debit, l.credit FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=? AND j.date BETWEEN ? AND ? ORDER BY j.date, j.id`, a.id, f.from, f.to)
        .map((x) => { bal += isDebitNature(a.type) ? x.debit - x.credit : x.credit - x.debit; return { ...x, balance: bal }; });
      return { columns: [C('date', 'Date'), C('journal_no', 'Journal'), C('memo', 'Description'), C('debit', 'Debit', money), C('credit', 'Credit', money), C('balance', 'Balance', money)], rows }; } },
  { key: 'customer-receivable', group: 'Financial', title: 'Customer receivable', module: 'accounting',
    run: (f) => ({ columns: [C('customer', 'Customer'), C('sale_no', 'Sale'), C('property', 'Property'), C('project', 'Project'), C('net', 'Net value', money), C('paid', 'Paid', money), C('outstanding', 'Outstanding', money), C('overdue', 'Overdue', money)],
      rows: all(`SELECT c.full_name customer, s.sale_no, COALESCE(s.title, p.title) property, pr.name project, s.net_price net, s.paid_amount paid, s.net_price-s.paid_amount outstanding,
        (SELECT COALESCE(SUM(i.amount-i.paid),0) FROM installments i WHERE i.sale_id=s.id AND i.status<>'paid' AND i.due_date<?) overdue
        FROM sales s JOIN contacts c ON c.id=s.contact_id LEFT JOIN properties p ON p.id=s.property_id LEFT JOIN projects pr ON pr.id=s.project_id
        WHERE s.status='confirmed' AND s.net_price>s.paid_amount ${f.project_id ? 'AND s.project_id=' + Number(f.project_id) : ''} ${f.contact_id ? 'AND s.contact_id=' + Number(f.contact_id) : ''} ORDER BY outstanding DESC`, today()) }) },
  { key: 'vendor-payable', group: 'Financial', title: 'Vendor payable', module: 'vendors',
    run: () => ({ columns: [C('vendor', 'Vendor'), C('category', 'Category'), C('billed', 'Billed', money), C('paid', 'Paid', money), C('payable', 'Payable', money)],
      rows: all(`SELECT v.name vendor, v.category, COALESCE(SUM(l.credit),0) billed, COALESCE(SUM(l.debit),0) paid, COALESCE(SUM(l.credit-l.debit),0) payable FROM vendors v
        LEFT JOIN journal_lines l ON l.vendor_id=v.id AND l.account_id=(SELECT id FROM accounts WHERE code='2100') GROUP BY v.id HAVING billed>0 ORDER BY payable DESC`) }) },
  { key: 'trial-balance', group: 'Financial', title: 'Trial balance', module: 'accounting',
    run: (f) => ({ columns: [C('code', 'Code'), C('name', 'Account'), C('type', 'Type'), C('debit', 'Debit', money), C('credit', 'Credit', money)],
      rows: trialBalance({ from: f.from, to: f.to, projectId: f.project_id }).filter((a) => a.debit || a.credit) }) },
  { key: 'payment-collection', group: 'Financial', title: 'Payment collection', module: 'payments',
    run: (f) => ({ columns: [C('receipt_no', 'Receipt'), C('date', 'Date'), C('customer', 'Customer'), C('project', 'Project'), C('type', 'Type'), C('method', 'Method'), C('amount', 'Amount', money), C('account', 'Deposited to')],
      rows: all(`SELECT r.receipt_no, r.date, c.full_name customer, pr.name project, r.payment_type type, r.method, CASE WHEN r.payment_type='Refund' THEN -r.amount ELSE r.amount END amount, CASE WHEN a.code='2610' THEN 'Paid to developer (not company cash)' ELSE a.name END account
        FROM receipts r JOIN contacts c ON c.id=r.contact_id LEFT JOIN projects pr ON pr.id=r.project_id JOIN accounts a ON a.id=r.account_id WHERE r.status='valid' AND r.date BETWEEN ? AND ?
        ${f.project_id ? 'AND r.project_id=' + Number(f.project_id) : ''} ${f.method ? "AND r.method='" + String(f.method).replace(/'/g, '') + "'" : ''} ${f.contact_id ? 'AND r.contact_id=' + Number(f.contact_id) : ''} ORDER BY r.date DESC`, f.from, f.to) }) },

  { key: 'vendor-activity', group: 'Vendor', title: 'Vendor purchases', module: 'vendors',
    run: (f) => ({ columns: [C('vendor', 'Vendor'), C('purchases', 'Vouchers'), C('amount', 'Amount', money), C('paid', 'Paid', money), C('outstanding', 'Outstanding', money)],
      rows: all(`SELECT v.name vendor, COUNT(e.id) purchases, COALESCE(SUM(e.amount),0) amount, COALESCE(SUM(e.paid_amount),0) paid, COALESCE(SUM(e.amount-e.paid_amount),0) outstanding FROM vendors v
        JOIN expense_vouchers e ON e.vendor_id=v.id AND e.status IN ('approved','partial','paid') AND e.date BETWEEN ? AND ? GROUP BY v.id ORDER BY amount DESC`, f.from, f.to) }) },

  { key: 'project-development', group: 'Project', title: 'Development progress', module: 'projects',
    run: () => ({ columns: [C('project', 'Project'), C('item', 'Item'), C('progress', 'Progress %')],
      rows: all(`SELECT p.name project, d.name item, d.progress FROM dev_items d JOIN projects p ON p.id=d.project_id ORDER BY p.name, d.sort_order`) }) },

  { key: 'employee-list', group: 'Employee', title: 'Employee report', module: 'hrm',
    run: () => ({ columns: [C('emp_code', 'ID'), C('name', 'Name'), C('department', 'Department'), C('designation', 'Designation'), C('hire_date', 'Joined'), C('salary', 'Salary', money), C('status', 'Status')],
      rows: all('SELECT emp_code,name,department,designation,hire_date,salary,status FROM employees ORDER BY name') }) },
  { key: 'payroll-summary', group: 'Employee', title: 'Payroll summary', module: 'hrm',
    run: (f) => ({ columns: [C('period', 'Period'), C('employees', 'Employees'), C('gross', 'Gross', money), C('deductions', 'Deductions', money), C('net', 'Net', money), C('paid', 'Paid', money)],
      rows: all(`SELECT period, COUNT(*) employees, SUM(basic+allowances+bonus+commission) gross, SUM(deductions+advances+loans) deductions, SUM(net) net, SUM(CASE WHEN status='paid' THEN net ELSE 0 END) paid
        FROM payroll WHERE period BETWEEN substr(?,1,7) AND substr(?,1,7) GROUP BY period ORDER BY period DESC`, f.from, f.to) }) },
];

r.get('/', (req, res) => {
  res.json(REPORTS.filter((x) => hasPerm(req.user, x.module, 'view')).map(({ key, group, title }) => ({ key, group, title })));
});

r.get('/:key', asyncH(async (req, res) => {
  const def = REPORTS.find((x) => x.key === req.params.key);
  if (!def) throw bad('Unknown report');
  if (!hasPerm(req.user, def.module, 'view')) throw forbidden('You do not have access to this report');
  if (ownerId(req) && !['sales-by-agent', 'sales-by-property', 'commission', 'crm-by-stage', 'crm-followups'].includes(def.key)) throw forbidden();
  const range = dateRange(req.query.range, req.query.from, req.query.to);
  const f = { ...req.query, ...range };
  if (ownerId(req)) f.agent_id = req.user.id;
  const out = def.run(f);
  const totals = {};
  for (const c of out.columns) if (c.type === money) totals[c.key] = out.rows.reduce((s, x) => s + (Number(x[c.key]) || 0), 0);
  if (['csv', 'xlsx', 'pdf'].includes(req.query.format)) {
    if (!hasPerm(req.user, def.module, 'export')) throw forbidden('You do not have permission to export');
    audit(req, 'Exported report', 'report', def.key, `${def.title} (${req.query.format})`);
    if (req.query.format === 'pdf') {
      return sendPdf(res, def.key, { title: def.title, subtitle: `Period ${range.from} to ${range.to}`, columns: out.columns, rows: out.rows, totals: Object.keys(totals).length && def.key !== 'trial-balance' ? totals : undefined });
    }
    return sendTable(res, req.query.format, def.key, out.columns, out.rows);
  }
  res.json({ key: def.key, title: def.title, ...out, totals, range });
}));

export default r;
