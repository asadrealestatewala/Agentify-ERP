import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-askvid-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });

await import('../src/index.js').then((m) => m.createApp());
const yt = await import('../src/services/trainingYoutube.js');
const { platformDb } = await import('../src/platform.js');
const { ask } = await import('../src/services/assistant.js');
after(async () => { (await import('../src/db.js')).closeDbs(); });

const user = { id: 1, isSuper: true, perms: new Set() };
const urls = (o) => (o.links || []).map((l) => l.url);
const FIN = 'https://www.youtube.com/watch?v=fin123';

test('Ask offers the YouTube link saved in the console for the topic it answers, from any answer type', () => {
  yt.listVideos(); // the console library
  platformDb().prepare("UPDATE training_posts SET youtube_url=? WHERE key='finance'").run(FIN);
  assert.ok(urls(ask('how does accounting work', user)).includes(FIN), 'workflow answer');
  assert.ok(!urls(ask('how does payroll work', user)).includes(FIN), 'an unrelated topic gets no unrelated video');
  assert.ok(!urls(ask('how does payroll work', user)).some((u) => u.includes('youtube')), 'a video with no saved link is never offered');
});

test('Ask never offers a video the asker may not watch', () => {
  const agent = { id: 9, isSuper: false, role: 'Nobody', role_id: 99999, perms: new Set() };
  assert.ok(!urls(ask('how does accounting work', agent)).includes(FIN));
});
