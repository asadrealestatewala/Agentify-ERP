// Business-hours arithmetic in an IANA timezone (pure: the caller supplies the working-day test). Used for response deadlines
// and sequence sending windows. All inputs and outputs are UTC milliseconds; local wall clock is only used to find the day and
// the opening/closing times, so daylight-saving changes and zones other than the server's are handled by shared/visits.js.
import { wallToMs, msToWall } from '../../../shared/visits.js';

const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
const win = (d, tz, start, end) => ({ open: wallToMs(`${d} ${start}:00`, tz), close: wallToMs(`${d} ${end}:00`, tz) });

/** Add `minutes` of working time to an instant. With businessOnly=false it is plain elapsed time. */
export function addBusinessMinutes(startMs, minutes, { tz, isWorking, start = '09:00', end = '18:00', businessOnly = true }) {
  if (!businessOnly) return startMs + minutes * 60_000;
  let cursor = startMs, left = minutes * 60_000;
  let day = msToWall(cursor, tz).slice(0, 10);
  for (let i = 0; i < 800; i++) {
    if (isWorking(day)) {
      const w = win(day, tz, start, end);
      if (cursor < w.open) cursor = w.open;
      if (cursor < w.close) {
        const take = Math.min(left, w.close - cursor);
        cursor += take; left -= take;
        if (left <= 0) return cursor;
      }
    }
    day = nextDay(day);
    cursor = Math.max(cursor, wallToMs(`${day} 00:00:00`, tz));
  }
  return cursor;
}

/** The first instant at or after `ms` that lies inside a sending window (a working day between start and end). */
export function alignToWindow(ms, { tz, isWorking, start = '09:00', end = '18:00', anyDay = false }) {
  let day = msToWall(ms, tz).slice(0, 10);
  for (let i = 0; i < 800; i++) {
    if (anyDay || isWorking(day)) {
      const w = win(day, tz, start, end);
      if (ms < w.open) return w.open;
      if (ms < w.close) return ms;
    }
    day = nextDay(day);
    ms = Math.max(ms, wallToMs(`${day} 00:00:00`, tz));
  }
  return ms;
}

/** Minutes of working time between two instants (for "time to first human response"; open hours only). */
export function businessMinutesBetween(aMs, bMs, { tz, isWorking, start = '09:00', end = '18:00' }) {
  if (bMs <= aMs) return 0;
  let total = 0, day = msToWall(aMs, tz).slice(0, 10);
  const lastDay = msToWall(bMs, tz).slice(0, 10);
  for (let i = 0; i < 800 && day <= lastDay; i++) {
    if (isWorking(day)) {
      const w = win(day, tz, start, end);
      const from = Math.max(aMs, w.open), to = Math.min(bMs, w.close);
      if (to > from) total += to - from;
    }
    day = nextDay(day);
  }
  return Math.round(total / 60_000);
}
