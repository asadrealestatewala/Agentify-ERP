import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectMeta, platformSitemap, blogSlugOf } from '../src/services/marketing.js';
import { BLOG_POSTS } from '../src/services/blog.js';

const req = { protocol: 'https', get: () => 'agentifyerp.co' };
const shell = '<html><head><title>Agentify ERP</title></head><body><div id="root"></div></body></html>';

test('home page gets title, canonical, structured data and crawler text', () => {
  const h = injectMeta(shell, '/', req);
  assert.match(h, /<meta name="description"/);
  assert.match(h, /rel="canonical"/);
  assert.match(h, /application\/ld\+json/);
  assert.match(h, /<div id="root"><h1>/);
});

test('blog index and articles get their own tags and article schema', () => {
  assert.match(injectMeta(shell, '/blog', req), /<h1>.*blog<\/h1>/i);
  const p = BLOG_POSTS[0];
  assert.equal(blogSlugOf(`/blog/${p.slug}`), p.slug);
  assert.equal(blogSlugOf('/blog/nope'), null);
  const h = injectMeta(shell, `/blog/${p.slug}`, req);
  assert.match(h, /BlogPosting/);
  assert.ok(h.includes(`/blog/${p.slug}" />`));
});

test('sitemap lists every article', () => {
  const x = platformSitemap(req);
  for (const p of BLOG_POSTS) assert.ok(x.includes(`/blog/${p.slug}`));
  assert.ok(x.includes('/blog</loc>'));
});
