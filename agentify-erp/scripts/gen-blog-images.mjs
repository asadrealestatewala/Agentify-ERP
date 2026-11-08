// Generates the blog images in client/public/blog-img/ from the article data (brand teal illustrations, no photos).
//   node scripts/gen-blog-images.mjs
// For every article: <slug>.webp and <slug>.jpg (1600x900) and <slug>-og.jpg (1200x630, for link previews),
// plus blog-index-og.jpg. Needs Playwright (Chromium) and ImageMagick's `convert`.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { BLOG_POSTS } from '../server/src/services/blog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'client', 'public', 'blog-img');
const tmp = path.join(out, '.tmp');
fs.mkdirSync(tmp, { recursive: true });
const { chromium } = createRequire(import.meta.url)('playwright');

const T = '#0e7c6b', T2 = '#0a5c50', MINT = '#9fe7da', INK = '#073f37';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Shorter on-image headlines for the first five articles (the others use their target keyword).
const LABEL = {
  'real-estate-crm-for-brokerages': 'Real estate CRM for brokerages',
  'property-installment-tracking-software': 'Property installment tracking',
  'construction-boq-and-budget-software': 'BOQ, budgets and cost control',
  'whatsapp-lead-follow-up-for-property-agents': 'WhatsApp lead follow-up',
  'erp-for-small-real-estate-and-construction-businesses': 'ERP for small property and construction firms',
};
const MOTIF = {
  'real-estate-crm-for-brokerages': 'people', 'property-installment-tracking-software': 'calendar', 'construction-boq-and-budget-software': 'boq',
  'whatsapp-lead-follow-up-for-property-agents': 'chat', 'erp-for-small-real-estate-and-construction-businesses': 'modules',
  'property-dealer-software-pakistan': 'house', 'real-estate-crm-pakistan-checklist': 'people', 'housing-society-software-pakistan': 'plots',
  'plot-file-management-system-pakistan': 'files', 'installment-defaulters-follow-up-pakistan': 'calendar', 'real-estate-agent-commission-tracking-pakistan': 'coins',
  'property-lead-sources-pakistan-one-list': 'funnel', 'property-dealer-crm-roman-urdu': 'people', 'lead-follow-up-roman-urdu': 'chat',
  'property-taxes-agent-records-pakistan': 'shield', 'property-sale-documents-checklist-pakistan': 'files', 'payment-receipts-property-pakistan': 'receipt',
  'real-estate-accounting-pakistan': 'chart', 'real-estate-website-for-agents-pakistan': 'browser', 'construction-management-software-pakistan': 'crane',
  'boq-excel-vs-software-pakistan': 'boq', 'construction-purchase-orders-material-control': 'truck', 'labour-subcontractor-payments-pakistan': 'workers',
  'construction-client-billing-progress-pakistan': 'invoice', 'grey-structure-cost-tracking-pakistan': 'bricks',
};

