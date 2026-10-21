#!/usr/bin/env node
// Builds a self-contained, installable Claude skill:
//
//   node erp-factory/tools/package-skill.mjs [--out <dir>] [--install] [--no-reference]
//
//   <out>/erp-factory/            SKILL.md + erp-factory/ (knowledge base) + agentify-erp/ (reference source, minus node_modules/data/.env)
//   --install                     also copies it to ~/.claude/skills/erp-factory  (available in EVERY project on this machine)
//   --no-reference                leave out the reference app source (docs only)
//
// Folder names inside the bundle match the repository, so every path written in the docs resolves relative to the skill directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const out = path.resolve(opt('--out') || path.join(root, 'dist'), 'erp-factory');
const SKIP = new Set(['node_modules', 'dist', 'data', 'uploads', '.env', '.git']);

const copy = (src, dst) => fs.cpSync(src, dst, { recursive: true, filter: (p) => !SKIP.has(path.basename(p)) && !/\.(db|db-wal|db-shm|zip)$/.test(p) });

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, '.claude', 'skills', 'erp-factory', 'SKILL.md'), path.join(out, 'SKILL.md'));
copy(path.join(root, 'erp-factory'), path.join(out, 'erp-factory'));
if (!args.includes('--no-reference')) copy(path.join(root, 'agentify-erp'), path.join(out, 'agentify-erp'));
fs.writeFileSync(path.join(out, 'erp-factory', 'BUNDLE.txt'), `Built ${new Date().toISOString()} from knowledge-base version ${fs.readFileSync(path.join(root, 'erp-factory', 'VERSION'), 'utf8').trim()}\n`);

let files = 0, bytes = 0;
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { files += 1; bytes += fs.statSync(p).size; } } })(out);
console.log(`Built ${out}\n  ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);

if (args.includes('--install')) {
  const dest = path.join(os.homedir(), '.claude', 'skills', 'erp-factory');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(out, dest, { recursive: true });
  console.log(`Installed to ${dest}`);
}
