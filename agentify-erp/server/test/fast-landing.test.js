// The public pages carry their data and the list of files to fetch up front, so they load in one round trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fastLanding, resetLandingCache } from '../src/services/fastLanding.js';

const shell = '<html><head><title>x</title></head><body><div id="root"><h1>Hi</h1></div></body></html>';

function distWith(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-fast-'));
  if (manifest) { fs.mkdirSync(path.join(dir, '.vite')); fs.writeFileSync(path.join(dir, '.vite', 'manifest.json'), JSON.stringify(manifest)); }
  return dir;
}

test('the page lists the public page files (not the app files it already has) and carries its data safely', () => {
  resetLandingCache();
  const dist = distWith({
    'index.html': { file: 'assets/index-1.js', isEntry: true, imports: ['_shared.js'], css: ['assets/index-1.css'] },
    '_shared.js': { file: 'assets/shared-1.js' },
    'src/marketing/Marketing.jsx': { file: 'assets/Marketing-1.js', imports: ['_shared.js', '_logo.js'], css: ['assets/Marketing-1.css'] },
    '_logo.js': { file: 'assets/Logo-1.js', css: ['assets/site-1.css'] },
  });
  const html = fastLanding(shell, { dist, site: () => ({ landing: true }), marketing: () => ({ content: { brand: '</script><script>alert(1)</script>' } }) });
  assert.match(html, /<link rel="modulepreload" href="\/assets\/Marketing-1\.js" \/>/);
  assert.match(html, /<link rel="modulepreload" href="\/assets\/Logo-1\.js" \/>/);
  assert.match(html, /<link rel="preload" as="style" href="\/assets\/Marketing-1\.css" \/>/);
  assert.match(html, /<link rel="preload" as="style" href="\/assets\/site-1\.css" \/>/);
  assert.doesNotMatch(html, /shared-1\.js|index-1/, 'files the app already loads are not listed twice');
  assert.match(html, /<div id="root"><h1>Hi<\/h1>/, 'the search-engine text stays');
  const json = html.match(/<script type="application\/json" id="erp-boot">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(json, /<\/script/i, 'page text can never close the data block');
  const data = JSON.parse(json);
  assert.equal(data.main, true); assert.equal(data.site.landing, true);
  assert.equal(data.marketing.content.brand, '</script><script>alert(1)</script>');
});

test('without a build manifest or with failing data the page still works the old way', () => {
  resetLandingCache();
  const html = fastLanding(shell, { dist: distWith(null), site: () => { throw new Error('db down'); }, marketing: () => ({}) });
  assert.doesNotMatch(html, /modulepreload|erp-boot/);
  assert.match(html, /<\/head>/);
});
