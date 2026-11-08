// Plain-words explanations for the things Ask reads from the ERP's own code: permission modules, workspace settings,
// pick-lists and regional switches. The lists themselves come from the code (server/src/services/systemKnowledge.js);
// server/test/system-knowledge.test.js fails when the code gains an item that has no note here.
export const ACTION_NOTES = { view: 'see the records', create: 'add new records', edit: 'change records', delete: 'remove records', approve: 'approve items that wait for approval', export: 'export to Excel/CSV', print: 'print or download PDFs' };

export const MODULE_NOTES = {
  dashboard: 'The home dashboard and its numbers.', crm: 'Contacts, leads, pipeline, tasks, notes, appointments, sequences, dialer, WhatsApp and meetings.',
  sales: 'Sales and bookings, payment plans and contracts.', commissions: 'Agent commission records and payouts.', properties: 'Property inventory and listings.',
  projects: 'Development and construction projects, units and updates.', customers: 'Customers, their portal and promotions.', payments: 'Installments, advances, balloon payments, receivables and payment history.',
  accounting: 'Chart of accounts, vouchers, journals, cash, banks and financial statements.', vendors: 'Vendors, tenders, purchases, ledger and credit book.',
  hrm: 'Employees, attendance, leave, salary, bonuses, onboarding and recruitment.', reports: 'The reports section.', settings: 'Workspace settings, users, roles and integrations.',
  documents: 'Document templates and generated documents.', website: 'The public website editor, chat assistant and website integrations.', content: 'The social media content calendar.',
  listings: 'Approval of listings before they are published.', seo: 'Search-engine titles, descriptions and blog posts.', construction: 'Construction estimates, purchase orders, materials and subcontracts.',
  developers: 'Partner developers, their agreements and joint-venture plot sales.',
};

export const SETTING_NOTES = {
  company_name: 'Your company name, shown on documents and the site.', company_address: 'Company address printed on documents.', company_phone: 'Company phone number.', company_email: 'Company email address.',
  logo_url: 'Your logo.', currency: 'The currency used for prices and accounts.', date_format: 'How dates are displayed.', default_commission_pct: 'The commission percentage used when no commission rule applies.',
  agent_targets: 'Daily and monthly targets for sales agents.', website_webhook_url: 'Address that receives website enquiries from an outside form.', website_api_key: 'Secret key for sending website enquiries into the CRM.',
  notify_email_enabled: 'Turns email notifications on or off.', notify_sms_enabled: 'Turns SMS notifications on or off.', notify_whatsapp_enabled: 'Turns WhatsApp notifications on or off.',
  installment_reminder_days: 'How many days before an installment is due the customer is reminded.', allow_negative_bank: 'Whether a bank account may go below zero when you record payments out.',
  print_header: 'Header text printed on documents.', print_footer: 'Footer text printed on documents.', print_email: 'Email address printed on documents.', print_phone: 'Phone number printed on documents.',
  print_address: 'Address printed on documents.', print_website: 'Website printed on documents.', print_social: 'Social links printed on documents.', print_show_logo: 'Whether the logo appears on printed documents.',
  receipt_title: 'Title at the top of receipt vouchers.', receipt_header: 'Text under the title of receipts.', receipt_footer: 'Text at the bottom of receipts.', receipt_terms: 'Terms printed on receipts.',
  receipt_copies: 'How many copies of a receipt are printed.', receipt_qr: 'Whether a QR code is printed on receipts so the receipt can be checked.', expense_title: 'Title at the top of expense vouchers.',
  expense_header: 'Text under the title of expense vouchers.', expense_footer: 'Text at the bottom of expense vouchers.', agents_can_publish: 'Whether sales agents may publish their own listings without approval.',
  staff_login_path: 'The address staff use to sign in to your workspace.', brand_color: 'Your brand colour, used for your workspace and documents.',
  ask_business_notes: 'Facts about your business that Ask may use when staff ask about the company (hours, policies, payment rules, FAQs). Up to 4,000 characters.', ask_style: 'How Ask talks: friendly (like a helpful colleague) or formal.',
};

export const LOOKUP_NOTES = {
  lead_stage: ['Lead stages', 'The steps a lead moves through in your pipeline. Each stage counts as new, open, won or lost.'], lead_source: ['Lead sources', 'Where leads come from.'], lead_type: ['Lead types', 'What kind of buyer a lead is.'],
  property_type: ['Property types', 'Kinds of property you list.'], amenity: ['Amenities', 'Features you can tick on a property.'], payment_method: ['Payment methods', 'Ways customers pay, for example cash or bank transfer.'],
  employment_type: ['Employment types', 'Kinds of employment for staff.'], asset_category: ['Asset categories', 'Types of company assets.'], expense_category: ['Expense categories', 'Categories for expense vouchers.'],
  income_category: ['Income categories', 'Categories for money received.'], vendor_category: ['Vendor categories', 'Types of vendors.'], department: ['Departments', 'Departments employees belong to.'], designation: ['Designations', 'Job titles.'],
  leave_type: ['Leave types', 'Kinds of leave, each with a yearly quota.'], document_category: ['Document categories', 'Categories for uploaded files.'], construction_activity: ['Construction activities', 'Standard stages of a construction job used in schedules.'],
  dev_item_template: ['Development items', 'Standard work items for a development project.'],
};

export const FLAG_NOTES = {
  mortgage: 'Mortgage tracking and lender referrals (menu: Mortgage).', transactions: 'The transaction checklist for a sale, from offer to closing.', compliance: 'Identity and compliance records suited to the country.',
  templates: 'Document templates such as offers and agency agreements (menu: Documents).', rentals: 'Rental listings and tenancy handling.', lettings: 'Lettings: tenancies, landlords and related certificates.',
  offplan: 'Off-plan sales from developers.',
};

export const ACCOUNT_GROUPS = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };
