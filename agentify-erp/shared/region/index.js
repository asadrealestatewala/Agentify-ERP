// Builds the runtime helpers for one region configuration (a pack plus the workspace's own overrides).
// The same function runs on the server (per request) and in the browser (once, after sign-in).
import { createMoney } from './money.js';
import { createUnits } from './units.js';
import { createPhone } from './phone.js';
import { createFormat } from './format.js';
import { createT, direction } from './i18n.js';
import { createPrice } from './price.js';

export { createMoney, createUnits, createPhone, createFormat, createT, direction, createPrice };
export { sdlt, dldFees, closingCosts, monthlyExtras, bands } from './purchaseCosts.js';
export { effective, bracketTax } from './rules.js';
export { roundHalfAway } from './money.js';

/** The default configuration is Pakistan, byte-for-byte what the app did before regions existed. */
export const PK_DEFAULTS = Object.freeze({
  region: 'PK', locale: 'en-PK', currency: 'PKR', money_scale: 0, currency_style: 'code_prefix', date_style: 'DD-Mon-YYYY', time_style: '12h',
  timezone: 'Asia/Karachi', units_system: 'mixed', marla_sqft: 272.25, phone: { calling_code: '92', trunk: '0', match_tail: 10, national_length: [10] },
  language: 'en', terminology: {}, flags: {}, price_style: 'south_asian', rent_suffix: ' / month',
});

export function buildRegion(cfg = {}) {
  const c = { ...PK_DEFAULTS, ...cfg, phone: { ...PK_DEFAULTS.phone, ...(cfg.phone || {}) } };
  return {
    config: c,
    money: createMoney({ currency: c.currency, scale: c.money_scale, locale: c.locale, style: c.currency_style }),
    units: createUnits({ marlaSqFt: c.marla_sqft }),
    phone: createPhone(c.phone),
    fmt: createFormat({ date_style: c.date_style, time_style: c.time_style, timezone: c.timezone }),
    price: createPrice({ price_style: c.price_style, currency: c.currency, locale: c.locale, money_scale: c.money_scale, rent_suffix: c.rent_suffix }),
    dir: direction(c.language || c.locale),
    /** Name of the national ID in this country (CNIC, SSN, Emirates ID, ...), without the "(last 4 shown)" suffix. */
    idLabel: String(c.identity?.national_id?.label || 'CNIC').replace(/\s*\(.*\)\s*$/, ''),
    /** True for Pakistan, where the CNIC is stored on the contact itself. */
    isPK: (c.region || 'PK') === 'PK',
    /** Terminology with a fallback to the given English default: term('agent', 'Sales Agent'). */
    term: (key, fallback) => c.terminology?.[key] ?? fallback ?? key,
  };
}
