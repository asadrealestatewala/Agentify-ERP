import { all, run, getSetting, setSetting } from '../db.js';
import { platformDb } from '../platform.js';
import { CHANGELOG } from '../../../shared/changelog.js';
import { now } from '../util.js';

// One in-app notification per release, for everyone. Runs on start-up and with the regular background jobs; the key
// per person (`release-v1.26`) and the per-workspace marker make it safe to run as often as needed. In-app only:
// nothing is pushed, e-mailed or sent to WhatsApp.
const latest = () => CHANGELOG[0];
const summary = (r) => (r.items[0]?.text || '').slice(0, 160);

/** Inside a workspace: tell every active staff user (not customer-portal users) about the newest release, once. */
export function announceRelease() {
  const r = latest();
  if (!r || getSetting('release_announced') === r.version) return { skipped: true };
  const users = all('SELECT u.id FROM users u JOIN roles ro ON ro.id=u.role_id WHERE u.active=1 AND ro.portal=0');
  let n = 0;
  for (const u of users) {
    n += run('INSERT OR IGNORE INTO notifications(user_id,type,title,body,link,read,dedupe,created_at) VALUES(?,?,?,?,?,0,?,?)',
      u.id, 'release', `Agentify ERP ${r.version}: ${r.title}`, summary(r), '/whats-new', `release-${r.version}`, now()).changes;
  }
  setSetting('release_announced', r.version);
  return { version: r.version, created: n };
}

/** For the Super Admin console: one alert per release, shown to every console user with its own read state. */
export function announcePlatformRelease() {
  const r = latest();
  if (!r) return { skipped: true };
  const c = platformDb().prepare("INSERT INTO platform_notifications(kind,severity,title,body,link,dedupe) VALUES('release','info',?,?,'/platform/whats-new',?) ON CONFLICT(dedupe) DO NOTHING")
    .run(`Agentify ERP ${r.version}: ${r.title}`, summary(r), `release:${r.version}`);
  return { version: r.version, created: c.changes };
}
