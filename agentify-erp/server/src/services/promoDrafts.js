// Ready-made draft posts for Agentify's character promo videos. The two MP4s ship with the app (server/assets/promo) and are
// served publicly at /promo-media/<file>, so the content calendar can point at them like any other media address. Nothing is
// posted: each entry is a draft the social media manager reviews, schedules and publishes on the channel themselves.
import { listPosts, createPost } from './contentCalendar.js';

export const PROMO_FILES = {
  characters: { vertical: 'characters-promo-9x16.mp4', horizontal: 'characters-promo-16x9.mp4' },
  kinetic: { vertical: 'kinetic-promo-9x16.mp4', horizontal: 'kinetic-promo-16x9.mp4' },
  receipt: { vertical: 'receipt-promo-9x16.mp4', horizontal: 'receipt-promo-16x9.mp4' },
  synq: { vertical: 'synq-promo-9x16.mp4', horizontal: 'synq-promo-16x9.mp4' },
  global: { vertical: 'global-promo-9x16.mp4', horizontal: 'global-promo-16x9.mp4' },
  urdu: { vertical: 'urdu-promo-9x16.mp4', horizontal: 'urdu-promo-16x9.mp4' },
};
export const PROMO_FILE_NAMES = Object.values(PROMO_FILES).flatMap((v) => Object.values(v));
const SITE = 'https://agentifyerp.co';
const TAGS = '#AgentifyERP #RealEstate #Construction #PropTech #ERP';

const HOLD = 'DO NOT POST: this video shows the seller partner Sync Technologies\' logo and name, and the partner\'s consent to use them is not confirmed yet. Keep this as a draft until the owner confirms consent in writing. ';
// Each video has its own caption per shape. Titles stay the same once shipped: they are how a re-run knows a draft exists.
const URDU_NOTE = 'Urdu promo with a spoken voice-over. The voice is a neural Hindi voice reading the same spoken Hindustani, so a native Urdu speaker should listen to it and read the on-screen text before it is posted. ';
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
  receipt: {
    titlePrefix: 'Promo video 3 (receipts)',
    vertical: { body: `Where is your receipt? Lost in chats. Buried in emails. Gone in a file.\n\nWith Agentify ERP every payment is recorded and the receipt goes out instantly. Start your free trial: agentifyerp.co\n\n${TAGS} #Payments`, notes: 'Receipts promo, vertical 9:16 (27s). Upload the file from the media address, then paste the caption.' },
    horizontal: { body: `Stop chasing paper. Agentify ERP records every payment and sends the receipt instantly, with installments, sites and customers all in one place.\n\nStart your free trial: agentifyerp.co\n\n${TAGS} #Payments`, notes: 'Receipts promo, horizontal 16:9 (27s). Upload the file from the media address, then paste the caption.' },
  },
  synq: {
    titlePrefix: 'ON HOLD (partner consent) Promo video 4 (Sync Technologies)',
    vertical: { body: `Every payment recorded, every receipt sent instantly. Proudly sold and supported by our seller partner, Sync Technologies.\n\nStart your free trial: agentifyerp.co\n\n${TAGS} #Payments`, notes: `${HOLD}Partner promo, vertical 9:16 (32s). Upload the file from the media address, then paste the caption.` },
    horizontal: { body: `Stop chasing paper. Agentify ERP records every payment and sends the receipt instantly. Proudly sold and supported by our seller partner, Sync Technologies.\n\nStart your free trial: agentifyerp.co\n\n${TAGS} #Payments`, notes: `${HOLD}Partner promo, horizontal 16:9 (32s). Upload the file from the media address, then paste the caption.` },
  },
  global: {
    titlePrefix: 'Promo video 5 (run from anywhere)',
    vertical: { body: `Run your agency from anywhere. Leads, sales, installments and sites in one workspace. Record a payment, pick how they paid, and the receipt is sent.\n\nTeams in Pakistan, the US, the UK, the UAE and Canada work in their own currency and rules. Start your 7-day free trial: agentifyerp.co\n\n${TAGS} #Payments`, notes: 'Run-from-anywhere promo, vertical 9:16 (32s). Figures in the video are sample data. Upload the file from the media address, then paste the caption.' },
    horizontal: { body: `Leads, sales, installments and sites no longer live in separate places. Agentify ERP is one workspace for real estate and construction teams, with payments, receipts and customers together, in your own currency and rules.\n\nStart your 7-day free trial: agentifyerp.co\n\n${TAGS} #Payments`, notes: 'Run-from-anywhere promo, horizontal 16:9 (32s). Figures in the video are sample data. Upload the file from the media address, then paste the caption.' },
  },
  urdu: {
    titlePrefix: 'Promo video 6 (Urdu)',
    vertical: { body: `گاہک کی کال آئی اور کسی نے فون نہیں اٹھایا؟ اب نہیں۔\n\nایجنٹیفائی ای آر پی کے ساتھ ہر لیڈ کو فوری جواب ملتا ہے، چوبیس گھنٹے۔ سیلز، اکاؤنٹس اور کنسٹرکشن ایک ہی سسٹم میں۔\n\nسات دن کا مفت ٹرائل شروع کریں: agentifyerp.co\n\n${TAGS} #Urdu`, notes: `${URDU_NOTE}Urdu promo, vertical 9:16 (34s). Upload the file from the media address, then paste the caption.` },
    horizontal: { body: `ادائیگیاں وقت پر، سائٹس شیڈول کے مطابق، کسٹمر ہمیشہ باخبر۔ ایجنٹیفائی ای آر پی ریئل اسٹیٹ اور کنسٹرکشن ٹیموں کے لیے سیلز، اکاؤنٹس اور سائٹس کو ایک ہی سسٹم میں جمع کرتا ہے۔\n\nسات دن کا مفت ٹرائل شروع کریں: agentifyerp.co\n\n${TAGS} #Urdu`, notes: `${URDU_NOTE}Urdu promo, horizontal 16:9 (34s). Upload the file from the media address, then paste the caption.` },
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
