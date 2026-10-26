// A React hook after an early `return` in the same component crashes the page once the early return stops applying
// (minified React error #310: a blank screen). This scans every client component for that pattern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/src');
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.jsx$/.test(e.name)) files.push(p); } })(root);

/** Components start at column 0 (`function X(`, `export default function X(`, `const X = (`) and end at a line that is just `}` or `};`. */
export function hookAfterReturn(src) {
  const lines = src.split('\n'), found = [];
  let start = -1, returned = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^(export default |export )?(async )?function [A-Z]\w*\(|^(export )?const [A-Z]\w* = (\(|memo\(|forwardRef\()/.test(l)) { start = i; returned = null; continue; }
    if (start < 0) continue;
    if (/^[}\)]/.test(l)) { start = -1; continue; }
    if (returned === null && /^ {2}if \(.*\) return\b/.test(l)) returned = i + 1;
    else if (returned !== null && /^ {2}(const|let) .*= (React\.)?use[A-Z]\w*\(/.test(l)) found.push({ line: i + 1, early: returned });
  }
  return found;
}

test('detector: finds a hook placed after an early return', () => {
  assert.equal(hookAfterReturn('function A() {\n  const [a] = useState(1);\n  if (!a) return null;\n  const [b, setB] = useState(2);\n  return 1;\n}\n').length, 1);
  assert.equal(hookAfterReturn('function A() {\n  const [a] = useState(1);\n  const [b] = useState(2);\n  if (!a) return null;\n  return 1;\n}\n').length, 0);
});

test('no client component calls a hook after an early return', () => {
  const bad = [];
  for (const f of files) for (const h of hookAfterReturn(fs.readFileSync(f, 'utf8'))) bad.push(`${path.relative(root, f)}:${h.line} (early return at ${h.early})`);
  assert.deepEqual(bad, []);
});
