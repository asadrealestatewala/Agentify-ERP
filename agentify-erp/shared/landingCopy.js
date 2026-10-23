// The editable wording and sections of the public landing page, shared by the page, the console's landing editor and the server's checks.
// Each text has a key, a group and label for the editor, and the default wording shown until someone changes it. A key may carry a country
// ("hero.sub@US") so a market can have its own wording. Only static wording is listed here: figures, plan names and prices come from the data.
export const COPY = [
  ['Top bar', 'nav.signin', 'Sign in link', 'Sign in'],
  ['Top bar', 'nav.cta', 'Start button', 'Start free'],
  ['Hero', 'hero.chip', 'Announcement chip', 'Video meetings, call recording and AI Studio are live'],
  ['Hero', 'hero.h1a', 'Headline, first part', 'Every real estate lead. Every follow-up.'],
  ['Hero', 'hero.h1b', 'Headline, highlighted part', 'One CRM.'],
  ['Hero', 'hero.sub', 'Sub-headline (overrides the market wording)', '', true],
  ['Hero', 'hero.cta1', 'First button', 'Explore the CRM'],
  ['Hero', 'hero.tick1', 'Reassurance 1', 'No card needed to start'],
  ['Hero', 'hero.tick2', 'Reassurance 2', 'Phone, tablet and desktop'],
  ['Hero', 'hero.tick3', 'Reassurance 3', 'Your data stays yours: read-only, never deleted'],
  ['Partners', 'partners.h', 'Partner logos heading', 'Our real estate partners'],
  ['Who it is for', 'segments.eyebrow', 'Label', 'Built for every kind of property business'],
  ['Features', 'features.eyebrow', 'Label', 'What is inside'],
  ['Features', 'features.h2a', 'Heading, first part', 'Everything the CRM does'],
  ['Features', 'features.h2b', 'Heading, highlighted part', 'for a brokerage'],
  ['Dashboard', 'dash.eyebrow', 'Label', 'Know where you stand'],
  ['Dashboard', 'dash.h2a', 'Heading, first part', 'Revenue and follow-ups'],
  ['Dashboard', 'dash.h2b', 'Heading, highlighted part', 'at a glance'],
  ['Dashboard', 'dash.lead', 'Paragraph', 'A manager’s view of the week: leads in, follow-ups done, viewings booked and what the pipeline is worth. Switch the period and open the screen behind each number.', true],
  ['How it works', 'how.eyebrow', 'Label', 'How it works'],
  ['How it works', 'how.h2a', 'Heading, first part', 'From first enquiry to'],
  ['How it works', 'how.h2b', 'Heading, highlighted part', 'signed sale'],
  ['ERP', 'beyond.eyebrow', 'Label', 'Beyond the CRM'],
  ['ERP', 'beyond.h2a', 'Heading, first part', 'The ERP behind it,'],
  ['ERP', 'beyond.h2b', 'Heading, highlighted part', 'when you are ready'],
  ['ERP', 'beyond.lead', 'Paragraph', 'Start with leads and follow-ups. The same workspace also runs the rest of a property business, so a won deal does not have to be typed in twice.', true],
  ['Mobile app', 'mobile.eyebrow', 'Label', 'The CRM in your pocket'],
  ['Mobile app', 'mobile.h2a', 'Heading, first part', 'Between viewings,'],
  ['Mobile app', 'mobile.h2b', 'Heading, highlighted part', 'it is all in your hand'],
  ['Mobile app', 'mobile.lead', 'Paragraph', 'Check new leads, open a client, see what they are looking for and complete the follow-up. These are the phone screens of the app itself: switch between Leads, Client and Tasks under the phone.', true],
  ['Reviews', 'reviews.eyebrow', 'Label', 'Customer reviews'],
  ['Pricing', 'pricing.eyebrow', 'Label', 'Pricing'],
  ['Pricing', 'pricing.h2a', 'Heading, first part', 'Plans for'],
  ['Pricing', 'pricing.h2b', 'Heading, highlighted part', 'real estate teams'],
  ['Questions', 'faq.eyebrow', 'Label', 'Questions'],
  ['Questions', 'faq.h2a', 'Heading, first part', 'Answers'],
  ['Questions', 'faq.h2b', 'Heading, highlighted part', 'before you ask'],
  ['Closing call to action', 'final.eyebrow', 'Label', 'Start today'],
  ['Closing call to action', 'final.h2a', 'Heading, first part', 'Put every lead and follow-up in'],
  ['Closing call to action', 'final.h2b', 'Heading, highlighted part', 'one place'],
  ['Closing call to action', 'final.cta1', 'First button', 'Start free'],
  ['Closing call to action', 'final.cta2', 'Second button', 'Book a demo'],
  ['Footer', 'footer.tagline', 'Line after the brand name', 'real estate CRM with the ERP behind it.'],
].map(([group, key, label, def, long]) => ({ group, key, label, def, long: !!long }));

export const COPY_DEFAULTS = Object.fromEntries(COPY.map((c) => [c.key, c.def]));
export const COPY_KEY = /^[a-z0-9]+\.[a-z0-9]+(@[A-Z]{2})?$/;

/** Sections of the landing page that can be switched off (the top bar, hero and footer always stay). */
export const SECTIONS = [
  ['partners', 'Partner logos'], ['segments', 'Who it is built for (scrolling cards)'], ['kinetic', 'Big scrolling words'], ['features', 'Features'],
  ['tour', 'Live product tour'], ['dashboard', 'Dashboard preview'], ['how', 'How it works'], ['beyond', 'The ERP behind it'], ['mobile', 'Mobile app'],
  ['stories', 'Customer stories'], ['reviews', 'Customer reviews'], ['pricing', 'Pricing'], ['faq', 'Questions'],
];
export const SECTION_IDS = SECTIONS.map(([id]) => id);

/** Check a saved copy map: known keys only, short text, no control characters. Returns the cleaned map; throws a readable Error. */
export function cleanCopy(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Page text must be a set of keys and texts');
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!COPY_KEY.test(k) || !(k.split('@')[0] in COPY_DEFAULTS)) throw new Error(`Unknown page text “${String(k).slice(0, 40)}”`);
    if (typeof v !== 'string') throw new Error(`The text for ${k} must be words`);
    const t = v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/ {3,}/g, '  ');
    if (t.length > 600) throw new Error(`The text for ${k} is too long (max 600 characters)`);
    out[k] = t;
  }
  if (Object.keys(out).length > 400) throw new Error('Too many page texts');
  return out;
}
