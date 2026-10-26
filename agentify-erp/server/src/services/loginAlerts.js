// "New sign-in" emails. Every successful staff sign-in is remembered as a (browser, IP address) pair. When a person signs in
// from an IP address they have never used, on a browser this server has not seen for them, they get an email saying when and
// from where, with a link to change their password (which signs every other session out).
//   * First sign-in on an account is only recorded (nothing to compare with), so a new user is not alerted.
//   * The same browser on a new IP (phone data, travel) is NOT alerted: the device cookie shows it is the usual browser.
//   * At most 3 alert emails per person per day, so a person on a changing mobile IP is not flooded.
// The browser is recognised by a long random cookie (erp_device) set after sign-in; clearing cookies makes the next sign-in
// look new, which is the safe direction.
import crypto from 'node:crypto';
import { all, get, run } from '../db.js';
import { sendMail, layout } from './mailer.js';
import { now } from '../util.js';

const COOKIE = 'erp_device';
const KEEP = 40;           // remembered (browser, IP) pairs per person
const MAX_PER_DAY = 3;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Short human text for the email: "Chrome on Windows". */
export function describeBrowser(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /wv\)/.test(s) ? 'the Agentify app' : 'a browser';
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad|iOS/.test(s) ? 'iOS' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/** The browser's long-lived identifier; created here when the browser has none. */
export function deviceId(req, res) {
  let id = req.cookies?.[COOKIE];
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(id || ''))) {
    id = crypto.randomBytes(24).toString('base64url');
    res.cookie(COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 400 * 864e5 });
  }
  return id;
}

/** Has this person signed in on this browser before? Read only; decides whether the email code step is asked for. */
export function recognised(userId, req) {
  const dev = req.cookies?.[COOKIE];
  return !!dev && !!get('SELECT 1 FROM login_devices WHERE user_id=? AND device_hash=?', userId, sha(dev));
}

/**
 * Remember this sign-in and email the person when it looks new. Never throws and never delays the sign-in.
 * Call after the session cookie is set.
 */
export function noteSignIn(req, res, u) {
  try {
    if (!u?.id || u.portal) return;
    const dev = deviceId(req, res);
    const hash = sha(dev);
    const ip = req.ip || 'unknown';
    const ua = String(req.get('user-agent') || '').slice(0, 300);
    const seenBefore = !!get('SELECT 1 FROM login_devices WHERE user_id=? LIMIT 1', u.id);
    const knownDevice = !!get('SELECT 1 FROM login_devices WHERE user_id=? AND device_hash=?', u.id, hash);
    const knownIp = !!get('SELECT 1 FROM login_devices WHERE user_id=? AND ip=?', u.id, ip);
    run(`INSERT INTO login_devices(user_id,device_hash,ip,user_agent,first_seen,last_seen) VALUES(?,?,?,?,?,?)
      ON CONFLICT(user_id,device_hash,ip) DO UPDATE SET last_seen=excluded.last_seen, user_agent=excluded.user_agent`, u.id, hash, ip, ua, now(), now());
    run('DELETE FROM login_devices WHERE user_id=? AND id NOT IN (SELECT id FROM login_devices WHERE user_id=? ORDER BY last_seen DESC, id DESC LIMIT ?)', u.id, u.id, KEEP);
    if (!seenBefore || knownIp || knownDevice || !u.email) return;
    const today = get("SELECT COUNT(*) n FROM login_alerts WHERE user_id=? AND created_at>=datetime('now','-1 day')", u.id).n;
    if (today >= MAX_PER_DAY) return;
    run("INSERT INTO login_alerts(user_id,ip,created_at) VALUES(?,?,datetime('now'))", u.id, ip);
    const origin = `${req.protocol}://${req.get('host')}`;
    const when = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const mail = layout({
      heading: 'New sign-in to your account',
      lines: [`Hi ${u.name}, your account was just signed in from an address we have not seen before.`, `When: ${when}`, `IP address: ${ip}`, `Browser: ${describeBrowser(ua)}`,
        'If this was you, there is nothing to do. If it was not, change your password now: that signs out every other session. Then ask your administrator to check Settings > Audit log.'],
      button: { label: 'Change my password', url: `${origin}/my/security` },
    });
    sendMail({ type: 'login_alert', to: u.email, subject: 'New sign-in to your account', ...mail }).catch(() => {});
  } catch (e) { console.error('[login-alert]', e.message); }
}

const FAIL_LIMIT = 5, FAIL_WINDOW_MIN = 15;
/**
 * A wrong password for a real account. After 5 in 15 minutes the owner gets one email (at most one per hour, so an attacker
 * cannot use it to flood their inbox). Never throws; the caller still answers "Invalid credentials" the same way.
 */
export function noteFailedLogin(req, row) {
  try {
    if (!row?.id) return;
    const ip = req.ip || 'unknown';
    run("INSERT INTO login_failures(user_id,ip,created_at) VALUES(?,?,datetime('now'))", row.id, ip);
    run("DELETE FROM login_failures WHERE created_at<datetime('now','-2 days')");
    if (!row.email) return;
    const n = get(`SELECT COUNT(*) n FROM login_failures WHERE user_id=? AND created_at>=datetime('now','-${FAIL_WINDOW_MIN} minutes')`, row.id).n;
    if (n < FAIL_LIMIT || get("SELECT 1 FROM login_failures WHERE user_id=? AND alerted=1 AND created_at>=datetime('now','-1 hour')", row.id)) return;
    run('UPDATE login_failures SET alerted=1 WHERE id=(SELECT MAX(id) FROM login_failures WHERE user_id=?)', row.id);
    const origin = `${req.protocol}://${req.get('host')}`;
    const mail = layout({
      heading: 'Someone is trying to guess your password',
      lines: [`Hi ${row.name}, there were ${n} wrong password attempts on your account in the last ${FAIL_WINDOW_MIN} minutes. The latest was from IP address ${ip}.`,
        'Nobody got in. If this was you, you can ignore this. If not, change your password now and consider turning on two-factor sign-in.'],
      button: { label: 'Reset my password', url: `${origin}/forgot-password` },
    });
    sendMail({ type: 'login_alert', to: row.email, subject: 'Wrong password attempts on your account', ...mail }).catch(() => {});
  } catch (e) { console.error('[login-alert]', e.message); }
}

/** Browsers this person has signed in from (newest first), with the addresses seen for each and which one is this request. */
export function deviceList(userId, req) {
  const mine = req.cookies?.[COOKIE] ? sha(req.cookies[COOKIE]) : null;
  const rows = all('SELECT device_hash, ip, user_agent, first_seen, last_seen FROM login_devices WHERE user_id=? ORDER BY last_seen DESC, id DESC', userId);
  const byDevice = new Map();
  for (const r of rows) {
    const d = byDevice.get(r.device_hash) || { browser: describeBrowser(r.user_agent), ips: [], first_seen: r.first_seen, last_seen: r.last_seen, current: r.device_hash === mine };
    if (!d.ips.includes(r.ip)) d.ips.push(r.ip);
    if (r.first_seen < d.first_seen) d.first_seen = r.first_seen;
    byDevice.set(r.device_hash, d);
  }
  return [...byDevice.values()];
}
