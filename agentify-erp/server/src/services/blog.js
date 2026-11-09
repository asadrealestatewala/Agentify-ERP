import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The public blog on the main (marketing) site: articles for people searching for CRM / ERP software.
// Articles are plain data in this file, so they ship with the app, are rendered into the HTML for search engines
// and need no database. Body blocks: { h } heading, { p } paragraph, { ul: [] } bullet list.

const BASE_POSTS = [
  {
    slug: 'real-estate-crm-for-brokerages',
    title: 'Real estate CRM for brokerages: what to look for before you buy',
    description: 'A practical checklist for choosing a real estate CRM: lead capture, follow-up reminders, pipelines, inventory, installments and reporting.',
    date: '2026-11-08', read: 6, tag: 'Real estate',
    body: [
      { p: 'Most brokerages start with a spreadsheet and a WhatsApp group. It works until the first month where ten agents are chasing the same lead, nobody remembers who promised a callback, and a buyer disappears because no one followed up in time. A real estate CRM exists to stop exactly that.' },
      { h: 'Start with the problems, not the feature list' },
      { p: 'Before comparing software, write down where deals are lost today. For most brokerages it is one of these four places:' },
      { ul: ['Enquiries arrive from many places (portals, Facebook, WhatsApp, walk-ins) and are not captured in one list.', 'Leads are not assigned, so everyone assumes someone else called.', 'Follow-ups depend on memory instead of reminders.', 'Owners cannot see which agent, source or project actually produces sales.'] },
      { h: 'What a good brokerage CRM should do' },
      { ul: ['Capture every enquiry automatically and put it in one inbox.', 'Assign leads to agents by rule or by hand, and show who owns what.', 'Set follow-up tasks and remind the agent before the lead goes cold.', 'Show a pipeline from new lead to site visit, negotiation and closed deal.', 'Keep property and project inventory next to the leads, so an agent can match a buyer to a unit in seconds.', 'Work well on a phone, because agents spend the day in the field.'] },
      { h: 'Do not stop at the CRM' },
      { p: 'A CRM tells you who is interested. It does not tell you what was paid, what is due next month, or what commission an agent has earned. Brokerages that sell on installments need payment plans, receipts and commissions connected to the same record as the lead. If these live in a separate system, someone re-types data every week and mistakes appear.' },
      { h: 'Questions to ask every vendor' },
      { ul: ['Can I try it with my own data before paying?', 'Does it support my country, currency and tax rules?', 'Can agents use it on Android and iPhone without training?', 'Who owns my data, and can I export it any time?', 'What happens to my leads if I leave?'] },
      { p: 'Agentify ERP combines the lead CRM with properties, sales, installments, commissions and accounts in one workspace, with a free trial so you can test it with your own team. Whatever you choose, run a one-week pilot with real leads before moving everyone over.' },
    ],
  },
  {
    slug: 'property-installment-tracking-software',
    title: 'How to track property installments without spreadsheets',
    description: 'Why spreadsheets fail for installment sales and how a payment-plan system keeps due dates, receipts and balances correct for every buyer.',
    date: '2026-11-08', read: 5, tag: 'Real estate',
    body: [
      { p: 'Selling plots, apartments or shops on installments creates years of paperwork per buyer. Each sale has a down payment, a schedule of instalments, sometimes a balloon payment, and often late or advance payments. A spreadsheet row per buyer cannot hold all this reliably for long.' },
      { h: 'Where spreadsheets break' },
      { ul: ['Someone edits a due date and the history is lost.', 'Receipts are issued in one file and balances kept in another.', 'No automatic reminder, so overdue accounts are found by accident.', 'When a buyer reschedules, nobody can tell what the original plan was.', 'Owners cannot quickly answer: how much is due this month across all projects?'] },
      { h: 'What an installment system should give you' },
      { ul: ['A payment plan per sale with every due date and amount generated up front.', 'Receipts that apply to the right instalment and update the balance instantly.', 'A list of overdue and upcoming payments, by buyer, project and month.', 'A saved history of reschedules and discounts.', 'Agent commission linked to the sale, so it is paid on what was actually collected.', 'Statements the buyer can see, so fewer calls reach your office.'] },
      { h: 'Collections is a daily habit' },
      { p: 'The best installment businesses review the due list every morning, message buyers before the date, and record the receipt the same day. Software makes this routine instead of a heroic monthly effort.' },
      { p: 'Agentify ERP builds the payment plan when a sale is created, issues receipts against it, and connects the result to commissions and accounting. You can try it free and import your existing buyers to see the difference.' },
    ],
  },
  {
    slug: 'construction-boq-and-budget-software',
    title: 'BOQ, budgets and cost control: a guide for construction companies',
    description: 'How contractors can link the bill of quantities, project budget, purchasing and progress billing so cost overruns show up early.',
    date: '2026-11-08', read: 6, tag: 'Construction',
    body: [
      { p: 'Cost overruns on construction projects rarely appear all at once. They creep in through materials bought above the estimate, extra labour days and variations that were never priced. The earlier you see the gap between plan and actual, the more you can do about it.' },
      { h: 'Start with a usable BOQ' },
      { p: 'The bill of quantities lists every work item with its quantity, unit and rate. It becomes the baseline for the whole project. A BOQ that lives only in a PDF or an isolated spreadsheet cannot be compared against what you really spend.' },
      { h: 'Connect four things' },
      { ul: ['The BOQ and project budget, split by work item or phase.', 'Purchasing: requests, orders and supplier bills charged to the project.', 'Site records: materials issued, labour and subcontractor work done.', 'Client billing: progress invoices based on completed work.'] },
      { p: 'When these four share one system, a purchase order shows immediately how much of the budget for that item is already spent.' },
      { h: 'Habits that catch overruns early' },
      { ul: ['Review budget against actual every week, not at month end.', 'Approve purchases against a budget line, not in a vacuum.', 'Record variations the day they are agreed and price them.', 'Keep subcontractor measurements and payments in one place.', 'Report progress with photos so the client bills match the site.'] },
      { p: 'Agentify ERP includes a construction management product with projects, BOQs, budgets, procurement, materials, labour, subcontractors and client billing. It is a good fit for small and mid-size contractors who have outgrown spreadsheets but do not want an enterprise system.' },
    ],
  },
  {
    slug: 'whatsapp-lead-follow-up-for-property-agents',
    title: 'WhatsApp lead follow-up: a simple routine for property agents',
    description: 'A step-by-step follow-up routine for property agents that uses WhatsApp, reminders and a CRM so fewer enquiries go cold.',
    date: '2026-11-08', read: 5, tag: 'Sales',
    body: [
      { p: 'In many markets, buyers prefer WhatsApp over email or phone calls. That is convenient, but conversations scattered across personal phones are invisible to the business. When an agent leaves, so does the history.' },
      { h: 'A routine that works' },
      { ul: ['Reply to every new enquiry quickly. The first responder often wins the visit.', 'Record the lead in the CRM with source, budget and area of interest.', 'Set the next follow-up date straight away, before leaving the conversation.', 'Send relevant listings, not the whole catalogue.', 'After a visit, follow up the same day with next steps.', 'Mark a lead lost only with a reason, so you can learn from it.'] },
      { h: 'What managers should watch' },
      { ul: ['Leads with no follow-up date.', 'Average time to first reply, by agent and source.', 'Visit-to-deal conversion, by agent and project.'] },
      { p: 'None of this needs complicated tools. It needs one place where every lead, message and next step is visible to the team, with reminders that fire on time. That is the point of a CRM built for real estate.' },
    ],
  },
  {
    slug: 'erp-for-small-real-estate-and-construction-businesses',
    title: 'Do small real estate and construction firms need an ERP?',
    description: 'When a growing property or construction business should move from spreadsheets and accounting software to an integrated ERP.',
    date: '2026-11-08', read: 5, tag: 'Business',
    body: [
      { p: 'ERP sounds like something for large companies with IT departments. In practice, a small firm feels the same pain earlier than it expects: the same data typed into three places, reports that never agree, and key knowledge sitting with one person.' },
      { h: 'Signs you have outgrown spreadsheets' },
      { ul: ['You enter the same sale or purchase in more than one file.', 'Month-end reports take days and still need corrections.', 'Only one person knows where things are saved.', 'You cannot tell which projects or agents are profitable.', 'Staff need access to some data but not all, and sharing files is risky.'] },
      { h: 'What "integrated" really means' },
      { p: 'An integrated system keeps sales, purchases, payroll, inventory and accounts in one database, so recording a transaction once updates everything that depends on it. Role-based access lets each person see only what they need.' },
      { h: 'How to adopt it without disruption' },
      { ul: ['Pick one area to start with, such as leads or a single project.', 'Import current data instead of retyping it.', 'Train two champions in the team first.', 'Run old and new side by side for a short, fixed period.', 'Expand module by module.'] },
      { p: 'A cloud ERP with a trial period lets you test this approach with little risk. Agentify ERP offers real estate and construction products on separate plans, so you only pay for what your business uses.' },
    ],
  },
];

const contentDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content');

/** "# heading", "* item" and plain lines to the block format used above. */
function parseBody(lines) {
  const out = [];
  for (const l of lines) {
    if (l.startsWith('# ')) out.push({ h: l.slice(2) });
    else if (l.startsWith('* ')) { const last = out[out.length - 1]; if (last?.ul) last.ul.push(l.slice(2)); else out.push({ ul: [l.slice(2)] }); }
    else out.push({ p: l });
  }
  return out;
}
const words = (blocks) => blocks.reduce((n, b) => n + (b.h || b.p || (b.ul || []).join(' ')).split(/\s+/).length, 0);

function loadExtra() {
  const posts = [];
  for (const f of fs.readdirSync(contentDir).filter((x) => /^blog-pk-.*\.json$/.test(x)).sort()) {
    for (const a of JSON.parse(fs.readFileSync(path.join(contentDir, f), 'utf8'))) {
      const body = parseBody(a.body);
      posts.push({ fresh: a.fresh === true, slug: a.slug, title: a.title, description: a.description, keyword: a.keyword, tag: a.tag, tags: a.tags || [], faq: a.faq || [], related: a.related || [], date: '2026-11-09', read: Math.max(2, Math.round(words(body) / 200)), body });
    }
  }
  return posts;
}

import { publishedPosts } from './blogStore.js';
import { BRAND, closingFor, BRAND_FAQ, isRomanUrdu, CLOSE_UR, HEAD_UR, BRAND_FAQ_UR } from './brandFacts.js';

