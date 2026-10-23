// Public marketing website content (platform host): editable texts, FAQs, testimonials, contact details, legal documents,
// demo requests and SEO metadata. Content lives in platform_settings ('marketing_content') and legal_documents, edited in
// the console (permission content.manage). Defaults describe only what the software actually does: no invented
// customers, counts, testimonials, integrations or performance claims.
import { platformDb, BASE_DOMAIN } from '../platform.js';
import { bad, HttpError } from '../util.js';

const pdb = () => platformDb();

export const MARKETING_SCHEMA = `
CREATE TABLE IF NOT EXISTS legal_documents(
  slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  reviewed_by TEXT, published_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT);
CREATE TABLE IF NOT EXISTS legal_document_versions(id INTEGER PRIMARY KEY, slug TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, published_at TEXT NOT NULL DEFAULT (datetime('now')), published_by TEXT, UNIQUE(slug, version));
CREATE TABLE IF NOT EXISTS demo_requests(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, company TEXT, product TEXT, team_size TEXT, message TEXT, source TEXT, landing_page TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','qualified','closed')), handled_by TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_demo_requests ON demo_requests(status, created_at);
`;

const PLACEHOLDER_NOTE = 'Template: replace every [bracketed] item and have it reviewed by a qualified lawyer for your jurisdictions before publishing.';
export const LEGAL_DEFAULTS = {
  terms: { title: 'Terms of Service', body: `${PLACEHOLDER_NOTE}

## 1. Who we are
Agentify ERP is provided by [Company legal name], [registered address] ("we", "us"). These terms apply to your use of the Agentify ERP website and software ("the Service").

## 2. Your account and workspace
You must give accurate information when you sign up and keep your password and two-factor codes safe. The person who creates a workspace is its owner and is responsible for who they invite and what those users do.

## 3. Free trial
New workspaces may receive a free trial for the period shown at signup. One trial is offered per owner email. We may end a trial that is misused.

## 4. Subscriptions and payment
Paid plans renew for the billing period you choose until cancelled. Prices, limits and included modules are shown on the pricing page and in Plan & Billing. Card payments are processed by our payment provider; we do not store card numbers. Bank and wallet payments start the plan once we confirm the money arrived.

## 5. Your data
You own the data you put into your workspace. Each workspace has its own separate database. If a subscription ends, your workspace becomes read-only: you can still sign in, view and export your data. See the Privacy Policy and the Cancellation & Refund Policy for retention.

## 6. Acceptable use
Do not use the Service for unlawful purposes, to send unsolicited messages, to attack the Service or to access another customer's data.

## 7. Availability and changes
We work to keep the Service available but do not guarantee uninterrupted service. We may change features; material changes to these terms will be notified in advance.

## 8. Liability
[Limitation of liability clause to be drafted for your jurisdiction.]

## 9. Governing law
These terms are governed by the laws of [jurisdiction]. Contact: [legal contact email].
` },
  privacy: { title: 'Privacy Policy', body: `${PLACEHOLDER_NOTE}

## What we collect
- Account details: name, email, phone, company name and the workspace address you choose.
- Workspace data: the records you and your team enter. This is stored in a separate database for your workspace and processed only to provide the Service.
- Billing details: plan, invoices and payment references. Card details are handled by our payment provider and never stored by us.
- Website analytics: only if you accept analytics cookies. We record pages viewed, the campaign or site that referred you and sign-up steps, using a random identifier. We do not store IP addresses for analytics and we honour Do Not Track and Global Privacy Control.

## Why we use it
To provide and secure the Service, bill subscriptions, send service emails (verification, invitations, receipts, trial and renewal reminders) and improve the website.

## Sharing
We use service providers for hosting, email delivery and payments: [list providers]. We do not sell personal data.

## Retention
Workspace data is kept while your account exists and for [retention period] after cancellation unless you ask us to delete it sooner, except billing records we must keep by law.

## Your rights
You can access, export, correct or ask us to delete your data. Contact [privacy contact email].

## Contact
[Company legal name], [address].
` },
  refunds: { title: 'Cancellation & Refund Policy', body: `${PLACEHOLDER_NOTE}

## Cancelling
You can cancel at any time from Plan & Billing (card subscriptions) or by contacting us (bank and wallet payments). Access continues until the end of the period you paid for.

## After cancellation
Your workspace becomes read-only. Your data is not deleted automatically; you can export it. [Describe how long data is retained and how to request deletion.]

## Refunds
[State your refund rules, e.g. whether annual plans are refunded pro rata, and any statutory rights that apply.] Setup fees are [refundable / non-refundable].

## Failed payments
If a renewal payment fails you keep access for the grace period shown in Plan & Billing. After that the workspace becomes read-only until payment is made.
` },
  subscription: { title: 'Subscription Terms', body: `${PLACEHOLDER_NOTE}

## Plans and limits
Each plan includes the users, projects, properties, storage and modules shown on the pricing page. Add-ons raise those limits. Limits are enforced by the Service.

## Billing periods and renewal
Monthly plans renew every month and yearly plans every year on the same date. Bank and wallet payers receive reminders before each renewal.

## Changing plans
Upgrades take effect when paid. Downgrades take effect at the next renewal. If you exceed the limits of a smaller plan you will be asked to reduce usage or keep the larger plan.

## Price changes
New prices apply to new purchases and renewals after we notify you. Your current period is never re-priced.

## Taxes
Prices are shown [inclusive / exclusive] of applicable taxes. [Add tax registration details.]
` },
};

