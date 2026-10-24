import { currentRegion } from '../regions/runtime.js';

/** International format for a phone entered the way people write it in this country (null when it cannot be read). */
export function toE164(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\+[1-9]\d{6,14}$/.test(s.replace(/[\s()-]/g, ''))) return s.replace(/[\s()-]/g, '');
  return currentRegion().phone.e164(s);
}

/** Digits only of the international form: the key two spellings of one number share (+92 300 1234567 and 03001234567). */
export const phoneKey = (raw) => (toE164(raw) || '').replace(/\D/g, '');
