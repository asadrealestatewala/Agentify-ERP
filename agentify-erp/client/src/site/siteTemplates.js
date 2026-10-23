// Ready-made starting points for a workspace website. A template is a list of blocks (with their text and options) plus colours and fonts.
// Applying one replaces the blocks of the page being edited; nothing is saved until the editor presses Save, and Undo / earlier versions still work.
// Texts are neutral prompts for the company to rewrite: no figures, customers, awards or partners are invented.
import { SECTION_TYPES } from './siteCore.jsx';

let n = 0;
const uid = () => `s${Date.now().toString(36)}${(n++).toString(36)}`;
const b = (type, over = {}) => ({ type, over });

export const TEMPLATES = [
  {
    id: 'mls', name: 'Listings portal (MLS style)', best: 'Agencies and brokers whose visitors come to search properties',
    tagline: 'Search first: big search box, featured and latest listings, agents and calculators.',
    theme: { primary: '#1d4ed8', accent: '#f97316', dark: '#0f172a', bg: '#ffffff', soft: '#f1f5f9', font_heading: 'Inter', font_body: 'Inter', radius: 8 },
    blocks: [
      b('hero', { headline: 'Search every property in one place', subheadline: 'Filter by city, type, price and size. New listings are added daily.', show_search: true, height: 'medium', overlay: 60 }),
      b('listings', { title: 'Featured properties', source: 'featured', limit: 8, layout: 'carousel', view_all_href: '/site/properties' }),
      b('livestats'),
      b('listings', { title: 'Latest listings', source: 'latest', limit: 12, layout: 'grid', view_all_href: '/site/properties' }),
      b('agents', { title: 'Talk to an agent', subtitle: 'Call or message the agent for any listing', limit: 4 }),
      b('calculators', { title: 'Work out your monthly payment', subtitle: '' }),
      b('reviews', { title: 'What our customers say' }),
      b('contact', { title: 'Ask us about a property' }),
    ],
  },
  {
    id: 'portfolio', name: 'Portfolio (developer showcase)', best: 'Developers and builders who want to show finished and ongoing work',
    tagline: 'Image-led: projects, gallery, the team, partners and testimonials.',
    theme: { primary: '#111827', accent: '#b8962e', dark: '#0b0f19', bg: '#ffffff', soft: '#f6f4ef', font_heading: 'Playfair Display', font_body: 'Inter', radius: 4 },
    blocks: [
      b('hero', { headline: 'Places built with care', subheadline: 'A selection of our projects, past and present.', show_search: false, height: 'tall', overlay: 45 }),
      b('stats', { items: [{ value: '', label: 'Add your own figure' }, { value: '', label: 'Add your own figure' }, { value: '', label: 'Add your own figure' }] }),
      b('projects', { title: 'Our projects', subtitle: 'Follow the progress of each one', limit: 6 }),
      b('gallery', { title: 'Gallery', images: [] }),
      b('imagetext', { title: 'Our approach', text: 'Describe how you plan, build and look after a project, in a few sentences.', image: '', image_side: 'right' }),
      b('leadership', { title: 'The team', subtitle: '' }),
      b('partners', { title: 'Our partners' }),
      b('reviews', { title: 'What clients say' }),
      b('cta', { headline: 'Planning a project?', text: 'Tell us about it and we will get back to you.', button_label: 'Start a conversation', button_href: '/site/p/contact', tone: 'dark' }),
    ],
  },
  {
    id: 'dual', name: 'Dual purpose (sales and construction)', best: 'Companies that sell property and also build or renovate',
    tagline: 'Two services side by side: listings and projects, with both calculators.',
    theme: { primary: '#0f766e', accent: '#f59e0b', dark: '#0a3d3a', bg: '#ffffff', soft: '#f4f7f6', font_heading: 'Poppins', font_body: 'Inter', radius: 12 },
    blocks: [
      b('hero', { headline: 'Buy it, build it, or both', subheadline: 'Find a property, or let us build exactly what you want.', show_search: true, height: 'tall' }),
      b('services', { title: 'What we do', items: [{ icon: '🏡', title: 'Property sales', text: 'Browse verified listings with clear payment plans.', href: '/site/properties' }, { icon: '🏗️', title: 'Construction', text: 'Plan, budget and build with a team you can follow online.', href: '/site/p/contact' }, { icon: '🔑', title: 'Customer portal', text: 'See payments, documents and progress in one place.', href: '/portal/login' }] }),
      b('listings', { title: 'Featured properties', source: 'featured', limit: 8, layout: 'carousel', view_all_href: '/site/properties' }),
      b('projects', { title: 'Projects we are building', limit: 3 }),
      b('calculators', { title: 'Plan your purchase and your build', subtitle: 'Estimate a monthly payment or the cost to build.' }),
      b('booking', {}),
      b('partners', { title: 'Our partners' }),
      b('reviews', { title: 'Customer reviews' }),
      b('contact', { title: 'Contact us' }),
    ],
  },
  {
    id: 'construction', name: 'Construction company', best: 'Contractors and builders',
    tagline: 'Services, projects, track record, cost calculator and FAQs.',
    theme: { primary: '#b45309', accent: '#0f172a', dark: '#1c1917', bg: '#ffffff', soft: '#faf7f2', font_heading: 'Montserrat', font_body: 'Open Sans', radius: 6 },
    blocks: [
      b('hero', { headline: 'Reliable building, on time and on budget', subheadline: 'Residential and commercial construction with clear costs.', show_search: false, height: 'medium' }),
      b('services', { title: 'What we build', items: [{ icon: '🏠', title: 'Houses', text: 'New homes from plan to handover.', href: '/site/p/contact' }, { icon: '🏢', title: 'Commercial', text: 'Offices, shops and plazas.', href: '/site/p/contact' }, { icon: '🛠️', title: 'Renovation', text: 'Extensions and refurbishment.', href: '/site/p/contact' }] }),
      b('projects', { title: 'Recent projects', limit: 6 }),
      b('projectinfo', { title: 'Our track record' }),
      b('calculators', { title: 'Estimate your construction cost', subtitle: '' }),
      b('faq', { title: 'Questions we are often asked', items: [{ q: 'How do I get a quote?', a: 'Send us the plan or the plot size and we will prepare an estimate.' }] }),
      b('reviews', { title: 'What clients say' }),
      b('contact', { title: 'Request a quote' }),
    ],
  },
  {
    id: 'agent', name: 'Personal brand (agent or broker)', best: 'Individual agents who want a simple, personal site',
    tagline: 'Short page: who you are, your listings, reviews, blog and contact.',
    theme: { primary: '#7c3aed', accent: '#ec4899', dark: '#2e1065', bg: '#ffffff', soft: '#f7f5fb', font_heading: 'DM Sans', font_body: 'DM Sans', radius: 16 },
    blocks: [
      b('hero', { headline: 'Your property partner', subheadline: 'Honest advice and a smooth experience, from the first viewing to the keys.', show_search: false, height: 'medium' }),
      b('imagetext', { title: 'About me', text: 'Introduce yourself: your area, your experience and how you work.', image: '', image_side: 'left' }),
      b('listings', { title: 'My listings', source: 'latest', limit: 6, layout: 'grid', view_all_href: '/site/properties' }),
      b('reviews', { title: 'What clients say' }),
      b('blog', { title: 'Notes from the market', limit: 3 }),
      b('contact', { title: 'Get in touch' }),
    ],
  },
  {
    id: 'blank', name: 'Blank canvas', best: 'Build exactly what you want from scratch',
    tagline: 'An empty page. Add any of the blocks yourself: columns, text, images, forms, listings, embeds and more.',
    theme: null,
    blocks: [b('text', { title: 'Start building', html: 'Open the “Add blocks” tab and drag blocks onto the page.', align: 'left' })],
  },
];

/** The blocks of a template as page sections: each block's default options, then the template's own text, with fresh ids. */
export function buildSections(t) {
  return t.blocks.map(({ type, over }) => ({ id: uid(), type, props: { ...JSON.parse(JSON.stringify(SECTION_TYPES[type]?.defaults || {})), ...JSON.parse(JSON.stringify(over)) } }));
}
