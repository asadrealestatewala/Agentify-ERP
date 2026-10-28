// "Create my website with AI": turns a short brief into a draft page (blocks, colours, fonts and search text) using the AI provider the
// workspace already connected. Nothing is saved here: the editor shows the draft and the owner applies and saves it. The model's answer is
// treated as untrusted input: only known blocks and known options survive, links and colours are checked, text is length-limited, and
// blocks that need real facts (statistics, testimonials, team, awards, partners) are never written by the AI.
import crypto from 'node:crypto';
import { bad } from '../util.js';
import { completeJson, activeProvider } from '../integrations/ai.js';
import { getSetting } from '../db.js';
import { SITE_FONTS, checkLink } from './siteValidate.js';
import { SITE_ICON_IDS } from '../../../shared/siteIcons.js';

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const S = (n) => ['s', n], L = ['l'], B = ['b'], E = (...o) => ['e', o], N = (a, b) => ['n', a, b], LIST = (max, spec) => ['list', max, spec];
/** Blocks the AI may write, with the options it may set. Anything else it sends is dropped. */
export const AI_BLOCKS = {
  hero: { headline: S(110), subheadline: S(260), cta_label: S(36), cta_href: L, show_search: B, height: E('tall', 'medium') },
  services: { title: S(70), items: LIST(6, { icon: E(...SITE_ICON_IDS), title: S(50), text: S(180), href: L }) },
  listings: { title: S(70), subtitle: S(140), source: E('featured', 'latest'), limit: N(4, 12), layout: E('grid', 'carousel') },
  projects: { title: S(70), subtitle: S(140), limit: N(1, 9) },
  calculators: { title: S(70), subtitle: S(140) },
  agents: { title: S(70), subtitle: S(140), limit: N(1, 8) },
  faq: { title: S(70), items: LIST(8, { q: S(160), a: S(420) }) },
  text: { title: S(80), html: S(1800), align: E('left', 'center') },
  imagetext: { title: S(80), text: S(520), image_side: E('left', 'right'), button_label: S(36), button_href: L },
  cta: { headline: S(90), text: S(200), button_label: S(36), button_href: L, tone: E('dark', 'primary', 'light') },
  contact: { title: S(70), text: S(200) },
  booking: { title: S(70), subtitle: S(160) },
  blog: { title: S(70), limit: N(1, 6) },
  reviews: { title: S(70), subtitle: S(140) },
  partners: { title: S(70) },
  livestats: {},
};
const DESCRIBE = {
  hero: 'top banner: headline, subheadline, optional cta_label and cta_href, show_search (property search box, for property sellers), height',
  services: `cards: items [{icon (one of: ${SITE_ICON_IDS.filter((i) => i !== 'dot').join(', ')}), title, text, href}]`,
  listings: 'live property listings from the CRM: title, subtitle, source (featured|latest), limit, layout (grid|carousel)',
  projects: 'live project cards from the CRM: title, subtitle, limit',
  calculators: 'installment and construction cost calculators: title, subtitle',
  agents: 'listing agents from the CRM: title, subtitle, limit',
  faq: 'questions: items [{q, a}]',
  text: 'a text section: title, html (plain paragraphs separated by blank lines), align',
  imagetext: 'picture beside text (the owner adds the picture later): title, text, image_side, button_label, button_href',
  cta: 'call-to-action banner: headline, text, button_label, button_href, tone',
  contact: 'enquiry form and contact details: title, text',
  booking: 'site visit booking form: title, subtitle',
  blog: 'latest blog posts: title, limit',
  reviews: 'customer review form and approved reviews: title, subtitle',
  partners: 'partner logo strip, left empty for the owner to fill: title',
  livestats: 'live counts from the CRM (listings, projects), no options',
};
export const BUSINESS_TYPES = { agency: 'Real estate agency or brokerage (sells, rents and lists properties)', developer: 'Property developer (plots, projects, housing schemes)', construction: 'Construction or renovation company', dual: 'Sells property and also builds', other: 'Something else (described below)' };
export const STYLES = { modern: 'modern and clean', classic: 'classic and trustworthy', bold: 'bold and energetic', luxury: 'elegant and premium', friendly: 'warm and friendly' };
export const TONES = { professional: 'professional', friendly: 'friendly and approachable', confident: 'confident and direct', formal: 'formal' };

