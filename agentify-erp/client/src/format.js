// All display formatting lives here so dates/currency are consistent app-wide. It follows the workspace's region
// (set once after sign-in with setRegion); until then, and for Pakistan, the output is exactly what it always was.
import { buildRegion } from '../../shared/region/index.js';

let R = buildRegion({});
/** Apply a workspace's region configuration (from /api/auth/region). */
export function setRegion(cfg) { R = buildRegion(cfg || {}); }
export const getRegion = () => R;

export const money = (n, opts) => R.money.format(n, opts);
export const num = (n) => R.money.number(n);
/** Compact money for tight spaces: 1.2M, 450K */
export const moneyShort = (n) => R.money.short(n);

/** 'YYYY-MM-DD' (or timestamp) -> '07-Oct-2026' in Pakistan, other styles elsewhere */
export const date = (s) => R.fmt.date(s);
export const dateTime = (s) => R.fmt.dateTime(s);
export const month = (s) => R.fmt.month(s);
/** A UTC instant ('…Z') shown as date and time in the workspace's timezone. */
export function dateTimeUtc(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return R.fmt.dateTime(iso);
  return R.fmt.dateTime(d.toLocaleString('sv-SE', { timeZone: R.config.timezone }));
}

/** Today in the workspace's timezone as YYYY-MM-DD (Pakistan: Asia/Karachi) */
export const today = () => R.fmt.today();
export const todayPK = today;

export const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function ago(s) {
  if (!s) return '—';
  const [y, mo, d, h, mi, se] = (s.match(/\d+/g) || []).map(Number);
  // the stored text is wall-clock time in the workspace's zone; find that zone's offset at that moment
  const wall = Date.UTC(y, mo - 1, d, h || 0, mi || 0, se || 0);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: R.config.timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(wall)).map((p) => [p.type, p.value]));
  const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - wall;
  const diff = (Date.now() - (wall - offset)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return date(s);
}

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

export const DATE_PRESETS = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['this_month', 'This month'], ['last_month', 'Last month'],
  ['this_quarter', 'This quarter'], ['this_year', 'This year'], ['all', 'All time'], ['custom', 'Custom range'],
];
export const cur = () => R.config.currency;
