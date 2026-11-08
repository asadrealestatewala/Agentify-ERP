import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-blogagent-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', ERP_BASE_DOMAIN: 'agentifyerp.co', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345' });

const agent = await import('../src/services/blogAgent.js');
const blog = await import('../src/services/blog.js');
const { setSetting } = await import('../src/services/platformConfig.js');
const fx = await import('../src/services/fxRate.js');

const realFetch = globalThis.fetch; let n = 0; const urls = [];
const long = (k) => Array.from({ length: 9 }, (_, i) => `Paragraph ${i} about ${k} with enough ordinary words to build a realistic article body for the check that counts words in the text. `.repeat(3));
const article = (k) => ({ title: `A practical guide to ${k} for property dealers`, description: `How property dealers can handle ${k} step by step, with a simple checklist and common mistakes to avoid.`, tag: 'Real estate', keyword: k, tags: ['#realestate'],
  body: ['# Why it matters', long(k)[0], '# Step one', long(k)[1], '* Check the file', '* Confirm the dues', '# Step two', long(k)[2], ...long(k).slice(3), '# Common mistakes', long(k)[4]], faq: [['Is it hard?', 'No.'], ['Is it slow?', 'Not really.'], ['Is it free?', 'Depends.']] });
before(() => {
  fx.saveFxSettings({ live: false, manual_rate: 300 }, 'test');
  setSetting('platform_gemini_key', 'AIza' + 'x'.repeat(35), { secret: true });
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); urls.push(u);
    if (u.includes('api.tavily.com')) return new Response(JSON.stringify({ results: [{ title: 'Source', url: 'https://example.com/a', content: 'Some facts about the topic.' }] }), { status: 200 });
    if (u.includes(':generateContent')) {
      const prompt = JSON.parse(opts.body).contents[0].parts[0].text;
      const text = prompt.startsWith('Focus:')
        ? JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ topic: `Topic number ${i} widgets${i}`, keyword: `kw${i}`, query: `q${i}` })))
        : JSON.stringify(article(`subject ${++n} alpha${n} beta${n}`));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 } }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
});
after(() => { globalThis.fetch = realFetch; });

test('does nothing until it is switched on and has a Tavily key', async () => {
  assert.match((await agent.runBlogAgent()).skipped, /switched off/);
  agent.saveSettings({ enabled: true });
  assert.match((await agent.runBlogAgent()).skipped, /Tavily/);
});

test('settings: cap limits, key format and keys are never returned', () => {
  assert.throws(() => agent.saveSettings({ cap: 0 }), /whole number/);
  assert.throws(() => agent.saveSettings({ cap: 11 }), /whole number/);
  assert.throws(() => agent.saveSettings({ tavily_key: 'bad key!' }), /does not look right/);
  const s = agent.saveSettings({ cap: 5, tavily_key: 'tvly-abcdef1234567890' });
  assert.equal(s.cap, 5); assert.equal(s.tavily.set, true);
  assert.ok(!JSON.stringify(s).includes('abcdef1234567890'));
});

test('a run writes exactly the daily cap as drafts that are NOT public until approved', async () => {
  const r = await agent.runBlogAgent();
  assert.equal(r.made.length, 5, JSON.stringify(r.errors));
  assert.ok(r.made.every((m) => m.status === 'draft' && m.problems.length === 0));
  assert.equal(blog.allPosts().length, blog.BLOG_POSTS.length, 'drafts are not on the blog');
  assert.match((await agent.runBlogAgent()).skipped, /limit of 5/);
  assert.equal(agent.madeToday(), 5);
});

test('approving publishes to the blog, unpublish takes it back, reject hides it', () => {
  const [first, second] = agent.listDrafts();
  const before = blog.allPosts().length;
  agent.decide(first.id, 'publish', 'admin@test');
  assert.equal(blog.allPosts().length, before + 1);
  const p = blog.getPost(first.slug); assert.ok(p && p.agent);
  assert.ok(blog.bodyHtml(p).includes('<h2>'));
  assert.ok(blog.listPosts().some((x) => x.slug === first.slug));
  assert.throws(() => agent.removeDraft(first.id), /Unpublish/);
  agent.decide(first.id, 'unpublish', 'admin@test');
  assert.equal(blog.getPost(first.slug), null);
  agent.decide(second.id, 'reject', 'admin@test');
  assert.equal(agent.getDraft(second.id).status, 'rejected');
});