const mentions = (v) => (JSON.stringify(v).match(/agentify/gi) || []).length;
/**
 * Makes sure a built-in article names the product: a short closing section when the body barely mentions it, a "What is Agentify ERP?"
 * answer in the FAQ (so it is in the FAQ schema too) and a brand tail on a short search description. Idempotent; the data files stay as written.
 */
export function brandify(p) {
  const out = { ...p };
  const ur = isRomanUrdu(p.slug);
  if (mentions(p.body) < 3) out.body = [...p.body, { h: ur ? HEAD_UR : `How ${BRAND} fits in` }, { p: ur ? CLOSE_UR : closingFor(p.tag, p.slug) }];
  if (!mentions(p.faq || [])) out.faq = [...(p.faq || []), ur ? BRAND_FAQ_UR : BRAND_FAQ];
  if (!ur && !/agentify/i.test(p.description) && p.description.length <= 135) out.description = `${p.description.replace(/\s*$/, '')} From ${BRAND}.`;
  return out;
}
const BUILT_IN = [...BASE_POSTS, ...loadExtra()].map(brandify);
/** Built-in articles. Use allPosts() to include the ones the blog agent published. */
export const BLOG_POSTS = BUILT_IN;
export const allPosts = () => { const extra = publishedPosts(); return extra.length ? [...BUILT_IN, ...extra.filter((e) => !BUILT_IN.some((b) => b.slug === e.slug))] : BUILT_IN; };
export { parseBody, words };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Unsplash photos picked by scripts/fetch-blog-photos.mjs: slug -> { raw, name, profile, page }. Articles without one use the illustration. */
const PHOTOS = (() => { try { return JSON.parse(fs.readFileSync(new URL('../content/blog-photos.json', import.meta.url), 'utf8')); } catch { return {}; } })();
const px = (raw, o) => `${raw}${raw.includes('?') ? '&' : '?'}auto=format&fit=crop&q=75&${o}`;
/**
 * Image for an article, with alt text that has the target keyword. With an Unsplash photo: hot-linked WebP and JPEG at 1600x900, a 800x450
 * version for the cards, a 1200x630 link-preview JPEG and the photographer credit. Without one: the files made by scripts/gen-blog-images.mjs.
 */
