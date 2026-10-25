import { all, get, run, getSetting, setSetting } from '../db.js';
import { now } from '../util.js';
import { currentTenant } from '../context.js';
import { DEFAULT_TOOLS } from '../../../shared/constructionTools.js';

let uid = 0;
const sec = (type, props) => ({ id: `s${Date.now().toString(36)}${(uid++).toString(36)}`, type, props });


/** Company, director and project information (from the company profile). Editable in the page builder; images ship with the site. */
const DIRECTOR_BIO = 'Raja Usman is the CEO of Expert Marketing & Developers, a real estate and property solutions company specializing in property sales, houses, plots, investment opportunities and land deals across Islamabad, Rawalpindi and surrounding developing projects.\n\nWe help clients find the right property according to their budget, location and investment goals, with professional guidance throughout the buying and selling process.';
const leadershipSec = () => sec('leadership', { title: 'Leadership & team', subtitle: 'The people behind Expert Marketing & Developers', members: [
  { name: 'Raja Usman', role: 'CEO · Expert Marketing & Developers', director: true, photo: '/site/raja-usman.jpg', bio: DIRECTOR_BIO, phone: '', email: '' },
] });
const projectInfoSec = () => sec('projectinfo', {
  title: 'Our projects', intro: 'We have successfully facilitated 200+ plot sales across Pakistan, connecting buyers with suitable residential and investment opportunities. Our experience spans multiple locations, helping clients make confident property decisions with professional guidance and reliable service.',
  stats: [{ value: '200+', label: 'Plot sales facilitated' }, { value: '13+', label: 'Plots & houses sold in B-17' }, { value: '9–10', label: 'Residential plots sold in CDA Sectors Alet' }, { value: '2–3', label: 'Houses sold in G-13' }],
  groups: [
    { heading: 'Ongoing projects', items: 'B-17 Islamabad | 13+ plots & houses and 2–3 apartments successfully sold\nCDA Sectors Alet | 9–10 residential plots successfully sold\nG-13 Islamabad | 2–3 residential houses successfully sold' },
    { heading: 'Personal projects', items: 'Dhamial\nChakri Road\nRanyal\nCapital Smart City\nKhan Village\nFaisal Town Phase 2\nFatima Jinnah Women University Area' },
  ] });
const COMPANY_SERVICES = [
  { icon: 'residential', title: 'Residential plots & houses', text: 'A wide range of houses and residential plots in prime and developing locations across Islamabad and Rawalpindi.', href: '/site/properties?purpose=Sell' },
  { icon: 'commercial', title: 'Commercial properties', text: 'Shops, offices and commercial plots for business and investment.', href: '/site/properties?purpose=Sell' },
  { icon: 'agricultural', title: 'Agricultural land deals', text: 'Reliable guidance on 5, 10, 20 Kanal and larger land parcels — from finding suitable land to negotiating and completing the transaction.', href: '/site/p/contact' },
  { icon: 'construction', title: 'Build your home', text: 'Turn-key house construction with a dated schedule and live progress updates.', href: '/site/calculators' },
];
const agriSec = () => sec('imagetext', { title: 'Agricultural land deals — 5, 10 & 20 Kanal', text: 'We provide professional solutions for agricultural land buying and selling, helping clients find suitable land for farming, investment and long-term development. Our services cover agricultural properties including 5 Kanal, 10 Kanal, 20 Kanal and larger land parcels in selected locations.\n\nWe assist clients throughout the process — from identifying suitable land and evaluating location to negotiating deals and completing transactions.', image: '/site/villa-sold.jpg', image_side: 'right', button_label: 'Ask about land', button_href: '/site/p/contact' });
const housesSec = () => sec('imagetext', { title: 'Residential plots & houses for sale', text: 'We offer a wide range of houses for sale and residential plots in prime and developing locations across Islamabad and Rawalpindi. Our portfolio includes quality residential houses and strategically located plots suitable for families, home construction, investment and long-term growth.\n\nWe help clients find the right property according to their budget, location and investment goals, with professional guidance throughout the buying and selling process.', image: '/site/residential-house.jpg', image_side: 'left', button_label: 'Browse properties', button_href: '/site/properties?purpose=Sell' });

