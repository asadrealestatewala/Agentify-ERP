// Console/platform calendar days. Timestamps are stored in UTC ('YYYY-MM-DD HH:MM:SS' or ISO); anything a person reads as "the date"
// (payment date, receipt date, "today") must be the day in the platform timezone, or a late-evening payment shows on the wrong day.
export const PLATFORM_TZ = process.env.PLATFORM_TZ || 'Asia/Karachi';

/** The platform-local calendar day (YYYY-MM-DD) for a UTC timestamp, or today when none is given. Date-only values pass through. */
export function localDay(ts) {
  if (ts == null || ts === '') return new Date().toLocaleString('sv-SE', { timeZone: PLATFORM_TZ }).slice(0, 10);
  const s = String(ts);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(ms)) return s.slice(0, 10);
  return new Date(ms).toLocaleString('sv-SE', { timeZone: PLATFORM_TZ }).slice(0, 10);
}
export const localToday = () => localDay();
