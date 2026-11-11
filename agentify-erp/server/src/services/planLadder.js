// The 6-tier Pakistan plan ladder (Agent Plus ... Enterprise; the old Solo Agent tier was retired in v1.89) and its add-ons. Seeded once as HIDDEN plans by plansStore.initPlans; the platform owner
// reviews them in Console > Plans and uses "Switch to the plan ladder" to put them on sale. Every number here is a proposal the owner edits in the console.
//
// Prices are PKR, tax-inclusive like the rest of the billing code. 6-month and yearly discounts come from shared/termDiscounts.js (5% and 10%).
// Each tier switches features on or off through plan.allowances.flags (see FEATURE_GATES in plans.js); the server refuses a switched-off area with 402 feature_not_in_plan.
import { FEATURE_GATES } from './plans.js';
import { periodPricesFor, termDiscountPercent } from '../../../shared/termDiscounts.js';

/** The currency the plain (un-suffixed) Stripe price slots of the ladder are for; other currencies get their own slot. */
export const LADDER_HOME_CURRENCY = 'PKR';
export const HALF_YEAR_DISCOUNT = termDiscountPercent('half');
export const YEAR_DISCOUNT = termDiscountPercent('year');
/** Monthly price -> { month, half, year } with the configured term discounts (shared/termDiscounts.js). */
export const periodPrices = (month, currency = null) => periodPricesFor(month, currency);

// feature -> the first tier that includes it (tiers 1..7); tiers above keep it
const FIRST_TIER = {
  installments: 2, receipts: 2, whatsapp: 2,
  vouchers: 3, reports: 3, website: 3, hrm: 3,
  visual_website: 4, custom_domain: 4, property_visits: 4, field_location: 4, tenant_email: 4, ai: 4,
  social_posting: 5, lead_scoring: 5,
  developer_portal: 6, plot_rebate: 6, project_inventory: 6, assisted_migration: 6,
  mls_feeds: 7, branches: 7, white_label: 7, dedicated_database: 7, enforce_2fa: 7, priority_support: 7,
};
const flagsFor = (tier, extra = {}) => ({ ...Object.fromEntries(Object.keys(FEATURE_GATES).map((k) => [k, tier >= (FIRST_TIER[k] ?? 99)])), ...extra });
const mail = (op, mk) => ({ operational: { monthly: op, daily: null }, marketing: { monthly: mk, daily: null } });
const credits = (n) => ({ PKR: n, default: n });
const noContent = { content_calendar: false, bulk_generator: false, brand_kit: false, listing_to_post: false, priority_queue: false };