const W = (x) => `fill="#fff" ${x || ''}`;
const card = (inner) => `<g transform="translate(900 150)"><rect width="600" height="600" rx="44" fill="#fff" fill-opacity=".10" stroke="#fff" stroke-opacity=".25" stroke-width="2"/><g transform="translate(0 0)">${inner}</g></g>`;
const person = (x, y, s = 1, c = '#fff') => `<g transform="translate(${x} ${y}) scale(${s})"><circle cx="0" cy="-34" r="26" fill="${c}"/><path d="M-48 40c0-34 22-54 48-54s48 20 48 54z" fill="${c}"/></g>`;
const bar = (x, y, w, h, c = '#fff', o = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${c}" fill-opacity="${o}"/>`;
const ICON = {
  people: () => card(`${person(300, 270, 1.6)}${person(150, 330, 1, MINT)}${person(450, 330, 1, MINT)}${bar(110, 460, 380, 22, '#fff', .5)}${bar(110, 505, 260, 22, '#fff', .3)}`),
  house: () => card(`<path d="M90 300 300 120l210 180v220H90z" fill="#fff"/><path d="M60 310 300 100l240 210" fill="none" stroke="${MINT}" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/><rect x="250" y="370" width="100" height="150" rx="10" fill="${T}"/><rect x="130" y="340" width="80" height="70" rx="8" fill="${MINT}"/><rect x="390" y="340" width="80" height="70" rx="8" fill="${MINT}"/>`),
  calendar: () => card(`<rect x="100" y="130" width="400" height="360" rx="30" fill="#fff"/><rect x="100" y="130" width="400" height="90" rx="30" fill="${MINT}"/>${[0, 1, 2, 3].map((i) => bar(140 + i * 85, 250, 60, 50, T, i === 2 ? 1 : .25)).join('')}${[0, 1, 2, 3].map((i) => bar(140 + i * 85, 330, 60, 50, T, i === 1 ? 1 : .25)).join('')}${[0, 1, 2].map((i) => bar(140 + i * 85, 410, 60, 50, T, .25)).join('')}<circle cx="440" cy="440" r="70" fill="${MINT}" stroke="#fff" stroke-width="10"/><path d="M405 440l25 25 45-50" fill="none" stroke="${INK}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`),
  coins: () => card(`${[0, 1, 2, 3].map((i) => `<ellipse cx="220" cy="${430 - i * 46}" rx="110" ry="36" fill="${i % 2 ? MINT : '#fff'}"/>`).join('')}${[0, 1, 2].map((i) => `<ellipse cx="400" cy="${450 - i * 46}" rx="95" ry="32" fill="${i % 2 ? '#fff' : MINT}"/>`).join('')}${person(310, 190, 1, '#fff')}`),
  chat: () => card(`<path d="M110 150h300a40 40 0 0 1 40 40v150a40 40 0 0 1-40 40H250l-80 70v-70h-60a40 40 0 0 1-40-40V190a40 40 0 0 1 40-40z" transform="translate(0 0)" fill="#fff"/>${bar(150, 215, 240, 20, T, .5)}${bar(150, 262, 180, 20, T, .3)}<path d="M200 430h250a40 40 0 0 1 40 40v40a40 40 0 0 1-40 40h-30v50l-70-50h-150a40 40 0 0 1-40-40v-40a40 40 0 0 1 40-40z" transform="translate(40 -40)" fill="${MINT}"/>${bar(280, 450, 150, 18, INK, .5)}`),
  files: () => card(`<rect x="170" y="110" width="300" height="380" rx="26" fill="#fff" fill-opacity=".45"/><rect x="130" y="140" width="300" height="380" rx="26" fill="#fff" fill-opacity=".7"/><rect x="90" y="170" width="300" height="380" rx="26" fill="#fff"/>${bar(130, 220, 160, 22, T, .8)}${bar(130, 270, 220, 16, T, .3)}${bar(130, 310, 200, 16, T, .3)}${bar(130, 350, 220, 16, T, .3)}<circle cx="430" cy="470" r="62" fill="${MINT}" stroke="#fff" stroke-width="10"/><path d="M400 470l22 22 40-46" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`),
  plots: () => card(`<rect x="90" y="120" width="420" height="360" rx="26" fill="#fff"/>${[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => `<rect x="${112 + c * 100}" y="${142 + r * 108}" width="88" height="94" rx="10" fill="${(r + c) % 3 === 0 ? T : MINT}" fill-opacity="${(r + c) % 3 === 0 ? 1 : .55}"/>`).join('')).join('')}${bar(90, 515, 300, 22, '#fff', .5)}`),
  funnel: () => card(`<path d="M80 130h440l-150 190v150l-140 60V320z" fill="#fff"/><path d="M80 130h440l-40 50H120z" fill="${MINT}"/>${[130, 230, 330, 430, 480].map((x, i) => `<circle cx="${x}" cy="${88 + (i % 2) * 20}" r="12" fill="${MINT}"/>`).join('')}${bar(230, 520, 140, 22, '#fff', .5)}`),
  shield: () => card(`<path d="M300 90 120 160v140c0 120 76 190 180 230 104-40 180-110 180-230V160z" fill="#fff"/><path d="M300 90 120 160v140c0 120 76 190 180 230z" fill="${MINT}" fill-opacity=".55"/><path d="M215 310l60 62 112-124" fill="none" stroke="${T}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>`),
  receipt: () => card(`<path d="M130 100h340v400l-40-28-43 28-43-28-43 28-43-28-43 28-42-28-43 28z" fill="#fff"/>${bar(180, 160, 150, 22, T, .8)}${bar(180, 215, 240, 16, T, .3)}${bar(180, 255, 240, 16, T, .3)}${bar(180, 295, 200, 16, T, .3)}<rect x="180" y="350" width="240" height="2" fill="${T}" fill-opacity=".3"/>${bar(180, 380, 120, 22, T, .8)}<circle cx="400" cy="400" r="46" fill="${MINT}"/><path d="M380 402l14 14 28-32" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`),
  chart: () => card(`<rect x="80" y="110" width="440" height="380" rx="26" fill="#fff"/>${[120, 200, 150, 280, 230, 330].map((h, i) => `<rect x="${118 + i * 66}" y="${440 - h}" width="44" height="${h}" rx="9" fill="${i % 2 ? T : MINT}"/>`).join('')}<path d="M120 330 220 270 300 300 400 200 480 160" fill="none" stroke="${INK}" stroke-opacity=".55" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>${bar(80, 520, 300, 22, '#fff', .45)}`),
  browser: () => card(`<rect x="70" y="120" width="460" height="360" rx="26" fill="#fff"/><path d="M70 146a26 26 0 0 1 26-26h408a26 26 0 0 1 26 26v50H70z" fill="${MINT}"/>${[0, 1, 2].map((i) => `<circle cx="${110 + i * 32}" cy="158" r="9" fill="${T}" fill-opacity=".7"/>`).join('')}<rect x="110" y="228" width="190" height="130" rx="14" fill="${MINT}" fill-opacity=".6"/><path d="M110 358 190 280l50 50 40-30 20 58z" fill="${T}" fill-opacity=".5"/>${bar(325, 232, 160, 20, T, .6)}${bar(325, 274, 150, 14, T, .25)}${bar(325, 306, 130, 14, T, .25)}<rect x="325" y="340" width="120" height="40" rx="12" fill="${T}"/>${bar(110, 400, 360, 14, T, .2)}${bar(110, 432, 260, 14, T, .2)}`),
  crane: () => card(`<rect x="80" y="505" width="440" height="22" rx="8" fill="#fff"/><rect x="110" y="300" width="170" height="205" fill="#fff" fill-opacity=".85"/>${[0, 1].map((r) => [0, 1].map((c) => `<rect x="${132 + c * 70}" y="${325 + r * 80}" width="42" height="52" rx="6" fill="${T}" fill-opacity=".45"/>`).join('')).join('')}<rect x="400" y="130" width="22" height="375" fill="#fff"/><path d="M400 130h-300l50-50h250z" fill="${MINT}"/><path d="M410 130 140 130M410 130 480 130" stroke="#fff" stroke-width="10"/><rect x="480" y="120" width="40" height="34" rx="6" fill="#fff"/><path d="M160 135v150" stroke="#fff" stroke-width="6"/><rect x="130" y="285" width="60" height="40" rx="6" fill="${MINT}"/>`),
  boq: () => card(`<rect x="80" y="110" width="440" height="400" rx="26" fill="#fff"/>${bar(100, 135, 400, 44, MINT)}${[0, 1, 2, 3].map((r) => `${bar(110, 208 + r * 66, 70, 36, T, .25)}${bar(196, 208 + r * 66, 190, 36, T, .12)}${bar(402, 208 + r * 66, 88, 36, T, r === 3 ? .8 : .3)}`).join('')}<path d="M80 540h300" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-dasharray="4 28"/>`),
  truck: () => card(`<rect x="70" y="230" width="300" height="200" rx="18" fill="#fff"/><path d="M370 290h90l70 70v70H370z" fill="${MINT}"/><rect x="410" y="310" width="60" height="50" rx="8" fill="${T}" fill-opacity=".5"/><circle cx="180" cy="450" r="46" fill="${INK}"/><circle cx="180" cy="450" r="20" fill="#fff"/><circle cx="440" cy="450" r="46" fill="${INK}"/><circle cx="440" cy="450" r="20" fill="#fff"/>${[0, 1, 2].map((i) => `<rect x="${95 + i * 90}" y="${180 - (i % 2) * 8}" width="76" height="62" rx="8" fill="${MINT}" stroke="#fff" stroke-width="6"/>`).join('')}`),
  workers: () => card(`${[150, 300, 450].map((x, i) => `<g transform="translate(${x} 300)"><path d="M-44 -62a44 44 0 0 1 88 0z" fill="${i === 1 ? MINT : '#fff'}"/><rect x="-54" y="-64" width="108" height="14" rx="7" fill="${i === 1 ? MINT : '#fff'}"/><circle cx="0" cy="-30" r="26" fill="#fff" fill-opacity=".9"/><path d="M-52 80c0-40 24-64 52-64s52 24 52 64z" fill="${i === 1 ? MINT : '#fff'}"/></g>`).join('')}${bar(110, 440, 380, 24, '#fff', .55)}${bar(110, 486, 260, 24, '#fff', .3)}`),
  invoice: () => card(`<rect x="130" y="90" width="340" height="430" rx="26" fill="#fff"/>${bar(170, 140, 160, 24, T, .8)}${bar(170, 190, 220, 14, T, .25)}${[0, 1, 2].map((r) => `${bar(170, 240 + r * 52, 140, 22, T, .2)}${bar(340, 240 + r * 52, 90, 22, T, .35)}`).join('')}<rect x="170" y="410" width="260" height="2" fill="${T}" fill-opacity=".3"/>${bar(280, 430, 150, 30, T)}<circle cx="170" cy="480" r="0" fill="none"/><g transform="translate(430 470)"><circle r="64" fill="${MINT}" stroke="#fff" stroke-width="10"/><path d="M-26 2l20 22 36-44" fill="none" stroke="${INK}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/></g>`),
  bricks: () => card(`${[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3].map((c) => { const off = r % 2 ? 50 : 0; const x = 80 + c * 112 - off; if (x < 70 || x > 450) return ''; return `<rect x="${x}" y="${150 + r * 78}" width="104" height="66" rx="8" fill="${(r + c) % 4 === 0 ? MINT : '#fff'}" fill-opacity="${(r + c) % 4 === 0 ? 1 : .9}"/>`; }).join('')).join('')}${bar(70, 550, 460, 14, '#fff', .45)}`),
  modules: () => card(`${[[90, 120, '#fff'], [320, 120, MINT], [90, 330, MINT], [320, 330, '#fff']].map(([x, y, c]) => `<rect x="${x}" y="${y}" width="190" height="190" rx="28" fill="${c}"/>${bar(x + 28, y + 46, 100, 18, T, .55)}${bar(x + 28, y + 86, 130, 14, T, .25)}${bar(x + 28, y + 118, 80, 14, T, .25)}`).join('')}<circle cx="300" cy="320" r="40" fill="${T}" stroke="#fff" stroke-width="10"/>`),
};

const logo = `<g transform="translate(80 84)"><rect width="64" height="64" rx="16" fill="#fff"/><path d="M14 48V28l18-13 18 13v20H38V34H26v14z" fill="${T}"/></g><text x="162" y="127" font-family="Inter, sans-serif" font-weight="700" font-size="34" fill="#fff">Agentify ERP</text>`;

function wrap(text, max) {
  const lines = []; let cur = '';
  for (const w of text.split(/\s+/)) { if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  return lines;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function svg({ label, tag, motif }) {
  let size = 72, lines = wrap(label, 18);
  if (lines.length > 3) { size = 58; lines = wrap(label, 22); }
  const y0 = 470 - ((lines.length - 1) * (size * 1.18)) / 2;
  const text = lines.map((l, i) => `<text x="80" y="${y0 + i * size * 1.18}" font-family="Inter, sans-serif" font-weight="800" font-size="${size}" fill="#fff">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${T}"/><stop offset="1" stop-color="${T2}"/></linearGradient>
<pattern id="d" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="#fff" fill-opacity=".10"/></pattern></defs>
<rect width="1600" height="900" fill="url(#g)"/><rect width="1600" height="900" fill="url(#d)"/>
<circle cx="1500" cy="80" r="360" fill="#fff" fill-opacity=".05"/><circle cx="1180" cy="900" r="300" fill="${MINT}" fill-opacity=".08"/>
${logo}
<g transform="translate(80 ${y0 - size - 70})"><rect width="${tag.length * 15 + 56}" height="46" rx="23" fill="#fff" fill-opacity=".16"/><text x="28" y="31" font-family="Inter, sans-serif" font-weight="600" font-size="22" fill="${MINT}">${esc(tag.toUpperCase())}</text></g>
${text}
<text x="80" y="840" font-family="Inter, sans-serif" font-weight="500" font-size="26" fill="#fff" fill-opacity=".75">agentifyerp.co/blog</text>
${(ICON[motif] || ICON.house)()}
</svg>`;
}

const jobs = BLOG_POSTS.map((p) => ({ slug: p.slug, label: LABEL[p.slug] || cap(p.keyword || p.title), tag: p.tag, motif: MOTIF[p.slug] || 'house' }));
jobs.push({ slug: 'blog-index', label: 'Guides for real estate and construction teams', tag: 'Blog', motif: 'modules' });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
let bytes = 0;
for (const j of jobs) {
  const f = path.join(tmp, `${j.slug}.svg`);
  fs.writeFileSync(f, svg(j));
  await page.goto('file://' + f);
  const png = path.join(tmp, `${j.slug}.png`);
  await page.screenshot({ path: png });
  const name = j.slug === 'blog-index' ? 'blog-index' : j.slug;
  if (j.slug !== 'blog-index') {
    execFileSync('convert', [png, '-quality', '82', '-define', 'webp:method=6', path.join(out, `${name}.webp`)]);
    execFileSync('convert', [png, '-quality', '84', '-sampling-factor', '4:2:0', '-strip', '-interlace', 'Plane', path.join(out, `${name}.jpg`)]);
  }
  // 1200x630 link-preview image: same artwork, cropped to the 1.91:1 shape
  execFileSync('convert', [png, '-resize', '1200x', '-gravity', 'center', '-crop', '1200x630+0+0', '+repage', '-quality', '84', '-strip', '-interlace', 'Plane', path.join(out, `${name}-og.jpg`)]);
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
for (const f of fs.readdirSync(out)) bytes += fs.statSync(path.join(out, f)).size;
console.log(`${jobs.length} images sets, ${fs.readdirSync(out).length} files, ${(bytes / 1048576).toFixed(1)} MB`);
