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

test('Pakistan article set: 40 extra, unique slugs, valid related links, SEO fields', async () => {
  const { BLOG_POSTS, getPost, bodyHtml } = await import('../src/services/blog.js');
  const extra = BLOG_POSTS.filter((p) => p.keyword);
  assert.equal(extra.length, 40);
  const slugs = new Set(BLOG_POSTS.map((p) => p.slug));
  assert.equal(slugs.size, BLOG_POSTS.length);
  for (const p of extra) {
    assert.ok(p.title.length <= 100 && p.description.length >= 70 && p.description.length <= 160, p.slug);
    assert.ok(p.tags.length >= 3 && p.tags.every((t) => t.startsWith('#')), p.slug);
    assert.ok(p.faq.length >= 2, p.slug);
    assert.ok(p.related.length >= 2 && p.related.every((r) => slugs.has(r)), p.slug);
    assert.match(bodyHtml(p), /Related articles/);
  }
  const h = injectMeta(shell, `/blog/${extra[0].slug}`, req);
  assert.match(h, /FAQPage/);
  assert.match(h, /name="keywords"/);
  assert.ok(getPost(extra[0].slug));
});

test('every article has image files, share tags and image schema', async () => {
  const fs = await import('node:fs');
  const { BLOG_POSTS, imageOf } = await import('../src/services/blog.js');
  const dir = new URL('../../client/public/blog-img/', import.meta.url);
  for (const p of BLOG_POSTS) {
    const im = imageOf(p);
    for (const f of [im.webp, im.jpg, im.og]) {
      if (f.startsWith('https://images.unsplash.com/')) { assert.ok(im.credit?.name && im.credit.profile.includes('utm_source=agentify_erp'), `${p.slug} needs a photo credit`); continue; }
      assert.ok(fs.existsSync(new URL(f.replace('/blog-img/', ''), dir)), `${p.slug} missing ${f}`);
    }
    assert.ok(im.alt.length > 10);
  }
  assert.ok(fs.existsSync(new URL('blog-index-og.jpg', dir)));
  const p = BLOG_POSTS[7];
  const h = injectMeta(shell, `/blog/${p.slug}`, req);
  assert.match(h, /property="og:image" content="https:\/\/(agentifyerp\.co\/blog-img\/.+-og\.jpg|images\.unsplash\.com\/.+)"/);
  assert.match(h, /summary_large_image/);
  assert.match(h, /"image":\["https:\/\/(agentifyerp\.co\/blog-img|images\.unsplash\.com)\//);
  assert.match(h, /<img src="(\/blog-img\/|https:\/\/images\.unsplash\.com\/).+" width="1600" height="900" alt=/);
  assert.match(platformSitemap(req), /<image:loc>https:\/\/(agentifyerp\.co\/blog-img|images\.unsplash\.com)\//);
  assert.match(injectMeta(shell, '/blog', req), /blog-index-og\.jpg/);
});
