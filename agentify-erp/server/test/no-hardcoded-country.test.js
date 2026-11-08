// A ratchet against Pakistan-only wording creeping back into code that every country uses. The words PKR, en-PK,
// Crore, Lakh, Marla and Kanal may appear in the Pakistan pack, shared/region (which implements the Pakistani style),
// the Pakistan blog articles (server/src/content/blog-pk-*.json, written for a Pakistani audience), tests and the places listed in test/golden/pk-tokens.json (billing prices, the original company's starter website...).
// A count in any other file may go down, never up, and a new file may not use them at all.
//   UPDATE_TOKENS=1 node --test test/no-hardcoded-country.test.js   re-records the baseline (review the diff first)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = path.join(root, 'server', 'test', 'golden', 'pk-tokens.json');
const TOKEN = /PKR|en-PK|Crore|Lakh|Marla|Kanal/g;
const ROOTS = ['client/src', 'server/src', 'shared'];
const ALLOWED = [/^server\/src\/content\/blog-pk-/, /^server\/src\/regions\/packs\/PK\.json$/, /^shared\/region\//, /^client\/src\/locales\//];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); } else if (/\.(jsx?|json|css)$/.test(e.name)) out.push(p);
  }
  return out;
}
function scan() {
  const counts = {};
  for (const r of ROOTS) for (const f of walk(path.join(root, r))) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (ALLOWED.some((a) => a.test(rel))) continue;
    const n = (fs.readFileSync(f, 'utf8').match(TOKEN) || []).length;
    if (n) counts[rel] = n;
  }
  return counts;
}

test('Pakistan-only wording does not spread into shared code', () => {
  const now = scan();
  if (process.env.UPDATE_TOKENS) { fs.writeFileSync(BASE, JSON.stringify(now, null, 2) + '\n'); return; }
  const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  const worse = Object.entries(now).filter(([f, n]) => n > (base[f] || 0)).map(([f, n]) => `${f}: ${n} (allowed ${base[f] || 0})`);
  assert.deepEqual(worse, [], 'new PKR / en-PK / Crore / Lakh / Marla / Kanal wording outside the Pakistan pack; use the region helpers instead');
});
