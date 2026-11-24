import { Router } from 'express';
import { all, get } from '../db.js';
import { hasPerm, ownerId, requireStaff } from '../rbac.js';
import { asyncH, dateRange, today, addDays, addMonths } from '../util.js';
import { agentStats } from './agents.js';

const r = Router();
r.use(requireStaff);

const stageKind = (kind) => `(SELECT id FROM lookups WHERE type='lead_stage' AND meta LIKE '%"kind":"${kind}"%')`;

/** Every number is a query over live records — nothing is stored or faked. */
r.get('/', asyncH((req, res) => {
  const { from, to } = dateRange(req.query.range || 'this_month', req.query.from, req.query.to);
  const t = today();
  const out = { range: { from, to, preset: req.query.range || 'this_month' } };
  const own = ownerId(req);

  // -------- CRM (everyone with crm; agents scoped to themselves)
  if (hasPerm(req.user, 'crm', 'view')) {
    const scope = own ? `AND (agent_id=${own} OR created_by=${own})` : '';
    const byStage = all(`SELECT st.id, st.value stage, st.color, COUNT(c.id) n FROM lookups st LEFT JOIN contacts c ON c.stage_id=st.id ${own ? `AND (c.agent_id=${own} OR c.created_by=${own})` : ''}
      WHERE st.type='lead_stage' AND st.active=1 GROUP BY st.id ORDER BY st.sort_order`);
    const stageCount = (name) => byStage.find((s) => s.stage === name)?.n ?? 0;
    out.crm = {
      total_leads: get(`SELECT COUNT(*) n FROM contacts WHERE 1=1 ${scope}`).n,
      new_leads: get(`SELECT COUNT(*) n FROM contacts WHERE date(created_at) BETWEEN ? AND ? ${scope}`, from, to).n,
      contacted: stageCount('Contacted'), followups: get(`SELECT COUNT(*) n FROM contacts WHERE followup_date IS NOT NULL AND followup_date<=? AND is_customer=0 ${scope}`, t).n,
      followups_today: get(`SELECT COUNT(*) n FROM contacts WHERE followup_date=? ${scope}`, t).n,
      interested: stageCount('Interested'), closed: get(`SELECT COUNT(*) n FROM sales WHERE status='confirmed' AND sale_date BETWEEN ? AND ? ${own ? 'AND agent_id=' + own : ''}`, from, to).n,
      total_customers: get(`SELECT COUNT(*) n FROM contacts WHERE is_customer=1 ${scope}`).n,
      by_stage: byStage,
    };
  }
  // -------- Properties
  if (hasPerm(req.user, 'properties', 'view')) {
    const rows = all('SELECT status, COUNT(*) n, COALESCE(SUM(net_price),0) v FROM properties GROUP BY status');
    const n = (...s) => rows.filter((x) => s.includes(x.status)).reduce((a, x) => a + x.n, 0);
    out.properties = { total: rows.reduce((a, x) => a + x.n, 0), available: n('available', 'featured'), reserved: n('reserved'), sold: n('sold'),
      distribution: rows.map((x) => ({ status: x.status, n: x.n, value: x.v })) };
  }
  // -------- Agent-specific (sales agent portal view)
  if (own) {
    out.agent = agentStats(own, from, to);
    out.tasks = all("SELECT t.id,t.title,t.due_date,c.full_name contact_name,t.entity_id FROM tasks t LEFT JOIN contacts c ON c.id=t.entity_id AND t.entity_type='contact' WHERE t.status='open' AND t.assigned_to=? ORDER BY t.due_date LIMIT 8", own);
    out.charts = {
      sales_by_month: all(`SELECT substr(sale_date,1,7) month, COUNT(*) n, SUM(net_price) value FROM sales WHERE agent_id=? AND status='confirmed' AND sale_date BETWEEN ? AND ? GROUP BY month ORDER BY month`, own, from, to),
    };
    return res.json(out);
  }
  // -------- Finance (not for agents)
  const finance = hasPerm(req.user, 'accounting', 'view') || hasPerm(req.user, 'payments', 'view');
  const sales = get(`SELECT COUNT(*) n, COALESCE(SUM(net_price),0) v FROM sales WHERE status='confirmed' AND sale_date BETWEEN ? AND ?`, from, to);
  out.sales = { count: sales.n, value: sales.v };
  if (finance) {
    // payments on developer files go to the developer (account 2610), not the company: keep them out of the company's own collections
    const collected = get(`SELECT COALESCE(SUM(CASE WHEN payment_type='Refund' THEN -amount ELSE amount END),0) v FROM receipts WHERE status='valid' AND date BETWEEN ? AND ? AND account_id NOT IN (SELECT id FROM accounts WHERE code='2610') AND held_for_developer=0`, from, to).v;
    const collectedByDeveloper = get(`SELECT COALESCE(SUM(CASE WHEN payment_type='Refund' THEN -amount ELSE amount END),0) v FROM receipts WHERE status='valid' AND date BETWEEN ? AND ? AND account_id IN (SELECT id FROM accounts WHERE code='2610')`, from, to).v;
    const expenses = get(`SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE a.type='expense' AND j.date BETWEEN ? AND ?`, from, to).v;
    // rebate the developer owes the company (account 4500) is the company's own income on developer files
    const rebateIncome = get(`SELECT COALESCE(SUM(l.credit-l.debit),0) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE a.code='4500' AND j.date BETWEEN ? AND ?`, from, to).v;
    const rec = get(`SELECT COALESCE(SUM(net_price-paid_amount),0) v FROM sales WHERE status='confirmed'`).v;
    const pend = get(`SELECT COUNT(*) n, COALESCE(SUM(i.amount-i.paid),0) v FROM installments i JOIN sales s ON s.id=i.sale_id WHERE s.status='confirmed' AND i.status<>'paid'`);
    const overdue = get(`SELECT COUNT(*) n, COALESCE(SUM(i.amount-i.paid),0) v FROM installments i JOIN sales s ON s.id=i.sale_id WHERE s.status='confirmed' AND i.status<>'paid' AND i.due_date<?`, t);
    const upcoming = get(`SELECT COUNT(*) n, COALESCE(SUM(i.amount-i.paid),0) v FROM installments i JOIN sales s ON s.id=i.sale_id WHERE s.status='confirmed' AND i.status<>'paid' AND i.due_date BETWEEN ? AND ?`, t, addDays(t, 30));
    out.finance = {
      project_value: get('SELECT COALESCE(SUM(total_value),0) v FROM projects').v || get("SELECT COALESCE(SUM(net_price),0) v FROM properties WHERE status<>'cancelled'").v,
      collected, collected_by_developer: collectedByDeveloper, receivable: rec, expenses, rebate_income: rebateIncome, net_revenue: collected + rebateIncome - expenses,
      pending_installments: pend, overdue_installments: overdue, upcoming_installments: upcoming,
      commission_payable: get("SELECT COALESCE(SUM(amount-paid_amount),0) v FROM commissions WHERE status IN ('approved','partially_paid')").v,
      commission_pending_approval: get("SELECT COALESCE(SUM(amount),0) v FROM commissions WHERE status='pending'").v,
      vendor_payables: get(`SELECT COALESCE(SUM(l.credit-l.debit),0) v FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.code='2100' AND l.vendor_id IS NOT NULL`).v,
      cash_and_bank: get(`SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.subtype IN ('cash','bank','custody','online')`).v,
    };
    out.charts = {
      sales_by_month: all(`SELECT substr(sale_date,1,7) month, COUNT(*) n, SUM(net_price) value FROM sales WHERE status='confirmed' AND sale_date BETWEEN ? AND ? GROUP BY month ORDER BY month`, from, to),
      revenue_by_month: all(`SELECT month, SUM(value) value FROM (SELECT substr(date,1,7) month, CASE WHEN payment_type='Refund' THEN -amount ELSE amount END value FROM receipts WHERE status='valid' AND date BETWEEN ? AND ? AND account_id NOT IN (SELECT id FROM accounts WHERE code='2610') AND held_for_developer=0 UNION ALL SELECT substr(j.date,1,7), l.credit-l.debit FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE a.code='4500' AND j.date BETWEEN ? AND ?) GROUP BY month ORDER BY month`, from, to, from, to),
      expenses_by_month: all(`SELECT substr(j.date,1,7) month, SUM(l.debit-l.credit) value FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE a.type='expense' AND j.date BETWEEN ? AND ? GROUP BY month ORDER BY month`, from, to),
      collection_vs_receivable: all(`SELECT substr(i.due_date,1,7) month, SUM(i.paid) collected, SUM(i.amount-i.paid) receivable FROM installments i JOIN sales s ON s.id=i.sale_id WHERE s.status='confirmed' AND i.due_date BETWEEN ? AND ? GROUP BY month ORDER BY month`, from, to),
      project_revenue: all(`SELECT COALESCE(p.name,'—') name, SUM(s.net_price) revenue, SUM(s.paid_amount) collected FROM sales s LEFT JOIN projects p ON p.id=s.project_id WHERE s.status='confirmed' AND s.sale_date BETWEEN ? AND ? GROUP BY s.project_id`, from, to),
      project_expenses: all(`SELECT COALESCE(p.name,'Unallocated') name, SUM(l.debit-l.credit) expenses FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id LEFT JOIN projects p ON p.id=l.project_id WHERE a.type='expense' AND j.date BETWEEN ? AND ? GROUP BY l.project_id`, from, to),
      agent_performance: all(`SELECT COALESCE(u.name,'Unassigned') name, COUNT(*) sales, SUM(s.net_price) value FROM sales s LEFT JOIN users u ON u.id=s.agent_id WHERE s.status='confirmed' AND s.sale_date BETWEEN ? AND ? GROUP BY s.agent_id ORDER BY value DESC LIMIT 10`, from, to),
      commission_performance: all(`SELECT u.name, SUM(c.amount) earned, SUM(c.paid_amount) paid FROM commissions c JOIN users u ON u.id=c.agent_id WHERE c.status<>'cancelled' AND date(c.created_at) BETWEEN ? AND ? GROUP BY c.agent_id ORDER BY earned DESC LIMIT 10`, from, to),
      payment_methods: all(`SELECT method, SUM(amount) value, COUNT(*) n FROM receipts WHERE status='valid' AND payment_type<>'Refund' AND date BETWEEN ? AND ? AND account_id NOT IN (SELECT id FROM accounts WHERE code='2610') AND held_for_developer=0 GROUP BY method ORDER BY value DESC`, from, to),
    };
    out.upcoming = all(`SELECT i.id,i.due_date,i.amount-i.paid amount,i.kind,s.id sale_id,c.full_name customer,s.contact_id FROM installments i JOIN sales s ON s.id=i.sale_id JOIN contacts c ON c.id=s.contact_id WHERE s.status='confirmed' AND i.status<>'paid' AND i.due_date<=? ORDER BY i.due_date LIMIT 8`, addDays(t, 14));
  } else {
    out.charts = {
      sales_by_month: all(`SELECT substr(sale_date,1,7) month, COUNT(*) n, SUM(net_price) value FROM sales WHERE status='confirmed' AND sale_date BETWEEN ? AND ? GROUP BY month ORDER BY month`, from, to),
      agent_performance: all(`SELECT COALESCE(u.name,'Unassigned') name, COUNT(*) sales, SUM(s.net_price) value FROM sales s LEFT JOIN users u ON u.id=s.agent_id WHERE s.status='confirmed' AND s.sale_date BETWEEN ? AND ? GROUP BY s.agent_id ORDER BY value DESC LIMIT 10`, from, to),
    };
  }
  if (hasPerm(req.user, 'hrm', 'view')) {
    out.hrm = { headcount: get("SELECT COUNT(*) n FROM employees WHERE status='active'").n, pending_leaves: get("SELECT COUNT(*) n FROM leaves WHERE status='pending'").n };
  }
  res.json(out);
}));

export default r;
