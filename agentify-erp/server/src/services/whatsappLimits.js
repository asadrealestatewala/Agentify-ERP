// Who may use the WhatsApp inbox, and how much. Layers, lowest first: the platform default (console), the workspace's plan,
// the workspace's own override (a super admin sets it on the workspace). Nothing is on until the platform master switch AND an
// enabled layer say so. The pure parts (clean, merge) have no I/O so they are easy to test.
import { bad } from '../util.js';

export const DEFAULT_CAPS = { monthly: 1000, daily: 200 };

const whole = (v, label, max = 1_000_000) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > max) throw bad(`${label} must be a whole number from 0, or empty to use the default`);
  return n;
};

/** Validate plan / workspace / platform-default input: { enabled, monthly, daily } (messages sent by staff). */
export function cleanWhatsappLimits(input) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw bad('WhatsApp limits must be an object');
  const out = {};
  if (input.enabled !== undefined) out.enabled = !!input.enabled;
  if (input.monthly !== undefined) out.monthly = whole(input.monthly, 'Monthly WhatsApp messages');
  if (input.daily !== undefined) out.daily = whole(input.daily, 'Daily WhatsApp messages');
  if (out.monthly != null && out.daily != null && out.daily > out.monthly) throw bad('The daily limit cannot exceed the monthly limit');
  return Object.keys(out).length ? out : null;
}

/** Later layers override earlier ones key by key; a key left out keeps the earlier value. */
export function mergeWhatsappLimits(...layers) {
  const out = { enabled: false, ...DEFAULT_CAPS };
  for (const l of layers) {
    if (!l) continue;
    if (l.enabled !== undefined) out.enabled = !!l.enabled;
    if (l.monthly !== undefined && l.monthly !== null) out.monthly = l.monthly;
    if (l.daily !== undefined && l.daily !== null) out.daily = l.daily;
  }
  return out;
}