export const CONTENT_DEFAULTS = {
  brand: 'Agentify ERP',
  hero_title: 'Run your property or construction business from one system',
  hero_subtitle: 'Two products on one secure platform: Real Estate Brokerage Management for agencies and developers, and Construction Management for contractors and builders. Each company gets its own private workspace.',
  real_estate: {
    title: 'Real Estate Brokerage Management',
    subtitle: 'Leads, property inventory, sales, installments, commissions, receipts and a customer portal, connected to double-entry accounting.',
    features: [
      ['CRM and follow-ups', 'Leads, contacts, smart lists, a sales pipeline, tasks and reminders, with agents restricted to their own leads.'],
      ['Property inventory and listings', 'Plots, files and units with registration numbers, statuses, approvals and a plot map; listings feed your website.'],
      ['Sales, payment plans and receipts', 'Booking, advance, installment and balloon schedules; receipts allocate to installments and post to the books.'],
      ['Agents and commissions', 'Commission rules, approvals and payouts with an agent ledger.'],
      ['Customer ledgers and portal', 'Each buyer sees their own schedule, payments, receipts and documents and can report a payment.'],
      ['Expenses and reports', 'Expense vouchers, vendor payables, income statement, balance sheet and sales, collection and receivable reports.'],
    ],
    use_cases: ['Property agencies managing listings and agents', 'Developers selling plots and files on installments', 'Teams that need customer ledgers and receipts in one place'],
  },
  construction: {
    title: 'Construction Management',
    subtitle: 'Projects, sites, BOQs, budgets, procurement, materials, labour, subcontractors, progress and client billing in one place.',
    features: [
      ['Projects, sites and phases', 'Set up projects with sites, phases, milestones and a date-driven schedule that flags delays.'],
      ['BOQs, estimates and budgets', 'Build estimates, convert them into the project BOQ, and compare budget with committed and actual cost.'],
      ['Procurement and materials', 'Purchase orders to suppliers, goods received into site stock, issues to work and stock balances per site.'],
      ['Labour and subcontractors', 'Daily labour records and subcontracts with retention; payment certificates from measured progress.'],
      ['Change orders and progress', 'Approved change orders adjust the budget; daily site reports record work done, weather, issues and photos.'],
      ['Client billing and portal', 'Payment schedules, invoices and receipts for clients, who can follow progress and documents in their portal.'],
    ],
    use_cases: ['General contractors running several sites', 'Builders delivering houses for clients on payment schedules', 'Developers who also build what they sell'],
  },
  faqs: [
    ['Is my data separate from other companies?', 'Yes. Every workspace has its own database and its own uploaded files, and every request is checked on the server against the workspace it belongs to.'],
    ['What happens when my trial ends?', 'The workspace becomes read-only. Nothing is deleted: you can still sign in, view and export everything. Choose a plan and editing returns immediately.'],
    ['Can I use both products?', 'Yes. Choose one product at signup; a bundle plan gives you both in the same workspace.'],
    ['How do I pay?', 'By card through our payment provider where available, or by bank transfer and local wallets. For transfers you enter the transaction reference and we confirm it.'],
    ['Can my team have different access?', 'Yes. Invite people by email and give each a role with view, create, edit, delete, approve, export and print rights per module.'],
  ],
  testimonials: [],
  partners: [],
  contact_email: '',
  contact_phone: '',
  address: '',
  social: { facebook: '', linkedin: '', instagram: '', youtube: '' },
  announcement_bar: '',
  seo: {
    home: { title: 'Agentify ERP: real estate CRM for brokerages, with the ERP behind it', description: 'Capture every enquiry, assign it to an agent, follow up on time and move deals through your pipeline. Properties, sales, instalments and accounts in the same workspace. Free trial.' },
    real_estate: { title: 'Real Estate Brokerage Management software | Agentify ERP', description: 'CRM, property inventory, sales, installments, commissions, receipts and a customer portal connected to accounting.' },
    construction: { title: 'Construction Management software | Agentify ERP', description: 'Projects, BOQs, budgets, procurement, materials, labour, subcontractors, progress reports and client billing.' },
    pricing: { title: 'Pricing | Agentify ERP', description: 'Plans for Real Estate Brokerage and Construction Management, monthly or yearly, with a free trial.' },
    contact: { title: 'Book a demo | Agentify ERP', description: 'Ask for a demo of Agentify ERP for real estate or construction.' },
  },
};