export const LADDER_PLANS = {
  lad_agent_plus: {
    name: 'Agent Plus', product: 'real_estate', seats: 2, projects: null, properties: 400, storage_mb: 2048, api_access: 0,
    description: 'Two users: listings, leads, installments, receipts and WhatsApp reminders, on your phone or desktop.',
    features: ['2 users', 'Property listings', 'Leads and CRM', 'Installment plans', 'Receipts', 'WhatsApp reminders', 'Android app and installable desktop app (works offline for notes, tasks and leads)'],
    allowances: { credits: credits(0), flags: flagsFor(2, noContent) },
    price: { PKR: periodPrices(1500), USD: periodPrices(29), AED: periodPrices(99) },
  },
  lad_agency_starter: {
    name: 'Agency Starter', product: 'real_estate', seats: 5, projects: null, properties: 1000, storage_mb: 5120, api_access: 0,
    description: 'A small agency: accounting, reports, HRM and a free website.',
    features: ['5 users', 'Everything in Agent Plus', 'Vouchers and accounting', 'Reports', 'HRM: employees, attendance, leave and salary', 'Free website'],
    allowances: { credits: credits(0), flags: flagsFor(3, noContent) },
    price: { PKR: periodPrices(5000), USD: periodPrices(79), AED: periodPrices(299) },
  },
  lad_agency_growth: {
    name: 'Agency Growth', product: 'real_estate', seats: 10, projects: null, properties: 2500, storage_mb: 10240, api_access: 0, highlight: 1,
    description: 'A growing agency: visual website with your own domain, visits, field locations, email and the first AI credits.',
    features: ['10 users', 'Everything in Agency Starter', 'Visual website with your own domain', 'Property visits', 'Field-location sharing', 'Tenant email', 'AI assistant and Creative Studio (small monthly quota)', 'Content calendar with approval for social posts'],
    allowances: { credits: credits(150), reel_seconds: 8, posts_per_day: null, posts_per_month: null, flags: flagsFor(4, { ...noContent, content_calendar: true }) },
    email_limits: mail(800, 1200),
    price: { PKR: periodPrices(12000), USD: periodPrices(149), AED: periodPrices(549) },
  },
  lad_agency_pro: {
    name: 'Agency Pro', product: 'real_estate', seats: 15, projects: null, properties: 5000, storage_mb: 20480, api_access: 0,
    description: 'A busy agency: bigger AI and Creative Studio quota, social posting, lead scoring and a follow-up reminder queue.',
    features: ['15 users', 'Everything in Agency Growth', 'Larger AI and Creative Studio quota', 'Meta (Facebook and Instagram) connection', 'Social media scheduler and auto-posting with Zernio', 'Lead scoring', 'Follow-up reminder queue'],
    allowances: { credits: credits(500), reel_seconds: 16, posts_per_day: 6, posts_per_month: 120, flags: flagsFor(5, { ...noContent, content_calendar: true, bulk_generator: true, brand_kit: true, listing_to_post: true }) },
    email_limits: mail(1500, 2500),
    price: { PKR: periodPrices(18000), USD: periodPrices(249), AED: periodPrices(899) },
  },
  lad_developer: {
    name: 'Developer', product: 'bundle', seats: 40, projects: null, properties: null, storage_mb: 51200, api_access: 0,
    description: 'Developers and builders: developer portal, plot rebates, projects and inventory, construction and assisted migration.',
    features: ['40 users', 'Everything in Agency Pro', 'Developer portal', 'Plot rebates', 'Projects and inventory', 'Construction management', 'Bigger AI quota', 'Assisted data migration'],
    allowances: { credits: credits(1200), reel_seconds: 16, posts_per_day: 10, posts_per_month: 200, flags: flagsFor(6, { ...noContent, content_calendar: true, bulk_generator: true, brand_kit: true, listing_to_post: true }) },
    email_limits: mail(3000, 5000),
    price: { PKR: periodPrices(35000), USD: periodPrices(449), AED: periodPrices(1649) },
  },
  lad_enterprise: {
    name: 'Enterprise', product: 'bundle', seats: null, projects: null, properties: null, storage_mb: null, api_access: 1,
    description: 'From PKR 85,000 a month. Unlimited users, branches, API and MLS feeds, white-label, a dedicated database, enforced 2FA and priority support. Final price is agreed with you.',
    features: ['From PKR 85,000 a month', 'Unlimited users', 'Branches', 'API and MLS feeds', 'White-label', 'Dedicated database', '2FA enforcement for all staff', 'Priority support'],
    allowances: { credits: credits(3000), reel_seconds: 24, posts_per_day: 20, posts_per_month: 600, flags: flagsFor(7, { content_calendar: true, bulk_generator: true, brand_kit: true, listing_to_post: true, priority_queue: true }) },
    email_limits: mail(8000, 12000),
    price: { PKR: periodPrices(85000), USD: periodPrices(999), AED: periodPrices(3699) },
  },
};
export const LADDER_IDS = Object.keys(LADDER_PLANS);

/**
 * Per-currency wording for the ladder plans. The plan rows carry one description and feature list written for Pakistan; a buyer paying in another
 * currency sees the `regional[currency]` version instead (same plans, same limits, same switches, wording that fits their market). Only features that
 * exist in the product are listed. See docs/usa-pricing-research.md for the research behind the USD prices.
 */
