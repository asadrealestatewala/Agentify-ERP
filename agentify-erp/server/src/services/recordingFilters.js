// Filters for the Recordings screen (meetings and calls): keyword, customer, host/agent, date, time of day, transcript state, length.
// Everything is a bound parameter; the caller supplies the SQL expressions of its own tables.
import { bad } from '../util.js';

const like = (s) => `%${String(s).trim().toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
const anyLike = (exprs) => `(${exprs.map((e) => `lower(coalesce(${e},'')) LIKE ? ESCAPE '\\'`).join(' OR ')})`;

/**
 * @param query    req.query
 * @param spec     { text: [expr], customer: [expr], host: [expr], when: expr (a 'YYYY-MM-DD HH:MM:SS' column), transcript: expr, seconds: expr }
 * @returns {{ sql: string, params: any[], active: boolean }} an " AND ..." string (empty when nothing is filtered)
 */
export function recordingFilter(query, spec) {
  const out = []; const params = [];
  const s = (k) => String(query[k] ?? '').trim();
  if (s('q')) { out.push(anyLike(spec.text)); params.push(...spec.text.map(() => like(s('q')))); }
  if (s('customer')) { out.push(anyLike(spec.customer)); params.push(...spec.customer.map(() => like(s('customer')))); }
  if (s('host')) { out.push(anyLike(spec.host)); params.push(...spec.host.map(() => like(s('host')))); }
  for (const k of ['from', 'to']) if (s(k) && !/^\d{4}-\d{2}-\d{2}$/.test(s(k))) throw bad('Dates must look like 2026-10-24');
  for (const k of ['time_from', 'time_to']) if (s(k) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s(k))) throw bad('Times must look like 14:30');
  if (s('from')) { out.push(`substr(${spec.when},1,10) >= ?`); params.push(s('from')); }
  if (s('to')) { out.push(`substr(${spec.when},1,10) <= ?`); params.push(s('to')); }
  const tf = s('time_from'); const tt = s('time_to');
  if (tf && tt) {
    // a range such as 22:00 to 06:00 wraps past midnight
    if (tf <= tt) { out.push(`substr(${spec.when},12,5) BETWEEN ? AND ?`); params.push(tf, tt); }
    else { out.push(`(substr(${spec.when},12,5) >= ? OR substr(${spec.when},12,5) <= ?)`); params.push(tf, tt); }
  } else if (tf) { out.push(`substr(${spec.when},12,5) >= ?`); params.push(tf); } else if (tt) { out.push(`substr(${spec.when},12,5) <= ?`); params.push(tt); }
  const tr = s('transcript');
  if (tr === 'ready') out.push(`${spec.transcript} = 'done'`);
  else if (tr === 'none') out.push(`${spec.transcript} <> 'done'`);
  if (s('min_minutes')) {
    const n = Number(s('min_minutes'));
    if (!Number.isFinite(n) || n < 0 || n > 1000) throw bad('Minimum length must be a number of minutes');
    out.push(`coalesce(${spec.seconds},0) >= ?`); params.push(Math.round(n * 60));
  }
  return { sql: out.length ? ` AND ${out.join(' AND ')}` : '', params, active: out.length > 0 };
}
