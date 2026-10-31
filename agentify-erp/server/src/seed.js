import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { all, get, run, tx, insert, setSetting, getSetting, val, backfillIds, nextNo } from './db.js';
import { createVendorPortalUser, notifyVendor } from './services/vendorAccount.js';
import { MODULES, ACTIONS, loadUser } from './rbac.js';
import { now, today, addMonths, addDays } from './util.js';
import { postOpening, acct, postJournal } from './services/accounting.js';
import { createSale } from './services/sales.js';
import { receivePayment } from './services/payments.js';
import { approveCommission, payCommission } from './services/commissions.js';
import { createVoucher, submitVoucher, approveVoucher, payVoucher } from './services/expenses.js';
import { activity } from './audit.js';
import { ensureSite } from './services/siteDefaults.js';

export const DEMO_PASSWORD = 'Demo@12345';
const ALL = MODULES.flatMap((m) => ACTIONS.map((a) => `${m}:${a}`));
const P = (mods, actions = ACTIONS) => mods.flatMap((m) => actions.map((a) => `${m}:${a}`));
const RW = ['view', 'create', 'edit'];

const ROLES = [
  { name: 'Super Admin', description: 'Full access to everything', perms: ALL },
  { name: 'Admin', description: 'Operational access', perms: [...ALL.filter((p) => !p.startsWith('settings:delete'))] },
  { name: 'Finance Manager', description: 'Accounting, receipts, expenses, vendors, cash, banks, financial reports',
    perms: [...P(['accounting', 'payments', 'vendors', 'reports', 'documents']), ...P(['dashboard', 'customers', 'projects', 'properties', 'sales'], ['view', 'export', 'print']), ...P(['commissions'], ['view', 'approve', 'export']), 'crm:view'] },
  { name: 'Sales Manager', description: 'CRM, leads, agents, properties, sales, customers, commission',
    perms: [...P(['crm'], ['view', 'create', 'edit', 'delete', 'approve', 'export', 'print']), ...P(['sales', 'customers'], [...RW, 'export', 'print']), ...P(['properties'], [...RW, 'approve', 'export']), ...P(['commissions'], ['view', 'approve', 'export']),
      ...P(['projects', 'dashboard', 'reports', 'documents'], ['view', 'export', 'print']), ...P(['website'], RW)] },
  { name: 'Sales Agent', description: 'Own leads, customers, available properties, own sales and commission', own_scope: 1,
    perms: [...P(['crm'], RW), ...P(['properties'], RW), ...P(['dashboard', 'sales', 'customers', 'commissions', 'reports'], ['view'])] },
  { name: 'HR Manager', description: 'Employees, documents, attendance, leave, salary',
    perms: [...P(['hrm']), ...P(['dashboard', 'documents'], ['view'])] },
  { name: 'Accounts Staff', description: 'Data entry for vouchers and payments',
    perms: [...P(['accounting', 'payments', 'vendors'], RW), ...P(['dashboard', 'customers', 'projects', 'properties', 'sales'], ['view'])] },
  { name: 'Project Manager', description: 'Projects, units, development progress',
    perms: [...P(['projects'], [...RW, 'export', 'print']), ...P(['properties'], ['view', 'edit']), ...P(['dashboard', 'reports', 'documents'], ['view'])] },
  { name: 'Listing Manager', description: 'Approves the properties and projects that agents add to the website; approved listings are featured',
    perms: [...P(['listings'], ['view', 'approve']), ...P(['properties'], [...RW, 'approve', 'export', 'print']), ...P(['projects', 'dashboard', 'documents', 'reports', 'website'], ['view'])] },
  { name: 'Website Manager', description: 'Runs the public website: pages, theme, blog, chatbot knowledge bank and enquiries',
    perms: [...P(['website', 'content']), ...P(['seo'], ['view', 'edit']), ...P(['listings'], ['view']), ...P(['crm'], ['view']), ...P(['properties', 'projects', 'dashboard', 'reports', 'documents'], ['view'])] },
  { name: 'SEO Manager', description: 'Search-engine optimisation: titles, descriptions, sitemap, structured data and content audits',
    perms: [...P(['seo'], ['view', 'create', 'edit', 'export']), ...P(['website'], ['view']), ...P(['content'], ['view', 'edit']), ...P(['properties', 'projects', 'dashboard', 'reports'], ['view'])] },
  { name: 'Inventory Manager', description: 'Property inventory and listings',
    perms: [...P(['properties'], [...RW, 'approve', 'export', 'print']), ...P(['projects', 'dashboard'], ['view'])] },
  { name: 'Customer', description: 'Customer portal only', portal: 1, perms: [] },
  { name: 'Vendor', description: 'Vendor portal only', portal: 1, perms: [] },
  { name: 'Developer', description: 'Developer partner portal only', portal: 1, perms: [] },
];

const L = (type, items) => items.map((it, i) => (typeof it === 'string' ? { type, value: it, sort_order: i } : { type, sort_order: i, ...it }));
const LOOKUPS = [
  ...L('lead_stage', [
    { value: 'Non Contacted', color: '#94a3b8', meta: { kind: 'new' } }, { value: 'Contacted', color: '#3b82f6', meta: { kind: 'open' } },
    { value: 'Follow Up', color: '#f59e0b', meta: { kind: 'open' } }, { value: 'Interested', color: '#22c55e', meta: { kind: 'open' } },
    { value: 'Not Interested', color: '#ef4444', meta: { kind: 'lost' } }, { value: 'Closed', color: '#15803d', meta: { kind: 'won' } }]),
  ...L('lead_source', ['Walk-in', 'Website', 'Facebook', 'Instagram', 'Referral', 'Zameen.com', 'OLX', 'Phone Call', 'Agent Network', 'Exhibition']),
  ...L('lead_type', ['Buyer', 'Investor', 'Renter', 'Dealer']),
  ...L('property_type', ['Plots', 'Ready Homes', 'Houses', 'Commercial', 'Files', 'Apartments', 'Shops', 'Offices', 'Other']),
  ...L('amenity', ['Electricity', 'Gas', 'Water', 'Sewerage', 'Security', 'Parking', 'Mosque', 'School', 'Park', 'Commercial Area', 'Main Road', 'Gated Community']),
  ...L('payment_method', [{ value: 'Cash', meta: { kind: 'Cash' } }, { value: 'Bank Transfer', meta: { kind: 'Bank', bank_name: 'Meezan Bank', account_title: 'Expert Marketing & Developers', account_number: '0123-4567890123', iban: 'PK00MEZN0001234567890123', branch: 'Main Branch, Faisalabad', instructions: 'Send the transfer slip to our accounts office on WhatsApp.' } }, 'Online Transfer', { value: 'JazzCash', meta: { kind: 'Wallet', account_title: 'Expert Marketing & Developers', wallet_number: '0300-0000000' } }, 'Easypaisa', 'Cheque', 'Other']),
  ...L('employment_type', ['Intern', 'Employee', 'Part time', 'Full time', 'Probation', 'Permanent', 'Contract based']),
  ...L('asset_category', ['Laptop', 'Mobile phone', 'Desktop computer', 'Bike / Vehicle', 'Furniture', 'Camera / Equipment', 'Office equipment', 'Other']),
  ...L('expense_category', ['Bricks', 'Cement', 'Steel', 'Wood', 'Water', 'Labour', 'Marketing', 'Utilities', 'Transport', 'Office', 'Other']),
  ...L('income_category', ['Booking', 'Installments', 'Balloon Payments', 'Other Income']),
  ...L('vendor_category', ['Brick Vendor', 'Wood Vendor', 'Cement Vendor', 'Water Service Provider', 'Construction Contractor', 'Electrician', 'Plumber', 'Transport Vendor', 'Other']),
  ...L('department', ['Sales', 'Finance', 'HR', 'Operations', 'Projects', 'Administration', 'Marketing']),
  ...L('designation', ['Sales Agent', 'Sales Manager', 'Finance Manager', 'HR Manager', 'Project Manager', 'Accountant', 'Admin Officer', 'Director']),
  ...L('leave_type', [{ value: 'Annual', meta: { quota: 14 } }, { value: 'Sick', meta: { quota: 10 } }, { value: 'Casual', meta: { quota: 8 } }, { value: 'Unpaid', meta: { quota: 0 } }]),
  ...L('document_category', ['CNIC', 'Agreement', 'Payment Proof', 'Site Plan', 'Allotment Letter', 'Resume/CV', 'Educational', 'Experience Letter', 'Contract', 'Architectural Drawing', 'Construction Drawing', 'Passport', 'Photo', 'Other']),
  ...L('construction_activity', ['Site clearing & marking', 'Excavation', 'Footing work', 'Plinth beam & DPC', 'Column work', 'Scaffolding work', 'Slab work', 'Masonry / brickwork', 'Plastering', 'Electrical conduiting', 'Plumbing & sewerage', 'Flooring & tiles', 'Woodwork & doors', 'Painting & finishing', 'Boundary wall', 'Final cleaning & handover']),
  ...L('dev_item_template', ['Land Development', 'Road Construction', 'Electricity', 'Sewerage', 'Boundary Wall', 'Street Development', 'Final Development']),
];