const LADDER_USD = {
  lad_agent_plus: { USD: {
    description: 'Two users: listings, leads, CRM, a click-to-call dialer and receipts, on your phone or desktop.',
    features: ['2 users', 'Property listings', 'Leads and CRM', 'Dialer with your own Twilio number (calls, notes, call log)', 'Mortgage lender and loan application tracking', 'Receipts', 'WhatsApp reminders', 'Android app and installable desktop app (works offline for notes, tasks and leads)'] } },
  lad_agency_starter: { USD: {
    description: 'A small brokerage: accounting, reports, HRM and a free website.',
    features: ['5 users', 'Everything in Agent Plus', 'Vouchers and accounting', 'Reports', 'HRM: employees, attendance, leave and payroll', 'Free website'] } },
  lad_agency_growth: { USD: {
    description: 'A growing brokerage: visual website with your own domain, property visits, field locations, email and the first AI credits.',
    features: ['10 users', 'Everything in Agency Starter', 'Visual website with your own domain', 'Property visits', 'Field-location sharing', 'Tenant email', 'AI assistant and Creative Studio (small monthly quota)', 'Content calendar with approval for social posts'] } },
  lad_agency_pro: { USD: {
    description: 'A busy brokerage: bigger AI and Creative Studio quota, social posting, lead scoring and a follow-up reminder queue.',
    features: ['15 users', 'Everything in Agency Growth', 'Larger AI and Creative Studio quota', 'Meta (Facebook and Instagram) connection', 'Social media scheduler and auto-posting with Zernio', 'Lead scoring', 'Follow-up reminder queue'] } },
  lad_developer: { USD: {
    description: 'Developers and builders: developer portal, projects and inventory, construction management and assisted migration.',
    features: ['40 users', 'Everything in Agency Pro', 'Developer portal', 'Projects and inventory', 'Construction management', 'Bigger AI quota', 'Assisted data migration'] } },
  lad_enterprise: { USD: {
    description: 'From $999 a month. Unlimited users, branches, API and MLS feeds, white-label, a dedicated database, enforced 2FA and priority support. Final price is agreed with you.',
    features: ['From $999 a month', 'Unlimited users', 'Branches', 'API and MLS feeds', 'White-label', 'Dedicated database', '2FA enforcement for all staff', 'Priority support'] } },
};
/** UAE wording: only features that exist today (RERA permit and title deed fields, DLD cost calculator, off-plan, rentals, Emirates ID). Arabic is not advertised until the Arabic screens are reviewed by a native speaker. */
const LADDER_AED = {
  lad_agent_plus: {
    description: 'Two users: listings, leads, CRM, rentals, off-plan and receipts, with DLD and RERA permit fields, on your phone or desktop.',
    features: ['2 users', 'Property listings with RERA permit number and title deed fields', 'Leads and CRM (Bayut, Property Finder and Dubizzle as lead sources)', 'Sale, rental and off-plan listings', 'Mortgage tracking and Dubai DLD transfer-cost calculator', 'Receipts', 'WhatsApp reminders', 'Android app and installable desktop app (works offline for notes, tasks and leads)'] },
  lad_agency_starter: {
    description: 'A small brokerage: accounting, reports, HRM and a free website.',
    features: ['5 users', 'Everything in Agent Plus', 'Vouchers and accounting', 'Reports', 'HRM: employees, attendance, leave and payroll', 'Free website'] },
  lad_agency_growth: {
    description: 'A growing brokerage: visual website with your own domain, property visits, field locations, email and the first AI credits.',
    features: ['10 users', 'Everything in Agency Starter', 'Visual website with your own domain', 'Property visits', 'Field-location sharing', 'Tenant email', 'AI assistant and Creative Studio (small monthly quota)', 'Content calendar with approval for social posts'] },
  lad_agency_pro: {
    description: 'A busy brokerage: bigger AI and Creative Studio quota, social posting, lead scoring and a follow-up reminder queue.',
    features: ['15 users', 'Everything in Agency Growth', 'Larger AI and Creative Studio quota', 'Meta (Facebook and Instagram) connection', 'Social media scheduler and auto-posting with Zernio', 'Lead scoring', 'Follow-up reminder queue'] },
  lad_developer: {
    description: 'Developers and builders: developer portal, projects and inventory, off-plan sales, construction management and assisted migration.',
    features: ['40 users', 'Everything in Agency Pro', 'Developer portal', 'Projects and inventory', 'Off-plan sales and construction management', 'Bigger AI quota', 'Assisted data migration'] },
  lad_enterprise: {
    description: 'From AED 3,699 a month. Unlimited users, branches, API and MLS feeds, white-label, a dedicated database, enforced 2FA and priority support. Final price is agreed with you.',
    features: ['From AED 3,699 a month', 'Unlimited users', 'Branches', 'API and MLS feeds', 'White-label', 'Dedicated database', '2FA enforcement for all staff', 'Priority support'] },
};
/** Per-currency wording for each ladder plan: { USD: {...}, AED: {...} }. */
export const LADDER_REGIONAL = Object.fromEntries(Object.keys(LADDER_USD).map((id) => [id, { ...LADDER_USD[id], AED: LADDER_AED[id] }]));
/** USD add-on prices (extra user, one-time AI top-up packs), merged into the add-on rows once. */
export const ADDON_USD = {
  extra_user: periodPrices(12),
  ai_topup_100: { month: 15, half: 15, year: 15 }, ai_topup_300: { month: 39, half: 39, year: 39 }, ai_topup_700: { month: 79, half: 79, year: 79 },
};