export const imageOf = (p) => {
  const alt = `${p.keyword ? `${p.keyword[0].toUpperCase()}${p.keyword.slice(1)}: ` : ''}${p.title}`;
  const ph = p.photo || PHOTOS[p.slug];
  if (!ph && (p.agent || p.fresh)) return { webp: BLOG_INDEX_OG, jpg: BLOG_INDEX_OG, og: BLOG_INDEX_OG, width: 1200, height: 630, alt };
  if (!ph) return { webp: `/blog-img/${p.slug}.webp`, jpg: `/blog-img/${p.slug}.jpg`, og: `/blog-img/${p.slug}-og.jpg`, width: 1600, height: 900, alt };
  return {
    webp: px(ph.raw, 'fm=webp&w=1600&h=900'), jpg: px(ph.raw, 'fm=jpg&w=1600&h=900'), og: px(ph.raw, 'fm=jpg&w=1200&h=630'),
    card: { webp: px(ph.raw, 'fm=webp&w=800&h=450'), jpg: px(ph.raw, 'fm=jpg&w=800&h=450') },
    width: 1600, height: 900, alt, credit: { name: ph.name, profile: ph.profile, page: ph.page },
  };
};
export const BLOG_INDEX_OG = '/blog-img/blog-index-og.jpg';

export const listPosts = () => [...allPosts()].sort((a, b) => (a.date < b.date ? 1 : -1)).map((p) => ({ slug: p.slug, title: p.title, description: p.description, date: p.date, read: p.read, tag: p.tag, image: imageOf(p) }));
export const getPost = (slug) => allPosts().find((p) => p.slug === slug) || null;
/** Titles of the related articles that exist, for the links under an article. */
export const relatedOf = (post) => (post.related || []).map((s) => allPosts().find((p) => p.slug === s)).filter(Boolean).map(({ slug, title }) => ({ slug, title }));
/** The article as the public page and API show it (adds the related-article titles). */
export const publicPost = (post) => ({ ...post, related: relatedOf(post), image: imageOf(post) });

/** The article body as HTML (used for the crawler-readable copy that is placed in the page on the server). */
export function bodyHtml(post) {
  const main = post.body.map((b) => (b.h ? `<h2>${esc(b.h)}</h2>` : b.ul ? `<ul>${b.ul.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p>${esc(b.p)}</p>`)).join('');
  const faq = (post.faq || []).length ? `<h2>Frequently asked questions</h2>${post.faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}` : '';
  const rel = relatedOf(post);
  const related = rel.length ? `<h2>Related articles</h2><ul>${rel.map((r) => `<li><a href="/blog/${r.slug}">${esc(r.title)}</a></li>`).join('')}</ul>` : '';
  const tags = (post.tags || []).length ? `<p>${post.tags.map(esc).join(' ')}</p>` : '';
  const img = imageOf(post);
  const hero = `<img src="${esc(img.jpg)}" width="${img.width}" height="${img.height}" alt="${esc(img.alt)}" />${img.credit ? `<p>Photo by <a href="${esc(img.credit.profile)}">${esc(img.credit.name)}</a> on <a href="https://unsplash.com/?utm_source=agentify_erp&utm_medium=referral">Unsplash</a></p>` : ''}`;
  return `<p>By ${BRAND} (<a href="/">agentifyerp.co</a>)</p>${hero}${main}${faq}${related}<p><a href="/real-estate">Real estate software</a> · <a href="/construction">Construction software</a> · <a href="/pricing">Pricing</a></p>${tags}`;
}