/** The original company's website (the legacy install). New workspaces use genericConfig() below. */
export const LEGACY_CONFIG = {
  brand: { name: 'Expert Marketing & Developers', tagline: 'Plots · Homes · Construction', logo: '' },
  theme: { primary: '#0f766e', accent: '#f59e0b', dark: '#0a3d3a', bg: '#ffffff', soft: '#f4f7f6', font_heading: 'Poppins', font_body: 'Inter', radius: 12 },
  header: {
    links: [{ label: 'Buy', href: '/site/properties?purpose=Sell' }, { label: 'Rent', href: '/site/properties?purpose=Rent' }, { label: 'Projects', href: '/site/projects' }, { label: 'Calculators', href: '/site/calculators' }, { label: 'Agents', href: '/site/agents' }, { label: 'Blog', href: '/site/blog' }, { label: 'About', href: '/site/p/about' }, { label: 'Contact', href: '/site/p/contact' }],
    cta_label: 'Sign in', cta_href: '/login', sticky: true, show_phone: true,
  },
  footer: {
    about: 'Expert Marketing & Developers plans, builds and sells residential and commercial communities with transparent installment plans and on-site progress you can follow online.',
    columns: [
      { title: 'Explore', links: [{ label: 'Properties for sale', href: '/site/properties?purpose=Sell' }, { label: 'Properties for rent', href: '/site/properties?purpose=Rent' }, { label: 'Our projects', href: '/site/projects' }, { label: 'Agents', href: '/site/agents' }] },
      { title: 'Tools', links: [{ label: 'Payment milestones', href: '/site/calculators?tab=milestones' }, { label: 'Construction calculator', href: '/site/calculators?tab=cost' }, { label: 'Blog', href: '/site/blog' }] },
      { title: 'Services', links: [{ label: 'Residential plots & houses', href: '/site/properties?purpose=Sell' }, { label: 'Commercial properties', href: '/site/properties?type=Commercial' }, { label: 'Agricultural land', href: '/site/p/contact' }, { label: 'House construction', href: '/site/calculators' }] },
      { title: 'Company', links: [{ label: 'About us', href: '/site/p/about' }, { label: 'Contact', href: '/site/p/contact' }, { label: 'Customer portal', href: '/portal/login' }, { label: 'Vendor portal', href: '/vendor/login' }] },
    ],
    show_cta: true, cta_title: 'Buying, selling or building a home?', cta_text: 'Talk to our team — we will match you with the right property and the right agent.', show_hours: true, show_map: true,
    copyright: '© {year} Expert Marketing & Developers. All rights reserved.', show_social: true,
  },
  social: [{ platform: 'Facebook', url: 'https://www.facebook.com/expertmarketingdev' }, { platform: 'Instagram', url: 'https://www.instagram.com/Expertmarketingdev' }, { platform: 'WhatsApp', url: 'https://wa.me/923005551350' }],
  contact: { phone: '0300-5551350', landline: '051-5575280', email: 'info@expertdevelopers.pk', whatsapp: '0300-5551350', address: 'Abdul Majeed Plaza, Main Chakri Road, Peer Mehar Ali Shah Town, Near Royal Grand Marquee, Rawalpindi', hours: 'Mon–Sat, 9am – 6pm' },
  calculators: {
    show_installment: false,
    tools: DEFAULT_TOOLS,
    construction: {
      unit: 'sq ft', rates: { Economy: 2800, Standard: 3500, Premium: 4800, Luxury: 6500 },
      breakdown: [{ label: 'Structure (foundation, slab, masonry)', pct: 42 }, { label: 'Finishing (plaster, paint, tiles)', pct: 24 }, { label: 'Electrical & plumbing', pct: 14 }, { label: 'Woodwork & fittings', pct: 12 }, { label: 'Labour & supervision', pct: 8 }],
      floor_extra_pct: 0, basement_rate: 2200, note: 'Estimates are indicative. Final cost depends on design, site and material prices.',
    },
    installment: { default_years: 3, max_years: 10, default_down_pct: 25, markup_pct: 0, note: 'Indicative plan. Actual installment plans are set in your sale agreement.' },
  },
  listing: { show_agent: true, per_page: 12, show_sold: false },
  bot: { enabled: true, name: 'Expert Assistant', greeting: 'Assalam o Alaikum! I can answer questions about our projects, properties, construction costs and company. How can I help?', quick_replies: ['Show featured properties', 'Construction cost', 'Our projects', 'Contact details', 'Talk to an agent'], lead_after: 2 },
  seo: { keywords: 'real estate Islamabad, plots for sale Rawalpindi, houses for sale Islamabad, agricultural land Pakistan, house construction, property investment', base_url: '', noindex: false, org_type: 'RealEstateAgent', image: '', title: 'Expert Marketing & Developers — Plots, Homes & Construction', description: 'Browse plots, houses and commercial properties, view our projects and plan your purchase with installment and construction calculators.' },
};

