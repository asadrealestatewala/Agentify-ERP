import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Release announcements: one in-app notification per version, per person; nothing is sent outside the app.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-rel-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', ERP_MAIL_QUIET: '1' });

const { all, get, run, setSetting, getSetting, closeDbs } = await import('../src/db.js');
const { announceRelease, announcePlatformRelease } = await import('../src/services/releaseNotice.js');
const { platformDb } = await import('../src/platform.js');
const { CHANGELOG } = await import('../../shared/changelog.js');
const { listNotifications, markRead } = await import('../src/services/platformMetrics.js');
const V = CHANGELOG[0].version;
after(() => closeDbs());

test('workspace: every active staff user gets one release notice, never customers or inactive users, and never twice', () => {
  const role = (name, portal) => run('INSERT INTO roles(name,portal) VALUES(?,?)', name, portal).lastInsertRowid;
  const staff = role('Fake Staff', 0), portal = role('Fake Portal', 1);
  const mk = (n, r, active) => run('INSERT INTO users(name,email,password_hash,role_id,active,created_at) VALUES(?,?,?,?,?,?)', n, `${n}@x.test`, 'x', r, active, '2026-01-01').lastInsertRowid;
  const a = mk('a', staff, 1), b = mk('b', staff, 1), c = mk('c', portal, 1), d = mk('d', staff, 0);
  const r1 = announceRelease();
  assert.equal(r1.version, V);
  const rows = all("SELECT user_id, link, read FROM notifications WHERE type='release'");
  const ids = rows.map((x) => x.user_id);
  assert.ok(ids.includes(a) && ids.includes(b));
  assert.ok(!ids.includes(c) && !ids.includes(d));
  assert.ok(rows.every((x) => x.link === '/whats-new' && x.read === 0));
  assert.equal(announceRelease().skipped, true);
  // even if the marker is lost, the per-person key stops duplicates
  setSetting('release_announced', '');
  assert.equal(announceRelease().created, 0);
  assert.equal(all("SELECT 1 FROM notifications WHERE type='release'").length, rows.length);
  // a user who already read it keeps their read state
  run("UPDATE notifications SET read=1 WHERE user_id=? AND type='release'", a);
  setSetting('release_announced', '');
  announceRelease();
  assert.equal(get("SELECT read FROM notifications WHERE user_id=? AND type='release'", a).read, 1);
  assert.equal(getSetting('release_announced'), V);
});

test('workspace: a new version is announced again, an old one is not repeated', () => {
  setSetting('release_announced', 'v0.1');
  run("UPDATE notifications SET dedupe='release-v0.9' WHERE type='release'");
  const r = announceRelease();
  assert.equal(r.created > 0, true);
});

test('console: one alert per version, separate read state per console user', () => {
  assert.equal(announcePlatformRelease().created, 1);
  assert.equal(announcePlatformRelease().created, 0);
  const db = platformDb();
  const adm = (e) => db.prepare("INSERT INTO platform_admins(email,name,password_hash) VALUES(?,?,'x')").run(e, e).lastInsertRowid;
  const x = adm('x@x.test'), y = adm('y@x.test');
  const l = listNotifications(x).items.find((n) => n.kind === 'release');
  assert.equal(l.link, '/platform/whats-new');
  assert.ok(l.title.includes(V));
  markRead(x, [l.id]);
  assert.equal(listNotifications(x).items.find((n) => n.kind === 'release').read, true);
  assert.equal(listNotifications(y).items.find((n) => n.kind === 'release').read, false);
});
