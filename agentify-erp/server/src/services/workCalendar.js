// The workspace's working calendar: which weekdays are off, which dates are holidays and the working hours, all in the
// workspace's own IANA timezone. Weekend days come from the workspace setting, else the region pack's default
// (`work_week.weekend`), else Sunday only (what attendance has always assumed). Nothing here is fixed to one country.
import { all, getSetting, setSetting } from '../db.js';
import { currentRegion } from '../regions/runtime.js';
import { addDays, bad, jparse, now, tenantTz } from '../util.js';

const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function weekendDays() {
  const own = jparse(getSetting('work_weekend_days'), null);
  if (Array.isArray(own)) return own;
  const pack = currentRegion().config.work_week?.weekend;
  return Array.isArray(pack) ? pack : [0];
}

export function workCalendar() {
  return { timezone: tenantTz(), weekend: weekendDays(), work_start: getSetting('work_start', '09:00'), work_end: getSetting('work_end', '18:00'),
    source: Array.isArray(jparse(getSetting('work_weekend_days'), null)) ? 'workspace' : 'region' };
}

export function saveWorkCalendar({ weekend, work_start, work_end }) {
  if (weekend !== undefined) {
    const days = [...new Set([].concat(weekend).map(Number))];
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw bad('Weekend days must be weekday numbers 0 (Sunday) to 6 (Saturday)');
    if (days.length > 5) throw bad('Leave at least two working days in the week');
    setSetting('work_weekend_days', JSON.stringify(days.sort()));
  }
  for (const [k, v] of [['work_start', work_start], ['work_end', work_end]]) {
    if (v === undefined) continue;
    if (!TIME.test(String(v))) throw bad('Working hours must look like 09:00');
    setSetting(k, String(v));
  }
  const c = workCalendar();
  if (c.work_end <= c.work_start) throw bad('The working day must end after it starts');
  return c;
}

/** A checker for one calculation (reads holidays once). */
export function calendarChecker() {
  const off = new Set(weekendDays());
  const holidays = new Set(all('SELECT date FROM holidays').map((h) => h.date));
  return (d) => !off.has(dow(d)) && !holidays.has(d);
}

/**
 * Move `n` working days from a date. 0 means the date itself, or the next working day when it is off; a negative
 * number counts back (preparation before the joining date). Always terminates: at least two weekdays are working days.
 */
export function addWorkingDays(date, n, isWorking = calendarChecker()) {
  let d = date;
  const step = n < 0 ? -1 : 1;
  if (n === 0) { for (let i = 0; i < 400 && !isWorking(d); i++) d = addDays(d, 1); return d; }
  let left = Math.abs(n);
  for (let i = 0; left > 0 && i < 4000; i++) { d = addDays(d, step); if (isWorking(d)) left--; }
  return d;
}

/** Is it a working day, inside working hours, right now in the workspace's timezone? Reminders wait for this. */
export function inWorkingHours(at = now()) {
  const day = at.slice(0, 10), hm = at.slice(11, 16);
  const c = workCalendar();
  return calendarChecker()(day) && hm >= c.work_start && hm < c.work_end;
}