function legacyPages() {
  return [
    { slug: 'home', title: 'Home', show_in_menu: 0, sort_order: 0, seo_title: 'Plots, Houses & Land for Sale in Islamabad & Rawalpindi', seo_desc: 'Browse verified plots, houses, commercial properties and agricultural land in Islamabad and Rawalpindi with flexible installment plans and live project updates.', sections: [
      sec('hero', { headline: 'Find your place with Expert Marketing & Developers', subheadline: 'Plots, homes and commercial spaces in planned communities — with flexible installment plans and live progress updates.', image: '', overlay: 55, show_search: true, height: 'tall', cta_label: 'Explore projects', cta_href: '/site/projects' }),
      sec('stats', { items: [{ value: '200+', label: 'Plot sales facilitated' }, { value: '3', label: 'Ongoing projects' }, { value: '7', label: 'Personal projects' }, { value: '5–20 Kanal', label: 'Agricultural land deals' }] }),
      sec('listings', { title: 'Featured properties', subtitle: 'Hand-picked by our team', source: 'featured', limit: 8, layout: 'carousel', view_all_href: '/site/properties' }),
      sec('projects', { title: 'Our projects', subtitle: 'Planned communities with progress you can follow online', limit: 3 }),
      sec('services', { title: 'How we can help', items: COMPANY_SERVICES }),
      housesSec(),
      leadershipSec(),
      projectInfoSec(),
      sec('calculators', { title: 'Plan your purchase and your build', subtitle: 'Work out a monthly installment or estimate construction cost in seconds.' }),
      sec('listings', { title: 'Latest listings', subtitle: 'Newly added by our listing agents', source: 'latest', limit: 8, layout: 'grid', view_all_href: '/site/properties' }),
      sec('agents', { title: 'Meet our listing agents', subtitle: 'Call or message the agent directly', limit: 4 }),
      sec('testimonials', { title: 'What our customers say', items: [{ name: 'Muhammad Ali', role: 'Plot owner', quote: 'Every installment and receipt is on my portal. I always know where my money stands.' }, { name: 'Sara Khan', role: 'Homeowner', quote: 'We bought the plot and had the house built together — one monthly payment, one team.' }, { name: 'Bilal Ahmed', role: 'Investor', quote: 'Clear paperwork, quick responses and regular site updates.' }] }),
      sec('blog', { title: 'From the blog', limit: 3 }),
      sec('cta', { headline: 'Ready to find or list a property?', text: 'Talk to our team today — we will match you with the right agent.', button_label: 'Contact us', button_href: '/site/p/contact', image: '', tone: 'dark' }),
    ] },
    { slug: 'about', title: 'About us', show_in_menu: 0, sort_order: 1, seo_title: 'About Expert Marketing & Developers — Real Estate Experts', seo_desc: 'Led by CEO Raja Usman, Expert Marketing & Developers has facilitated 200+ plot sales across Islamabad and Rawalpindi. Meet our team and see our projects.', sections: [
      sec('banner', { text: 'About Expert Marketing & Developers', href: '', tone: 'primary' }),
      sec('imagetext', { title: 'Expert Marketing & Developers', text: 'Expert Marketing & Developers is a real estate and property solutions company led by Raja Usman, CEO, specializing in property sales, houses, plots, investment opportunities and land deals across Islamabad, Rawalpindi and surrounding developing projects.\n\n**What we do**\n- Plots for sale\n- Houses for sale\n- Commercial properties\n- Agricultural land\n- Property deals\n\nOur customers see their payment plan, receipts and construction progress online, and our agents guide every step.', image: '/site/residential-house.jpg', image_side: 'right', button_label: '', button_href: '' }),
      leadershipSec(),
      housesSec(),
      projectInfoSec(),
      agriSec(),
      sec('stats', { items: [{ value: '200+', label: 'Plot sales facilitated' }, { value: '3', label: 'Ongoing projects' }, { value: '7', label: 'Personal projects' }] }),
      sec('cta', { headline: 'Visit our office', text: 'We would love to meet you.', button_label: 'Get directions', button_href: '/site/p/contact', image: '', tone: 'primary' }),
    ] },
    { slug: 'contact', title: 'Contact', show_in_menu: 0, sort_order: 2, seo_title: 'Contact Expert Marketing & Developers — Call, Chat, Visit', seo_desc: 'Call, WhatsApp or visit our Rawalpindi office, or send an enquiry and a sales agent will contact you about plots, houses, land and construction.', sections: [
      sec('banner', { text: 'Contact us', href: '', tone: 'primary' }),
      sec('contact', { title: 'Send us a message', text: 'Tell us what you are looking for and the right agent will call you back.', show_form: true, show_details: true }),
      sec('faq', { title: 'Frequently asked questions', items: [{ q: 'Can I buy on installments?', a: 'Yes. Most plots and houses have installment plans. Use the installment calculator to estimate a monthly amount.' }, { q: 'Can you build a house on my plot?', a: 'Yes. We offer construction contracts and can combine the plot and construction into one monthly payment.' }, { q: 'How do I follow my payments and construction progress?', a: 'After purchase you get a customer portal login with your ledger, receipts and dated build schedule.' }] }),
    ] },
  ];
}

