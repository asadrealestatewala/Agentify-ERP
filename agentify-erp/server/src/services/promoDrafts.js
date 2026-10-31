// Ready-made draft posts for Agentify's character promo videos. The two MP4s ship with the app (server/assets/promo) and are
// served publicly at /promo-media/<file>, so the content calendar can point at them like any other media address. Nothing is
// posted: each entry is a draft the social media manager reviews, schedules and publishes on the channel themselves.
import { listPosts, createPost } from './contentCalendar.js';

export const PROMO_FILES = {
  characters: { vertical: 'characters-promo-9x16.mp4', horizontal: 'characters-promo-16x9.mp4' },
  kinetic: { vertical: 'kinetic-promo-9x16.mp4', horizontal: 'kinetic-promo-16x9.mp4' },
};
export const PROMO_FILE_NAMES = Object.values(PROMO_FILES).flatMap((v) => Object.values(v));
const SITE = 'https://agentifyerp.co';
const TAGS = '#AgentifyERP #RealEstate #Construction #PropTech #ERP';

// Each video has its own caption per shape. Titles stay the same once shipped: they are how a re-run knows a draft exists.
const SERIES = {
  characters: {
    titlePrefix: 'Promo video',
    vertical: { body: `Meet Sara, Imran and Ayesha: an agent, a site manager and a customer, all on one system. Leads, listings, projects and payments in one place with Agentify ERP.\n\nSee it in action: agentifyerp.co\n\n${TAGS}`, notes: 'Characters promo, vertical 9:16 (56s). Upload the file from the media address, then paste the caption.' },
    horizontal: { body: `One system for real estate and construction teams. Meet Sara (agent), Imran (site manager) and Ayesha (customer) and see how Agentify ERP keeps leads, listings, projects and payments together.\n\nStart a free 7-day trial: agentifyerp.co\n\n${TAGS}`, notes: 'Characters promo, horizontal 16:9 (56s). Upload the file from the media address, then paste the caption.' },
  },
  kinetic: {
    titlePrefix: 'Promo video 2 (fast)',
    vertical: { body: `A buyer is calling. Nobody picks up. Lost lead? Not anymore.\n\nSales, accounts and construction in one system, with Agentify ERP. Start your 7-day free trial: agentifyerp.co\n\n${TAGS} #Leads`, notes: 'Fast promo, vertical 9:16 (26s). Upload the file from the media address, then paste the caption.' },
    horizontal: { body: `Never lose a lead to a missed call. Agentify ERP puts sales, accounts and construction in one system: payments on time, sites on schedule, customers always in the loop.\n\nStart your 7-day free trial: agentifyerp.co\n\n${TAGS} #Leads`, notes: 'Fast promo, horizontal 16:9 (26s). Upload the file from the media address, then paste the caption.' },
  },
};
const PLAN = [
  ['instagram', 'vertical', 'Reels and Stories'], ['tiktok', 'vertical', 'TikTok'], ['youtube', 'vertical', 'YouTube Shorts'], ['whatsapp', 'vertical', 'WhatsApp Status'],
  ['youtube', 'horizontal', 'YouTube'], ['linkedin', 'horizontal', 'LinkedIn'], ['facebook', 'horizontal', 'Facebook'], ['x', 'horizontal', 'X'],
];

/** Adds one draft per channel for each promo video; entries that already exist (same title) are skipped, so it is safe to run again. */
export function addPromoDrafts(baseUrl, by) {
  const have = new Set(listPosts().map((p) => p.title));
  const added = [], skipped = [];
  for (const [key, series] of Object.entries(SERIES)) {
    for (const [channel, shape, label] of PLAN) {
      const title = `${series.titlePrefix}: ${label} (${shape === 'vertical' ? '9:16' : '16:9'})`;
      if (have.has(title)) { skipped.push(title); continue; }
      const t = series[shape];
      added.push(createPost({ title, body: t.body, channel, media_url: `${baseUrl}/promo-media/${PROMO_FILES[key][shape]}`, link: SITE, notes: t.notes }, by));
    }
  }
  return { added, skipped };
}
