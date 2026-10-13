#!/usr/bin/env node
// Re-audits the design tokens.
//
//   node erp-factory/tools/check-token-drift.mjs
//       Compares erp-factory/tokens/design-tokens.css with the EFFECTIVE values in the reference app
//       (agentify-erp/client/src: styles.css -> styles2.css -> styles3.css, plus ACCENTS in theme.js).
//       Exit 1 if the reference changed and the knowledge base was not updated.
//
//   node erp-factory/tools/check-token-drift.mjs --target path/to/new-project/client/src/tokens.css
//       Compares a new project's token file with the factory tokens (catches forked/edited tokens).
//
// No dependencies. Names that exist only in the factory file (e.g. --font-ui, --r-*) are ignored when comparing with the reference.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tokensFile = path.join(root, 'erp-factory', 'tokens', 'design-tokens.css');
const refDir = path.join(root, 'agentify-erp', 'client', 'src');

const norm = (v) => v.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').toLowerCase();
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Collect `--var: value` pairs from blocks whose selector is exactly `selector`; later blocks override earlier ones. */
function vars(css, selector) {
  const out = new Map();
  for (const m of strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim().replace(/\s+/g, ' ') !== selector) continue;
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) out.set(d[1], norm(d[2]));
  }
  return out;
}
const merge = (...maps) => maps.reduce((a, m) => { for (const [k, v] of m) a.set(k, v); return a; }, new Map());

function accents(js) {
  const out = new Map();
  for (const m of js.matchAll(/(\w+):\s*\['(#[0-9a-f]{6})',\s*'(#[0-9a-f]{6})',\s*'(#[0-9a-f]{6})'\]/gi)) out.set(m[1], [m[2], m[3], m[4]].map((x) => x.toLowerCase()).join(' '));
  return out;
}
function accentTable(css) {
  const out = new Map();
  for (const m of css.matchAll(/^\s{3}(blue|teal|violet|rose|amber|green)\s+(#[0-9a-f]{6})\s+(#[0-9a-f]{6})\s+(#[0-9a-f]{6})/gim)) out.set(m[1], [m[2], m[3], m[4]].map((x) => x.toLowerCase()).join(' '));
  return out;
}

const args = process.argv.slice(2);
const ti = args.indexOf('--target');
const read = (f) => fs.readFileSync(f, 'utf8');
let problems = 0;
const report = (scope, name, a, b) => { problems += 1; console.log(`DRIFT [${scope}] ${name}\n    expected: ${a}\n    found:    ${b ?? '(missing)'}`); };

const kb = read(tokensFile);
const kbLight = vars(kb, ':root');
const kbDark = vars(kb, ':root[data-theme="dark"]');

if (ti >= 0) {
  const target = path.resolve(args[ti + 1] || '');
  if (!fs.existsSync(target)) { console.error(`target not found: ${target}`); process.exit(2); }
  const t = read(target);
  const tLight = vars(t, ':root'), tDark = vars(t, ':root[data-theme="dark"]');
  for (const [k, v] of kbLight) if (k.startsWith('--r-') || k === '--font-ui' || k.startsWith('--dur') || k === '--ease-out') continue; else if (tLight.get(k) !== v) report('light', k, v, tLight.get(k));
  for (const [k, v] of kbDark) if (tDark.get(k) !== v) report('dark', k, v, tDark.get(k));
  const tAcc = accentTable(t);
  for (const [k, v] of accentTable(kb)) if (tAcc.get(k) !== v) report('accent', k, v, tAcc.get(k));
  console.log(problems ? `\n${problems} difference(s) between ${target} and the factory tokens.` : `OK: ${target} matches the factory tokens.`);
  process.exit(problems ? 1 : 0);
}

const s1 = read(path.join(refDir, 'styles.css')), s2 = read(path.join(refDir, 'styles2.css')), s3 = read(path.join(refDir, 'styles3.css'));
const refLight = merge(vars(s1, ':root'), vars(s2, ':root'), vars(s3, ':root'));
// dark: styles2 then styles3 override, both on top of the light values for variables the dark blocks do not redefine
const refDark = merge(vars(s2, ':root[data-theme="dark"]'), vars(s3, ':root[data-theme="dark"]'));

let checked = 0;
for (const [k, v] of kbLight) {
  if (!refLight.has(k)) continue; // factory-added alias
  checked += 1;
  if (refLight.get(k) !== v) report('light', k, refLight.get(k), v);
}
for (const [k, v] of kbDark) {
  if (!refDark.has(k)) continue;
  checked += 1;
  if (refDark.get(k) !== v) report('dark', k, refDark.get(k), v);
}
// every reference token must exist in the knowledge base, otherwise a new variable was added without documenting it
for (const [k] of refLight) if (!kbLight.has(k)) report('light', k, refLight.get(k), undefined);
for (const [k] of refDark) if (!kbDark.has(k)) report('dark', k, refDark.get(k), undefined);

const refAcc = accents(read(path.join(refDir, 'theme.js'))), kbAcc = accentTable(kb);
for (const [k, v] of refAcc) { checked += 1; if (kbAcc.get(k) !== v) report('accent', k, v, kbAcc.get(k)); }
if (!refAcc.size) { problems += 1; console.log('DRIFT [accent] could not read ACCENTS from theme.js'); }

console.log(problems ? `\n${problems} drift problem(s). Update erp-factory/design + tokens, then re-run.` : `OK: ${checked} tokens/accents in design-tokens.css match the reference app.`);
process.exit(problems ? 1 : 0);