test('editing a draft re-parses the body', () => {
  const d = agent.listDrafts().find((x) => x.status === 'draft');
  const e = agent.editDraft(d.id, { text: '# New heading\nA paragraph.\n* one\n* two' });
  assert.deepEqual(e.body.map((b) => Object.keys(b)[0]), ['h', 'p', 'ul']);
  assert.throws(() => agent.editDraft(d.id, { title: 'short' }), /title/);
});

test('quality checks reject thin, duplicate and boilerplate articles', () => {
  assert.ok(agent.checkArticle({ title: 'Short guide', description: 'x', body: ['hello'] }, []).problems.length >= 3);
  const ok = article('unique topic xyz');
  assert.equal(agent.checkArticle(ok, ['Something else entirely']).problems.length, 0);
  assert.match(agent.checkArticle(ok, [ok.title]).problems.join(), /existing article/);
  assert.match(agent.checkArticle({ ...ok, body: [...ok.body, 'As an AI language model I cannot.'] }, []).problems.join(), /boilerplate/);
  assert.ok(agent.similarity('real estate crm', 'real estate crm') === 1);
});

test('the writing engine can be Groq, and falls back to Gemini when Groq fails', async () => {
  setSetting('groq_api_key', 'gsk_' + 'a'.repeat(40), { secret: true });
  assert.throws(() => agent.saveSettings({ engine: 'openai' }), /Gemini or Groq/);
  assert.equal(agent.saveSettings({ engine: 'groq' }).engine, 'groq');
  assert.equal(agent.settings().engines.groq, true);
  const prev = globalThis.fetch; let groqCalls = 0, geminiCalls = 0, groqOk = true;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('api.groq.com')) { groqCalls++; if (!groqOk) return new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 }); const body = JSON.parse(opts.body); assert.equal(body.response_format.type, 'json_object'); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ topics: [{ topic: 'Groq topic about plots', keyword: 'plots', query: 'plots' }] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200 }); }
    if (u.includes(':generateContent')) geminiCalls++;
    return prev(url, opts);
  };
  try {
    const t = await agent.proposeTopics(1, 'focus');
    assert.equal(t[0].topic, 'Groq topic about plots'); assert.equal(groqCalls, 1); assert.equal(geminiCalls, 0);
    groqOk = false;
    const t2 = await agent.proposeTopics(1, 'focus');
    assert.ok(t2.length === 1 && geminiCalls === 1, 'fell back to Gemini');
  } finally { globalThis.fetch = prev; agent.saveSettings({ engine: 'gemini' }); }
});

test('the sitemap lists published agent articles', async () => {
  const d = agent.listDrafts().find((x) => x.status === 'draft');
  agent.decide(d.id, 'publish', 'admin@test');
  const { platformSitemap } = await import('../src/services/marketing.js');
  assert.ok(String(platformSitemap({ get: () => 'agentifyerp.co', protocol: 'https', headers: {}, hostname: 'agentifyerp.co' })).includes(`/blog/${d.slug}`));
});

test('Google Search Console ownership file is served on the main site', async () => {
  const { createApp } = await import('../src/index.js');
  const http = await import('node:http');
  const srv = createApp().listen(0);
  try {
    const t = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: srv.address().port, path: '/googlea752702b6eef04aa.html', headers: { Host: 'agentifyerp.co' } }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => resolve({ status: r.statusCode, b })); }).on('error', reject));
    assert.equal(t.b, 'google-site-verification: googlea752702b6eef04aa.html'); assert.equal(t.status, 200);
  } finally { srv.close(); (await import('../src/db.js')).closeDbs(); }
});

test('Groq JSON-mode failure is retried without JSON mode, and a broken article answer is retried once', async () => {
  agent.saveSettings({ engine: 'groq' });
  const prev = globalThis.fetch; const modes = []; let bad = 1;
  const art = JSON.stringify(article('retry subject gamma delta'));
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.includes('api.groq.com')) return prev(url, opts);
    const body = JSON.parse(opts.body); modes.push(Boolean(body.response_format));
    if (body.response_format) return new Response(JSON.stringify({ error: { message: "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details." } }), { status: 400 });
    const content = bad-- > 0 ? 'not json at all' : art; // first plain answer is garbage, second is fine
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }), { status: 200 });
  };
  try {
    const a = await agent.writeArticle({ topic: 'x', keyword: 'y', query: 'z' }, []);
    assert.ok(a.title.includes('retry subject'));
    assert.deepEqual(modes, [true, false, true, false], 'strict JSON first, then plain, on each attempt');
  } finally { globalThis.fetch = prev; agent.saveSettings({ engine: 'gemini' }); }
});
