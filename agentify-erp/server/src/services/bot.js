import { all, get, run } from '../db.js';
import { jparse, now } from '../util.js';
import { livePages } from './siteRelease.js';
import { estimateCost, DEFAULT_TOOLS } from '../../../shared/constructionTools.js';

/**
 * Website assistant. No external AI service: it answers from a knowledge bank made of
 *  1. entries the website team writes (table bot_kb), and
 *  2. everything already on the website — company details, page content, FAQs, live projects and featured listings, calculator rates.
 * Questions it cannot answer are logged (bot_chats.matched = 0) so the team can add an answer.
 */

const STOP = new Set('a an the is are was were be been am do does did to of in on at for from with and or but if then so as it its this that these those i me my we our you your please can could would should will shall may might about tell show give need want know have has had there here what which who whom how any some more much many also just like get let us'.split(' '));
const stem = (w) => w.replace(/(ing|ed|es|s)$/, (m, s, i) => (w.length - m.length >= 3 ? '' : m));
const SYN = { payment: 'pay', paid: 'pay', paying: 'pay', instalment: 'installment', installment: 'installment', purchase: 'buy', buying: 'buy', bought: 'buy', price: 'cost', rate: 'cost', pricing: 'cost', construct: 'build', construction: 'build', building: 'build', home: 'house', homes: 'house', houses: 'house', flat: 'apartment', ceo: 'director', owner: 'director', founder: 'director' };
export const tokens = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9؀-ۿ\s-]/g, ' ').split(/\s+/).map((w) => w.replace(/^-+|-+$/g, '')).filter((w) => w && (w.length > 1 || /\d/.test(w)) && !STOP.has(w)).map((w) => SYN[w] || SYN[stem(w)] || stem(w));

