// Ask can look up the workspace's own records (contacts, properties, projects, sales, instalments, receipts, vendors, vouchers, staff, leaves,
// commissions, tasks, appointments, tenders, assets) to answer a question in words. Rules:
//  - only THIS workspace's database (the Super Admin console lives in a separate platform database and is never reachable from here);
//  - only what the asker's role may view (same permission as the screen), and own-records-only roles (sales agents) see only their own;
//  - only rows that match words in the question, a few per table, listed columns only (no CNIC, bank details, salaries, passwords or tokens);
//  - never sent to the Stable Horde community network (askAi keeps these blocks private); the admin can switch it off (ask_use_records).
import { all, get, getSetting } from '../db.js';
import { hasPerm as can } from '../rbac.js';
const hasPerm = (u, m, a) => !!u && (u.isSuper || u.perms instanceof Set) && can(u, m, a); // a caller without a role (console test) sees nothing

const U = (col, id) => `(SELECT name FROM users WHERE id=${id})`;
export const SOURCES = [
  { key: 'contacts', label: 'Contact / lead', mod: 'crm', from: 'contacts c', own: '(c.agent_id=? OR c.created_by=?)', search: ['c.full_name', 'c.phone', 'c.email', 'c.city', 'c.company', 'c.area'], order: 'c.id DESC',
    sel: `c.full_name AS name, c.phone, c.email, c.city, c.company, c.lead_source AS source, (SELECT value FROM lookups WHERE id=c.stage_id) AS stage, ${U('', 'c.agent_id')} AS agent, c.created_at AS created` },
  { key: 'properties', label: 'Property / listing', mod: 'properties', from: 'properties p', search: ['p.code', 'p.title', 'p.plot_no', 'p.city', 'p.area_name', 'p.block', 'p.sector', 'p.address'], order: 'p.id DESC',
    sel: 'p.code, p.title, p.purpose, p.property_type AS type, p.city, p.area_name AS area, p.plot_no, p.area_size AS size, p.unit, p.net_price AS price, p.status' },
  { key: 'projects', label: 'Project', mod: 'projects', from: 'projects pr', search: ['pr.code', 'pr.name', 'pr.location', 'pr.developer'], order: 'pr.id DESC',
    sel: 'pr.code, pr.name, pr.location, pr.developer, pr.dev_status AS status, pr.total_units AS units, pr.total_value, pr.budget, pr.start_date, pr.expected_completion AS expected_completion' },
  { key: 'sales', label: 'Sale', mod: 'sales', from: 'sales s JOIN contacts c ON c.id=s.contact_id', own: 's.agent_id', search: ['s.sale_no', 's.title', 'c.full_name', 'c.phone'], order: 's.id DESC',
    sel: `s.sale_no, s.title, c.full_name AS customer, s.sale_date, s.net_price, s.paid_amount AS paid, s.status, ${U('', 's.agent_id')} AS agent` },
  { key: 'installments', label: 'Instalment', mod: 'sales', from: 'installments i JOIN sales s ON s.id=i.sale_id JOIN contacts c ON c.id=s.contact_id', own: 's.agent_id', search: ['s.sale_no', 'c.full_name'], order: "CASE i.status WHEN 'pending' THEN 0 ELSE 1 END, i.due_date",
    sel: 's.sale_no, c.full_name AS customer, i.seq, i.kind, i.due_date, i.amount, i.paid, i.status' },
  { key: 'receipts', label: 'Receipt', mod: 'payments', from: 'receipts r JOIN contacts c ON c.id=r.contact_id', search: ['r.receipt_no', 'c.full_name', 'r.reference_no', 'r.txn_id'], order: 'r.id DESC',
    sel: 'r.receipt_no, r.date, c.full_name AS customer, r.amount, r.method, r.payment_type, r.status' },
  { key: 'vendors', label: 'Vendor', mod: 'vendors', from: 'vendors v', search: ['v.name', 'v.company', 'v.phone', 'v.category'], order: 'v.id DESC', sel: 'v.name, v.company, v.phone, v.category, v.payment_terms, v.active' },
  { key: 'vouchers', label: 'Expense voucher', mod: 'accounting', from: 'expense_vouchers e LEFT JOIN vendors v ON v.id=e.vendor_id', search: ['e.voucher_no', 'e.description', 'v.name'], order: 'e.id DESC',
    sel: 'e.voucher_no, e.date, e.description, e.amount, e.status, v.name AS vendor' },
  { key: 'employees', label: 'Employee', mod: 'hrm', from: 'employees e', search: ['e.name', 'e.emp_code', 'e.department', 'e.designation', 'e.phone'], order: 'e.id DESC',
    sel: 'e.emp_code, e.name, e.department, e.designation, e.hire_date, e.employment_type, e.status' }, // pay and personal phone numbers never go to an outside AI
  { key: 'leaves', label: 'Leave', mod: 'hrm', from: 'leaves l JOIN employees e ON e.id=l.employee_id', search: ['e.name', 'l.type', 'l.reason'], order: 'l.id DESC', sel: 'e.name AS employee, l.type, l.from_date, l.to_date, l.days, l.status' },
  { key: 'commissions', label: 'Commission', mod: 'commissions', from: 'commissions cm JOIN users u ON u.id=cm.agent_id JOIN sales s ON s.id=cm.sale_id', own: 'cm.agent_id', search: ['cm.commission_no', 'u.name', 's.sale_no'], order: 'cm.id DESC',
    sel: 'cm.commission_no, u.name AS agent, s.sale_no, cm.amount, cm.paid_amount AS paid, cm.status' },
  { key: 'tasks', label: 'Follow-up task', mod: 'crm', from: 'tasks t', own: 't.assigned_to', search: ['t.title'], order: 't.id DESC', sel: `t.title, t.due_date, t.status, t.priority, ${U('', 't.assigned_to')} AS assigned_to` },
  { key: 'appointments', label: 'Appointment', mod: 'crm', from: 'appointments a', own: 'a.user_id', search: ['a.title', 'a.location', 'a.notes'], order: 'a.starts_at DESC', sel: 'a.title, a.kind, a.starts_at, a.ends_at, a.location, a.status' },
  { key: 'tenders', label: 'Tender', mod: 'construction', from: 'tenders td', search: ['td.tender_no', 'td.title', 'td.location', 'td.category'], order: 'td.id DESC', sel: 'td.tender_no, td.title, td.category, td.estimated_budget AS budget, td.closes_on, td.status' },
  { key: 'assets', label: 'Asset', mod: 'hrm', from: 'assets a', search: ['a.asset_no', 'a.name', 'a.serial_no', 'a.category'], order: 'a.id DESC', sel: 'a.asset_no, a.name, a.category, a.status, a.cost, (SELECT name FROM employees WHERE id=a.employee_id) AS assigned_to' },
];