export function demoPosts() {
  return [
    { slug: 'how-installment-plans-work', title: 'How installment plans work on a plot purchase', excerpt: 'Booking, monthly installments and balloon payments explained in plain language.', tags: ['guide', 'installments'], body: 'Buying a plot on installments is simple once you know the three parts of a plan.\n\n**1. Booking.** An upfront payment that reserves your plot.\n\n**2. Monthly installments.** Equal payments over a fixed period.\n\n**3. Balloon payments.** Occasional larger payments — for example every six months.\n\nUse our installment calculator to see what your monthly amount could look like.' },
    { slug: 'construction-cost-per-square-foot', title: 'What does house construction cost per square foot?', excerpt: 'A quick guide to grade-wise construction rates and what is included.', tags: ['construction', 'guide'], body: 'Construction cost depends mostly on the **grade of finishing** you choose.\n\n- **Economy** — basic finishing\n- **Standard** — good-quality fittings\n- **Premium** — better materials and woodwork\n- **Luxury** — imported fittings and custom design\n\nTry the construction calculator for an estimate and a cost breakdown.' },
    { slug: 'why-follow-your-build-online', title: 'Why we publish a dated schedule for every house', excerpt: 'Footing, slab, masonry and finishing — each with a start and due date.', tags: ['construction', 'transparency'], body: 'Every construction contract has a schedule: footing work, slab work, scaffolding, masonry, plaster, finishing and more.\n\nEach activity has a **start date** and a **due date**, and your completion percentage is calculated automatically from those dates — if anything runs late, you see it in your portal.' },
  ];
}

/**
 * One-time upgrade for websites created before the company profile existed: adds the director, project-information and
 * agricultural-land sections to the Home and About pages (never touches a page that already has them).
 */
export function upgradeSite() {
  if (getSetting('site_upgrade_v1')) return;
  if (isGeneric()) { setSetting('site_upgrade_v1', '1'); return; }
  const add = (slug, build, after) => {
    const row = get('SELECT id, sections FROM site_pages WHERE slug=?', slug);
    if (!row) return;
    const secs = JSON.parse(row.sections || '[]');
    if (secs.some((x) => x.type === 'leadership')) return;
    const at = after ? secs.findIndex((x) => x.type === after) : -1;
    secs.splice(at >= 0 ? at + 1 : secs.length - 1, 0, ...build());
    run('UPDATE site_pages SET sections=?, updated_at=? WHERE id=?', JSON.stringify(secs), now(), row.id);
  };
  add('home', () => [leadershipSec(), projectInfoSec()], 'services');
  add('about', () => [leadershipSec(), housesSec(), projectInfoSec(), agriSec()], 'imagetext');
  setSetting('site_upgrade_v1', '1');
}

