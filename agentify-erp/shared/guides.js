// Step guides, FAQs and known limits for what each release added. One source for: What's new (Guide links), the
// console's Support knowledge base (training + customer support), and the Ask assistant's "how do I ..." answers.
// A changelog item points at a guide with `guide: 'key'`. `video` is the key of a training video (server/assets/training/manifest.json
// or the console's Training videos library). Write for customers: plain words, no mention of the console or platform admins
// in tenant guides (shared/test enforces this). `internal` lines are for support staff only and never reach a workspace.
import { CHANGELOG, tenantChangelog } from './changelog.js';
import { SCREENS } from './screens.generated.js';
import { SCREEN_NOTES } from './screenNotes.js';

export const GUIDES = {
  'creative-studio': {
    title: 'Creative Studio: brand story and post images', since: 'v1.65', module: 'Creative Studio',
    who: 'Roles with the Content permission, in workspaces where AI is switched on and credits are left',
    keywords: ['creative', 'studio', 'brand story', 'caption', 'captions', 'post', 'image', 'images', 'social media', 'instagram', 'facebook', 'credits', 'ai', 'urdu', 'report'],
    steps: [
      'Open Creative Studio from the menu. If you do not see it, AI is off for your workspace or this month\'s credits are used up.',
      'On Brand profile, check your brand name, business type, tone and colors, add a short true description of your business, then Save. It starts from your Branding settings.',
      'On Brand story, choose English or Urdu, optionally say what the story should focus on, and write it. You get a story and three captions to copy.',
      'On Post images, describe the post, choose Square, Portrait or Story size and how many options, then create. Save the ones you like or Download them.',
      'Saved images and every brand story are kept under My creations. If a result is wrong or unsuitable, press Report.',
    ],
    limits: ['A story costs 1 credit and each image 3 credits; credits reset every month and the page shows what is left.', 'Requests for harmful, illegal or deceptive content are refused and cost nothing.', 'Video reels and voice-overs are not part of this release.'],
    faq: [
      { q: 'Why is Creative Studio missing from my menu?', a: 'It only shows when AI is switched on for your workspace and you still have credits this month. Contact support to top up or switch AI on.' },
      { q: 'Does the AI invent facts about my business?', a: 'It is told to use only what you saved in the brand profile and your description. Check every result before posting and use Report if something is wrong.' },
      { q: 'Where are my images kept?', a: 'Saved images go to your workspace\'s own file storage and count toward your storage limit. Unsaved options disappear when you leave the page.' },
    ],
    internal: ['Credits are set per workspace (or by default) in the console AI page; a refused or blocked request is not charged.', 'Reports appear in the console AI page under Reported AI answers.'],
  },
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
  'field-location': {
    title: 'Field agent location sharing and coverage', since: 'v1.6', module: 'My Space', video: 'field-coverage-admin',
    who: 'Field staff share; managers and HR read the coverage view',
    keywords: ['location sharing', 'share location', 'field coverage', 'field agent', 'tracking', 'consent', 'gps', 'coverage'],
    steps: [
      'An administrator switches location sharing on for the workspace. It stays off until they do.',
      'Each employee sees a consent notice first. In My Space > My Location they choose when to share and can stop at any time.',
      'Managers open My Space > Field Coverage to see which agents shared recently and where.',
    ],
    limits: ['Only people who agreed to the notice can be seen, and only while they share.', 'Two training videos cover this: one for administrators and HR, one for field staff.'],
    faq: [{ q: 'Why does an agent not appear on Field Coverage?', a: 'They have not agreed to the notice, have stopped sharing, or location sharing is not switched on for the workspace.' }],
    internal: ['Offline readings are queued on the phone and sent when the connection returns.'],
  },
  'lead-routing-conversion': {
    title: 'Lead routing and the Lead Conversion report', since: 'v1.15', module: 'Settings, CRM',
    who: 'Sales managers and administrators',
    keywords: ['lead routing', 'assign leads', 'round robin', 'weighted', 'duplicate', 'duplicates', 'merge', 'response time', 'conversion', 'who gets the lead', 'unassigned'],
    steps: [
      'Open Settings > Lead Routing and add rules. They are checked in order and the first match wins. A rule can match source, city, property type and project.',
      'Choose how a rule shares leads: round robin or weighted. Only active, available agents on the rule\'s team who are under their open-lead limit are chosen.',
      'If nobody is eligible the lead goes to the rule\'s fallback owner, then the workspace default owner, then the sales manager. Otherwise it waits unassigned and the manager is told.',
      'Open CRM > Lead Conversion to see how leads move from enquiry to response, appointment and won, with the counts behind each percentage.',
    ],
    limits: ['Saving or switching on a rule never moves leads that are already assigned.', 'A repeat enquiry from someone already in the CRM keeps their owner.', 'Two enquiries that share a phone or email but have different names stay separate until a manager reviews and merges them under Lead Routing > Duplicates.'],
    faq: [{ q: 'Why did a lead not go to the agent I expected?', a: 'Rules run in order and an agent must be available, on the rule\'s team and under their open-lead limit.' }, { q: 'A conversion rate shows a dash.', a: 'There is nothing to measure yet, so no percentage is shown.' }],
    internal: ['Assignment is written in one database transaction so simultaneous leads cannot read the same round-robin position.'],
  },
  'follow-up-sequences': {
    title: 'Follow-up sequences', since: 'v1.15', module: 'CRM',
    who: 'Sales teams that email or message leads automatically',
    keywords: ['sequence', 'sequences', 'follow-up', 'follow up', 'drip', 'automatic email', 'nurture', 'reminder', 'sender', 'verified sender'],
    steps: [
      'Open CRM > Follow-up Sequences and start from a ready template (new inquiry, viewing follow-up, long-term nurture).',
      'Set what starts it: by hand, a new website enquiry, a viewing booked or a viewing completed. Add steps: emails or tasks with waits.',
      'Verify your company domain and create a sender address under Settings > Email. Only verified senders can send.',
      'Check the first message with a test send to yourself, then switch the sequence on.',
    ],
    limits: ['A sequence stops when the customer replies, books a viewing, opts out, or the lead is won or lost.', 'It waits if there is no verified sender or no email allowance left on your plan.', 'French and Arabic templates are machine-prepared and need a native read before use.'],
    faq: [{ q: 'Why are my sequence emails not sending?', a: 'Check that you have a verified sender, the contact has not opted out, and your plan\'s email allowance is not used up.' }],
    internal: ['Reply detection needs an inbound domain on the server; without it staff use Pause or "Customer replied".'],
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

const tidy = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').map((w) => (w.length > 3 && /[^siu]s$/.test(w) ? w.slice(0, -1) : w)).join(' ');
const STOPW = new Set(['how', 'do', 'does', 'did', 'can', 'the', 'and', 'for', 'what', 'where', 'which', 'with', 'from', 'this', 'that', 'is', 'are', 'was', 'to', 'in', 'on', 'of', 'my', 'me', 'i', 'a', 'an', 'it', 'new', 'tell', 'show', 'explain', 'about', 'use', 'work', 'works', 'doe', 'have', 'has', 'option', 'workspace', 'mean', 'when', 'why', 'which', 'there', 'get', 'can', 'will', 'would', 'should']);
const sing = (w) => (w.length > 3 && /[^siu]s$/.test(w) ? w.slice(0, -1) : w);
const toks = (s) => tidy(s).split(' ').filter((w) => w.length >= 2 && !STOPW.has(w) && !STOPW.has(sing(w)));

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
    let score = 0, matched = 0;
    for (const w of qt) { if (hay.includes(` ${w} `) || hay.startsWith(`${w} `) || hay.endsWith(` ${w}`)) { score += 2; matched++; } else if (w.length > 4 && hay.includes(w)) { score += 1; } }
    if (tidy(question).includes(tidy(g.title))) { score += 6; matched = qt.length; }
    if (score >= 2) out.push({ type: 'guide', key, score: score * 5, coverage: matched / qt.length, guide: g });
  }
  for (const r of releases) for (const it of r.items) {
    if (it.guide) continue; // covered by its guide
    const hay = tidy(`${r.title} ${it.text} ${it.where || ''}`);
    let score = 0; for (const w of qt) if (w.length > 3 && hay.includes(w)) score += 1;
    if (score >= 2) out.push({ type: 'release', version: r.version, score, title: r.title, item: it });
  }
  // every screen in the menu (generated from the app's own navigation), so Ask can answer for any screen
  const seenPath = new Set();
  for (const sc of SCREENS) {
    if (seenPath.has(sc.path)) continue; seenPath.add(sc.path);
    const about = SCREEN_NOTES[sc.path] || '';
    const hay = tidy(`${sc.label} ${sc.section} ${about}`), label = tidy(sc.label);
    let score = 0, matched = 0; for (const w of qt) { if (` ${label} `.includes(` ${w} `)) { score += 3; matched++; } else if (hay.includes(` ${w} `) || hay.startsWith(`${w} `)) { score += 1; } }
    const named = tidy(question).includes(label) && label.length > 3; if (named) score += 5;
    if (score >= 3) out.push({ type: 'screen', score, named, coverage: matched / qt.length, screen: { ...sc, about } });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Every guide, grouped for the console knowledge base (newest release first). */
export const guideList = () => Object.entries(GUIDES).map(([key, g]) => ({ key, ...g })).sort((a, b) => b.since.localeCompare(a.since, undefined, { numeric: true }));

/** Rank free-form documents ({id,title,keywords,text}) against a question. Titles and keywords weigh more than body text. */
export function searchDocs(question, docs, limit = 3) {
  const qt = [...new Set(toks(question))];
  if (!qt.length) return [];
  const prepared = docs.map((d) => ({ d, t: ` ${tidy(d.title)} `, k: ` ${tidy(d.keywords || '')} `, b: ` ${tidy(d.text)} ` }));
  const N = prepared.length;
  const df = Object.fromEntries(qt.map((w) => [w, prepared.filter((p) => p.t.includes(` ${w} `) || p.k.includes(` ${w} `) || p.b.includes(` ${w} `)).length]));
  const idf = (w) => Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5));
  const total = qt.reduce((s, w) => s + idf(w), 0) || 1;
  return prepared.map((p) => {
    let score = 0, hit = 0;
    for (const w of qt) {
      const inT = p.t.includes(` ${w} `), inK = p.k.includes(` ${w} `), inB = p.b.includes(` ${w} `);
      if (!inT && !inK && !inB) continue;
      hit += idf(w);
      score += idf(w) * ((inT ? 3 : 0) + (inK ? 2.5 : 0) + (inB ? 1 : 0));
    }
    return { doc: p.d, score, coverage: hit / total };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