// Developer partner portal accounts (docs/DEVELOPER_PARTNER_PORTAL.md section 7). Also added to existing workspaces by upgradePermissions().
export const DEV_ACCOUNTS = [
  ['1350', 'Developer Rebate Receivable', 'asset', null, '1000'], ['1450', 'Resale File Inventory', 'asset', null, '1000'],
  ['2610', 'Developer Clearing (customer contracts)', 'liability', null, '2000'], ['2620', 'Developer Payable (taken-over files)', 'liability', null, '2000'],
  ['4500', 'Developer Rebate Income', 'income', null, '4000'], ['4510', 'Cancellation Deduction Income', 'income', null, '4000'],
  ['5950', 'Cost of Resold Files', 'expense', null, '5000'],
];

// [code, name, type, subtype, parentCode]
const COA = [
  ['1000', 'Assets', 'asset', null, null], ['1100', 'Cash', 'asset', null, '1000'], ['1110', 'Company Cash Till', 'asset', 'cash', '1100'],
  ['1120', 'Petty Cash', 'asset', 'cash', '1100'], ['1130', 'Finance Manager Custody', 'asset', 'custody', '1100'],
  ['1200', 'Bank', 'asset', null, '1000'], ['1210', 'Main Bank Account', 'asset', 'bank', '1200'], ['1220', 'Bank Account 2', 'asset', 'bank', '1200'],
  ['1230', 'Online Payment Account', 'asset', 'online', '1200'], ['1300', 'Accounts Receivable (Customers)', 'asset', 'receivable', '1000'], ['1400', 'Property Inventory', 'asset', null, '1000'],
  ['2000', 'Liabilities', 'liability', null, null], ['2100', 'Vendor Payables', 'liability', 'payable', '2000'], ['2200', 'Customer Advances', 'liability', null, '2000'],
  ['2300', 'Commission Payable', 'liability', null, '2000'], ['2400', 'Salary Payable', 'liability', null, '2000'],
  ['3000', 'Equity', 'equity', null, null], ['3100', 'Capital', 'equity', null, '3000'], ['3200', 'Retained Earnings', 'equity', null, '3000'],
  ['4000', 'Income', 'income', null, null], ['4100', 'Property Sales', 'income', null, '4000'], ['4200', 'Booking Income', 'income', null, '4000'],
  ['4150', 'Construction Contract Income', 'income', null, '4000'], ['4300', 'Installment Income', 'income', null, '4000'], ['4400', 'Balloon Payments', 'income', null, '4000'], ['4900', 'Other Income', 'income', null, '4000'],
  ['5000', 'Expenses', 'expense', null, null], ['5100', 'Construction', 'expense', null, '5000'], ['5110', 'Bricks', 'expense', null, '5100'], ['5120', 'Cement', 'expense', null, '5100'],
  ['5130', 'Steel', 'expense', null, '5100'], ['5140', 'Wood', 'expense', null, '5100'], ['5150', 'Water', 'expense', null, '5100'], ['5160', 'Labour', 'expense', null, '5100'],
  ['5200', 'Marketing', 'expense', null, '5000'], ['5300', 'Salaries', 'expense', null, '5000'], ['5400', 'Utilities', 'expense', null, '5000'], ['5500', 'Transport', 'expense', null, '5000'],
  ['5600', 'Office Expenses', 'expense', null, '5000'], ['5800', 'Assets & Equipment Purchases', 'expense', null, '5000'], ['5700', 'Commission Expense', 'expense', null, '5000'],
  ...DEV_ACCOUNTS, ['5900', 'Other Expenses', 'expense', null, '5000'],
];

/** Essential configuration — always present, never demo. */
/**
 * Base configuration for an empty database: roles, lookups, chart of accounts, settings and one Super Admin.
 * `opts` (company name, admin, currency) is used when a new tenant is provisioned; the original install keeps the env defaults.
 */
export function bootstrap(opts = {}) {
  if (val('SELECT COUNT(*) FROM roles') > 0) return false;
  tx(() => {
    for (const r of ROLES) {
      const id = Number(run('INSERT INTO roles(name,description,own_scope,portal,is_system) VALUES(?,?,?,?,1)', r.name, r.description, r.own_scope || 0, r.portal || 0).lastInsertRowid);
      const extra = r.portal || r.name === 'Super Admin' || r.name === 'Admin' ? [] : P(['content'], r.name === 'Sales Manager' ? [...RW, 'approve', 'delete'] : RW);
      for (const p of new Set([...r.perms, ...extra])) { const [m, a] = p.split(':'); run('INSERT INTO role_permissions(role_id,module,action) VALUES(?,?,?)', id, m, a); }
    }
    for (const l of LOOKUPS) run('INSERT INTO lookups(type,value,color,meta,sort_order) VALUES(?,?,?,?,?)', l.type, l.value, l.color ?? null, l.meta ? JSON.stringify(l.meta) : null, l.sort_order);
    for (const [code, name, type, subtype, parent] of COA) {
      run('INSERT INTO accounts(code,name,type,subtype,parent_id,is_system) VALUES(?,?,?,?,?,1)', code, name, type, subtype, parent ? val('SELECT id FROM accounts WHERE code=?', parent) : null);
    }
    const s = {
      company_name: opts.companyName || 'Expert Marketing & Developers', company_address: '', company_phone: '', company_email: opts.adminEmail || '', currency: opts.currency || 'PKR', date_format: 'DD-MMM-YYYY',
      default_commission_pct: 2, agent_targets: JSON.stringify({ Bronze: 1, Silver: 3, Gold: 6, Platinum: 10, Champion: 15 }), installment_reminder_days: 7,
      website_api_key: 'emd_' + crypto.randomBytes(24).toString('hex'), work_start: '09:00', work_end: '18:00',
    };
    for (const [k, v] of Object.entries(s)) setSetting(k, v);
    run('INSERT INTO commission_rules(name,type,value,active) VALUES(?,?,?,1)', 'Standard 2% commission', 'percentage', 2);
    run('INSERT INTO commission_rules(name,type,value,sale_kind,active) VALUES(?,?,?,?,1)', 'Construction contracts 1.5%', 'percentage', 1.5, 'construction');
    const adminEmail = opts.adminEmail || process.env.ADMIN_EMAIL || 'admin@expertdevelopers.pk';
    const pwd = opts.adminPassword || process.env.ADMIN_PASSWORD || DEMO_PASSWORD;
    run('INSERT INTO users(name,email,password_hash,role_id,created_at) VALUES(?,?,?,?,?)', opts.adminName || 'Super Admin', adminEmail, bcrypt.hashSync(pwd, 10), val("SELECT id FROM roles WHERE name='Super Admin'"), now());
  });
  return true;
}

const ph = (n) => `+92 3${String(10 + n).slice(-2)} ${String(1000000 + n * 7919).slice(0, 7)}`;