/** AED add-on prices (UAE launch), merged into the add-on rows once. */
export const ADDON_AED = {
  extra_user: periodPrices(45),
  ai_topup_100: { month: 55, half: 55, year: 55 }, ai_topup_300: { month: 145, half: 145, year: 145 }, ai_topup_700: { month: 290, half: 290, year: 290 },
};

/** Add-ons sold on top of a plan. `topup_credits` marks a one-time pack: its credits are added for the current month when the payment is approved (no recurring add-on is created). */
export const LADDER_ADDONS = [
  { id: 'extra_user', name: 'Extra user', description: 'One more team member on any plan (PKR 700 a month).', product: 'any', price: { PKR: periodPrices(700) }, entitlements: { seats: 1 }, sort_order: 10 },
  { id: 'ai_topup_100', name: 'AI top-up: 100 credits', description: 'One-time pack, added to this month\'s AI credits.', product: 'any', price: { PKR: { month: 3000, half: 3000, year: 3000 } }, entitlements: { topup_credits: 100 }, sort_order: 20 },
  { id: 'ai_topup_300', name: 'AI top-up: 300 credits', description: 'One-time pack, added to this month\'s AI credits.', product: 'any', price: { PKR: { month: 8000, half: 8000, year: 8000 } }, entitlements: { topup_credits: 300 }, sort_order: 21 },
  { id: 'ai_topup_700', name: 'AI top-up: 700 credits', description: 'One-time pack, added to this month\'s AI credits.', product: 'any', price: { PKR: { month: 16000, half: 16000, year: 16000 } }, entitlements: { topup_credits: 700 }, sort_order: 22 },
];

/**
 * Put the ladder on sale (or take it off). Switching ON shows and sells the 6 ladder plans and takes every other public plan off sale
 * (subscribers keep them and can renew; nothing is deleted). The previous state is stored so switching OFF restores it exactly.
 */
export function ladderState(db) {
  const rows = db.prepare(`SELECT id, visible, active FROM plans WHERE id IN (${LADDER_IDS.map(() => '?').join(',')})`).all(...LADDER_IDS);
  const prev = db.prepare("SELECT value FROM platform_settings WHERE key='ladder_previous'").get()?.value;
  return { present: rows.length === LADDER_IDS.length, on: rows.length > 0 && rows.every((r) => r.visible && r.active), plans: rows.map((r) => ({ id: r.id, visible: !!r.visible, active: !!r.active })), restorable: !!prev };
}
export function setLadder(db, on, actor) {
  const set = (k, v) => db.prepare("INSERT INTO platform_settings(key,value,updated_by,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at").run(k, v, actor);
  const ph = LADDER_IDS.map(() => '?').join(',');
  if (db.prepare(`SELECT COUNT(*) n FROM plans WHERE id IN (${ph})`).get(...LADDER_IDS).n !== LADDER_IDS.length) throw new Error('The plan ladder is not fully present');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (on) {
      if (ladderState(db).on) { db.exec('COMMIT'); return; }
      // remember what was public so switching off puts it back
      const others = db.prepare(`SELECT id, visible, active FROM plans WHERE id NOT IN (${ph}) AND (visible=1 OR active=1)`).all(...LADDER_IDS);
      set('ladder_previous', JSON.stringify(others));
      db.prepare(`UPDATE plans SET visible=0, active=0, updated_at=datetime('now'), updated_by=? WHERE id NOT IN (${ph})`).run(actor, ...LADDER_IDS);
      db.prepare(`UPDATE plans SET visible=1, active=1, updated_at=datetime('now'), updated_by=? WHERE id IN (${ph})`).run(actor, ...LADDER_IDS);
    } else {
      db.prepare(`UPDATE plans SET visible=0, active=0, updated_at=datetime('now'), updated_by=? WHERE id IN (${ph})`).run(actor, ...LADDER_IDS);
      const prev = JSON.parse(db.prepare("SELECT value FROM platform_settings WHERE key='ladder_previous'").get()?.value || '[]');
      for (const r of prev) db.prepare("UPDATE plans SET visible=?, active=?, updated_at=datetime('now'), updated_by=? WHERE id=?").run(r.visible, r.active, actor, r.id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
