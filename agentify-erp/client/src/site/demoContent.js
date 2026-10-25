// Sample content for theme previews and the editor canvas. Photos ship with the app (client/public/site/theme-*.jpg) and are
// copied into a theme's blocks when the workspace has no listing photos yet, so every picture can be swapped in the editor.
// The sample listings, agents and articles below are shown ONLY in the editor and theme previews, never to visitors: the live
// website always shows the workspace's real data (or nothing).

export const DEMO_PHOTOS = ['/site/theme-house.jpg', '/site/theme-meeting.jpg', '/site/theme-viewing.jpg'];
export const DEMO_NAMED = {
  house: '/site/theme-house.jpg', meeting: '/site/theme-meeting.jpg', viewing: '/site/theme-viewing.jpg',
  'agent-1': '/site/theme-agent-1.jpg', 'agent-2': '/site/theme-agent-2.jpg', 'agent-3': '/site/theme-agent-3.jpg',
};

const L = (id, title, purpose, price, cover, extra) => ({ id: `sample-${id}`, sample: true, title, purpose, price, cover, city: 'Your city', area_name: 'Sample area', type: 'Houses', ...extra });
export const DEMO_LISTINGS = [
  L(1, 'Modern family home with garden', 'Sell', 45000000, DEMO_PHOTOS[0], { area: 10, unit: 'Marla', bedrooms: 4, bathrooms: 4, featured: true, installment: true }),
  L(2, 'Bright apartment near the park', 'Rent', 120000, DEMO_PHOTOS[2], { area: 1450, unit: 'sq ft', bedrooms: 3, bathrooms: 2, type: 'Apartments' }),
  L(3, 'Corner house, ready to move in', 'Sell', 32000000, DEMO_PHOTOS[0], { area: 7, unit: 'Marla', bedrooms: 3, bathrooms: 3, ready: true }),
  L(4, 'Family home close to schools', 'Rent', 95000, DEMO_PHOTOS[2], { area: 5, unit: 'Marla', bedrooms: 3, bathrooms: 2 }),
  L(5, 'Spacious villa with garage', 'Sell', 68000000, DEMO_PHOTOS[0], { area: 1, unit: 'Kanal', bedrooms: 5, bathrooms: 6, featured: true }),
  L(6, 'Townhouse in a gated community', 'Sell', 27500000, DEMO_PHOTOS[2], { area: 5, unit: 'Marla', bedrooms: 3, bathrooms: 3, installment: true }),
  L(7, 'Studio flat for young professionals', 'Rent', 55000, DEMO_PHOTOS[0], { area: 600, unit: 'sq ft', bedrooms: 1, bathrooms: 1, type: 'Apartments' }),
  L(8, 'Plot in a developing block', 'Sell', 9500000, null, { area: 10, unit: 'Marla', type: 'Plots', bedrooms: null, bathrooms: null }),
];

export const DEMO_AGENTS = [
  { id: 'sample-a1', sample: true, name: 'Sample Agent', role: 'Sales Manager', listings: 12, photo: DEMO_NAMED['agent-1'] },
  { id: 'sample-a2', sample: true, name: 'Sample Agent', role: 'Agent', listings: 8, photo: DEMO_NAMED['agent-2'] },
  { id: 'sample-a3', sample: true, name: 'Sample Agent', role: 'Agent', listings: 5, photo: DEMO_NAMED['agent-3'] },
];

export const DEMO_POSTS = [
  { id: 'sample-p1', sample: true, slug: '', title: 'Five things to check before you buy', excerpt: 'Write short guides that answer your buyers’ common questions.', cover: DEMO_PHOTOS[0] },
  { id: 'sample-p2', sample: true, slug: '', title: 'How we price a home for sale', excerpt: 'Explain your valuation process so sellers trust it.', cover: DEMO_PHOTOS[1] },
  { id: 'sample-p3', sample: true, slug: '', title: 'A first-time renter’s checklist', excerpt: 'Help tenants prepare for viewings and paperwork.', cover: DEMO_PHOTOS[2] },
];
