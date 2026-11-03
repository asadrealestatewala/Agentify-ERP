// Readable dates for the platform console (the API sends ISO strings such as 2026-11-07T07:05:26.691Z or "2026-11-07 07:05:26").
const parse = (v) => {
  if (!v) return null;
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z';
  else if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s = `${s.replace(' ', 'T')}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 7 Nov 2026 (UTC calendar day, so it matches the stored date)
export const fmtDay = (v) => { const d = parse(v); return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : (v ? String(v).slice(0, 10) : '—'); };
// 7 Nov 2026, 07:05 (UTC)
export const fmtWhen = (v) => { const d = parse(v); return d ? `${fmtDay(v)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` : (v ? String(v).slice(0, 16) : '—'); };
