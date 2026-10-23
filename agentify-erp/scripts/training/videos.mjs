// The Agentify ERP training videos: who each one is for, and what every phase shows and says.
//  - scenes[].shot: which signed-in demo person looks at which screen (path), what to point at (a CSS selector, default the page heading)
//    and optionally act(page) to open something first.
//  - say is the voice-over (about 2.6 words a second). roles are the workspace roles a video is given to when it is first placed in a
//    workspace's library; administrators change that later with Assign.
// All filming is done in the demo workspace (sample names), never on real customers.
const ADMIN = 'admin', AGENT = 'agent';
const STAFF = ['Super Admin', 'Admin', 'Finance Manager', 'Sales Manager', 'Sales Agent', 'HR Manager', 'Accounts Staff', 'Project Manager', 'Listing Manager', 'Website Manager', 'SEO Manager', 'Inventory Manager'];
const S = (as, path, focus, extra = {}) => ({ as, path, focus, ...extra });
const clickText = (re) => async (page) => { await page.evaluate((src) => { const r = new RegExp(src, 'i'); [...document.querySelectorAll('button, a')].find((b) => r.test(b.textContent || ''))?.click(); }, re.source); };

export const VIDEOS = [
  {
    key: 'erp-overview', order: 1, title: 'Agentify ERP overview', kicker: 'Training video', tagline: 'A quick tour of the whole system', category: 'System overview', roles: STAFF,
    description: 'A quick tour of Agentify ERP: the dashboard, leads and the sales pipeline, property inventory, accounting, projects and your people.',
    intro: 'Welcome to Agentify E R P. This is a quick tour of the whole system, in about a minute.',
    outro: 'That is Agentify at a glance. Next, watch the videos made for your own role.',
    scenes: [
      { phase: 'Dashboard', title: 'See everything, live', bullets: ['Collections, overdue and new leads', 'Quick actions for daily jobs'], say: 'The dashboard shows money collected, overdue installments and new leads, live, with quick buttons for your daily jobs.', shot: S(ADMIN, '/', '.hero, .stat'), call: 'Live figures' },
      { phase: 'Sales', title: 'From lead to booking', bullets: ['Leads and pipeline', 'Follow ups and bookings'], say: 'The C R M captures every lead, reminds you to follow up on time, and turns enquiries into bookings.', shot: S(ADMIN, '/pipeline', '.page-head'), call: 'Pipeline' },
      { phase: 'Properties', title: 'Your property inventory', bullets: ['Price, size and status', 'Always up to date'], say: 'Property inventory keeps every listing with its price, size and status, so the team always sells what is available.', shot: S(ADMIN, '/properties', '.page-head'), call: 'Inventory' },
      { phase: 'Accounting', title: 'Books that keep themselves', bullets: ['Receipts, expenses and vouchers', 'Statements always up to date'], say: 'Every receipt and voucher posts to the books, so the financial statements are always up to date.', shot: S(ADMIN, '/accounting/income-statement', '.page-head'), call: 'Income statement' },
      { phase: 'Projects', title: 'Projects and construction', bullets: ['Development and units', 'Progress and financials'], say: 'Projects tracks development, units, progress updates and financials in one place.', shot: S(ADMIN, '/projects', '.page-head'), call: 'Projects' },
      { phase: 'People', title: 'People and pay', bullets: ['Attendance and leave', 'Salary that follows attendance'], say: 'Attendance, leave and salary live together, with deductions shown clearly.', shot: S(ADMIN, '/hrm/attendance', '.page-head'), call: 'Attendance' },
    ],
  },
  {
    key: 'my-space', order: 5, title: 'My Space: your daily routine', kicker: 'Training video for every employee', tagline: 'Attendance, leave, payslip, tasks and your account', category: 'System overview', roles: STAFF,
    description: 'For every employee: mark your attendance each day, ask for leave, read your payslip, manage your tasks and keep your account secure.',
    intro: 'Welcome. This video is for every employee. It covers what you do in the system every day, starting with your attendance.',
    outro: 'Mark your attendance every morning, keep your tasks current, and your salary will always be right. Now watch the video for your own role.',
    scenes: [
      { phase: 'Sign in', title: 'Sign in and find your way', bullets: ['Email or mobile number', 'The menu shows only your work'], say: 'Sign in with your email or mobile number. The menu on the left shows only the screens your role needs.', shot: S(AGENT, '/', '.hero, .stat'), call: 'Your menu' },
      { phase: 'Attendance', title: 'Mark your attendance', bullets: ['Check in when you start', 'Check out when you finish'], say: 'Open My Attendance every morning and check in when you start work. Check out when you finish. Late arrivals and absences are recorded, and they affect your salary.', shot: S(AGENT, '/my/attendance', '.page-head'), call: 'Check in and out' },
      { phase: 'Leave', title: 'Ask for leave', bullets: ['Choose the type and dates', 'H R approves or declines'], say: 'Need a day off? Open My Leave, choose the type and the dates, and send the request. H R approves or declines it.', shot: S(AGENT, '/my/leave', '.page-head'), call: 'My leave' },
      { phase: 'Payslip', title: 'Your payroll and payslip', bullets: ['Salary, bonuses and commission', 'Deductions shown clearly'], say: 'My Payroll shows your salary month by month. If you were late or absent, the deduction is shown clearly, so there are no surprises.', shot: S(AGENT, '/my/payroll', '.page-head'), call: 'My payroll' },
      { phase: 'Tasks', title: 'Your tasks', bullets: ['Everything you must do today', 'Due dates and reminders'], say: 'Your tasks list everything you must do, with due dates and reminders. Finish a task and tick it off.', shot: S(AGENT, '/my/tasks', '.page-head'), call: 'My tasks' },
      { phase: 'Security', title: 'Keep your account safe', bullets: ['Change your password', 'Two step sign in with an app'], say: 'Protect your account. Change your password, switch on two step sign in, and never share your login with anyone.', shot: S(AGENT, '/my/security', '.page-head'), call: 'Account security' },
    ],
  },
  {
    key: 'super-admin', order: 10, title: 'Super Admin portal', kicker: 'Training video', tagline: 'Oversight, people, access, billing and safety', category: 'Administration', roles: ['Super Admin', 'Admin'],
    description: 'For owners and administrators: the dashboard and reports, users and roles, the audit trail, billing and the main settings.',
    intro: 'Welcome to the Super Admin portal. In this video you will see how to oversee the whole company, control who can do what, and keep the system safe.',
    outro: 'That is the administrator toolkit. Oversee from the dashboard, control access with roles, and rely on the audit log. Next, watch the videos for each department.',
    scenes: [
      { phase: 'Dashboard', title: 'The company at a glance', bullets: ['Collections, overdue and leads', 'Pick any period'], say: 'The dashboard is your starting point. It shows money collected, overdue installments and new leads for any period you choose.', shot: S(ADMIN, '/', '.hero, .stat'), call: 'Live figures' },
      { phase: 'Reports', title: 'Reports', bullets: ['Sales, finance, people and inventory', 'Export to Excel and PDF'], say: 'Reports covers sales, finance, people and inventory, and every report can be exported to Excel or P D F.', shot: S(ADMIN, '/reports', '.page-head'), call: 'Reports' },
      { phase: 'Users', title: 'People and logins', bullets: ['Add staff in seconds', 'Switch access off when they leave'], say: 'Add a new employee here, give them a role, and switch their access off the day they leave.', shot: S(ADMIN, '/settings/users', '.page-head'), call: 'Users' },
      { phase: 'Roles', title: 'Roles and permissions', bullets: ['One role per job', 'View, create, edit, delete, approve, export'], say: 'Roles decide exactly what each person can see and do, module by module.', shot: S(ADMIN, '/settings/roles', '.page-head'), call: 'Roles' },
      { phase: 'Audit log', title: 'A trail of every action', bullets: ['Who did what, and when', 'Logins, edits and payments'], say: 'The audit log records every login, edit and payment with the person and the time. Nothing happens silently.', shot: S(ADMIN, '/settings/audit', '.page-head'), call: 'Audit log' },
      { phase: 'Billing', title: 'Your plan and billing', bullets: ['Plan, seats and trial', 'Invoices and payments'], say: 'Billing shows your plan, how many seats you use, your trial and your invoices. You can upgrade from here.', shot: S(ADMIN, '/settings/billing', '.page-head'), call: 'Plan and billing' },
      { phase: 'Training', title: 'Training videos for every role', bullets: ['Assign each video to roles', 'Everyone sees their own set'], say: 'Finally, Training videos. Use the Assign button on each video to choose which roles see it.', shot: S(ADMIN, '/training', '.page-head'), call: 'Assign to roles' },
    ],
  },
  {
    key: 'sales-manager', order: 30, title: 'Sales Manager portal', kicker: 'Training video', tagline: 'Lead your team, watch the pipeline and release commission', category: 'Sales & CRM', roles: ['Sales Manager', 'Super Admin', 'Admin'],
    description: 'For sales managers: manage leads and agents, watch the pipeline, set goals, review sales and approve commission.',
    intro: 'Welcome, Sales Manager. This video shows how you lead the sales team and keep every lead moving.',
    outro: 'Assign leads fast, watch the pipeline, and approve commission on time. That is how a sales team stays motivated.',
    scenes: [
      { phase: 'Leads', title: 'All leads, all agents', bullets: ['Assign and reassign leads', 'Import from a file'], say: 'Start with leads. You see every lead from every agent. Assign or reassign leads and import lists from a file.', shot: S(ADMIN, '/leads', '.page-head'), call: 'All leads' },
      { phase: 'Pipeline', title: 'Watch the pipeline', bullets: ['Cards move across stages', 'Value at each stage'], say: 'The pipeline shows where every opportunity stands and what it is worth. Stalled leads are easy to spot.', shot: S(ADMIN, '/pipeline', '.page-head'), call: 'Pipeline' },
      { phase: 'Agents', title: 'Your sales team', bullets: ['Leads, sales and conversion', 'Ranking by performance'], say: 'Open Sales Agents to see each agent, their leads, their sales and how well they convert.', shot: S(ADMIN, '/agents', '.page-head'), call: 'Sales agents' },
      { phase: 'Goals', title: 'Goals and rewards', bullets: ['Set daily targets', 'Recognise top performers'], say: 'Goals and rewards keep the team motivated, with daily targets, streaks and recognition.', shot: S(ADMIN, '/goals', '.page-head'), call: 'Goals' },
      { phase: 'Sales', title: 'Sales and bookings', bullets: ['Payment plans and installments', 'Status of every booking'], say: 'Sales lists every booking with its payment plan and status. Open one to see the installments and receipts.', shot: S(ADMIN, '/sales', '.page-head'), call: 'Sales' },
      { phase: 'Commission', title: 'Approve commission', bullets: ['Earned as clients pay', 'Pending, approved and paid'], say: 'Commission is earned as clients pay. Review and approve it here, and finance releases the payment.', shot: S(ADMIN, '/commissions', '.page-head'), call: 'Commissions' },
    ],
  },
  {
    key: 'sales-agent', order: 40, title: 'Sales Agent portal', kicker: 'Training video', tagline: 'From new lead to booking, and your commission', category: 'Sales & CRM', roles: ['Sales Agent', 'Sales Manager'],
    description: 'For sales agents: add and track leads, follow up on time, move leads through the pipeline, find properties, book a sale and track your commission.',
    intro: 'Welcome to the Sales Agent portal. This video follows one customer from the first enquiry to a booking, and shows how you earn commission.',
    outro: 'Add every lead, follow up on time, and keep your streak alive. Your commission follows your sales.',
    scenes: [
      { phase: 'Dashboard', title: 'Your day at a glance', bullets: ['Follow ups due today', 'Your leads and sales'], say: 'Your dashboard shows the follow ups due today and your own leads and sales. Start every day here.', shot: S(AGENT, '/', '.hero, .stat'), call: 'Your day' },
      { phase: 'Add lead', title: 'Add a new lead', bullets: ['Name, phone and interest', 'Duplicates are caught'], say: 'When an enquiry arrives, click Add Contact. Enter the name and phone number, the source and the budget. The system warns you about duplicates.', shot: S(AGENT, '/leads', '.modal, [role=dialog]', { act: clickText(/add contact/) }), call: 'New lead form' },
      { phase: 'Leads', title: 'Track your leads', bullets: ['See only your own leads', 'Call or message in one click'], say: 'Your leads list shows only your own leads. Call or message from here, and update the stage after each conversation.', shot: S(AGENT, '/leads', 'table'), call: 'Your leads' },
      { phase: 'Pipeline', title: 'Move leads through the pipeline', bullets: ['Drag cards between stages', 'Every move is logged'], say: 'On the pipeline, drag each lead along as the conversation moves forward. Every move is recorded on the contact timeline.', shot: S(AGENT, '/pipeline', '.page-head'), call: 'Drag between stages' },
      { phase: 'Follow-ups', title: 'Tasks and follow ups', bullets: ['A task for every follow up', 'Reminders when due'], say: 'Set a task for every follow up. You are reminded when it is due, so no customer is forgotten.', shot: S(AGENT, '/tasks', '.page-head'), call: 'Your tasks' },
      { phase: 'Properties', title: 'Find the right property', bullets: ['Filter by type, price and area', 'Share details with the client'], say: 'Search the property inventory to match each buyer with the right property, and share the details with them.', shot: S(AGENT, '/properties', '.page-head'), call: 'Property inventory' },
      { phase: 'Commission', title: 'Track your commission', bullets: ['Earned as clients pay', 'Pending, approved and paid'], say: 'Your commission is earned as your clients pay. Watch it move from pending, to approved, to paid.', shot: S(AGENT, '/commissions', '.page-head'), call: 'Your commission' },
    ],
  },
  {
    key: 'properties-listings', order: 50, title: 'Properties and listings', kicker: 'Training video', tagline: 'Inventory, approvals, featured listings and the map', category: 'Properties & projects', roles: ['Listing Manager', 'Inventory Manager', 'Sales Manager', 'Super Admin', 'Admin'],
    description: 'For listing and inventory managers: the property inventory, adding a property, listing approvals, featured properties and the map.',
    intro: 'Welcome. This video covers the property inventory and the listings that appear on your website.',
    outro: 'Accurate properties mean accurate sales. Keep status, price and size current, and approve listings quickly.',
    scenes: [
      { phase: 'Inventory', title: 'The property inventory', bullets: ['Search and filter', 'Status and price at a glance'], say: 'The inventory lists every property with its status, price and size. Search and filter to find any listing in seconds.', shot: S(ADMIN, '/properties', '.page-head'), call: 'Inventory' },
      { phase: 'Add', title: 'Add a property', bullets: ['Type, size and price', 'Photos and description'], say: 'To add a property, click Add property and fill in its type, size, price and description, then upload photos.', shot: S(ADMIN, '/properties/new', '.page-head'), call: 'New property' },
      { phase: 'Approvals', title: 'Listing approvals', bullets: ['Review what agents add', 'Approve before it goes live'], say: 'Listings that agents add wait for approval here. Review each one, and approve it before it appears on the website.', shot: S(ADMIN, '/listings/approvals', '.page-head'), call: 'Approvals' },
      { phase: 'Featured', title: 'Featured properties', bullets: ['Highlight your best listings', 'Shown first on the website'], say: 'Feature your best listings so they appear first on the website.', shot: S(ADMIN, '/properties/featured', '.page-head'), call: 'Featured' },
      { phase: 'Map', title: 'The map', bullets: ['See availability visually', 'Reserved and sold at a glance'], say: 'The map shows availability visually, with reserved and sold properties marked.', shot: S(ADMIN, '/projects/map', '.page-head'), call: 'Map' },
    ],
  },
  {
    key: 'projects', order: 60, title: 'Projects', kicker: 'Training video', tagline: 'Development, units, progress and financials', category: 'Properties & projects', roles: ['Project Manager', 'Super Admin', 'Admin'],
    description: 'For project managers: development and construction projects, units, progress updates and project financials.',
    intro: 'Welcome. This video shows how you manage projects from the first unit to the last progress update.',
    outro: 'Keep progress updates current and watch the financials, and every project stays on track.',
    scenes: [
      { phase: 'Projects', title: 'All your projects', bullets: ['Development and construction', 'Status of each project'], say: 'Projects lists every development and construction project with its status.', shot: S(ADMIN, '/projects', '.page-head'), call: 'Projects' },
      { phase: 'Development', title: 'Development projects', bullets: ['Phases and blocks', 'Units and availability'], say: 'Development projects are split into phases and blocks, each with its units and their availability.', shot: S(ADMIN, '/projects/development', '.page-head'), call: 'Development' },
      { phase: 'Units', title: 'Units', bullets: ['Price and size', 'Available, reserved or sold'], say: 'Units shows every unit with its price and size, and whether it is available, reserved or sold.', shot: S(ADMIN, '/projects/units', '.page-head'), call: 'Units' },
      { phase: 'Updates', title: 'Progress updates', bullets: ['Post what was done', 'Clients can follow progress'], say: 'Post progress updates as work moves forward, so everyone, including clients, can follow it.', shot: S(ADMIN, '/projects/updates', '.page-head'), call: 'Progress' },
      { phase: 'Financials', title: 'Project financials', bullets: ['Income and costs', 'Profit per project'], say: 'Financials shows income, costs and profit for each project.', shot: S(ADMIN, '/projects/financials', '.page-head'), call: 'Financials' },
    ],
  },
  {
    key: 'finance', order: 70, title: 'Finance and accounting', kicker: 'Training video', tagline: 'Receipts, expenses, installments and the books', category: 'Accounting', roles: ['Finance Manager', 'Accounts Staff', 'Super Admin', 'Admin'],
    description: 'For finance teams: record receipts and expenses, follow installments and receivables, and read the financial statements.',
    intro: 'Welcome. This video shows how finance records money in and out, and how the books stay right.',
    outro: 'Record every receipt and expense the day it happens, and the statements will always be true.',
    scenes: [
      { phase: 'Receipts', title: 'Record a receipt', bullets: ['Choose the customer and the sale', 'Print the receipt'], say: 'When a customer pays, record a receipt against their sale. You can print or share it straight away.', shot: S(ADMIN, '/receipts', '.page-head'), call: 'Receipts' },
      { phase: 'Expenses', title: 'Record expenses', bullets: ['Category and amount', 'Attach the bill'], say: 'Record every expense with its category and amount, and attach the bill.', shot: S(ADMIN, '/expenses', '.page-head'), call: 'Expenses' },
      { phase: 'Installments', title: 'Installments and receivables', bullets: ['What is due and overdue', 'Follow up with customers'], say: 'Installments shows what is due and what is overdue, and receivables shows who owes you.', shot: S(ADMIN, '/payments/installments', '.page-head'), call: 'Installments' },
      { phase: 'Journals', title: 'Journals and ledgers', bullets: ['Every entry posts to the books', 'Chart of accounts'], say: 'Every receipt and expense posts to the books automatically. You can also post journal entries yourself.', shot: S(ADMIN, '/accounting/journals', '.page-head'), call: 'Journals' },
      { phase: 'Statements', title: 'Financial statements', bullets: ['Income statement', 'Balance sheet'], say: 'The income statement and the balance sheet are always up to date, because they come straight from the books.', shot: S(ADMIN, '/accounting/income-statement', '.page-head'), call: 'Income statement' },
    ],
  },
  {
    key: 'hr', order: 80, title: 'H R and payroll', kicker: 'Training video', tagline: 'Employees, attendance, leave and salary', category: 'HR & payroll', roles: ['HR Manager', 'Super Admin', 'Admin'],
    description: 'For H R managers: employee records, attendance, leave approvals, salary and bonuses.',
    intro: 'Welcome. This video shows how H R keeps people, attendance and pay in one place.',
    outro: 'Keep attendance and leave current, and payroll follows without any extra work.',
    scenes: [
      { phase: 'Employees', title: 'Employee records', bullets: ['Contact details and role', 'Documents on file'], say: 'Employees holds every record, with contact details, role and documents.', shot: S(ADMIN, '/hrm/employees', '.page-head'), call: 'Employees' },
      { phase: 'Attendance', title: 'Attendance', bullets: ['Daily check in and out', 'Late and absent flagged'], say: 'Attendance shows who checked in and out each day. Late arrivals and absences are flagged automatically.', shot: S(ADMIN, '/hrm/attendance', '.page-head'), call: 'Attendance' },
      { phase: 'Leave', title: 'Leave requests', bullets: ['Approve or decline', 'Balances kept for you'], say: 'Leave requests wait here for your decision, and balances are kept for you.', shot: S(ADMIN, '/hrm/leave', '.page-head'), call: 'Leave' },
      { phase: 'Salary', title: 'Salary', bullets: ['Follows attendance', 'Deductions shown clearly'], say: 'Salary follows attendance, with deductions shown clearly for every employee.', shot: S(ADMIN, '/hrm/salary', '.page-head'), call: 'Salary' },
      { phase: 'Bonuses', title: 'Bonuses', bullets: ['Reward results', 'Added to the payslip'], say: 'Bonuses reward results and are added to the payslip.', shot: S(ADMIN, '/hrm/bonuses', '.page-head'), call: 'Bonuses' },
    ],
  },
  {
    key: 'vendors', order: 85, title: 'Vendors and purchasing', kicker: 'Training video', tagline: 'Suppliers, tenders, purchases and what you owe', category: 'Accounting', roles: ['Finance Manager', 'Accounts Staff', 'Project Manager', 'Super Admin', 'Admin'],
    description: 'For purchasing and finance: vendors, tenders and bids, purchases and the vendor ledger.',
    intro: 'Welcome. This video shows how you manage suppliers, from the first tender to the final payment.',
    outro: 'Keep every purchase and payment on the vendor ledger, and you always know what you owe.',
    scenes: [
      { phase: 'Vendors', title: 'Your vendors', bullets: ['Contact details and category', 'Balance with each vendor'], say: 'Vendors lists every supplier with their category and the balance you owe them.', shot: S(ADMIN, '/vendors', '.page-head'), call: 'Vendors' },
      { phase: 'Tenders', title: 'Tenders and bids', bullets: ['Invite vendors to bid', 'Compare the bids'], say: 'Invite vendors to bid on a tender, then compare the bids side by side.', shot: S(ADMIN, '/vendors/tenders', '.page-head'), call: 'Tenders' },
      { phase: 'Purchases', title: 'Purchases', bullets: ['Record what you bought', 'Post to the books'], say: 'Record each purchase, and it posts to the books and to the vendor ledger.', shot: S(ADMIN, '/vendors/purchases', '.page-head'), call: 'Purchases' },
      { phase: 'Ledger', title: 'The vendor ledger', bullets: ['Every purchase and payment', 'The balance at any date'], say: 'The vendor ledger shows every purchase and payment, and the balance at any date.', shot: S(ADMIN, '/vendors/ledger', '.page-head'), call: 'Ledger' },
    ],
  },
  {
    key: 'customers', order: 90, title: 'Customers and the customer portal', kicker: 'Training video', tagline: 'One profile for every buyer, and their own portal', category: 'Sales & CRM', roles: ['Sales Manager', 'Finance Manager', 'Super Admin', 'Admin'],
    description: 'For sales and finance: customer profiles, the customer 360 view, statements and the customer portal.',
    intro: 'Welcome. This video shows how you see everything about a buyer in one place, and how customers follow their own account.',
    outro: 'One profile per customer, and a portal where they can see their own payments. That means fewer calls to your office.',
    scenes: [
      { phase: 'Customers', title: 'All your customers', bullets: ['Active, buyers and installments', 'Search and filter'], say: 'Customers lists every buyer. Filter by active customers, buyers or those paying installments.', shot: S(ADMIN, '/customers', '.page-head'), call: 'Customers' },
      { phase: 'Installments', title: 'Customers on installments', bullets: ['What each customer owes', 'Overdue at a glance'], say: 'The installment view shows what each customer owes and what is overdue.', shot: S(ADMIN, '/customers/installment', '.page-head'), call: 'Installments' },
      { phase: 'Portal', title: 'The customer portal', bullets: ['Customers see their own payments', 'Documents and notifications'], say: 'Give customers access to their own portal, where they see their payments, documents and notifications.', shot: S(ADMIN, '/customers/portal', '.page-head'), call: 'Portal access' },
      { phase: 'Promotions', title: 'Promotions', bullets: ['Offers for your customers', 'Shown in their portal'], say: 'Promotions let you share offers with your customers, and they appear in the customer portal.', shot: S(ADMIN, '/customers/promos', '.page-head'), call: 'Promotions' },
    ],
  },
];
