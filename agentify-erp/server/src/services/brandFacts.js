// What the blog may truthfully say about Agentify ERP. The blog agent is given ONLY these facts about the product, and the quality
// checks reject claims outside them (rankings, awards, customer counts, testimonials, prices). Edit this file when the product changes.
export const BRAND = 'Agentify ERP';
export const DOMAIN = 'agentifyerp.co';
export const SUMMARY = 'Agentify ERP is a cloud CRM and ERP for real estate agencies and construction companies. It runs in the browser and has an Android app.';
export const FACTS = [
  'Two products: Real Estate (brokerage management) and Construction (project management). Each has its own plans, and a company picks the one it needs.',
  'Real Estate covers leads and follow-ups, property and project inventory, sales, installment plans with receipts, agent commissions, accounting, a customer portal and a website for the agency.',
  'Construction covers projects and sites, bills of quantities (BOQ) and budgets, purchasing, materials, labour and subcontractors, client progress billing and a project schedule.',
  'Sales, receipts, expenses, vendor payments, commissions and salaries post to one double-entry accounting ledger, so reports come from the same records the team works in.',
  'A sale builds its installment schedule and receipts are applied to the right installment; commissions follow rules set by the company.',
  'Access is controlled by roles (for example sales agents see only their own leads and sales), and every change is logged.',
  'It has an AI assistant called Ask that answers how-to and data questions, including in Roman Urdu, and an AI writer for property descriptions.',
  'It works in the browser and there is an Android app. Regional packs exist for Pakistan, the US, the UK, the UAE and Canada.',
  'New companies can start with a free trial (7 days) with their own data before paying.',
];
/** Things the writer must never say about Agentify ERP (also enforced by the checks). */
export const FORBIDDEN_CLAIMS = /\b(?:#1|number one|no\.? ?1|best[- ]selling|market leader|leading (?:provider|software|platform)|award[- ]winning|trusted by (?:thousands|hundreds|\d)|\d[\d,]*\+? (?:customers|clients|companies|users|agencies)|guaranteed (?:results|ranking|roi)|100% (?:secure|safe|uptime)|rated \d)/i;
export const BRAND_RULES = `About ${BRAND} (${DOMAIN}): ${SUMMARY} Facts you may use, and no others: ${FACTS.map((f, i) => `(${i + 1}) ${f}`).join(' ')} Never claim rankings, awards, customer numbers, testimonials, uptime, security certifications or prices. Never name or criticise competitor products; compare approaches (spreadsheets, a generic CRM, a portal's bundled tools) and say honestly when another approach fits better.`;

/** Closing paragraph for built-in articles, by tag and a stable variant number. Plain facts from the list above. */
const CLOSE = {
  'Real estate': [
    'Agentify ERP is built for exactly this kind of work: leads, property inventory, installment plans, receipts, commissions and accounts live in one cloud workspace, so the office stops re-typing the same record.',
    'Agentify ERP keeps the lead, the sale, the installment schedule and the receipt connected, so an agent, a manager and the accountant look at the same numbers.',
  ],
  Construction: [
    'Agentify ERP has a construction product with projects, BOQs and budgets, purchasing, labour and subcontractors, and client billing in one system, so cost control does not depend on separate spreadsheets.',
    'Agentify ERP links the BOQ and budget to purchasing, site records and progress billing, which is what lets a contractor see a cost overrun while it can still be fixed.',
  ],
  Sales: [
    'Agentify ERP puts every enquiry, follow-up and next step for the team in one place, with reminders, so fewer property leads go cold.',
    'Agentify ERP gives the whole sales team one lead list with owners, follow-up dates and pipeline stages, and keeps it connected to properties, sales and payments.',
  ],
  Business: [
    'Agentify ERP is a cloud ERP for real estate and construction companies; you can start with a free trial using your own data and add modules as the business grows.',
    'Agentify ERP is made for small and mid-size property and construction firms that have outgrown spreadsheets: one workspace for leads, projects, money and reports, with roles for each person.',
  ],
};
export const closingFor = (tag, slug) => { const list = CLOSE[tag] || CLOSE.Business; let h = 0; for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0; return list[h % list.length]; };
export const BRAND_FAQ = ['What is Agentify ERP?', `${SUMMARY} It covers leads, properties, sales, installments, accounting and a customer portal for real estate, and projects, BOQs, purchasing and client billing for construction. You can try it free at ${DOMAIN}.`];

/** The same pieces in Roman Urdu for the articles written in Roman Urdu. */
export const isRomanUrdu = (slug) => /roman-urdu/.test(slug);
export const CLOSE_UR = `${BRAND} real estate aur construction companies ke liye cloud CRM aur ERP hai: leads, properties, installments, receipts aur accounts aik hi jagah rehte hain, taake wohi data bar bar dobara type na karna pare.`;
export const HEAD_UR = `${BRAND} is kaam mein kahan fit hota hai`;
export const BRAND_FAQ_UR = [`${BRAND} kya hai?`, `${BRAND} real estate agencies aur construction companies ke liye cloud CRM aur ERP hai. Ye browser mein chalta hai aur Android app bhi hai. Aap ${DOMAIN} par free trial try kar sakte hain.`];