/** One-time colour harmony fix: the old default used a navy that clashed with the teal brand colour. */
export function upgradeSiteTheme() {
  if (getSetting('site_upgrade_v2')) return;
  const saved = getSetting('site_config');
  if (saved) {
    try {
      const c = JSON.parse(saved);
      if (c.theme && String(c.theme.dark).toLowerCase() === '#0b1f33') { c.theme.dark = '#0a3d3a'; setSetting('site_config', JSON.stringify(c)); }
    } catch { /* leave a hand-edited config alone */ }
  }
  setSetting('site_upgrade_v2', '1');
}


/** Starter answers for the website assistant — all taken from what the website already says; the Website Manager can edit or add more. */
export const STARTER_KB = [
  { title: 'Can I buy a plot or house on installments?', category: 'Pricing & plans', keywords: 'installment instalment monthly booking advance balloon payment plan easy', link: '/site/calculators', content: 'Yes. Most of our plots and houses are available on installment plans made of a booking amount, an advance, monthly installments and, where agreed, balloon payments. The exact plan is written in your sale agreement, and every installment and receipt appears on your customer portal.' },
  { title: 'Can you build a house on my plot?', category: 'Construction', keywords: 'build construct construction contractor grey structure turnkey house', link: '/site/calculators', content: 'Yes. We offer construction contracts — grey structure, semi-finished or turnkey — with a dated schedule and progress you can follow online. You can also combine the plot and the house in one monthly payment plan. Use our calculators for a cost, material and payment-milestone estimate.' },
  { title: 'How do I see my payments and construction progress?', category: 'Buying process', keywords: 'portal login receipt ledger statement progress track customer', link: '/portal/login', content: 'Customers get their own portal where they can see their plot or house, payment plan, receipts, ledger, documents and construction progress at any time.' },
  { title: 'How can I visit a project or meet an agent?', category: 'Buying process', keywords: 'visit site tour appointment meet office agent schedule', link: '/site/p/contact', content: 'Leave your name and number here in the chat, or call our office, and a sales agent will arrange a site visit at a time that suits you. Our office address and hours are on the Contact page.' },
  { title: 'Can overseas Pakistanis buy or build with you?', category: 'Buying process', keywords: 'overseas abroad expatriate nri remote', link: '/site/p/contact', content: 'Yes. Because your payment plan, receipts and construction progress are available online, you can buy or build from anywhere. Contact us and an agent will guide you through the process remotely.' },
  { title: 'Which areas do you work in?', category: 'Company', keywords: 'areas locations cities islamabad rawalpindi where', link: '/site/projects', content: 'We work across Islamabad, Rawalpindi and surrounding developing projects — plots, houses, commercial properties and agricultural land. See the Projects page for what we are currently offering.' },
];

/** Installs the starter website once (idempotent). */
export function ensureSite({ withPosts = false } = {}) {
  if (!getSetting('site_config')) setSetting('site_config', JSON.stringify(defaultConfig()));
  if (!get('SELECT 1 FROM site_pages LIMIT 1')) {
    for (const p of defaultPages()) {
      run('INSERT INTO site_pages(slug,title,sections,published,seo_title,seo_desc,sort_order,show_in_menu,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', p.slug, p.title, JSON.stringify(p.sections), 1, p.seo_title, p.seo_desc, p.sort_order, p.show_in_menu, now());
    }
  }
  upgradeSite();
  scrubInheritedSite();
  upgradeSiteTheme();
  if (!getSetting('bot_kb_seeded')) {
    if (!isGeneric() && !get('SELECT 1 FROM bot_kb LIMIT 1')) for (const k of STARTER_KB) run('INSERT INTO bot_kb(title,category,content,keywords,link,active,created_at) VALUES(?,?,?,?,?,1,?)', k.title, k.category, k.content, k.keywords, k.link, now());
    setSetting('bot_kb_seeded', '1');
  }
  if (withPosts && !isGeneric() && !get('SELECT 1 FROM site_posts LIMIT 1')) {
    for (const p of demoPosts()) {
      run('INSERT INTO site_posts(slug,title,excerpt,body,cover,tags,published,published_at,created_at) VALUES(?,?,?,?,?,?,1,?,?)', p.slug, p.title, p.excerpt, p.body, '', JSON.stringify(p.tags), now(), now());
    }
  }
}

