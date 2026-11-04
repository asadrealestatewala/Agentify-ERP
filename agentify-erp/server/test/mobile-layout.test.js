import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Two-column pages with an inline grid-template-columns must stack on phones, otherwise the
// first column is squeezed to a narrow strip (the property detail page bug).
const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/src');
const mobile = fs.readFileSync(path.join(src, 'mobile.css'), 'utf8');
const styles = fs.readFileSync(path.join(src, 'styles.css'), 'utf8');

function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.jsx') ? [path.join(dir, e.name)] : [])); }

test('property detail, sales and dialer two-column grids opt in to stacking', () => {
  for (const f of ['pages/PropertyDetail.jsx', 'pages/Sales.jsx', 'pages/Dialer.jsx', 'pages/Branding.jsx']) {
    const lines = fs.readFileSync(path.join(src, f), 'utf8').split('\n').filter((l) => /gridTemplateColumns: 'minmax\(0, ?[0-9]?fr?\)? ?\)? ?minmax|gridTemplateColumns: 'minmax\(0,[0-9]fr\) minmax/.test(l) && !/repeat\(/.test(l));
    for (const l of lines) assert.match(l, /data-stack="md"/, `${f} two-column grid must have data-stack="md"`);
  }
});

test('stacking rule and phone guards exist', () => {
  assert.match(styles, /\[data-stack="md"\][^}]*grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(mobile, /\.content \{ padding-bottom: calc\(112px/);
  assert.match(mobile, /\.tabs \{ overflow-x: auto/);
});

test('every fixed-px two-column inline grid stacks via attribute or mobile rule', () => {
  for (const f of files(path.join(src, 'pages'))) {
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = l.match(/gridTemplateColumns: '([^']+)'/);
      if (!m || /repeat\(/.test(m[1]) || m[1].trim().split(/\s+(?![^()]*\))/).length !== 2 || !/\d+px/.test(m[1])) continue;
      const ok = /data-stack="md"/.test(l) || /px minmax|px 1fr/.test(m[1]) || /className="(pa-grid3|dialer-cols)/.test(l);
      assert.ok(ok, `${path.basename(f)}: ${m[1]} would not stack on phones`);
    }
  }
});
