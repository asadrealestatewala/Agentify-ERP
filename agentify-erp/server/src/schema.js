export const SALES_DDL = (name) => `CREATE TABLE IF NOT EXISTS ${name}(
  id INTEGER PRIMARY KEY, sale_no TEXT UNIQUE NOT NULL, kind TEXT NOT NULL DEFAULT 'property', title TEXT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  property_id INTEGER REFERENCES properties(id), project_id INTEGER REFERENCES projects(id),
  bundle_id INTEGER, linked_sale_id INTEGER,
  sale_date TEXT NOT NULL, sale_price INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, net_price INTEGER NOT NULL,
  booking_amount INTEGER NOT NULL DEFAULT 0, advance_amount INTEGER NOT NULL DEFAULT 0,
  num_installments INTEGER NOT NULL DEFAULT 0, installment_amount INTEGER NOT NULL DEFAULT 0,
  balloon_count INTEGER NOT NULL DEFAULT 0, balloon_amount INTEGER NOT NULL DEFAULT 0, balloon_interval INTEGER NOT NULL DEFAULT 6,
  first_due TEXT, final_due TEXT, agent_id INTEGER REFERENCES users(id), manager_id INTEGER,
  paid_amount INTEGER NOT NULL DEFAULT 0, advance_credit INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed', notes TEXT, journal_id INTEGER, is_demo INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER, created_at TEXT NOT NULL);`;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS counters(key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS roles(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT,
  own_scope INTEGER NOT NULL DEFAULT 0, portal INTEGER NOT NULL DEFAULT 0, is_system INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS role_permissions(
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE, module TEXT NOT NULL, action TEXT NOT NULL,
  PRIMARY KEY(role_id,module,action));
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, phone TEXT, password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id), active INTEGER NOT NULL DEFAULT 1,
  contact_id INTEGER, token_version INTEGER NOT NULL DEFAULT 0, is_demo INTEGER NOT NULL DEFAULT 0,
  last_login TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

CREATE TABLE IF NOT EXISTS lookups(
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, value TEXT NOT NULL, color TEXT, meta TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS idx_lookups_type ON lookups(type);
CREATE TABLE IF NOT EXISTS custom_fields(
  id INTEGER PRIMARY KEY, entity TEXT NOT NULL, label TEXT NOT NULL, key TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text', options TEXT, required INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(entity,key));

CREATE TABLE IF NOT EXISTS contacts(
  id INTEGER PRIMARY KEY,
  first_name TEXT, last_name TEXT, full_name TEXT NOT NULL, father_name TEXT, cnic TEXT, dob TEXT, gender TEXT,
  phone TEXT, alt_phone TEXT, whatsapp TEXT, email TEXT,
  country TEXT DEFAULT 'Pakistan', province TEXT, city TEXT, area TEXT, address TEXT, company TEXT,
  lead_source TEXT, stage_id INTEGER REFERENCES lookups(id), lead_type TEXT,
  agent_id INTEGER REFERENCES users(id), manager_id INTEGER REFERENCES users(id),
  tags TEXT DEFAULT '[]', priority TEXT DEFAULT 'Medium',
  project_id INTEGER, property_id INTEGER, budget INTEGER, pref_location TEXT, property_type TEXT,
  followup_date TEXT, is_customer INTEGER NOT NULL DEFAULT 0, customer_since TEXT,
  custom TEXT DEFAULT '{}', is_demo INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT, last_activity_at TEXT);
CREATE INDEX IF NOT EXISTS idx_contacts_agent ON contacts(agent_id);
CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(stage_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);

CREATE TABLE IF NOT EXISTS activities(
  id INTEGER PRIMARY KEY, contact_id INTEGER, entity_type TEXT, entity_id INTEGER, user_id INTEGER, user_name TEXT,
  action TEXT NOT NULL, field TEXT, prev_value TEXT, new_value TEXT, detail TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_act_contact ON activities(contact_id);
CREATE TABLE IF NOT EXISTS notes(
  id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL DEFAULT 'contact', entity_id INTEGER NOT NULL, body TEXT NOT NULL,
  user_id INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL DEFAULT 'contact', entity_id INTEGER, title TEXT NOT NULL,
  due_date TEXT, assigned_to INTEGER, status TEXT NOT NULL DEFAULT 'open', priority TEXT DEFAULT 'Medium',
  created_by INTEGER, completed_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents(
  id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, category TEXT, name TEXT NOT NULL,
  path TEXT NOT NULL, mime TEXT, size INTEGER, portal_visible INTEGER NOT NULL DEFAULT 0, uploaded_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_docs_entity ON documents(entity_type, entity_id);
CREATE TABLE IF NOT EXISTS media(
  id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, kind TEXT NOT NULL,
  path TEXT NOT NULL, caption TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_media_entity ON media(entity_type, entity_id);
CREATE TABLE IF NOT EXISTS smart_lists(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, logic TEXT NOT NULL DEFAULT 'AND', rules TEXT NOT NULL DEFAULT '[]',
  owner_id INTEGER, shared INTEGER NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS projects(
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, location TEXT, developer TEXT, description TEXT,
  total_land_area REAL, land_unit TEXT DEFAULT 'Kanal', total_units INTEGER, total_value INTEGER,
  dev_status TEXT DEFAULT 'Planning', manager_id INTEGER REFERENCES users(id), start_date TEXT, expected_completion TEXT,
  is_development INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL DEFAULT 'development', budget INTEGER, site_visible INTEGER NOT NULL DEFAULT 1, is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dev_items(
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS dev_updates(
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, update_date TEXT NOT NULL,
  title TEXT NOT NULL, kind TEXT DEFAULT 'Progress', progress INTEGER, description TEXT, videos TEXT DEFAULT '[]',
  published INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS properties(
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, title TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'Sell',
  property_type TEXT, project_id INTEGER REFERENCES projects(id), block TEXT, sector TEXT, plot_no TEXT,
  city TEXT, area_name TEXT, location TEXT, address TEXT, lat REAL, lng REAL,
  area_size REAL, unit TEXT DEFAULT 'Marla', total_price INTEGER NOT NULL DEFAULT 0, price_per_unit INTEGER,
  discount INTEGER NOT NULL DEFAULT 0, net_price INTEGER NOT NULL DEFAULT 0,
  installment_available INTEGER NOT NULL DEFAULT 0, ready_possession INTEGER NOT NULL DEFAULT 0,
  features TEXT DEFAULT '{}', amenities TEXT DEFAULT '[]', short_desc TEXT, description TEXT,
  videos TEXT DEFAULT '[]', agent_id INTEGER REFERENCES users(id), contact_email TEXT, contact_phone TEXT, contact_whatsapp TEXT,
  status TEXT NOT NULL DEFAULT 'draft', review_state TEXT NOT NULL DEFAULT 'draft', published INTEGER NOT NULL DEFAULT 0,
  dev_status TEXT, reserved_contact_id INTEGER, is_demo INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_prop_project ON properties(project_id);
CREATE INDEX IF NOT EXISTS idx_prop_status ON properties(status);

${SALES_DDL('sales')}
CREATE INDEX IF NOT EXISTS idx_sales_contact ON sales(contact_id);
CREATE INDEX IF NOT EXISTS idx_sales_agent ON sales(agent_id);
CREATE TABLE IF NOT EXISTS installments(
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE, seq INTEGER NOT NULL,
  kind TEXT NOT NULL, due_date TEXT NOT NULL, amount INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', paid_date TEXT);
CREATE INDEX IF NOT EXISTS idx_inst_sale ON installments(sale_id);
CREATE INDEX IF NOT EXISTS idx_inst_due ON installments(due_date);

CREATE TABLE IF NOT EXISTS accounts(
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, subtype TEXT,
  parent_id INTEGER REFERENCES accounts(id), opening_balance INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS journals(
  id INTEGER PRIMARY KEY, journal_no TEXT UNIQUE NOT NULL, date TEXT NOT NULL, memo TEXT, ref_type TEXT, ref_id INTEGER,
  project_id INTEGER, reversal_of INTEGER, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_j_ref ON journals(ref_type, ref_id);
CREATE TABLE IF NOT EXISTS journal_lines(
  id INTEGER PRIMARY KEY, journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id), debit INTEGER NOT NULL DEFAULT 0, credit INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER, contact_id INTEGER, vendor_id INTEGER, sale_id INTEGER, memo TEXT);
CREATE INDEX IF NOT EXISTS idx_jl_acc ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_jl_j ON journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_jl_proj ON journal_lines(project_id);
CREATE INDEX IF NOT EXISTS idx_jl_contact ON journal_lines(contact_id);
CREATE INDEX IF NOT EXISTS idx_jl_vendor ON journal_lines(vendor_id);

CREATE TABLE IF NOT EXISTS receipts(
  id INTEGER PRIMARY KEY, receipt_no TEXT UNIQUE NOT NULL, date TEXT NOT NULL, contact_id INTEGER NOT NULL REFERENCES contacts(id),
  sale_id INTEGER REFERENCES sales(id), project_id INTEGER, property_id INTEGER,
  account_id INTEGER NOT NULL REFERENCES accounts(id), payment_type TEXT NOT NULL, amount INTEGER NOT NULL,
  advance_amount INTEGER NOT NULL DEFAULT 0, method TEXT NOT NULL, reference_no TEXT, cheque_no TEXT, bank TEXT,
  txn_id TEXT, sender TEXT, notes TEXT, received_by INTEGER, journal_id INTEGER,
  status TEXT NOT NULL DEFAULT 'valid', void_reason TEXT, is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rc_sale ON receipts(sale_id);
CREATE INDEX IF NOT EXISTS idx_rc_contact ON receipts(contact_id);
CREATE TABLE IF NOT EXISTS receipt_allocations(
  id INTEGER PRIMARY KEY, receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  installment_id INTEGER NOT NULL REFERENCES installments(id), amount INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS vendors(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT, address TEXT, cnic_tax TEXT,
  category TEXT, bank_details TEXT, payment_terms TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS expense_vouchers(
  id INTEGER PRIMARY KEY, voucher_no TEXT UNIQUE NOT NULL, date TEXT NOT NULL, project_id INTEGER REFERENCES projects(id),
  vendor_id INTEGER REFERENCES vendors(id), expense_account_id INTEGER NOT NULL REFERENCES accounts(id), description TEXT,
  quantity REAL NOT NULL DEFAULT 1, unit_cost REAL NOT NULL DEFAULT 0, amount INTEGER NOT NULL,
  payment_method TEXT, reference_no TEXT, paid_from_account_id INTEGER REFERENCES accounts(id),
  is_credit INTEGER NOT NULL DEFAULT 0, due_date TEXT, sale_id INTEGER, status TEXT NOT NULL DEFAULT 'created',
  approved_by INTEGER, paid_by INTEGER, paid_amount INTEGER NOT NULL DEFAULT 0, journal_id INTEGER, notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vendor_payments(
  id INTEGER PRIMARY KEY, payment_no TEXT UNIQUE NOT NULL, vendor_id INTEGER REFERENCES vendors(id),
  voucher_id INTEGER REFERENCES expense_vouchers(id), date TEXT NOT NULL, amount INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id), method TEXT, reference_no TEXT, journal_id INTEGER,
  notes TEXT, created_by INTEGER, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS commission_rules(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'percentage', value REAL NOT NULL DEFAULT 0,
  tiers TEXT DEFAULT '[]', project_id INTEGER, property_id INTEGER, property_type TEXT, sale_kind TEXT,
  active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS commissions(
  id INTEGER PRIMARY KEY, commission_no TEXT UNIQUE NOT NULL, sale_id INTEGER NOT NULL REFERENCES sales(id),
  agent_id INTEGER NOT NULL REFERENCES users(id), contact_id INTEGER, property_id INTEGER, project_id INTEGER,
  base_amount INTEGER NOT NULL, rule_id INTEGER, rate_type TEXT, rate_value REAL, amount INTEGER NOT NULL,
  paid_amount INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', approved_by INTEGER,
  journal_id INTEGER, is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS commission_payments(
  id INTEGER PRIMARY KEY, commission_id INTEGER NOT NULL REFERENCES commissions(id), amount INTEGER NOT NULL,
  account_id INTEGER NOT NULL, date TEXT NOT NULL, method TEXT, reference_no TEXT, journal_id INTEGER, created_by INTEGER, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS employees(
  id INTEGER PRIMARY KEY, emp_code TEXT UNIQUE, name TEXT NOT NULL, cnic TEXT, dob TEXT, gender TEXT, phone TEXT, email TEXT,
  address TEXT, emergency_contact TEXT, department TEXT, designation TEXT, hire_date TEXT, employment_type TEXT DEFAULT 'Full-time',
  salary INTEGER NOT NULL DEFAULT 0, commission_note TEXT, bonus INTEGER NOT NULL DEFAULT 0, manager_id INTEGER, branch TEXT,
  status TEXT NOT NULL DEFAULT 'draft', user_id INTEGER, is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payroll(
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), period TEXT NOT NULL,
  basic INTEGER NOT NULL DEFAULT 0, allowances INTEGER NOT NULL DEFAULT 0, bonus INTEGER NOT NULL DEFAULT 0,
  commission INTEGER NOT NULL DEFAULT 0, deductions INTEGER NOT NULL DEFAULT 0, advances INTEGER NOT NULL DEFAULT 0,
  loans INTEGER NOT NULL DEFAULT 0, net INTEGER NOT NULL DEFAULT 0, payment_date TEXT, payment_method TEXT,
  account_id INTEGER, status TEXT NOT NULL DEFAULT 'draft', journal_id INTEGER, notes TEXT, created_at TEXT NOT NULL,
  UNIQUE(employee_id, period));
CREATE TABLE IF NOT EXISTS attendance(
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), date TEXT NOT NULL,
  check_in TEXT, check_out TEXT, late_minutes INTEGER NOT NULL DEFAULT 0, early_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'present', UNIQUE(employee_id, date));
CREATE TABLE IF NOT EXISTS leaves(
  id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), type TEXT NOT NULL,
  from_date TEXT NOT NULL, to_date TEXT NOT NULL, days INTEGER NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'pending',
  approved_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS holidays(id INTEGER PRIMARY KEY, date TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recruitment(
  id INTEGER PRIMARY KEY, position TEXT NOT NULL, candidate TEXT NOT NULL, phone TEXT, email TEXT,
  stage TEXT NOT NULL DEFAULT 'Applied', notes TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT, title TEXT NOT NULL, body TEXT, link TEXT,
  read INTEGER NOT NULL DEFAULT 0, dedupe TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY, user_id INTEGER, user_name TEXT, action TEXT NOT NULL, entity TEXT, entity_id TEXT,
  detail TEXT, ip TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reconciliations(
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, date TEXT NOT NULL, statement_balance INTEGER NOT NULL,
  book_balance INTEGER NOT NULL, difference INTEGER NOT NULL, notes TEXT, created_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_log(
  id INTEGER PRIMARY KEY, property_id INTEGER, event TEXT, status TEXT, response TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sale_bundles(
  id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL REFERENCES contacts(id), name TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receipt_sales(
  id INTEGER PRIMARY KEY, receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  sale_id INTEGER NOT NULL REFERENCES sales(id), amount INTEGER NOT NULL, advance INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_rs_sale ON receipt_sales(sale_id);
CREATE INDEX IF NOT EXISTS idx_rs_receipt ON receipt_sales(receipt_id);
CREATE TABLE IF NOT EXISTS project_tasks(
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, sale_id INTEGER,
  parent_id INTEGER, name TEXT NOT NULL, planned_start TEXT NOT NULL, planned_end TEXT NOT NULL,
  actual_start TEXT, actual_end TEXT, progress INTEGER NOT NULL DEFAULT 0, weight REAL NOT NULL DEFAULT 1,
  predecessor_id INTEGER, notes TEXT, client_visible INTEGER NOT NULL DEFAULT 1, delay_notified INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_pt_project ON project_tasks(project_id);

CREATE TABLE IF NOT EXISTS agent_goals(
  id INTEGER PRIMARY KEY, user_id INTEGER, period TEXT NOT NULL, leads INTEGER NOT NULL DEFAULT 0, followups INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0, sales_value INTEGER NOT NULL DEFAULT 0, set_by INTEGER, updated_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS idx_goal_user ON agent_goals(IFNULL(user_id,0), period);
CREATE TABLE IF NOT EXISTS push_subscriptions(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS site_pages(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, sections TEXT NOT NULL DEFAULT '[]', published INTEGER NOT NULL DEFAULT 1,
  seo_title TEXT, seo_desc TEXT, sort_order INTEGER NOT NULL DEFAULT 0, show_in_menu INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
CREATE TABLE IF NOT EXISTS site_page_versions(
  id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE, title TEXT, sections TEXT NOT NULL, label TEXT,
  user_id INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_spv_page ON site_page_versions(page_id, id);
-- website releases: what visitors see (services/siteRelease.js); site_pages + settings.site_config are the editor's draft
CREATE TABLE IF NOT EXISTS site_releases(
  id INTEGER PRIMARY KEY, config TEXT NOT NULL, pages TEXT NOT NULL, label TEXT, restored_from INTEGER, published_by INTEGER, published_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS site_preview_links(
  id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_by INTEGER, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS site_reviews(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, company TEXT, country TEXT, rating INTEGER, quote TEXT NOT NULL, email TEXT NOT NULL, photo BLOB, photo_type TEXT,
  consent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, decided_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_site_reviews ON site_reviews(status, created_at);
CREATE TABLE IF NOT EXISTS site_posts(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, excerpt TEXT, body TEXT, cover TEXT, tags TEXT DEFAULT '[]',
  author_id INTEGER, published INTEGER NOT NULL DEFAULT 0, published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS payment_claims(
  id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL, sale_id INTEGER NOT NULL, amount INTEGER NOT NULL, method TEXT NOT NULL, txn_id TEXT, bank TEXT, cheque_no TEXT,
  paid_date TEXT NOT NULL, note TEXT, slip_path TEXT, status TEXT NOT NULL DEFAULT 'pending', receipt_id INTEGER, reject_reason TEXT, decided_by INTEGER, decided_at TEXT,
  created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_claims_status ON payment_claims(status, id);
CREATE TABLE IF NOT EXISTS payment_feed(
  id INTEGER PRIMARY KEY, channel TEXT NOT NULL, txn_id TEXT NOT NULL, txn_norm TEXT NOT NULL, amount INTEGER NOT NULL, paid_date TEXT, sender TEXT, note TEXT,
  source TEXT NOT NULL DEFAULT 'webhook', claim_id INTEGER, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_txn ON payment_feed(txn_norm, amount);
CREATE TABLE IF NOT EXISTS bot_kb(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'General', content TEXT NOT NULL, keywords TEXT, link TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS bot_chats(
  id INTEGER PRIMARY KEY, session TEXT NOT NULL, message TEXT NOT NULL, answer TEXT, source TEXT, matched INTEGER NOT NULL DEFAULT 1,
  contact_id INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_bot_chats_session ON bot_chats(session, id);
CREATE TABLE IF NOT EXISTS chat_log(
  id INTEGER PRIMARY KEY, user_id INTEGER, question TEXT NOT NULL, intent TEXT, ok INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS work_tasks(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT, priority TEXT NOT NULL DEFAULT 'Medium', due_date TEXT,
  status TEXT NOT NULL DEFAULT 'todo', assigned_to INTEGER NOT NULL, assigned_by INTEGER, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_wt_user ON work_tasks(assigned_to, status);
CREATE TABLE IF NOT EXISTS work_task_updates(
  id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE, user_id INTEGER, status TEXT, note TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets(
  id INTEGER PRIMARY KEY, asset_no TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT, brand_model TEXT, serial_no TEXT, purchase_date TEXT,
  cost INTEGER NOT NULL DEFAULT 0, voucher_id INTEGER, status TEXT NOT NULL DEFAULT 'in_stock', employee_id INTEGER, assigned_date TEXT,
  instructions TEXT, notes TEXT, created_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS asset_history(
  id INTEGER PRIMARY KEY, asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE, employee_id INTEGER, action TEXT NOT NULL, date TEXT NOT NULL, note TEXT, user_id INTEGER);
CREATE TABLE IF NOT EXISTS content_posts(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, post_type TEXT NOT NULL DEFAULT 'static', caption TEXT, platforms TEXT NOT NULL DEFAULT '[]',
  post_date TEXT NOT NULL, post_time TEXT, creative_path TEXT, creative_name TEXT, creative_mime TEXT, status TEXT NOT NULL DEFAULT 'planned',
  posted TEXT NOT NULL DEFAULT '{}', assigned_to INTEGER, created_by INTEGER, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_content_date ON content_posts(post_date);
CREATE TABLE IF NOT EXISTS social_accounts(
  id INTEGER PRIMARY KEY, platform TEXT UNIQUE NOT NULL, handle TEXT, profile_url TEXT, client_id TEXT, client_secret TEXT, access_token TEXT, notes TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS portal_promos(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT, image TEXT, property_id INTEGER, project_id INTEGER, price_label TEXT, valid_until TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tenders(
  id INTEGER PRIMARY KEY, tender_no TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT, category TEXT, project_id INTEGER REFERENCES projects(id), location TEXT,
  scope TEXT, boq TEXT NOT NULL DEFAULT '[]', required_docs TEXT, estimated_budget INTEGER, show_budget INTEGER NOT NULL DEFAULT 0,
  closes_on TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', visibility TEXT NOT NULL DEFAULT 'all', awarded_bid_id INTEGER, award_note TEXT,
  created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS tender_bids(
  id INTEGER PRIMARY KEY, tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE, vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  total_amount INTEGER NOT NULL, duration_days INTEGER, validity_days INTEGER, boq_rates TEXT NOT NULL DEFAULT '[]', proposal TEXT, payment_terms TEXT, notes TEXT,
  status TEXT NOT NULL DEFAULT 'submitted', staff_note TEXT, submitted_at TEXT NOT NULL, updated_at TEXT, UNIQUE(tender_id, vendor_id));
CREATE INDEX IF NOT EXISTS idx_bids_tender ON tender_bids(tender_id);
CREATE INDEX IF NOT EXISTS idx_bids_vendor ON tender_bids(vendor_id);
-- one-time links: staff invitations and password resets (only a hash of the token is stored)
CREATE TABLE IF NOT EXISTS auth_tokens(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('invite','reset')), token_hash TEXT UNIQUE NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, email TEXT, name TEXT, role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE, invited_by INTEGER,
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_kind ON auth_tokens(kind, email);
-- email-address confirmation links (a separate table: auth_tokens.kind has a CHECK that older databases cannot change)
CREATE TABLE IF NOT EXISTS verify_tokens(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT UNIQUE NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL);
-- browsers/addresses each person has signed in from, so a sign-in from somewhere new can be flagged (services/loginAlerts.js)
CREATE TABLE IF NOT EXISTS login_devices(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, device_hash TEXT NOT NULL, ip TEXT NOT NULL, user_agent TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, UNIQUE(user_id, device_hash, ip));
CREATE TABLE IF NOT EXISTS login_alerts(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, ip TEXT, created_at TEXT NOT NULL);
-- wrong passwords against a real account, to warn its owner of a guessing attempt (services/loginAlerts.js)
CREATE TABLE IF NOT EXISTS login_failures(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, ip TEXT, created_at TEXT NOT NULL, alerted INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_login_failures_user ON login_failures(user_id, created_at);
-- training videos: the library of finished videos and which roles may watch each one
CREATE TABLE IF NOT EXISTS training_library(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT, category TEXT NOT NULL DEFAULT 'System overview', path TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER, seed_key TEXT UNIQUE, sort_order INTEGER NOT NULL DEFAULT 100, created_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS training_assignments(
  video_id INTEGER NOT NULL, role_id INTEGER NOT NULL, PRIMARY KEY(video_id, role_id));
`;
