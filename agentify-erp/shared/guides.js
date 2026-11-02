// Step guides, FAQs and known limits for what each release added. One source for: What's new (Guide links), the
// console's Support knowledge base (training + customer support), and the Ask assistant's "how do I ..." answers.
// A changelog item points at a guide with `guide: 'key'`. `video` is the key of a training video (server/assets/training/manifest.json
// or the console's Training videos library). Write for customers: plain words, no mention of the console or platform admins
// in tenant guides (shared/test enforces this). `internal` lines are for support staff only and never reach a workspace.
import { CHANGELOG, tenantChangelog } from './changelog.js';

export const GUIDES = {
  'developer-partners': {
    title: 'Developer partners (joint-venture plots)', since: 'v1.56', module: 'Developers', video: 'developer-partners',
    who: 'Admin and roles with the Developers permission; Pakistan workspaces',
    keywords: ['developer', 'developers', 'joint venture', 'jv', 'plot', 'plots', 'agreement', 'rebate', 'portal', 'booking id', 'pass-through'],
    steps: [
      'Open Developers and choose Add developer. Enter the developer and its agreement: rates, rebate percentages and the cancellation window with its deduction tiers.',
      'Open Properties > Add Property (or edit a plot) and set Plot source to Developer. Choose the developer and one of its agreements.',
      'Sell the plot from Sales & Bookings as usual. A booking ID is created and the sale is held as a pass-through, so it is not counted as your revenue.',
      'To give the developer a read-only view, open Developers > the developer > Create portal login.',
    ],
    limits: ['Direct receipts on developer files are switched off until the developer approval step arrives.', 'Payment approval by the developer, rebates and cancellations are not part of the product yet.', 'The developer portal never shows customer CNIC, phone or e-mail.'],
    faq: [
      { q: 'Why is a developer plot sale not in my revenue?', a: 'The customer pays the developer, so the sale is held as a pass-through and kept out of your revenue.' },
      { q: 'The Developers list is empty.', a: 'This was fixed in v1.57. Refresh the page; your developers now appear.' },
      { q: 'I cannot find Plot source on the property form.', a: 'It appears for Pakistan workspaces whose role has the Developers permission (added in v1.57).' },
    ],
    internal: ['If Plot source is missing, check the workspace region is Pakistan and the role has the Developers permission.'],
  },
  'one-email-one-account': {
    title: 'One email, one account', since: 'v1.58', module: 'Settings',
    who: 'Admins adding users, employees, vendors and developers',
    keywords: ['email', 'already exists', 'duplicate', 'second account', 'same email', 'invite'],
    steps: ['Use a different email address for each person or company.', 'To change someone\'s role, edit the existing user (Settings > Users) instead of adding them again.'],
    limits: ['Capital letters and spaces make no difference when emails are compared.'],
    faq: [{ q: 'I see "This email already exists".', a: 'That address is already used by another account, employee, vendor, developer or invitation. Use another address or edit the existing record.' }],
    internal: ['Search all login types for the address before telling a tenant it is free.'],
  },
  'maps-navigate': {
    title: 'Maps and the Navigate button', since: 'v1.60', module: 'Properties, Visits, Field Coverage', video: 'field-coverage-admin',
    who: 'Everyone who views properties, visits or Field Coverage',
    keywords: ['map', 'maps', 'navigate', 'directions', 'location', 'pin', 'field coverage', 'google maps', 'satellite', 'street'],
    steps: [
      'Field Coverage (My Space > Field Coverage) shows each agent as a marker. It refreshes about every 15 seconds.',
      'On a property, drag the pin when adding or editing it and use the place search to jump to an address.',
      'Press Navigate on a property or visit to open Google Maps (Apple Maps on iPhone and Mac) with directions to the spot.',
    ],
    limits: ['On busy teams only the most recent agents are drawn so phones stay fast.', 'Satellite view is available only where your plan includes it.'],
    faq: [{ q: 'The map shows fewer agents than I have.', a: 'Only the most recently reporting agents are drawn on busy teams. Open the list view for everyone.' }],
    internal: ['Free map is the default. Google, MapTiler (satellite) and LocationIQ are optional keys set on the deployment.'],
  },
};

const tidy = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOPW = new Set(['how', 'do', 'does', 'did', 'can', 'the', 'and', 'for', 'what', 'where', 'which', 'with', 'from', 'this', 'that', 'is', 'are', 'was', 'to', 'in', 'on', 'of', 'my', 'me', 'i', 'a', 'an', 'it', 'new', 'tell', 'show', 'explain', 'about', 'use', 'work', 'works']);
const toks = (s) => tidy(s).split(' ').filter((w) => w.length >= 2 && !STOPW.has(w));

/**
 * Search guides (and release items) for a question. Returns best matches first.
 * `platform` also searches console-only release items and each guide's internal notes.
 */
export function searchKnowledge(question, { platform = false, log = CHANGELOG } = {}) {
  const qt = toks(question);
  if (!qt.length) return [];
  const releases = platform ? log : tenantChangelog(log);
  const out = [];
  for (const [key, g] of Object.entries(GUIDES)) {
    const hay = tidy([g.title, g.module, ...g.keywords, ...g.faq.map((f) => f.q), ...(platform ? g.internal || [] : [])].join(' '));
    let score = 0;
    for (const w of qt) { if (hay.includes(` ${w} `) || hay.startsWith(`${w} `) || hay.endsWith(` ${w}`)) score += 2; else if (w.length > 3 && hay.includes(w)) score += 1; }
    if (tidy(question).includes(tidy(g.title))) score += 6;
    if (score >= 2) out.push({ type: 'guide', key, score, guide: g });
  }
  for (const r of releases) for (const it of r.items) {
    if (it.guide) continue; // covered by its guide
    const hay = tidy(`${r.title} ${it.text} ${it.where || ''}`);
    let score = 0; for (const w of qt) if (w.length > 3 && hay.includes(w)) score += 1;
    if (score >= 2) out.push({ type: 'release', version: r.version, score, title: r.title, item: it });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Every guide, grouped for the console knowledge base (newest release first). */
export const guideList = () => Object.entries(GUIDES).map(([key, g]) => ({ key, ...g })).sort((a, b) => b.since.localeCompare(a.since, undefined, { numeric: true }));
