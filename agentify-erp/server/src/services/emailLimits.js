// Pure rules for tenant e-mail allowances (no database, no I/O) so they are easy to test.
//
// Categories (what a message is for, which decides whether it is counted and how it is protected):
//   service       Agentify's own mail to the workspace owner/users: verification, password reset, billing and security notices.
//                 Never counted against a tenant allowance and never blocked by it.
//   operational   a tenant's mail about something the recipient is already involved in: appointment confirmations and reminders, receipts.
//   marketing     campaigns and lead-nurture sequences. Needs consent, carries an unsubscribe link and header.
// Only operational and marketing are metered per tenant.
import { bad } from '../util.js';

export const CATEGORIES = ['service', 'operational', 'marketing'];
export const METERED = ['operational', 'marketing'];
export const DEFAULT_THRESHOLDS = [70, 90, 100];

const whole = (v, label, max = 100_000_000) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > max) throw bad(`${label} must be a whole number from 0, or empty for unlimited`);
  return n;
};

/** Validate the plan editor / tenant override input. Missing categories stay unset (not configured). */
export function cleanEmailLimits(input) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw bad('E-mail limits must be an object');
  const out = {};
  for (const c of METERED) {
    if (input[c] === undefined || input[c] === null) continue;
    out[c] = { monthly: whole(input[c].monthly, `${c} monthly allowance`), daily: whole(input[c].daily, `${c} daily limit`) };
    if (out[c].monthly !== null && out[c].daily !== null && out[c].daily > out[c].monthly) throw bad(`The ${c} daily limit cannot exceed its monthly allowance`);
  }
  if (input.thresholds !== undefined) {
    const t = [...new Set((Array.isArray(input.thresholds) ? input.thresholds : []).map((x) => Math.trunc(Number(x))))].filter((n) => n >= 1 && n <= 100).sort((a, b) => a - b);
    if (!t.length || t.length > 5) throw bad('Warning thresholds are 1 to 5 percentages between 1 and 100');
    out.thresholds = t;
  }
  if (input.hard_stop !== undefined) out.hard_stop = !!input.hard_stop;
  if (input.topups !== undefined) out.topups = !!input.topups;
  return Object.keys(out).length ? out : null;
}

/** Merge layers, later ones win per category: [platform default, plan, workspace override]. */
export function resolveLimits(...layers) {
  const out = { thresholds: DEFAULT_THRESHOLDS, hard_stop: true, topups: true };
  for (const l of layers) {
    if (!l) continue;
    for (const c of METERED) if (l[c]) out[c] = { monthly: l[c].monthly ?? null, daily: l[c].daily ?? null };
    if (l.thresholds) out.thresholds = l.thresholds;
    if (l.hard_stop !== undefined) out.hard_stop = l.hard_stop;
    if (l.topups !== undefined) out.topups = l.topups;
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** anchor + n months, keeping the anchor's day of month, clipped to the month's length (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsClipped(anchorDay, n) {
  const [y, m, d] = anchorDay.split('-').map(Number);
  const t = (m - 1) + n;
  const yy = y + Math.floor(t / 12), mm = ((t % 12) + 12) % 12;
  return `${yy}-${pad(mm + 1)}-${pad(Math.min(d, daysIn(yy, mm)))}`;
}

/**
 * The usage period containing instant `atMs`: monthly windows counted from a stable anchor day (UTC). The anchor never
 * moves, so upgrading, downgrading or switching to annual billing does not restart consumption. An annual subscription still
 * gets its monthly allowance monthly.
 */
export function periodFor(anchorDay, atMs = Date.now()) {
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(anchorDay)) ? anchorDay : dayStr(atMs);
  const at = dayStr(atMs);
  const [ay, am] = anchor.split('-').map(Number);
  const [y, m] = at.split('-').map(Number);
  let n = (y - ay) * 12 + (m - am);
  if (n < 0) n = 0;
  while (addMonthsClipped(anchor, n) > at) n -= 1;
  while (addMonthsClipped(anchor, n + 1) <= at) n += 1;
  if (n < 0) n = 0;
  const start = addMonthsClipped(anchor, n);
  const end = addMonthsClipped(anchor, n + 1);
  return { key: start, start, end, resets_at: `${end}T00:00:00Z` };
}

/** Which of the configured thresholds a usage figure has reached (highest first match list, ascending). */
export const reachedThresholds = (used, allowance, thresholds = DEFAULT_THRESHOLDS) =>
  (allowance > 0 ? thresholds.filter((t) => used * 100 >= allowance * t) : (allowance === 0 ? thresholds : []));