// ---------------------------------------------------------------- neutral defaults for SaaS workspaces
// The starter website above describes the original company (its people, phone numbers, address, results and customer
// quotes). A new customer workspace must never inherit any of that, so every workspace other than the original install
// starts from these neutral defaults built from its own company name and product. Nothing here makes claims about the
// customer's business: sections that need real facts (team, figures, testimonials) are left for the customer to add.
const isGeneric = () => { const t = currentTenant(); return !!t && !t.is_legacy; };
const companyName = () => getSetting('company_name') || currentTenant()?.name || 'Our company';
const productOf = () => currentTenant()?.product || 'real_estate';

export function genericConfig(name = companyName(), product = productOf()) {
  const construction = product === 'construction';
  const c = JSON.parse(JSON.stringify(LEGACY_CONFIG));
  c.brand = { name, tagline: '', logo: '' };
  c.header.links = construction
    ? [{ label: 'Projects', href: '/site/projects' }, { label: 'Calculators', href: '/site/calculators' }, { label: 'About', href: '/site/p/about' }, { label: 'Contact', href: '/site/p/contact' }]
    : [{ label: 'Buy', href: '/site/properties?purpose=Sell' }, { label: 'Rent', href: '/site/properties?purpose=Rent' }, { label: 'Projects', href: '/site/projects' }, { label: 'Agents', href: '/site/agents' }, { label: 'Contact', href: '/site/p/contact' }];
  c.footer.about = `${name}.`;
  c.footer.columns = [
    { title: 'Explore', links: construction ? [{ label: 'Projects', href: '/site/projects' }, { label: 'Construction calculator', href: '/site/calculators?tab=cost' }] : [{ label: 'Properties for sale', href: '/site/properties?purpose=Sell' }, { label: 'Properties for rent', href: '/site/properties?purpose=Rent' }, { label: 'Projects', href: '/site/projects' }] },
    { title: 'Company', links: [{ label: 'About us', href: '/site/p/about' }, { label: 'Contact', href: '/site/p/contact' }, { label: construction ? 'Client portal' : 'Customer portal', href: '/portal/login' }] },
  ];
  c.footer.cta_title = 'Have a question?'; c.footer.cta_text = 'Send us a message and our team will get back to you.';
  c.footer.copyright = `© {year} ${name}. All rights reserved.`;
  c.social = [];
  c.contact = { phone: '', landline: '', email: '', whatsapp: '', address: '', hours: '', map_embed: '' };
  c.bot = { ...c.bot, name: 'Assistant', greeting: `Hello! Ask me about ${name}.`, quick_replies: construction ? ['Our projects', 'Construction cost', 'Contact details'] : ['Show featured properties', 'Our projects', 'Contact details'] };
  c.seo = { ...c.seo, keywords: '', title: name, description: '', image: '', org_type: construction ? 'GeneralContractor' : 'RealEstateAgent' };
  return c;
}

export function genericPages(name = companyName(), product = productOf()) {
  const construction = product === 'construction';
  return [
    { slug: 'home', title: 'Home', show_in_menu: 0, sort_order: 0, seo_title: name, seo_desc: '', sections: [
      sec('hero', { headline: `Welcome to ${name}`, subheadline: construction ? 'Tell visitors what you build and where you work.' : 'Tell visitors what you sell and where you work.', image: '', overlay: 55, show_search: !construction, height: 'tall', cta_label: 'Contact us', cta_href: '/site/p/contact' }),
      ...(construction ? [] : [sec('listings', { title: 'Featured properties', subtitle: '', source: 'featured', limit: 8, layout: 'carousel', view_all_href: '/site/properties' })]),
      sec('projects', { title: 'Our projects', subtitle: '', limit: 3 }),
      sec('calculators', { title: construction ? 'Estimate your build' : 'Plan your purchase', subtitle: '' }),
      sec('cta', { headline: 'Get in touch', text: 'Send us a message and our team will get back to you.', button_label: 'Contact us', button_href: '/site/p/contact', image: '', tone: 'dark' }),
    ] },
    { slug: 'about', title: 'About us', show_in_menu: 0, sort_order: 1, seo_title: `About ${name}`, seo_desc: '', sections: [
      sec('banner', { text: `About ${name}`, href: '', tone: 'primary' }),
      sec('imagetext', { title: name, text: 'Describe your company, your experience and your team here.', image: '', image_side: 'right' }),
    ] },
    { slug: 'contact', title: 'Contact', show_in_menu: 0, sort_order: 2, seo_title: `Contact ${name}`, seo_desc: '', sections: [
      sec('banner', { text: 'Contact us', href: '', tone: 'primary' }),
      sec('contact', { title: 'Send us a message', text: 'Tell us what you are looking for and we will get back to you.', show_form: true, show_details: true }),
    ] },
  ];
}