// words that name a kind of record or are everyday filler: they would match too many rows to say anything
const FILLER = new Set('about after again also among been before being between both could does each from have here into just like list many more most much only other over same show some such tell than that them then there these they this those very want what when where which while will with would your lead leads sale sales project projects property properties customer customers payment payments plot plots client clients details detail status record records please give kitna kitni kitne hain kese kesy kaise kaun kiya mujhe batao dikhao wala wali their ours phone email number address name amount date price total paid pending'.split(' '));
export const keywords = (text) => [...new Set(String(text).toLowerCase().replace(/\S+@\S+/g, (m) => ` ${m} `).split(/[^a-z0-9@.+\-]+/).map((w) => w.replace(/^[.\-+]+|[.\-+]+$/g, '')).filter((w) => (w.length >= 4 || (w.length === 3 && /\d/.test(w))) && !FILLER.has(w)))].slice(0, 8);

const MAX_PER = 4, MAX_CHARS = 5500;
const cell = (v) => String(v).replace(/\s+/g, ' ').slice(0, 80);
const line = (_src, row) => `${Object.entries(row).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k.replace(/_/g, ' ')}=${cell(v)}`).join(', ')}`;

/** Records (as short text lines) matching the question's words, limited to what this user may see. Returns [{ title, text, private: true }]. */
export function recordMaterial(q, user) {
  if (!user || user.portal || getSetting('ask_use_records', '1') === '0') return [];
  const kws = keywords(q);
  if (!kws.length) return [];
  const out = [];
  let used = 0;
  for (const src of SOURCES) {
    if (!hasPerm(user, src.mod, 'view')) continue;
    const likes = kws.map(() => `(${src.search.map((c) => `LOWER(IFNULL(${c},'')) LIKE ?`).join(' OR ')})`);
    const score = likes.map((l) => `(CASE WHEN ${l} THEN 1 ELSE 0 END)`).join(' + ');
    const params = kws.flatMap((k) => src.search.map(() => `%${k.replace(/[%_]/g, '')}%`));
    // `own` is a column (agent = me) or a ready condition with ? marks, all filled with the asker's id
    const ownSql = src.own && user.own_scope ? (src.own.includes('?') ? src.own : `${src.own}=?`) : '';
    const own = ownSql ? ` AND ${ownSql}` : '';
    const ownParams = ownSql ? Array((ownSql.match(/\?/g) || []).length).fill(user.id) : [];
    try {
      const rows = all(`SELECT ${src.sel}, (${score}) AS _score FROM ${src.from} WHERE (${likes.join(' OR ')})${own} ORDER BY _score DESC, ${src.order} LIMIT ${MAX_PER}`, ...params, ...params, ...ownParams);
      for (const r of rows) {
        const { _score, ...rest } = r;
        const t = line(src, rest);
        if (used + t.length > MAX_CHARS) return out;
        out.push({ title: `Workspace record (${src.label})`, text: t, private: true }); used += t.length;
      }
    } catch { /* a table this workspace does not have yet: skip it */ }
  }
  return out;
}

/** Counts of what the workspace holds, for the modules this user may view (a few numbers, no names). */
export function overviewLine(user) {
  if (!user || user.portal || getSetting('ask_use_records', '1') === '0') return '';
  const parts = [];
  for (const [mod, table, label] of [['crm', 'contacts', 'contacts/leads'], ['properties', 'properties', 'properties'], ['projects', 'projects', 'projects'], ['sales', 'sales', 'sales'], ['vendors', 'vendors', 'vendors'], ['hrm', 'employees', 'employees']]) {
    if (!hasPerm(user, mod, 'view') || (user.own_scope && ['contacts', 'sales'].includes(table))) continue;
    try { parts.push(`${get(`SELECT COUNT(*) n FROM ${table}`).n} ${label}`); } catch { /* table missing */ }
  }
  return parts.length ? `The workspace holds ${parts.join(', ')}.` : '';
}