const HEX = /^#[0-9a-fA-F]{6}$/;
function cleanValue(spec, v) {
  const [kind] = spec;
  if (kind === 's') return clip(v, spec[1]);
  if (kind === 'b') return v === true || v === 'true';
  if (kind === 'e') return spec[1].includes(v) ? v : undefined;
  if (kind === 'n') { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(spec[2], Math.max(spec[1], n)) : undefined; }
  // links written by the AI stay inside the site: internal paths or in-page anchors only
  if (kind === 'l') { const s = clip(v, 200); if (!s || !(/^\/(?!\/)/.test(s) || /^#/.test(s))) return ''; try { checkLink(s, 'link'); } catch { return ''; } return s; }
  if (kind === 'list') return (Array.isArray(v) ? v : []).slice(0, spec[1]).map((it) => cleanProps(spec[2], it)).filter((it) => Object.values(it).some((x) => x !== '' && x !== undefined));
  return undefined;
}
function cleanProps(spec, raw) {
  const out = {};
  for (const [k, sp] of Object.entries(spec)) {
    const v = cleanValue(sp, raw?.[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const paragraphs = (t) => String(t || '').replace(/<[^>]*>/g, ' ').split(/\n{2,}|\r\n\r\n/).map((p) => clip(p, 700)).filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`).join('');

/** Turn the model's JSON into a safe draft: { theme, seo, sections }. Exported for tests. */
export function cleanDraft(raw, { company } = {}) {
  const t = raw?.theme || {};
  const theme = {};
  for (const k of ['primary', 'accent', 'dark', 'soft']) if (HEX.test(String(t[k] || ''))) theme[k] = String(t[k]).toLowerCase();
  for (const k of ['font_heading', 'font_body']) if (SITE_FONTS.includes(t[k])) theme[k] = t[k];
  if (Number.isFinite(Number(t.radius))) theme.radius = Math.min(24, Math.max(0, Math.round(Number(t.radius))));
  const seo = { title: clip(raw?.seo?.title, 70), description: clip(raw?.seo?.description, 160) };
  const sections = [];
  for (const s of (Array.isArray(raw?.sections) ? raw.sections : []).slice(0, 14)) {
    const spec = AI_BLOCKS[s?.type];
    if (!spec) continue; // unknown or disallowed block types are dropped
    if (s.type === 'partners' && sections.some((x) => x.type === 'partners')) continue;
    const props = cleanProps(spec, s.props || {});
    if (s.type === 'text') props.html = paragraphs(s.props?.html);
    if (s.type === 'partners') props.items = []; // logos always come from the owner
    sections.push({ id: `s${crypto.randomBytes(5).toString('hex')}`, type: s.type, props });
  }
  if (sections.length < 3) throw bad('The AI did not return a usable page. Try again, or add a little more detail about your business.');
  if (sections[0].type !== 'hero') sections.unshift({ id: `s${crypto.randomBytes(5).toString('hex')}`, type: 'hero', props: { headline: company || 'Welcome', subheadline: '' } });
  if (!sections.some((x) => x.type === 'contact')) sections.push({ id: `s${crypto.randomBytes(5).toString('hex')}`, type: 'contact', props: { title: 'Contact us' } });
  return { theme, seo, sections };
}

/** The brief from the form, checked and length-limited before it goes into a prompt. */
export function cleanBrief(b = {}) {
  const pick = (v, map, d) => (Object.keys(map).includes(v) ? v : d);
  const brief = {
    company: clip(b.company, 80), type: pick(b.type, BUSINESS_TYPES, 'agency'), location: clip(b.location, 100), what: clip(b.what, 800), audience: clip(b.audience, 300),
    style: pick(b.style, STYLES, 'modern'), tone: pick(b.tone, TONES, 'professional'), language: clip(b.language, 40) || 'English', notes: clip(b.notes, 600),
  };
  if (!brief.company) throw bad('Enter your company name');
  if (brief.what.length < 15) throw bad('Describe what your company does in a sentence or two');
  return brief;
}

const SYSTEM = `You design home pages for real estate and construction companies. Reply with one JSON object only.
Rules you must follow:
- Use only facts the owner gave. Never invent statistics, years in business, prices, awards, clients, testimonials, partners, team names, addresses, phone numbers or e-mail addresses. If a fact is missing, write copy that does not need it.
- Write in the requested language and tone. Keep headlines short and concrete. No filler, no exaggeration, no superlatives you cannot back up.
- Choose 6 to 10 blocks from the list, in a sensible order, starting with a hero and ending with contact. Use listings, projects and calculators only if the business really sells property or builds.
- Links may only be internal paths such as /site/properties, /site/p/contact or /site/blog.
- Colours are 6-digit hex codes suited to the style, with enough contrast between text and background. Fonts must come from the allowed list.`;

function promptFor(brief) {
  return `Business
- Company: ${brief.company}
- Type: ${BUSINESS_TYPES[brief.type]}
- Location: ${brief.location || 'not given'}
- What they do: ${brief.what}
- Who they serve: ${brief.audience || 'not given'}
- Visual style: ${STYLES[brief.style]}
- Tone: ${TONES[brief.tone]}
- Language: ${brief.language}
- Other notes: ${brief.notes || 'none'}

Blocks you may use (type: options):
${Object.entries(DESCRIBE).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Allowed fonts: ${SITE_FONTS.join(', ')}

Return JSON exactly like:
{"theme":{"primary":"#0f766e","accent":"#f59e0b","dark":"#0a3d3a","soft":"#f4f7f6","font_heading":"Poppins","font_body":"Inter","radius":12},
 "seo":{"title":"...up to 60 characters","description":"...up to 150 characters"},
 "sections":[{"type":"hero","props":{"headline":"...","subheadline":"...","show_search":true,"height":"tall"}}, {"type":"services","props":{"title":"...","items":[{"icon":"residential","title":"...","text":"...","href":"/site/properties"}]}}]}`;
}

export async function generateSiteDraft(rawBrief) {
  const brief = cleanBrief(rawBrief);
  const provider = activeProvider(getSetting('ai_default', null));
  if (!provider) throw Object.assign(bad('Connect an AI provider first (Integrations, AI). Your own key is used, so nothing is shared with other companies.'), { status: 409 });
  let raw;
  try { raw = await completeJson(provider, { purpose: 'website_builder', system: SYSTEM, prompt: promptFor(brief), maxTokens: 4000 }); }
  catch (e) { throw bad(`The AI service could not write the page: ${String(e.message || e).slice(0, 200)}`); }
  return { provider, brief: { company: brief.company }, ...cleanDraft(raw, { company: brief.company }) };
}