/** The defaults for the current workspace: the original company's site for the original install, neutral otherwise. */
export const defaultConfig = () => (isGeneric() ? genericConfig() : LEGACY_CONFIG);
export const defaultPages = () => (isGeneric() ? genericPages() : legacyPages());

/** @deprecated use defaultConfig(): kept for older imports. */
export const DEFAULT_CONFIG = LEGACY_CONFIG;

/**
 * One-time clean-up for customer workspaces created before the neutral defaults existed: they were seeded with the
 * original company's name, contact details, people, figures, quotes and assistant answers. Only values that are still
 * exactly the inherited defaults are replaced or removed; anything the customer changed is kept.
 */
const LEGACY_NAME = 'Expert Marketing & Developers';
const LEGACY_MARKERS = ['Raja Usman', '200+', 'Muhammad Ali', 'Sara Khan', 'expertdevelopers', '0300-5551350'];
export function scrubInheritedSite() {
  if (!isGeneric() || getSetting('site_scrub_v1')) return;
  const L = LEGACY_CONFIG, G = genericConfig();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let saved = null;
  try { saved = JSON.parse(getSetting('site_config') || 'null'); } catch { saved = null; }
  if (saved) {
    if (saved.brand?.name === L.brand.name) saved.brand = { ...saved.brand, name: G.brand.name, tagline: saved.brand.tagline === L.brand.tagline ? '' : saved.brand.tagline };
    if (same(saved.contact, L.contact)) saved.contact = G.contact;
    if (same(saved.social, L.social)) saved.social = G.social;
    if (saved.footer) for (const k of ['about', 'copyright']) if (saved.footer[k] === L.footer[k]) saved.footer[k] = G.footer[k];
    if (saved.seo?.title === L.seo.title) saved.seo = { ...saved.seo, title: G.seo.title, description: G.seo.description, keywords: G.seo.keywords };
    if (saved.bot?.name === L.bot.name) saved.bot = { ...saved.bot, name: G.bot.name, greeting: G.bot.greeting };
    setSetting('site_config', JSON.stringify(saved));
  }
  const name = companyName();
  for (const pg of all('SELECT id, sections, seo_title, seo_desc FROM site_pages')) {
    let secs = [];
    try { secs = JSON.parse(pg.sections || '[]'); } catch { continue; }
    const kept = secs.filter((x) => !(['leadership', 'projectinfo', 'stats', 'testimonials'].includes(x.type) && LEGACY_MARKERS.some((m) => JSON.stringify(x.props || {}).includes(m))))
      .map((x) => JSON.parse(JSON.stringify(x).split(LEGACY_NAME).join(name)));
    const fix = (t) => (t && (t.includes(LEGACY_NAME) || LEGACY_MARKERS.some((m) => t.includes(m))) ? name : t);
    run('UPDATE site_pages SET sections=?, seo_title=?, seo_desc=? WHERE id=?', JSON.stringify(kept), fix(pg.seo_title), pg.seo_desc && (pg.seo_desc.includes(LEGACY_NAME) || LEGACY_MARKERS.some((m) => pg.seo_desc.includes(m))) ? '' : pg.seo_desc, pg.id);
  }
  for (const k of STARTER_KB) run('DELETE FROM bot_kb WHERE title=? AND content=?', k.title, k.content);
  setSetting('site_scrub_v1', '1');
}