const money = (v) => { const n = Number(v || 0); if (!n) return 'price on request'; return n >= 1e7 ? `PKR ${+(n / 1e7).toFixed(2)} crore` : n >= 1e5 ? `PKR ${+(n / 1e5).toFixed(2)} lakh` : `PKR ${n.toLocaleString('en-PK')}`; };
const strip = (t) => String(t || '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[#\-\s]+/gm, '').replace(/\n{2,}/g, '\n').trim();
const oneLine = (t) => strip(t).replace(/\s*\n\s*/g, ' ');

/** Everything the assistant knows, as {id,title,text,link,source,boost,keywords}. */
export function buildKnowledge(cfg) {
  const docs = [];
  const add = (d) => { if (d.text && String(d.text).trim()) docs.push({ boost: 1, keywords: '', link: '', ...d, text: oneLine(d.text) }); };
  for (const k of all('SELECT * FROM bot_kb WHERE active=1 ORDER BY id')) add({ id: `kb${k.id}`, title: k.title, text: k.content, keywords: k.keywords || '', link: k.link || '', source: 'Knowledge bank', boost: 1.6 });

  const c = cfg.contact || {};
  add({ id: 'contact', title: 'Contact details, office address and opening hours', keywords: 'phone number call whatsapp email address office location timing hours open visit reach',
    text: `You can call us on ${c.phone || ''}${c.landline ? ` or ${c.landline}` : ''}, WhatsApp ${c.whatsapp || c.phone || ''}, or email ${c.email || ''}. Our office is at ${c.address || ''}. Opening hours: ${c.hours || ''}.`, link: '/site/p/contact', source: 'Company', boost: 1.3 });
  add({ id: 'company', title: `About ${cfg.brand?.name || 'the company'}`, text: cfg.footer?.about || '', link: '/site/p/about', source: 'Company' });

  // what visitors can read: the published release of the website, not unpublished edits
  for (const pg of livePages()) {
    const link = pg.slug === 'home' ? '/site' : `/site/p/${pg.slug}`;
    for (const s of pg.sections || []) {
      const p = s.props || {};
      if (s.type === 'text') add({ id: `${pg.slug}-${s.id}`, title: p.title || pg.title, text: p.html, link, source: `Page: ${pg.title}` });
      else if (s.type === 'imagetext') add({ id: `${pg.slug}-${s.id}`, title: p.title, text: p.text, link, source: `Page: ${pg.title}` });
      else if (s.type === 'faq') for (const [i, q] of (p.items || []).entries()) add({ id: `${pg.slug}-${s.id}-${i}`, title: q.q, text: q.a, link, source: 'FAQ', boost: 1.4 });
      else if (s.type === 'services') for (const [i, q] of (p.items || []).entries()) add({ id: `${pg.slug}-${s.id}-${i}`, title: q.title, text: q.text, link: q.href || link, source: 'Services' });
      else if (s.type === 'leadership') for (const [i, m] of (p.members || []).entries()) add({ id: `${pg.slug}-${s.id}-m${i}`, title: `${m.name} — ${m.role}`, keywords: `${m.director ? 'director ceo owner founder management leadership team' : 'team staff'}`, text: m.bio || `${m.name} is ${m.role}.`, link, source: 'Team', boost: 1.2 });
      else if (s.type === 'projectinfo') {
        add({ id: `${pg.slug}-${s.id}-intro`, title: p.title || 'Our track record', keywords: 'experience sold sales track record achievements', text: `${p.intro || ''} ${(p.stats || []).map((x) => `${x.value} ${x.label}`).join('; ')}`, link, source: 'Track record' });
        for (const [i, g] of (p.groups || []).entries()) add({ id: `${pg.slug}-${s.id}-g${i}`, title: g.heading, text: String(g.items || '').split('\n').map((l) => l.replace('|', ' — ')).join('. '), link, source: 'Projects', boost: 1.2 });
      } else if (s.type === 'stats') add({ id: `${pg.slug}-${s.id}`, title: 'Company numbers', text: (p.items || []).map((x) => `${x.value} ${x.label}`).join('; '), link, source: 'Page' });
    }
  }

  for (const pr of all(`SELECT p.id,p.name,p.location,p.description,p.dev_status,p.total_units,p.kind,
      (SELECT COUNT(*) FROM properties q WHERE q.project_id=p.id AND q.published=1 AND q.status IN ('available','featured')) available,
      (SELECT MIN(net_price) FROM properties q WHERE q.project_id=p.id AND q.published=1 AND q.status IN ('available','featured') AND net_price>0) min_price,
      (SELECT MAX(net_price) FROM properties q WHERE q.project_id=p.id AND q.published=1 AND q.status IN ('available','featured')) max_price
    FROM projects p WHERE p.site_visible=1`)) {
    add({ id: `project${pr.id}`, title: `${pr.name} project`, keywords: 'project society scheme housing', link: `/site/project/${pr.id}`, source: 'Projects', boost: 1.4,
      text: `${pr.name} is ${pr.kind === 'construction' ? 'a construction project' : 'a development project'} at ${pr.location || 'our listed location'}${pr.dev_status ? ` (status: ${pr.dev_status})` : ''}.${pr.total_units ? ` It has ${pr.total_units} units.` : ''} ${pr.description || ''}${pr.available ? ` ${pr.available} listings are available now${pr.min_price ? ` from ${money(pr.min_price)}${pr.max_price > pr.min_price ? ` to ${money(pr.max_price)}` : ''}` : ''}.` : ''}` });
  }
  for (const l of all(`SELECT p.id,p.title,p.property_type,p.purpose,p.net_price,p.area_size,p.unit,p.city,p.area_name,p.short_desc,pr.name project FROM properties p LEFT JOIN projects pr ON pr.id=p.project_id
      WHERE p.published=1 AND p.status IN ('available','featured') ORDER BY (p.status='featured') DESC, p.id DESC LIMIT 40`)) {
    add({ id: `listing${l.id}`, title: l.title, keywords: `${l.property_type} ${l.purpose} ${l.city} ${l.area_name} ${l.project}`, link: `/site/property/${l.id}`, source: 'Listings',
      text: `${l.title}: ${l.property_type || 'property'} ${l.purpose === 'Rent' ? 'for rent' : 'for sale'}, ${l.area_size || ''} ${l.unit || ''}, ${[l.project, l.area_name, l.city].filter(Boolean).join(', ')}. ${money(l.net_price)}${l.purpose === 'Rent' ? ' per month' : ''}. ${l.short_desc || ''}` });
  }
  const t = { ...DEFAULT_TOOLS, ...(cfg.calculators?.tools || {}) };
  add({ id: 'calculators', title: 'Construction cost, material and payment calculators', keywords: 'construction cost per sqft grey structure semi finished turnkey build house estimate calculator',
    text: `Our website calculators estimate house construction cost, materials and payment milestones. Planning rates per covered sq ft: grey structure from PKR ${t.rates.grey.Standard} to ${t.rates.grey.Luxury}, semi-finished PKR ${t.rates.semi.Standard} to ${t.rates.semi.Luxury}, turnkey PKR ${t.rates.turnkey.Standard} to ${t.rates.turnkey.Luxury}. ${t.note}`, link: '/site/calculators', source: 'Calculators', boost: 1.2 });
  return docs;
}

/** BM25-style ranking with extra weight for the title and keyword fields. */
export function search(query, docs, limit = 3) {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const prepared = docs.map((d) => ({ d, title: tokens(d.title), kw: tokens(d.keywords), body: tokens(d.text) }));
  const df = Object.fromEntries(q.map((w) => [w, prepared.filter((p) => p.title.includes(w) || p.kw.includes(w) || p.body.includes(w)).length]));
  const N = prepared.length || 1;
  const idf = (w) => Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5));
  const total = q.reduce((s, w) => s + idf(w), 0) || 1;
  return prepared.map((p) => {
    let score = 0, hit = 0;
    for (const w of q) {
      const tf = p.body.filter((x) => x === w).length, inT = p.title.includes(w), inK = p.kw.includes(w);
      if (!tf && !inT && !inK) continue;
      hit += idf(w);
      score += idf(w) * ((tf ? 1 + Math.log(tf) : 0) + (inT ? 3 : 0) + (inK ? 3.5 : 0));
    }
    return { doc: p.d, score: score * p.d.boost, coverage: hit / total };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The 1–2 sentences of a document that best match the question. */
function excerpt(text, query) {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) || [text];
  if (text.length <= 360) return text;
  const q = new Set(tokens(query));
  const scored = sentences.map((s, i) => ({ s, i, n: tokens(s).filter((w) => q.has(w)).length })).sort((a, b) => b.n - a.n || a.i - b.i);
  const picked = scored.slice(0, 2).sort((a, b) => a.i - b.i).map((x) => x.s).join(' ');
  return picked.length > 420 ? `${picked.slice(0, 417)}…` : picked;
}

const TYPES = [[/\b(plots?|land)\b/, 'Plots'], [/\b(house|houses|home|homes|villa|villas)\b/, 'Houses'], [/\b(flat|flats|apartments?)\b/, 'Apartments'], [/\b(shops?|offices?|commercial|plazas?)\b/, 'Commercial']];
const cardOf = (l) => ({ title: l.title, subtitle: `${money(l.net_price)}${l.purpose === 'Rent' ? ' / month' : ''} · ${l.area_size || ''} ${l.unit || ''} · ${[l.area_name, l.city].filter(Boolean).join(', ')}`, href: `/site/property/${l.id}`, image: l.cover ? `/uploads/${l.cover}` : null });

function parseBudget(m) {
  const x = m.match(/(\d+(?:\.\d+)?)\s*(crore|cr|lakh|lac|million|m|k|thousand)?/g) || [];
  for (const raw of x) {
    const [, n, u] = raw.match(/(\d+(?:\.\d+)?)\s*(crore|cr|lakh|lac|million|m|k|thousand)?/);
    const v = Number(n) * ({ crore: 1e7, cr: 1e7, lakh: 1e5, lac: 1e5, million: 1e6, m: 1e6, k: 1e3, thousand: 1e3 }[u] || 1);
    if (v >= 100000) return v;
  }
  return null;
}

function listingSearch(m) {
  const type = TYPES.find(([re]) => re.test(m))?.[1];
  const rent = /\brent|rental|lease\b/.test(m);
  const budget = /\b(under|below|within|upto|up to|budget|max|less than)\b/.test(m) || /\d\s*(crore|cr|lakh|lac|million)/.test(m) ? parseBudget(m) : null;
  const size = m.match(/(\d+(?:\.\d+)?)\s*(marla|kanal)/);
  const where = ["p.published=1 AND p.status IN ('available','featured','reserved')"], params = [];
  if (type) { where.push('p.property_type=?'); params.push(type); }
  where.push('p.purpose=?'); params.push(rent ? 'Rent' : 'Sell');
  if (budget) { where.push('p.net_price<=?'); params.push(budget); }
  if (size) { where.push('LOWER(p.unit)=? AND p.area_size=?'); params.push(size[2], Number(size[1])); }
  const place = all('SELECT DISTINCT area_name a FROM properties WHERE published=1 AND area_name IS NOT NULL UNION SELECT DISTINCT city FROM properties WHERE published=1 AND city IS NOT NULL UNION SELECT name FROM projects WHERE site_visible=1').map((r) => r.a).find((a) => a && m.includes(String(a).toLowerCase()));
  if (place) { where.push('(p.area_name LIKE ? OR p.city LIKE ? OR pr.name LIKE ?)'); params.push(...Array(3).fill(`%${place}%`)); }
  const rows = all(`SELECT p.id,p.title,p.net_price,p.area_size,p.unit,p.city,p.area_name,p.purpose,
      (SELECT path FROM media WHERE entity_type='property' AND entity_id=p.id AND kind IN ('cover','gallery') ORDER BY kind='cover' DESC, sort_order LIMIT 1) cover
    FROM properties p LEFT JOIN projects pr ON pr.id=p.project_id WHERE ${where.join(' AND ')} ORDER BY (p.status='featured') DESC, p.net_price LIMIT 4`, ...params);
  const label = `${type ? type.toLowerCase() : 'properties'} ${rent ? 'for rent' : 'for sale'}${place ? ` in ${place}` : ''}${budget ? ` under ${money(budget)}` : ''}${size ? ` (${size[1]} ${size[2]})` : ''}`;
  return { rows, label };
}

const BOT_DEFAULT = { enabled: true, name: 'Expert Assistant', greeting: 'Assalam o Alaikum! I can answer questions about our projects, properties, construction costs and company. How can I help?', quick_replies: ['Show featured properties', 'Construction cost', 'Our projects', 'Contact details', 'Talk to an agent'], lead_after: 2 };
export const botConfig = (cfg) => { const b = { ...BOT_DEFAULT, ...(cfg.bot || {}) }; b.quick_replies = (b.quick_replies || []).map((x) => String(x).trim()).filter(Boolean); return b; };

/** Answer one visitor message. Pure apart from reading the database. */
export function reply(message, cfg) {
  const raw = String(message || '').trim().slice(0, 400);
  const m = raw.toLowerCase();
  const bot = botConfig(cfg);
  const R = (o) => ({ answer: '', cards: [], links: [], suggestions: bot.quick_replies.slice(0, 4), action: null, matched: true, source: '', ...o });
  const wa = cfg.contact?.whatsapp;
  const talk = { label: 'Chat with an agent on WhatsApp', href: wa ? `https://wa.me/${String(wa).replace(/[^\d]/g, '')}` : '/site/p/contact' };

  if (!m) return R({ answer: bot.greeting, source: 'greeting' });
  if (/^(hi+|hello+|hey+|salam|assalam|assalamualaikum|aoa|good (morning|afternoon|evening))\b/.test(m) && m.split(/\s+/).length <= 4) return R({ answer: bot.greeting, source: 'greeting' });
  if (/^(thanks?|thank you|shukria|jazak|ok(ay)?|great|nice|bye|goodbye)\b/.test(m) && m.split(/\s+/).length <= 4) return R({ answer: 'You are welcome! If you would like our team to follow up, you can leave your details below.', action: 'lead', source: 'smalltalk' });

  if (/\b(talk|speak|connect)\b.*\b(agent|human|person|someone|team|representative)\b|\b(call me|contact me|call back|callback|get in touch|appointment|book a visit|site visit|schedule)\b|\b(i am|i'm|im) (interested|looking)\b|\binterested in\b/.test(m)) {
    return R({ answer: 'Happy to connect you with our team. Share a few details and a sales agent will contact you shortly.', action: 'lead', links: [talk], source: 'lead-intent', suggestions: [] });
  }

  const sqft = m.match(/(\d+(?:\.\d+)?)\s*(marla|kanal)/);
  if (/\b(cost|construct|construction|build|building|estimate|per sq|sqft|grey|turnkey|semi)\b/.test(m) && sqft && !/\b(for sale|buy|plot for|available)\b/.test(m)) {
    const marla = Number(sqft[1]) * (sqft[2] === 'kanal' ? 20 : 1);
    const scope = /turnkey/.test(m) ? 'turnkey' : /semi/.test(m) ? 'semi' : 'grey';
    const floors = /single/.test(m) ? 1 : /triple|3 storey|three/.test(m) ? 3 : 2;
    const finish = /luxury/.test(m) ? 'Luxury' : /standard/.test(m) ? 'Standard' : 'Premium';
    const t = { ...DEFAULT_TOOLS, ...(cfg.calculators?.tools || {}) };
    const e = estimateCost({ marla, floors, scope, finish }, t);
    return R({ answer: `Planning estimate for a ${sqft[1]} ${sqft[2]} ${floors === 1 ? 'single' : floors === 2 ? 'double' : 'triple'}-storey ${t.scopes[scope]} (${finish}) house: about ${money(e.total)} (range ${money(e.low)} – ${money(e.high)}) for roughly ${e.area.toLocaleString('en-PK')} sq ft, taking ${e.months[0]}–${e.months[1]} months. This is indicative only — a firm quote needs drawings and a site review.`,
      links: [{ label: 'Open the calculators', href: '/site/calculators' }], action: 'lead', source: 'calculator', suggestions: ['Material estimate', 'Payment milestones', 'Talk to an agent'] });
  }

  if (/\b(plots?|house|houses|home|homes|villas?|flats?|apartments?|shops?|offices?|commercial|properties|property|listings?|land)\b/.test(m) && /\b(show|find|search|looking|available|for sale|for rent|rent|buy|sale|under|below|budget|price|cheap|featured|latest|options|list)\b|\d\s*(marla|kanal|crore|cr|lakh|lac|million)/.test(m) && !/\b(project|society|scheme)s?\b/.test(m)) {
    const featuredOnly = /featured|best|top/.test(m) && !TYPES.some(([re]) => re.test(m));
    const { rows, label } = listingSearch(featuredOnly ? 'properties' : m);
    if (rows.length) return R({ answer: `Here ${rows.length === 1 ? 'is a match' : 'are some matches'} for ${featuredOnly ? 'our featured properties' : label}:`, cards: rows.map(cardOf), links: [{ label: 'See all properties', href: '/site/properties' }], action: null, source: 'listings', suggestions: ['Talk to an agent', 'Construction cost'] });
    return R({ answer: `I could not find ${label} on the website right now. Our team often has more inventory than what is listed — leave your requirements and an agent will come back to you.`, action: 'lead', links: [{ label: 'Browse all properties', href: '/site/properties' }], source: 'listings', matched: false });
  }

  const docs = buildKnowledge(cfg);
  if (/\b(projects?|societies|society|schemes?)\b/.test(m) && tokens(m).length <= 4) {
    const ps = all('SELECT id,name,location,dev_status FROM projects WHERE site_visible=1 ORDER BY site_featured DESC, name LIMIT 6');
    if (ps.length) return R({ answer: `We currently showcase ${ps.length} project${ps.length > 1 ? 's' : ''}. Tap one to see details, or ask me about it.`, cards: ps.map((p) => ({ title: p.name, subtitle: `${p.location || ''}${p.dev_status ? ` · ${p.dev_status}` : ''}`, href: `/site/project/${p.id}` })), links: [{ label: 'All projects', href: '/site/projects' }], source: 'projects', suggestions: ['Show featured properties', 'Contact details'] });
  }
  if (/\b(phone|number|call|whatsapp|email|address|office|timings?|hours|open|location|where are you|contact)\b/.test(m) && !/\b(project|plot|house)\b/.test(m)) {
    const d = docs.find((x) => x.id === 'contact');
    return R({ answer: d.text, links: [{ label: 'Contact page', href: '/site/p/contact' }, talk], source: 'Company', suggestions: ['Our projects', 'Talk to an agent'] });
  }

  const hits = search(raw, docs, 3);
  const best = hits[0];
  if (best && best.coverage >= 0.34) {
    const others = hits.slice(1).filter((h) => h.coverage >= 0.3);
    return R({ answer: excerpt(best.doc.text, raw), links: best.doc.link ? [{ label: best.doc.title.length > 40 ? 'Read more' : best.doc.title, href: best.doc.link }] : [], source: best.doc.source,
      suggestions: [...others.map((h) => h.doc.title).filter((t) => t.length < 46).slice(0, 2), 'Talk to an agent'], action: /\b(price|cost|rate|payment|installment|plan|book|buy)\b/.test(m) ? 'lead' : null });
  }
  return R({ answer: 'I do not have that information yet, but our team will. Leave your name and number and an agent will get back to you — or chat with us on WhatsApp.', action: 'lead', links: [talk], matched: false, source: 'unanswered', suggestions: ['Our projects', 'Show featured properties', 'Contact details'] });
}

export const logChat = (session, message, r) => run('INSERT INTO bot_chats(session,message,answer,source,matched,created_at) VALUES(?,?,?,?,?,?)', String(session).slice(0, 64), String(message).slice(0, 400), String(r.answer).slice(0, 1200), r.source, r.matched ? 1 : 0, now());
export const learnedSummary = () => ({ kb: get('SELECT COUNT(*) n FROM bot_kb WHERE active=1').n });