const getSetting = (k) => pdb().prepare('SELECT value FROM platform_settings WHERE key=?').get(k)?.value;
const putSetting = (k, v, by) => pdb().prepare("INSERT INTO platform_settings(key,value,updated_by,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at").run(k, v, by);

let ready = false;
function ensure() {
  if (ready) return;
  pdb().exec(MARKETING_SCHEMA);
  for (const [slug, d] of Object.entries(LEGAL_DEFAULTS)) pdb().prepare('INSERT OR IGNORE INTO legal_documents(slug,title,body,updated_by) VALUES(?,?,?,?)').run(slug, d.title, d.body, 'system');
  ready = true;
}
export const resetMarketingCache = () => { ready = false; };

const merge = (base, over) => {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = k in base ? merge(base[k], v) : v;
  return out;
};
export function marketingContent() {
  ensure();
  let saved = {};
  try { saved = JSON.parse(getSetting('marketing_content') || '{}'); } catch { saved = {}; }
  return merge(CONTENT_DEFAULTS, saved);
}

const str = (v, max, label) => { const s = String(v ?? '').trim(); if (s.length > max) throw bad(`${label} is too long (max ${max} characters)`); return s; };
const pairs = (v, label, max = 20) => {
  if (!Array.isArray(v)) throw bad(`${label} must be a list`);
  return v.slice(0, max).map((p) => [str(p?.[0], 160, label), str(p?.[1], 1200, label)]).filter(([a]) => a);
};
/** Save the editable website content (validated, length-limited, plain text only). */
export function saveMarketing(b, by) {
  ensure();
  const cur = marketingContent();
  const next = { ...cur };
  for (const k of ['brand', 'hero_title', 'hero_subtitle', 'contact_email', 'contact_phone', 'address', 'announcement_bar']) if (b[k] !== undefined) next[k] = str(b[k], k === 'hero_subtitle' ? 600 : 200, k);
  if (next.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.contact_email)) throw bad('Contact email is not valid');
  for (const prod of ['real_estate', 'construction']) {
    if (!b[prod]) continue;
    next[prod] = { ...cur[prod] };
    if (b[prod].title !== undefined) next[prod].title = str(b[prod].title, 120, 'Title');
    if (b[prod].subtitle !== undefined) next[prod].subtitle = str(b[prod].subtitle, 600, 'Subtitle');
    if (b[prod].features !== undefined) next[prod].features = pairs(b[prod].features, 'Features');
    if (b[prod].use_cases !== undefined) next[prod].use_cases = (Array.isArray(b[prod].use_cases) ? b[prod].use_cases : []).map((x) => str(x, 200, 'Use case')).filter(Boolean).slice(0, 10);
  }
  if (b.faqs !== undefined) next.faqs = pairs(b.faqs, 'FAQs', 40);
  if (b.testimonials !== undefined) {
    if (!Array.isArray(b.testimonials)) throw bad('Testimonials must be a list');
    // only genuine testimonials: each needs a named person, company and confirmation that permission was given
    next.testimonials = b.testimonials.slice(0, 20).map((t) => ({ quote: str(t.quote, 600, 'Quote'), name: str(t.name, 80, 'Name'), company: str(t.company, 120, 'Company'), role: str(t.role, 80, 'Role'), country: /^[A-Za-z]{2}$/.test(String(t.country || '').trim()) ? String(t.country).trim().toUpperCase() : null, permission: !!t.permission }))
      .filter((t) => t.quote);
    if (next.testimonials.some((t) => !t.name || !t.company || !t.permission)) throw bad('Each testimonial needs the person\'s name, company and confirmation that they gave permission to publish it');
  }
  if (b.partners !== undefined) {
    if (!Array.isArray(b.partners)) throw bad('Partners must be a list');
    // only companies that agreed to be listed; the logo is a small image saved with the content (data address) or an https link
    next.partners = b.partners.slice(0, 40).map((p) => ({ name: str(p.name, 80, 'Partner name'), country: /^[A-Za-z]{2}$/.test(String(p.country || '').trim()) ? String(p.country).trim().toUpperCase() : null, logo: String(p.logo || '').trim(), url: String(p.url || '').trim(), permission: !!p.permission })).filter((p) => p.name || p.logo);
    for (const p of next.partners) {
      if (!p.name) throw bad('Each partner needs a name');
      if (!p.permission) throw bad(`${p.name}: confirm that they agreed to be listed as a partner`);
      if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(p.logo) && !/^https:\/\/[^\s"'<>]+$/.test(p.logo)) throw bad(`${p.name}: add the logo as a PNG, JPG, WebP or SVG image`);
      if (p.logo.length > 50_000) throw bad(`${p.name}: the logo is too large (keep it under about 35 KB; large images are shrunk automatically)`);
      if (p.url && !/^https:\/\/[^\s"'<>]+$/.test(p.url)) throw bad(`${p.name}: the website link must start with https://`);
    }
  }
  if (b.social !== undefined) next.social = Object.fromEntries(Object.entries({ ...cur.social, ...b.social }).map(([k, v]) => {
    const s = str(v, 200, k);
    if (s && !/^https:\/\//.test(s)) throw bad(`${k} link must start with https://`);
    return [k, s];
  }));
  if (b.seo !== undefined) {
    next.seo = { ...cur.seo };
    for (const [page, m] of Object.entries(b.seo || {})) if (cur.seo[page]) next.seo[page] = { title: str(m.title, 70, 'SEO title'), description: str(m.description, 170, 'SEO description') };
  }
  putSetting('marketing_content', JSON.stringify(next), by);
  return marketingContent();
}

/** What the public site may show (published legal docs are listed; drafts are shown with a clear notice). */
export function publicContent() {
  const c = marketingContent();
  return { ...c, testimonials: c.testimonials.filter((t) => t.permission), partners: (c.partners || []).filter((p) => p.permission && p.logo), legal: listLegal().map(({ slug, title, status, version, published_at }) => ({ slug, title, status, version, published_at })) };
}

// ---------------------------------------------------------------- legal documents
export function listLegal() { ensure(); return pdb().prepare('SELECT slug,title,status,version,reviewed_by,published_at,updated_at,updated_by FROM legal_documents ORDER BY slug').all(); }
export function legalDoc(slug, { includeDraft = true } = {}) {
  ensure();
  const d = pdb().prepare('SELECT * FROM legal_documents WHERE slug=?').get(String(slug));
  if (!d) throw new HttpError(404, 'Document not found');
  if (d.status === 'published' || includeDraft) return { slug: d.slug, title: d.title, body: d.body, status: d.status, version: d.version, published_at: d.published_at, reviewed_by: d.reviewed_by };
  // the published version stays live while a new draft is being edited
  const v = pdb().prepare('SELECT * FROM legal_document_versions WHERE slug=? ORDER BY version DESC LIMIT 1').get(d.slug);
  return v ? { slug: d.slug, title: v.title, body: v.body, status: 'published', version: v.version, published_at: v.published_at } : { slug: d.slug, title: d.title, body: d.body, status: 'draft', version: d.version };
}
/** Public view: the latest published version, or the draft clearly marked as not yet reviewed. */
export const publicLegal = (slug) => legalDoc(slug, { includeDraft: false });

export function saveLegal(slug, { title, body }, by) {
  ensure();
  const d = pdb().prepare('SELECT * FROM legal_documents WHERE slug=?').get(String(slug));
  if (!d) throw new HttpError(404, 'Document not found');
  const t = str(title ?? d.title, 120, 'Title'), b = String(body ?? d.body);
  if (b.length > 60000) throw bad('Document is too long');
  if (!t || !b.trim()) throw bad('Title and text are required');
  pdb().prepare("UPDATE legal_documents SET title=?, body=?, status='draft', updated_at=datetime('now'), updated_by=? WHERE slug=?").run(t, b, by, d.slug);
  return legalDoc(d.slug);
}
/** Publishing needs a named reviewer (the lawyer or person responsible), and refuses text that still has [placeholders]. */
export function publishLegal(slug, { reviewed_by }, by) {
  ensure();
  const d = pdb().prepare('SELECT * FROM legal_documents WHERE slug=?').get(String(slug));
  if (!d) throw new HttpError(404, 'Document not found');
  const reviewer = str(reviewed_by, 120, 'Reviewer');
  if (reviewer.length < 3) throw bad('Name the person who reviewed this document before publishing it');
  if (/\[[^\]]{2,80}\]/.test(d.body)) throw bad('Replace every [bracketed] placeholder before publishing');
  if (d.body.includes(PLACEHOLDER_NOTE)) throw bad('Remove the template note at the top before publishing');
  const last = pdb().prepare('SELECT MAX(version) v FROM legal_document_versions WHERE slug=?').get(d.slug).v || 0;
  pdb().prepare('INSERT INTO legal_document_versions(slug,version,title,body,published_by) VALUES(?,?,?,?,?)').run(d.slug, last + 1, d.title, d.body, by);
  pdb().prepare("UPDATE legal_documents SET status='published', version=?, reviewed_by=?, published_at=datetime('now'), updated_at=datetime('now'), updated_by=? WHERE slug=?").run(last + 1, reviewer, by, d.slug);
  return legalDoc(d.slug);
}
/** The version of the Terms a new customer accepts at signup (0 while only a draft exists). */
export const termsVersion = () => { ensure(); return pdb().prepare('SELECT MAX(version) v FROM legal_document_versions WHERE slug=?').get('terms').v || 0; };

// ---------------------------------------------------------------- demo requests
export function createDemoRequest(b) {
  ensure();
  const email = str(b.email, 160, 'Email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Please enter a valid email address');
  const name = str(b.name, 100, 'Name');
  if (name.length < 2) throw bad('Please enter your name');
  const product = ['real_estate', 'construction', 'both'].includes(b.product) ? b.product : null;
  const id = Number(pdb().prepare('INSERT INTO demo_requests(name,email,phone,company,product,team_size,message,source,landing_page) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(name, email, str(b.phone, 40, 'Phone') || null, str(b.company, 120, 'Company') || null, product, str(b.team_size, 20, 'Team size') || null, str(b.message, 2000, 'Message') || null,
      str(b.source, 120, 'Source') || null, str(b.landing_page, 200, 'Landing page') || null).lastInsertRowid);
  return { id, email, name, product };
}
export function listDemoRequests({ status } = {}) {
  ensure();
  return pdb().prepare(`SELECT * FROM demo_requests ${status ? 'WHERE status=?' : ''} ORDER BY id DESC LIMIT 500`).all(...(status ? [status] : []));
}
export function updateDemoRequest(id, { status, note }, by) {
  ensure();
  if (status && !['new', 'contacted', 'qualified', 'closed'].includes(status)) throw bad('Unknown status');
  const r = pdb().prepare('SELECT * FROM demo_requests WHERE id=?').get(Number(id));
  if (!r) throw new HttpError(404, 'Request not found');
  pdb().prepare("UPDATE demo_requests SET status=COALESCE(?,status), note=COALESCE(?,note), handled_by=?, updated_at=datetime('now') WHERE id=?").run(status || null, note === undefined ? null : str(note, 1000, 'Note'), by, r.id);
  return pdb().prepare('SELECT * FROM demo_requests WHERE id=?').get(r.id);
}

// ---------------------------------------------------------------- SEO for the platform host
export const MARKETING_ROUTES = { '/': 'home', '/real-estate': 'real_estate', '/construction': 'construction', '/pricing': 'pricing', '/contact': 'contact', '/signup': 'home',
  '/legal/terms': 'legal', '/legal/privacy': 'legal', '/legal/refunds': 'legal', '/legal/subscription': 'legal' };
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const siteOrigin = (req) => (BASE_DOMAIN && BASE_DOMAIN !== 'localhost' ? `https://${BASE_DOMAIN}` : `${req.protocol}://${req.get('host')}`);

/** index.html with the page's title, description, canonical URL and social sharing tags filled in on the server. */
export function injectMeta(html, path, req) {
  const page = MARKETING_ROUTES[path];
  if (!page) return html;
  const c = marketingContent();
  let m = c.seo[page] || c.seo.home;
  if (page === 'legal') { const slug = path.split('/').pop(); const doc = LEGAL_DEFAULTS[slug]; m = { title: `${doc?.title || 'Legal'} | ${c.brand}`, description: `${doc?.title || 'Legal document'} for ${c.brand}.` }; }
  const url = `${siteOrigin(req)}${path === '/' ? '/' : path}`;
  const tags = [
    `<title>${escHtml(m.title)}</title>`, `<meta name="description" content="${escHtml(m.description)}" />`, `<link rel="canonical" href="${escHtml(url)}" />`,
    `<meta property="og:type" content="website" />`, `<meta property="og:site_name" content="${escHtml(c.brand)}" />`, `<meta property="og:title" content="${escHtml(m.title)}" />`,
    `<meta property="og:description" content="${escHtml(m.description)}" />`, `<meta property="og:url" content="${escHtml(url)}" />`, `<meta property="og:image" content="${escHtml(siteOrigin(req))}/icon-512.png" />`,
    `<meta name="twitter:card" content="summary" />`, `<meta name="twitter:title" content="${escHtml(m.title)}" />`, `<meta name="twitter:description" content="${escHtml(m.description)}" />`,
  ].join('\n    ');
  return html.replace(/<title>[\s\S]*?<\/title>/, tags);
}

export function platformSitemap(req) {
  const o = siteOrigin(req);
  const today = new Date().toISOString().slice(0, 10);
  const urls = Object.keys(MARKETING_ROUTES).filter((p) => p !== '/signup').map((p) => `  <url><loc>${o}${p}</loc><lastmod>${today}</lastmod><changefreq>${p.startsWith('/legal') ? 'monthly' : 'weekly'}</changefreq></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
export const platformRobots = (req) => `User-agent: *\nAllow: /\nDisallow: /platform\nDisallow: /api/\nSitemap: ${siteOrigin(req)}/sitemap.xml\n`;