export function seedDemo() {
  if (val('SELECT COUNT(*) FROM users') > 1) return false;
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const role = (n) => val('SELECT id FROM roles WHERE name=?', n);
  const mkUser = (name, email, roleName, phone) => Number(run('INSERT INTO users(name,email,phone,password_hash,role_id,is_demo,created_at) VALUES(?,?,?,?,?,1,?)', name, email, phone, hash, role(roleName), now()).lastInsertRowid);

  tx(() => {
    // ---- Users & employees
    run("UPDATE users SET is_demo=1, name='Super Admin (Demo)' WHERE role_id=?", role('Super Admin'));
    const U = {
      admin: mkUser('Ayesha Rehman', 'admin.demo@expertdevelopers.pk', 'Admin', '+92 300 1000001'),
      finance: mkUser('Hassan Raza', 'finance@expertdevelopers.pk', 'Finance Manager', '+92 300 1000002'),
      sm: mkUser('Omar Farooq', 'salesmanager@expertdevelopers.pk', 'Sales Manager', '+92 300 1000003'),
      a1: mkUser('Bilal Chaudhry', 'agent1@expertdevelopers.pk', 'Sales Agent', '+92 300 1000004'),
      a2: mkUser('Mariam Shah', 'agent2@expertdevelopers.pk', 'Sales Agent', '+92 300 1000005'),
      a3: mkUser('Danish Iqbal', 'agent3@expertdevelopers.pk', 'Sales Agent', '+92 300 1000006'),
      hr: mkUser('Sana Javed', 'hr@expertdevelopers.pk', 'HR Manager', '+92 300 1000007'),
      pm: mkUser('Engr. Tahir Mehmood', 'pm@expertdevelopers.pk', 'Project Manager', '+92 300 1000008'),
      lm: mkUser('Hamna Aslam', 'listing@expertdevelopers.pk', 'Listing Manager', '+92 300 1000009'),
      wm: mkUser('Zara Iqbal', 'web@expertdevelopers.pk', 'Website Manager', '+92 300 1000010'),
      seo: mkUser('Omar Farooq', 'seo@expertdevelopers.pk', 'SEO Manager', '+92 300 1000011'),
    };
    const superId = val("SELECT id FROM users WHERE role_id=? LIMIT 1", role('Super Admin'));
    const staff = [[superId, 'Director (Demo)', 'Director', 'Administration', 600000], [U.admin, 'Ayesha Rehman', 'Admin Officer', 'Administration', 180000], [U.finance, 'Hassan Raza', 'Finance Manager', 'Finance', 250000],
      [U.sm, 'Omar Farooq', 'Sales Manager', 'Sales', 220000], [U.a1, 'Bilal Chaudhry', 'Sales Agent', 'Sales', 70000], [U.a2, 'Mariam Shah', 'Sales Agent', 'Sales', 70000],
      [U.a3, 'Danish Iqbal', 'Sales Agent', 'Sales', 65000], [U.hr, 'Sana Javed', 'HR Manager', 'HR', 150000], [U.pm, 'Engr. Tahir Mehmood', 'Project Manager', 'Projects', 200000], [U.lm, 'Hamna Aslam', 'Listing Manager', 'Marketing', 130000], [U.wm, 'Zara Iqbal', 'Website Manager', 'Marketing', 140000], [U.seo, 'Omar Farooq', 'SEO Manager', 'Marketing', 125000]];
    staff.forEach(([uid, name, des, dep, sal], i) => {
      run(`INSERT INTO employees(emp_code,name,gender,phone,email,department,designation,hire_date,employment_type,salary,branch,status,user_id,is_demo,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
        `EMP-${String(i + 1).padStart(4, '0')}`, name, i % 2 ? 'Female' : 'Male', ph(i), get('SELECT email FROM users WHERE id=?', uid).email, dep, des, addMonths(today(), -24 + i * 2), 'Full-time', sal, 'Head Office', 'active', uid, now());
    });
    run("UPDATE counters SET value=? WHERE key='EMP'", staff.length);
    run("INSERT INTO counters(key,value) VALUES('EMP',?) ON CONFLICT(key) DO UPDATE SET value=?", staff.length, staff.length);

    // ---- Projects
    const proj = (code, name, loc, dev, area, units, value, status, start, end) => Number(run(`INSERT INTO projects(code,name,location,developer,description,total_land_area,land_unit,total_units,total_value,dev_status,manager_id,start_date,expected_completion,is_demo,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`, code, name, loc, 'Expert Marketing & Developers', `${name} — a planned residential and commercial community (demo data).`, area, 'Kanal', units, value, status, U.pm, start, end, now()).lastInsertRowid);
    const PR = {
      er: proj('ER', 'Expert Residency', 'Sargodha Road, Faisalabad', 120, 400, 120, 1_800_000_000, 'Under Development', addMonths(today(), -18), addMonths(today(), 12)),
      eg: proj('EG', 'Expert Greens', 'Park Road, Islamabad', 80, 250, 80, 1_200_000_000, 'Under Development', addMonths(today(), -10), addMonths(today(), 20)),
      ec: proj('EC', 'Expert City', 'Ferozepur Road, Lahore', 200, 800, 200, 3_600_000_000, 'Planning', addMonths(today(), -4), addMonths(today(), 36)),
    };
    const eh = Number(run(`INSERT INTO projects(code,name,location,developer,description,total_units,dev_status,manager_id,start_date,expected_completion,is_development,kind,is_demo,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,0,'construction',1,?)`, 'EH', 'Expert Homes — House Construction', 'Faisalabad & Lahore', 'Expert Marketing & Developers',
    'Turn-key house construction contracts for customers (demo data).', 0, 'Under Development', U.pm, addMonths(today(), -6), addMonths(today(), 18), now()).lastInsertRowid);
    PR.eh = eh;
    const progress = { er: [100, 100, 70, 50, 90, 40, 20], eg: [100, 80, 40, 30, 50, 10, 0], ec: [60, 20, 0, 0, 10, 0, 0] };
    const items = ['Land Development', 'Road Construction', 'Electricity', 'Sewerage', 'Boundary Wall', 'Street Development', 'Final Development'];
    for (const k of ['er', 'eg', 'ec']) items.forEach((n, i) => run('INSERT INTO dev_items(project_id,name,progress,sort_order) VALUES(?,?,?,?)', PR[k], n, progress[k][i], i));
    const upd = (p, d, title, pr, desc) => run('INSERT INTO dev_updates(project_id,update_date,title,kind,progress,description,published,created_by,created_at) VALUES(?,?,?,?,?,?,1,?,?)', p, d, title, 'Progress', pr, desc, U.pm, now());
    upd(PR.er, addDays(today(), -40), 'Road base completed in Block A', 55, 'Sub-base and base course completed for all internal roads in Block A.');
    upd(PR.er, addDays(today(), -9), 'Electricity poles installed', 70, 'Transformers delivered; pole installation 70% complete across Blocks A and B.');
    upd(PR.eg, addDays(today(), -15), 'Boundary wall progress', 50, 'Boundary wall at the north and east sides is now complete.');

    // ---- Properties (flagged demo)
    const prop = (project, title, type, block, plot, area, unit, price, discount, extra = {}) => {
      const net = price - discount;
      return Number(run(`INSERT INTO properties(code,title,purpose,property_type,project_id,block,plot_no,city,area_name,location,area_size,unit,total_price,price_per_unit,discount,net_price,installment_available,
        ready_possession,features,amenities,short_desc,description,agent_id,contact_email,contact_phone,status,review_state,published,is_demo,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      `PR-${String(val("SELECT COUNT(*)+1 FROM properties")).padStart(5, '0')}`, title, extra.purpose || 'Sell', type, project, block, plot, extra.city || 'Faisalabad', extra.area_name || '', extra.location || '',
      area, unit, price, Math.round(price / area), discount, net, 1, extra.ready ? 1 : 0, JSON.stringify(extra.features || {}),
      JSON.stringify(extra.amenities || ['Electricity', 'Water', 'Security', 'Gated Community']), `${title} — demo listing`, `${title}. A well-located property with clear title and installment options. (Demo listing)`, extra.agent || U.a1,
      'sales@expertdevelopers.pk', '+92 300 1000000', 'available', 'published', 1, U.admin, now(), now()).lastInsertRowid);
    };
    const feat = { corner: true, park_facing: false, main_road: false, boulevard: false, possession: 'Immediate', development_status: 'Developed' };
    const P_ = {
      p2b: prop(PR.er, 'Plot 2B — Expert Residency', 'Plots', 'A', '2B', 10, 'Marla', 10_000_000, 500_000, { features: feat, city: 'Faisalabad', area_name: 'Sargodha Road' }),
      p2c: prop(PR.er, 'Plot 2C — Expert Residency', 'Plots', 'A', '2C', 10, 'Marla', 10_500_000, 0, { features: { ...feat, corner: false, park_facing: true }, city: 'Faisalabad', agent: U.a2 }),
      p2d: prop(PR.er, 'Plot 2D — Expert Residency', 'Plots', 'A', '2D', 5, 'Marla', 5_400_000, 0, { city: 'Faisalabad', agent: U.a3 }),
      p5a: prop(PR.eg, 'Plot 5A — Expert Greens', 'Plots', 'B', '5A', 1, 'Kanal', 6_500_000, 0, { features: { ...feat, main_road: true }, city: 'Islamabad', area_name: 'Park Road' }),
      h101: prop(PR.ec, 'House 101 — Expert City', 'Houses', 'C', '101', 7, 'Marla', 24_500_000, 500_000, { city: 'Lahore', ready: true, agent: U.a2, features: { bedrooms: 4, bathrooms: 4, floors: 2, kitchen: 1, garage: true, lawn: true, drawing_room: true, dining_room: true } }),
      p7c: prop(PR.er, 'Plot 7C — Expert Residency', 'Plots', 'B', '7C', 3, 'Marla', 1_200_000, 0, { city: 'Faisalabad', features: feat }),
      s12: prop(PR.ec, 'Commercial Shop 12 — Expert City', 'Shops', 'Commercial', '12', 450, 'Sq Ft', 12_000_000, 0, { city: 'Lahore', agent: U.a2, amenities: ['Electricity', 'Water', 'Parking', 'Main Road', 'Commercial Area'] }),
    };
    // listings waiting for the Listing Manager: a property added by an agent and a project an agent wants shown on the website
    const pendingProp = prop(PR.ec, 'Corner Plot 21 — Expert City Block E', 'Plots', 'E', '21', 10, 'Marla', 9_800_000, 0, { city: 'Lahore', agent: U.a1, area_name: 'Ferozepur Road' });
    run("UPDATE properties SET review_state='review', published=0, status='draft', created_by=? WHERE id=?", U.a1, pendingProp);
    run(`INSERT INTO projects(code,name,location,developer,description,total_units,dev_status,is_development,kind,site_visible,site_state,site_requested_by,site_requested_at,is_demo,created_at)
      VALUES('EX','Expert Heights','Chakri Road, Rawalpindi','Expert Marketing & Developers','Boutique apartments and shops on Chakri Road with ready possession and easy installments.',60,'Planning',1,'development',0,'requested',?,?,1,?)`, U.a2, now(), now());
    const hf = (b, ba, fl) => ({ bedrooms: b, bathrooms: ba, floors: fl, kitchen: 1, garage: true, lawn: true, drawing_room: true, dining_room: true });
    const more = [
      prop(PR.er, 'Plot 3A — Expert Residency', 'Plots', 'A', '3A', 5, 'Marla', 5_200_000, 0, { city: 'Faisalabad', area_name: 'Sargodha Road', agent: U.a2, features: { ...feat, park_facing: true } }),
      prop(PR.er, 'Plot 3B — Expert Residency', 'Plots', 'A', '3B', 10, 'Marla', 9_800_000, 200_000, { city: 'Faisalabad', area_name: 'Sargodha Road', agent: U.a3, features: { ...feat, corner: true, main_road: true } }),
      prop(PR.eg, 'Plot 6C — Expert Greens', 'Plots', 'B', '6C', 1, 'Kanal', 7_200_000, 0, { city: 'Islamabad', area_name: 'Park Road', agent: U.a1, features: { ...feat, boulevard: true } }),
      prop(PR.eg, 'Plot 8A — Expert Greens', 'Plots', 'C', '8A', 10, 'Marla', 4_900_000, 0, { city: 'Islamabad', area_name: 'Park Road', agent: U.a2 }),
      prop(PR.ec, 'House 102 — Expert City', 'Houses', 'C', '102', 5, 'Marla', 16_500_000, 0, { city: 'Lahore', area_name: 'Ferozepur Road', agent: U.a3, ready: true, features: hf(3, 3, 2) }),
      prop(PR.ec, 'House 205 — Expert City', 'Houses', 'D', '205', 10, 'Marla', 31_000_000, 1_000_000, { city: 'Lahore', area_name: 'Ferozepur Road', agent: U.a2, ready: true, features: hf(5, 5, 2) }),
      prop(PR.ec, 'Apartment 4B — Expert City Heights', 'Apartments', 'Heights', '4B', 1200, 'Sq Ft', 14_500_000, 0, { city: 'Lahore', area_name: 'Ferozepur Road', agent: U.a1, ready: true, features: { bedrooms: 2, bathrooms: 2, floors: 1, kitchen: 1 }, amenities: ['Electricity', 'Gas', 'Water', 'Security', 'Parking', 'Gated Community'] }),
      prop(PR.ec, 'Shop 14 — Expert City Mall', 'Shops', 'Commercial', '14', 300, 'Sq Ft', 8_500_000, 0, { city: 'Lahore', area_name: 'Ferozepur Road', agent: U.a3, amenities: ['Electricity', 'Water', 'Parking', 'Main Road', 'Commercial Area'] }),
      prop(PR.ec, 'Office 2F — Expert City Heights (for rent)', 'Offices', 'Heights', '2F', 900, 'Sq Ft', 150_000, 0, { city: 'Lahore', area_name: 'Ferozepur Road', agent: U.a2, purpose: 'Rent', ready: true }),
      prop(PR.ec, 'Apartment 3A — Expert City Heights (for rent)', 'Apartments', 'Heights', '3A', 1000, 'Sq Ft', 85_000, 0, { city: 'Lahore', area_name: 'Ferozepur Road', agent: U.a1, purpose: 'Rent', ready: true, features: { bedrooms: 2, bathrooms: 2, floors: 1, kitchen: 1 } }),
    ];
    run("UPDATE properties SET status='featured' WHERE id=?", more[5]);
    run("UPDATE properties SET status='featured' WHERE id=?", P_.h101);
    const nProps = val('SELECT COUNT(*) FROM properties'); run("INSERT INTO counters(key,value) VALUES('PR',?) ON CONFLICT(key) DO UPDATE SET value=?", nProps, nProps);

    // ---- Treasury opening balances (posted as journals against Capital)
    postOpening(acct('1110'), 5_000_000, superId); postOpening(acct('1210'), 20_000_000, superId);
    postOpening(acct('1220'), 5_000_000, superId); postOpening(acct('1120'), 100_000, superId);

    // ---- Contacts
    const stage = (v) => val("SELECT id FROM lookups WHERE type='lead_stage' AND value=?", v);
    const contact = (name, phone, email, src, st, agent, extra = {}) => {
      const [fn, ...rest] = name.split(' ');
      const id = Number(run(`INSERT INTO contacts(first_name,last_name,full_name,phone,email,cnic,city,lead_source,stage_id,lead_type,agent_id,manager_id,tags,priority,project_id,property_id,budget,followup_date,is_demo,created_by,created_at,last_activity_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`, fn, rest.join(' '), name, phone, email, extra.cnic ?? null, extra.city || 'Lahore', src, stage(st), extra.type || 'Buyer', agent, U.sm,
      JSON.stringify(extra.tags || []), extra.priority || 'Medium', extra.project ?? null, extra.property ?? null, extra.budget ?? null, extra.followup ?? null, agent, `${addDays(today(), -(extra.age ?? 10))} 11:00:00`, `${addDays(today(), -(extra.age ?? 10))} 11:00:00`).lastInsertRowid);
      activity(id, { id: agent, name: get('SELECT name FROM users WHERE id=?', agent).name }, 'Lead created', { detail: `Source: ${src}` });
      return id;
    };
    const C = {
      ali: contact('Muhammad Ali', '+92 321 4455667', 'm.ali@example.com', 'Referral', 'Interested', U.a1, { cnic: '35202-1234567-1', city: 'Faisalabad', budget: 10_000_000, project: PR.er, property: P_.p2b, age: 200, tags: ['investor'] }),
      sara: contact('Sara Khan', '+92 333 2233445', 'sara.khan@example.com', 'Website', 'Interested', U.a1, { cnic: '61101-7654321-2', city: 'Islamabad', budget: 6_500_000, project: PR.eg, property: P_.p5a, age: 120 }),
      bilal: contact('Bilal Ahmed', '+92 345 9988776', 'bilal.ahmed@example.com', 'Facebook', 'Interested', U.a2, { cnic: '35201-9988776-3', budget: 12_000_000, project: PR.ec, property: P_.s12, age: 60, type: 'Investor' }),
      ayesha: contact('Ayesha Siddiqui', '+92 300 7766554', 'ayesha.s@example.com', 'Instagram', 'Interested', U.a2, { budget: 25_000_000, project: PR.ec, property: P_.h101, followup: today(), priority: 'High', tags: ['hot'], age: 8 }),
      hamza: contact('Hamza Qureshi', '+92 311 1234321', 'hamza.q@example.com', 'Walk-in', 'Follow Up', U.a1, { budget: 8_000_000, followup: addDays(today(), 2), age: 14 }),
      fatima: contact('Fatima Zahra', '+92 322 5566778', null, 'Zameen.com', 'Contacted', U.a3, { budget: 5_500_000, project: PR.er, age: 5 }),
      usman: contact('Usman Tariq', '+92 301 8899001', 'usman.t@example.com', 'Referral', 'Non Contacted', U.a3, { budget: 15_000_000, age: 1 }),
      zainab: contact('Zainab Malik', '+92 334 1122334', 'zainab.m@example.com', 'Exhibition', 'Follow Up', U.a2, { budget: 11_000_000, followup: today(), project: PR.er, age: 20, priority: 'High' }),
      imran: contact('Imran Hussain', '+92 313 6677889', null, 'Phone Call', 'Not Interested', U.a1, { budget: 3_000_000, age: 45 }),
      nadia: contact('Nadia Rauf', '+92 302 4455660', 'nadia.r@example.com', 'OLX', 'Contacted', U.a3, { budget: 9_500_000, followup: addDays(today(), 5), age: 9 }),
      kamran: contact('Kamran Akmal', '+92 335 7788990', null, 'Agent Network', 'Non Contacted', U.a2, { budget: 20_000_000, age: 0 }),
      hira: contact('Hira Baig', '+92 323 2200119', 'hira.baig@example.com', 'Website', 'Interested', U.a3, { budget: 18_000_000, followup: addDays(today(), -1), project: PR.ec, age: 12, tags: ['hot'] }),
    };
    run("UPDATE properties SET status='reserved', reserved_contact_id=? WHERE id=?", C.ayesha, P_.p2c);
    activity(C.ayesha, { id: U.a2, name: 'Mariam Shah' }, 'Property reserved', { detail: 'Plot 2C — Expert Residency' });
    for (const [t, c, d, u] of [['Call to discuss payment plan', C.ayesha, today(), U.a2], ['Site visit — Expert Residency', C.zainab, addDays(today(), 1), U.a2], ['Send brochure', C.fatima, addDays(today(), 3), U.a3]]) {
      run("INSERT INTO tasks(entity_type,entity_id,title,due_date,assigned_to,created_by,created_at) VALUES('contact',?,?,?,?,?,?)", c, t, d, u, u, now());
    }
    run("INSERT INTO notes(entity_type,entity_id,body,user_id,created_at) VALUES('contact',?,?,?,?)", C.ayesha, 'Interested in a ready house. Prefers 24 month plan with 20% booking.', U.a2, now());
    const sl = (name, rules, shared = 1, def = 0) => run('INSERT INTO smart_lists(name,logic,rules,owner_id,shared,is_default,created_at) VALUES(?,?,?,?,?,?,?)', name, 'AND', JSON.stringify(rules), U.sm, shared, def, now());
    sl('Hot Leads', [{ field: 'stage', op: 'eq', value: stage('Interested') }, { field: 'budget', op: 'gt', value: 10000000 }]);
    sl('Follow-up Today', [{ field: 'followup', op: 'eq', value: 'today' }]);
    sl('Overdue Customers', [{ field: 'payment_status', op: 'eq', value: 'overdue' }]);

    run('INSERT INTO holidays(date,name) VALUES(?,?),(?,?),(?,?),(?,?)', '2026-11-09', 'Iqbal Day', '2026-12-25', 'Quaid-e-Azam Day', '2027-02-05', 'Kashmir Day', '2027-03-23', 'Pakistan Day');
    run(`INSERT INTO recruitment(position,candidate,phone,stage,created_at) VALUES('Sales Agent','Rizwan Ahmed','+92 300 5551234','Interview',?),('Accountant','Maryam Noor','+92 300 5554321','Applied',?)`, now(), now());

    // expose ids for the next phase
    global.__seed = { U, PR, P_, C, superId };
  });

  // ---- Transactions through the real services (these create journals, ledgers, commissions)
  const { U, PR, P_, C, superId } = global.__seed;
  const fin = loadUser(U.finance), sa = loadUser(superId), sm = loadUser(U.sm);
  const req = (u) => ({ user: u, ip: 'seed' });
  const bank = acct('1210'), till = acct('1110'), bank2 = acct('1220');
  let txn = 0;
  const bankPay = (contact, sale, amount, type, date, r = req(fin)) => receivePayment({ contact_id: contact, sale_id: sale, amount, payment_type: type, method: 'Bank Transfer', bank: 'HBL', txn_id: `TXN-DEMO-${++txn}`, account_id: bank, date }, r);

  // Sale 1 — Plot 2B, Muhammad Ali. 1,000,000 booking + 30 × 250,000 + 2 × 500,000 balloons = 9,500,000 net
  const d1 = addMonths(today(), -6);
  const s1 = createSale({ contact_id: C.ali, property_id: P_.p2b, sale_date: d1, sale_price: 10_000_000, discount: 500_000, booking_amount: 1_000_000, num_installments: 30, installment_amount: 250_000,
    balloon_count: 2, balloon_amount: 500_000, balloon_interval: 6, first_due: addMonths(d1, 1), agent_id: U.a1,
    collect_booking: { method: 'Bank Transfer', bank: 'HBL', txn_id: `TXN-DEMO-${++txn}`, account_id: bank } }, req(sm));
  for (let i = 1; i <= 4; i++) bankPay(C.ali, s1.id, 250_000, 'Installment', addMonths(d1, i));
  // Sale 2 — Plot 5A, Sara Khan
  const d2 = addMonths(today(), -3);
  const s2 = createSale({ contact_id: C.sara, property_id: P_.p5a, sale_date: d2, sale_price: 6_500_000, discount: 0, booking_amount: 1_300_000, num_installments: 12, installment_amount: 400_000,
    balloon_count: 1, balloon_amount: 400_000, first_due: addMonths(d2, 1), agent_id: U.a1,
    collect_booking: { method: 'Cash', account_id: till } }, req(sm));
  for (let i = 1; i <= 2; i++) bankPay(C.sara, s2.id, 400_000, 'Installment', addMonths(d2, i));
  // Sale 3 — Shop 12, Bilal Ahmed
  const d3 = addMonths(today(), -1);
  const s3 = createSale({ contact_id: C.bilal, property_id: P_.s12, sale_date: d3, sale_price: 12_000_000, discount: 0, booking_amount: 3_000_000, num_installments: 18, installment_amount: 500_000,
    first_due: addMonths(d3, 1), agent_id: U.a2, collect_booking: { method: 'Cheque', cheque_no: '004512', bank: 'Meezan Bank', account_id: bank2 } }, req(sm));
  // Bundled customer: plot 7C + house construction, paid together (PKR 25,000 plot + PKR 25,000 construction per month)
  const d4 = addMonths(today(), -3);
  const bundle = createSale({ contact_id: C.zainab, property_id: P_.p7c, sale_date: d4, sale_price: 1_200_000, discount: 0, booking_amount: 300_000, num_installments: 36, installment_amount: 25_000,
    first_due: addMonths(d4, 1), agent_id: U.a2, collect_booking: { method: 'Cash', account_id: till },
    construction: { project_id: PR.eh, title: 'House construction — Plot 7C', sale_price: 900_000, booking_amount: 0, installment_amount: 25_000 } }, req(sm));
  for (let i = 1; i <= 2; i++) {
    receivePayment({ contact_id: C.zainab, splits: bundle.ids.map((sid) => ({ sale_id: sid, amount: 25_000 })), payment_type: 'Installment', method: 'Bank Transfer', bank: 'HBL',
      txn_id: `TXN-DEMO-${++txn}`, account_id: bank, date: addMonths(d4, i) }, req(fin));
  }
  // Commission: approve + pay the first, approve the second
  const cm = all('SELECT id FROM commissions ORDER BY id');
  approveCommission(cm[0].id, req(fin)); payCommission(cm[0].id, { account_id: bank, amount: 100_000, method: 'Bank Transfer' }, req(fin));
  approveCommission(cm[1].id, req(fin));

  // ---- Vendors & expenses
  const vend = (name, company, cat, phone) => Number(run('INSERT INTO vendors(name,company,category,phone,payment_terms,is_demo,created_at) VALUES(?,?,?,?,?,1,?)', name, company, cat, phone, 'Net 30', now()).lastInsertRowid);
  const V = { bricks: vend('ABC Bricks', 'ABC Bricks & Co.', 'Brick Vendor', '+92 300 2000001'), wood: vend('Expert Wood Suppliers', 'Expert Wood Suppliers', 'Wood Vendor', '+92 300 2000002'), water: vend('XYZ Water Services', 'XYZ Water Services', 'Water Service Provider', '+92 300 2000003') };
  // custody: company till -> finance manager
  postJournal({ date: addDays(today(), -20), memo: 'Cash given to Finance Manager', refType: 'transfer', userId: superId, lines: [{ account: acct('1130'), debit: 500_000 }, { account: till, credit: 500_000 }] });
  const ev = (inp, pay, r = req(fin)) => { const id = createVoucher(inp, r); submitVoucher(id, r); approveVoucher(id, r); if (pay) payVoucher(id, pay, r); return id; };
  ev({ project_id: PR.er, vendor_id: V.bricks, expense_account_id: acct('5110'), description: 'Bricks — Block A boundary', quantity: 50000, unit_cost: 5, payment_method: 'Cash', date: addDays(today(), -18) }, { account_id: acct('1130'), method: 'Cash', date: addDays(today(), -18) });
  const credit = ev({ project_id: PR.er, vendor_id: V.bricks, expense_account_id: acct('5110'), description: 'Bricks on credit', amount: 300_000, is_credit: 1, due_date: addDays(today(), 12), date: addDays(today(), -25) });
  payVoucher(credit, { account_id: bank, amount: 200_000, method: 'Bank Transfer' }, req(fin));
  ev({ project_id: PR.er, vendor_id: V.wood, expense_account_id: acct('5140'), description: 'Wood — site offices', amount: 180_000, is_credit: 1, due_date: addDays(today(), -5), date: addDays(today(), -40) });
  ev({ project_id: PR.eg, vendor_id: V.water, expense_account_id: acct('5150'), description: 'Water tanker supply', amount: 85_000, payment_method: 'Bank Transfer', date: addDays(today(), -7) }, { account_id: bank, method: 'Bank Transfer', date: addDays(today(), -7) });
  ev({ project_id: PR.ec, expense_account_id: acct('5200'), description: 'Launch marketing campaign', amount: 350_000, payment_method: 'Bank Transfer', date: addDays(today(), -3) }, { account_id: bank, method: 'Bank Transfer', date: addDays(today(), -3) });
  { const id = createVoucher({ project_id: PR.er, vendor_id: V.water, expense_account_id: acct('5150'), description: 'Pending — water connection fee', amount: 60_000, date: today() }, req(fin)); submitVoucher(id, req(fin)); }

  // ---- Primavera-style schedules (relative to today so the demo always shows live delays)
  const D = (n) => addDays(today(), n);
  const task = (project, sale, name, a, b, progress, o = {}) => Number(run(`INSERT INTO project_tasks(project_id,sale_id,parent_id,name,planned_start,planned_end,actual_start,actual_end,progress,weight,predecessor_id,client_visible,sort_order,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`, project, sale, o.parent ?? null, name, D(a), D(b), o.as != null ? D(o.as) : null, o.ae != null ? D(o.ae) : null, o.ae != null ? 100 : 0, o.w ?? 1, o.pred ?? null, ++taskSeq, U.pm, now()).lastInsertRowid);
  let taskSeq = 0;
  const t1 = task(PR.er, null, 'Land development', -120, -60, 100, { as: -118, ae: -55 });
  const t2 = task(PR.er, null, 'Road construction', -70, -10, 85, { as: -68, pred: t1 });
  task(PR.er, null, 'Electricity network', -30, 30, 40, { as: -29 });
  task(PR.er, null, 'Sewerage & drainage', -20, 40, 20, { as: -18 });
  task(PR.er, null, 'Boundary wall', -60, 15, 70, { as: -58 });
  const t6 = task(PR.er, null, 'Street development', 10, 80, 0, { pred: t2 });
  task(PR.er, null, 'Final development & handover', 85, 120, 0, { pred: t6 });
  const house = bundle.ids[1];
  const g1 = task(PR.eh, house, 'Foundation', -80, -50, 100, { as: -80, ae: -50 });
  const g2 = task(PR.eh, house, 'Structure & roof', -50, -5, 60, { as: -48, pred: g1, w: 2 });
  const g3 = task(PR.eh, house, 'Brickwork & plaster', -4, 30, 0, { pred: g2 });
  const g4 = task(PR.eh, house, 'Electrical & plumbing', 20, 50, 0, { pred: g3 });
  const g5 = task(PR.eh, house, 'Finishing & paint', 45, 80, 0, { pred: g4 });
  task(PR.eh, house, 'Handover', 80, 90, 0, { pred: g5 });

  run('UPDATE projects SET budget=? WHERE id=?', 25_000_000, PR.er); run('UPDATE projects SET budget=? WHERE id=?', 15_000_000, PR.eg);
  run('UPDATE projects SET budget=? WHERE id=?', 40_000_000, PR.ec); run('UPDATE projects SET budget=? WHERE id=?', 6_000_000, PR.eh);

  // Sales goals (set by the sales manager) and some of today's activity so the Goals screen has something to show
  const goal = (uid, period, l, fu, cv, sv) => run('INSERT INTO agent_goals(user_id,period,leads,followups,conversions,sales_value,set_by,updated_at) VALUES(?,?,?,?,?,?,?,?)', uid, period, l, fu, cv, sv, U.sm, now());
  goal(null, 'daily', 5, 10, 0, 0); goal(null, 'monthly', 100, 200, 4, 20_000_000); goal(U.a1, 'daily', 6, 12, 0, 0); goal(U.a1, 'monthly', 120, 240, 5, 25_000_000);
  const done = (uid, name, n) => { for (let i = 0; i < n; i++) run("INSERT INTO activities(contact_id,user_id,user_name,action,detail,created_at) VALUES(NULL,?,?,'Follow-up completed','Call completed (demo)',?)", uid, name, now()); };
  done(U.a1, 'Bilal Chaudhry', 7); done(U.a2, 'Mariam Shah', 4); done(U.a3, 'Danish Iqbal', 2);

  // Print branding defaults (editable in Settings → Receipts & branding)
  for (const [k, v] of Object.entries({ company_phone: 'Mobile: 0300-5551350  |  Ph: 051-5575280', company_email: 'info@expertdevelopers.pk', company_address: 'Head Office: Abdul Majeed Plaza, Main Chakri Road, Peer Mehar Ali Shah Town, Near Royal Grand Marquee, Rawalpindi', print_address: 'Head Office: Abdul Majeed Plaza, Main Chakri Road, Peer Mehar Ali Shah Town, Near Royal Grand Marquee, Rawalpindi', print_header: 'Expert Marketing & Developers', print_phone: 'Mobile: 0300-5551350  |  Ph: 051-5575280', print_email: 'info@expertdevelopers.pk', print_website: 'www.expertdevelopers.pk',
    print_social: JSON.stringify([{ platform: 'Facebook', handle: 'expertmarketingdev' }, { platform: 'Instagram', handle: 'Expertmarketingdev' }]),
    receipt_title: 'RECEIPT VOUCHER', receipt_footer: 'Thank you for your payment. This is a computer-generated receipt and does not require a signature.', receipt_terms: 'Payments are subject to realisation. Please quote your receipt number in all correspondence.',
    expense_title: 'EXPENSE VOUCHER', expense_footer: 'Approved expenses are posted to the project ledger.' })) setSetting(k, v);

  // HR: draft payroll for last month; attendance today
  const lastMonth = addMonths(today(), -1).slice(0, 7);
  for (const e of all("SELECT * FROM employees WHERE status='active'")) {
    run('INSERT INTO payroll(employee_id,period,basic,allowances,bonus,commission,deductions,advances,loans,net,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', e.id, lastMonth, e.salary, 0, 0, 0, 0, 0, 0, e.salary, 'draft', now());
    run("INSERT INTO attendance(employee_id,date,check_in,check_out,late_minutes,status) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING", e.id, today(), '09:05', null, 5, 'late');
  }
  run("INSERT INTO leaves(employee_id,type,from_date,to_date,days,reason,status,created_at) VALUES(5,'Casual',?,?,1,'Family function','pending',?)", addDays(today(), 7), addDays(today(), 7), now());

  // ---- Staff self-service demo: reporting lines, profile details, attendance, leave, payslips, tasks, assets, content, promos
  {
    const empOf = (uid) => get('SELECT * FROM employees WHERE user_id=?', uid);
    const bossOf = { [U.a1]: U.sm, [U.a2]: U.sm, [U.a3]: U.sm, [U.sm]: superId, [U.hr]: U.admin, [U.pm]: U.admin, [U.finance]: U.admin, [U.admin]: superId };
    const fathers = ['Abdul Rehman', 'Muhammad Aslam', 'Ghulam Hussain', 'Shabbir Ahmed', 'Nazir Chaudhry', 'Riaz Shah', 'Iqbal Hussain', 'Javed Akhtar', 'Mehmood Khan'];
    const kinds = ['Permanent', 'Permanent', 'Full time', 'Permanent', 'Probation', 'Full time', 'Part time', 'Permanent', 'Contract based'];
    const pad = (n) => String(n).padStart(2, '0');
    all('SELECT id,user_id FROM employees ORDER BY id').forEach((e, i) => {
      run('UPDATE employees SET manager_id=?, father_name=?, dob=?, emergency_contact=?, employment_type=? WHERE id=?', bossOf[e.user_id] ? empOf(bossOf[e.user_id])?.id ?? null : null,
        fathers[i % fathers.length], `${1986 + i}-${pad((i % 12) + 1)}-${pad(10 + i)}`, `+92 321 55500${pad(i)}`, kinds[i % kinds.length], e.id);
    });
    // attendance marked by HR for every working day this month so far
    const first = today().slice(0, 7) + '-01';
    for (const e of all("SELECT id FROM employees WHERE status='active'")) {
      for (let d = first, k = 0; d < today(); d = addDays(d, 1), k++) {
        if (new Date(d + 'T00:00:00Z').getUTCDay() === 0) continue;
        const roll = (e.id * 7 + k * 3) % 13;
        const st = roll === 0 ? 'absent' : roll === 5 ? 'late' : roll === 9 ? 'half_day' : 'present';
        run('INSERT INTO attendance(employee_id,date,check_in,check_out,late_minutes,status) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING', e.id, d, st === 'absent' ? null : st === 'late' ? '09:25' : '09:00', st === 'absent' ? null : '18:00', st === 'late' ? 25 : 0, st);
      }
    }
    // leave: one approved (sick), one pending already seeded above
    run("INSERT INTO leaves(employee_id,type,from_date,to_date,days,reason,status,approved_by,decided_at,created_at) VALUES(?,?,?,?,2,'Fever and rest','approved',?,?,?)", empOf(U.a2).id, 'Sick', addDays(today(), -12), addDays(today(), -11), U.sm, now(), now());
    // last month's payroll is paid (booked through accounting) so employees can open their payslips
    const lastM = addMonths(today(), -1).slice(0, 7);
    for (const p of all("SELECT * FROM payroll WHERE period=? AND status='draft'", lastM)) {
      const jid = postJournal({ date: `${lastM}-28`, memo: `Salary ${lastM}`, refType: 'payroll', refId: p.id, userId: superId, lines: [{ account: '5300', debit: p.net }, { account: bank, credit: p.net }] });
      run("UPDATE payroll SET status='paid', payment_date=?, payment_method='Bank Transfer', account_id=?, journal_id=? WHERE id=?", `${lastM}-28`, bank, jid, p.id);
    }
    // work tasks assigned by management
    const wt = (title, desc, pri, due, to, by, status = 'todo') => Number(run('INSERT INTO work_tasks(title,description,priority,due_date,status,assigned_to,assigned_by,created_at) VALUES(?,?,?,?,?,?,?,?)', title, desc, pri, due ? addDays(today(), due) : null, status, to, by, now()).lastInsertRowid);
    wt('Call every "Interested" lead today', 'Aim to book at least two site visits. Update the lead stage after each call.', 'High', 0, U.a1, U.sm);
    wt('Prepare weekly sales report', 'Leads received, follow-ups done and conversions for the week.', 'Medium', 2, U.a2, U.sm);
    wt('Visit Expert City site with two clients', null, 'Medium', 3, U.a3, U.sm, 'in_progress');
    wt('Collect pending CNIC copies from customers', 'Check the Documents tab of each customer.', 'Low', 5, U.admin, superId);
    wt('Update the employee handbook', null, 'Low', 10, U.hr, U.admin);
    // company assets (the laptop is bought through an expense voucher so the funds trail is visible)
    const aId = nextNoAsset();
    function nextNoAsset() { run("INSERT INTO counters(key,value) VALUES('AST',1) ON CONFLICT(key) DO UPDATE SET value=value+1"); return `AST-${String(val("SELECT value FROM counters WHERE key='AST'")).padStart(4, '0')}`; }
    const lapV = ev({ expense_account_id: acct('5800'), description: `Asset purchase: Dell Latitude laptop (${aId})`, amount: 185_000, payment_method: 'Bank Transfer', date: addDays(today(), -60) }, { account_id: bank, method: 'Bank Transfer', date: addDays(today(), -60) });
    // approving the voucher already filed an asset; the demo laptop below is that record with full details, so drop the auto one
    run('DELETE FROM assets WHERE voucher_id=?', lapV);
    run("UPDATE counters SET value=? WHERE key='AST'", Number(aId.slice(4)));
    const asset = (no, name, cat, model, serial, cost, voucher, to, days, instr) => {
      const id = Number(run('INSERT INTO assets(asset_no,name,category,brand_model,serial_no,purchase_date,cost,voucher_id,status,employee_id,assigned_date,instructions,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', no, name, cat, model, serial, addDays(today(), -days - 3), cost, voucher, to ? 'assigned' : 'in_stock', to ? empOf(to).id : null, to ? addDays(today(), -days) : null, instr ?? null, superId, now()).lastInsertRowid);
      if (to) run('INSERT INTO asset_history(asset_id,employee_id,action,date,note,user_id) VALUES(?,?,?,?,?,?)', id, empOf(to).id, 'assigned', addDays(today(), -days), instr ?? null, superId);
      return id;
    };
    asset(aId, 'Laptop', 'Laptop', 'Dell Latitude 5440', 'DL5440-88213', 185_000, lapV, U.a1, 55, 'For office and client presentations only. Report any damage or loss to HR immediately.');
    asset(nextNoAsset(), 'Mobile phone', 'Mobile phone', 'Samsung Galaxy A35', 'SGA35-55120', 78_000, null, U.a2, 40, 'Company SIM included — keep it charged for client calls.');
    asset(nextNoAsset(), 'Bike', 'Bike / Vehicle', 'Honda CG 125', 'FSD-4821', 210_000, null, U.a3, 90, 'Fuel card issued monthly. Helmet is mandatory.');
    asset(nextNoAsset(), 'Camera', 'Camera / Equipment', 'Sony ZV-E10', 'SNZV-77019', 245_000, null, null, 20, null);
    // content calendar
    const cp = (title, type, caption, platforms, dayOff, time, status, to) => run('INSERT INTO content_posts(title,post_type,caption,platforms,post_date,post_time,status,assigned_to,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', title, type, caption, JSON.stringify(platforms), addDays(today(), dayOff), time, status, to, U.sm, now(), now());
    cp('Expert City — plots now open', 'reel', 'Own your dream plot in Expert City 🏡 Easy instalments, ready development. DM for a site visit! #ExpertCity #Faisalabad #RealEstate', ['instagram', 'tiktok', 'facebook'], 0, '18:00', 'planned', U.a1);
    cp('Client handover story', 'story', 'Another happy family receives their keys ❤️', ['instagram', 'facebook', 'snapchat'], 0, '12:30', 'ready', U.a2);
    cp('Construction progress — Expert Homes', 'static', 'Foundation complete! Track live progress in your customer portal.', ['facebook', 'linkedin'], 1, '11:00', 'planned', U.a3);
    cp('5 tips before buying a plot', 'video', 'Watch before you invest. Full video on our channel.', ['youtube', 'facebook'], 3, '19:00', 'idea', U.a1);
    // customer-portal promotions
    run("INSERT INTO portal_promos(title,description,price_label,valid_until,sort_order,active,created_at) VALUES(?,?,?,?,?,1,?)", 'Eid booking offer', 'Book a plot this month and get a free boundary wall package and zero processing fee.', 'Save up to PKR 150,000', addDays(today(), 45), 1, now());
    run("INSERT INTO portal_promos(title,description,price_label,valid_until,sort_order,active,created_at) VALUES(?,?,?,?,?,1,?)", 'Refer a friend', 'Refer someone who buys and receive a PKR 25,000 credit on your next installment.', 'PKR 25,000 credit', null, 2, now());
    // plot file details
    run("UPDATE properties SET file_no='FL-'||printf('%04d',id), registration_no=NULL, file_status=CASE id%5 WHEN 0 THEN 'Suspended' WHEN 3 THEN 'Paused' WHEN 2 THEN 'Defaulted' ELSE 'Active' END WHERE plot_no IS NOT NULL AND plot_no<>''");
  }

  // ---- Vendor portal: demo logins, announced contracts and bids
  run('UPDATE vendors SET email=? WHERE id=?', 'abc.bricks@example.com', V.bricks);
  run('UPDATE vendors SET email=? WHERE id=?', 'wood@example.com', V.wood);
  run('UPDATE vendors SET email=? WHERE id=?', 'water@example.com', V.water);
  createVendorPortalUser(V.bricks, DEMO_PASSWORD);
  createVendorPortalUser(V.wood, DEMO_PASSWORD);
  const tender = (o) => Number(run(`INSERT INTO tenders(tender_no,title,description,category,project_id,location,scope,boq,required_docs,estimated_budget,show_budget,closes_on,status,visibility,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, nextNo('TND', 'TND', 4), o.title, o.description, o.category ?? null, o.project ?? null, o.location ?? null, o.scope ?? null, JSON.stringify(o.boq || []), o.docs ?? null,
    o.budget ?? null, o.showBudget ? 1 : 0, o.closes, o.status, o.visibility || 'all', superId, now()).lastInsertRowid);
  const boqOf = (...l) => l.map(([description, unit, qty], i) => ({ no: i + 1, description, unit, qty }));
  const bid = (t, vendor, rates, days, proposal, status = 'submitted') => {
    const boq = JSON.parse(get('SELECT boq FROM tenders WHERE id=?', t).boq);
    const total = boq.reduce((s, l, i) => s + Math.round(l.qty * rates[i]), 0);
    return Number(run(`INSERT INTO tender_bids(tender_id,vendor_id,total_amount,duration_days,validity_days,boq_rates,proposal,payment_terms,status,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      t, vendor, total, days, 30, JSON.stringify(rates.map((rate, i) => ({ no: i + 1, rate }))), proposal, 'Net 30 on measured work', status, now()).lastInsertRowid);
  };
  const wall = tender({ title: 'Boundary wall — Expert City Block D', category: 'Brick Vendor', project: PR.ec, location: 'Ferozepur Road, Lahore', status: 'open', closes: addDays(today(), 10), docs: 'Company profile, last 3 invoices, NTN certificate',
    description: 'Supply and build a 9-inch brick boundary wall around Block D. Materials, labour and curing included.', scope: 'Excavation, foundation, 9-inch brick masonry, plaster and paint on both faces. Site access from the main gate.',
    boq: boqOf(['Excavation & foundation', 'rft', 1200], ['9-inch brick masonry', 'sft', 9600], ['Plaster & paint (both faces)', 'sft', 9600]), budget: 6_500_000 });
  bid(wall, V.wood, [900, 330, 150], 75, 'We have built 11 boundary walls in the last two years and can mobilise within 5 days.');
  bid(wall, V.water, [780, 345, 170], 90, 'Experienced civil crew with our own mixers and scaffolding.', 'shortlisted');
  tender({ title: 'Wooden doors & windows — Expert Homes', category: 'Wood Vendor', project: PR.er, location: 'Sargodha Road, Faisalabad', status: 'open', visibility: 'category', closes: addDays(today(), 14),
    description: 'Seasoned deodar frames, shutters and fitting for 24 houses.', scope: 'Supply, polish and fix. Samples must be shown before award.',
    boq: boqOf(['Main door (deodar, 7ft)', 'nos', 24], ['Room door (flush)', 'nos', 96], ['Window frame with shutter', 'nos', 120]) });
  const water = tender({ title: 'Water supply line — Expert Greens', category: 'Water Service Provider', project: PR.eg, location: 'Park Road, Islamabad', status: 'awarded', closes: addDays(today(), -6),
    description: 'Underground water mains for phase 1.', boq: boqOf(['Trench & lay 4-inch PVC main', 'rft', 2500], ['Valves & fittings', 'set', 40]) });
  const lose = bid(water, V.bricks, [520, 9000], 60, 'Our crew has laid pipelines before.', 'rejected');
  const win = bid(water, V.water, [480, 8500], 55, 'Specialist water service provider.', 'awarded');
  run('UPDATE tenders SET awarded_bid_id=?, award_note=? WHERE id=?', win, 'Lowest compliant bid with the shortest timeline.', water);
  notifyVendor(V.bricks, 'tender', 'New contract open for bidding', `Boundary wall — Expert City Block D — closes ${addDays(today(), 10)}`, `/vendor/tenders/${wall}`);
  notifyVendor(V.wood, 'tender', 'New contract open for bidding', `Boundary wall — Expert City Block D — closes ${addDays(today(), 10)}`, `/vendor/tenders/${wall}`);
  notifyVendor(V.bricks, 'tender', 'Tender decided', 'Water supply line — Expert Greens was awarded to another vendor. Thank you for bidding.', `/vendor/tenders/${water}`);
  notifyVendor(V.wood, 'payment', 'Voucher approved', 'EV-00003: PKR 180,000 is approved (credit purchase)', '/vendor/payments');
  tender({ title: 'Electrical works — Expert Residency Block B', category: 'Electrical', project: PR.er, status: 'draft', closes: addDays(today(), 20), description: 'Draft — scope and BOQ still being prepared.', boq: [] });
  backfillIds(); // customer IDs and registration numbers for everything seeded above

  // Customer portal demo logins (known password) + demo flag everywhere
  const pwd = bcrypt.hashSync(DEMO_PASSWORD, 10);
  run('UPDATE users SET password_hash=?, is_demo=1 WHERE contact_id IS NOT NULL', pwd);
  for (const t of ['contacts', 'projects', 'properties', 'sales', 'receipts', 'vendors', 'expense_vouchers', 'commissions', 'employees']) run(`UPDATE ${t} SET is_demo=1`);
  setSetting('demo_data', '1');
  delete global.__seed;
  return true;
}

/** Permissions added in later versions, applied to existing databases without touching what admins customised. */
export function upgradePermissions() {
  const grant = (roleName, perms) => {
    const id = val('SELECT id FROM roles WHERE name=?', roleName);
    if (!id) return;
    for (const p of perms) { const [m, a] = p.split(':'); run('INSERT OR IGNORE INTO role_permissions(role_id,module,action) VALUES(?,?,?)', id, m, a); }
  };
  if (!getSetting('perm_upgrade_dev1')) {
    // developer partner portal: module permissions, portal role and the pass-through accounts
    grant('Admin', P(['developers']));
    grant('Sales Manager', P(['developers'], ['view']));
    if (!val("SELECT 1 FROM roles WHERE name='Developer'")) run("INSERT INTO roles(name,description,own_scope,portal,is_system) VALUES('Developer','Developer partner portal only',0,1,1)");
    for (const [code, name, type, subtype, parent] of DEV_ACCOUNTS) {
      if (!val('SELECT 1 FROM accounts WHERE code=?', code)) run('INSERT INTO accounts(code,name,type,subtype,parent_id,is_system) VALUES(?,?,?,?,(SELECT id FROM accounts WHERE code=?),1)', code, name, type, subtype, parent);
    }
    setSetting('perm_upgrade_dev1', '1');
  }
  if (!getSetting('perm_upgrade_v2')) {
    grant('Admin', P(['website']));
    grant('Sales Manager', P(['website'], RW));
    grant('Sales Agent', P(['properties'], ['create', 'edit']));
    setSetting('perm_upgrade_v2', '1');
  }
  if (!getSetting('perm_upgrade_v4')) {
    // Listing Manager: approves what sales agents add to the website
    grant('Admin', P(['listings']));
    if (!val("SELECT 1 FROM roles WHERE name='Listing Manager'")) {
      const rid = Number(run("INSERT INTO roles(name,description,own_scope,portal,is_system) VALUES('Listing Manager','Approves the properties and projects that agents add to the website; approved listings are featured',0,0,1)").lastInsertRowid);
      for (const perm of [...P(['listings'], ['view', 'approve']), ...P(['properties'], [...RW, 'approve', 'export', 'print']), ...P(['projects', 'dashboard', 'documents', 'reports', 'website'], ['view']), ...P(['content'], RW)]) {
        const [m, a] = perm.split(':'); run('INSERT OR IGNORE INTO role_permissions(role_id,module,action) VALUES(?,?,?)', rid, m, a);
      }
    }
    setSetting('perm_upgrade_v4', '1');
  }
  if (!getSetting('perm_upgrade_v5')) {
    // Website Manager and SEO Manager roles (+ the new `seo` module for admins)
    grant('Admin', P(['seo']));
    const mk = (name, desc, perms) => {
      if (val('SELECT 1 FROM roles WHERE name=?', name)) return;
      const rid = Number(run('INSERT INTO roles(name,description,own_scope,portal,is_system) VALUES(?,?,0,0,1)', name, desc).lastInsertRowid);
      for (const perm of perms) { const [m, a] = perm.split(':'); run('INSERT OR IGNORE INTO role_permissions(role_id,module,action) VALUES(?,?,?)', rid, m, a); }
    };
    mk('Website Manager', 'Runs the public website: pages, theme, blog, chatbot knowledge bank and enquiries', [...P(['website', 'content']), ...P(['seo'], ['view', 'edit']), ...P(['listings'], ['view']), ...P(['crm'], ['view']), ...P(['properties', 'projects', 'dashboard', 'reports', 'documents'], ['view'])]);
    mk('SEO Manager', 'Search-engine optimisation: titles, descriptions, sitemap, structured data and content audits', [...P(['seo'], ['view', 'create', 'edit', 'export']), ...P(['website'], ['view']), ...P(['content'], ['view', 'edit']), ...P(['properties', 'projects', 'dashboard', 'reports'], ['view'])]);
    setSetting('perm_upgrade_v5', '1');
  }
  if (!getSetting('perm_upgrade_v3')) {
    // content calendar for all staff, company-assets account, employment types, drawing categories
    for (const r of all('SELECT name FROM roles WHERE portal=0')) grant(r.name, P(['content'], r.name === 'Super Admin' || r.name === 'Admin' ? ACTIONS : r.name === 'Sales Manager' ? [...RW, 'approve', 'delete'] : RW));
    if (!val("SELECT 1 FROM accounts WHERE code='5800'")) run("INSERT INTO accounts(code,name,type,subtype,parent_id,is_system) VALUES('5800','Assets & Equipment Purchases','expense',NULL,(SELECT id FROM accounts WHERE code='5000'),1)");
    const lk = (type, value, extra = {}) => { if (!val('SELECT 1 FROM lookups WHERE type=? AND value=?', type, value)) run('INSERT INTO lookups(type,value,meta,sort_order) VALUES(?,?,?,?)', type, value, extra.meta ? JSON.stringify(extra.meta) : null, extra.order ?? 50); };
    ['Intern', 'Employee', 'Part time', 'Full time', 'Probation', 'Permanent', 'Contract based'].forEach((v, i) => lk('employment_type', v, { order: i }));
    ['Laptop', 'Mobile phone', 'Desktop computer', 'Bike / Vehicle', 'Furniture', 'Camera / Equipment', 'Office equipment', 'Other'].forEach((v, i) => lk('asset_category', v, { order: i }));
    ['Architectural Drawing', 'Construction Drawing'].forEach((v) => lk('document_category', v));
    run("UPDATE employees SET employment_type='Full time' WHERE employment_type='Full-time'");
    setSetting('perm_upgrade_v3', '1');
  }
  if (!getSetting('perm_upgrade_con1')) {
    // Construction Management: project managers run it, finance approves and sees costs, sales managers can look
    grant('Admin', P(['construction']));
    grant('Project Manager', P(['construction'], [...RW, 'delete', 'approve', 'export', 'print']));
    grant('Finance Manager', P(['construction'], ['view', 'approve', 'export', 'print']));
    grant('Sales Manager', P(['construction'], ['view']));
    setSetting('perm_upgrade_con1', '1');
  }
}

export function ensureBootstrapped() {
  const fresh = bootstrap();
  upgradePermissions();
  ensureSite({ withPosts: fresh && process.env.ERP_DEMO !== '0' });
  if (fresh && process.env.ERP_DEMO !== '0') seedDemo();
}
